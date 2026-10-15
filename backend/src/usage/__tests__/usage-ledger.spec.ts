import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { UsageLedger } from "../usage-ledger";
import type { ExecutionObservation } from "@workspace/core/usage";

it("reads and updates an existing ledger with the retired behavior column", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "usage-upgrade-"));
  const file = path.join(dir, "usage.sqlite");
  const at = Date.parse("2026-10-15T12:00:00Z");
  const previous = new DatabaseSync(file);
  previous.exec(
    "CREATE TABLE executions(provider TEXT,session_id TEXT,turn_id TEXT,agent_id TEXT,model TEXT,team_id TEXT,repository TEXT,phase TEXT,started_at INTEGER,updated_at INTEGER,duration_ms INTEGER,tokens TEXT,behavior TEXT,timing TEXT,PRIMARY KEY(provider,session_id,turn_id))",
  );
  previous
    .prepare(
      "INSERT INTO executions VALUES('claude','s','old','a','model',NULL,NULL,'completed',?,?,NULL,NULL,?,NULL)",
    )
    .run(at, at, '{"responses":2}');
  previous.close();
  const ledger = new UsageLedger(file, () => at);
  const event = {
    provider: "claude" as const,
    agentId: "a",
    sessionId: "s",
    model: "model",
    at,
  };
  try {
    await ledger.load();
    expect(
      await ledger.observe(
        {
          ...event,
          turnId: "old",
          phase: "usage",
          tokens: { input: 100, output: 40, cacheRead: 10, cacheWrite: 0 },
        },
        { teamId: null, repository: null },
      ),
    ).toBe(true);
    expect(
      await ledger.observe(
        { ...event, turnId: "new", phase: "started" },
        { teamId: null, repository: null },
      ),
    ).toBe(true);
    expect(ledger.query().rows[0]).toMatchObject({
      started: 2,
      completed: 1,
      measuredTurns: 1,
      tokens: { total: 140 },
    });
  } finally {
    await ledger.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("includes every retained execution beyond 10,000 in totals and model breakdowns", async () => {
  const at = Date.parse("2026-10-15T12:00:00Z");
  const ledger = new UsageLedger(":memory:", () => at);
  try {
    await ledger.load();
    for (let i = 0; i < 10001; i++)
      await ledger.observe(
        {
          provider: "claude",
          agentId: "a",
          sessionId: "s",
          turnId: String(i),
          model: i === 10000 ? "latest-model" : "model",
          phase: "started",
          at: at - 10001 + i,
        },
        { teamId: null, repository: null },
      );
    expect(ledger.query().rows[0]?.started).toBe(10001);
    expect(ledger.query({ group: "model" }).rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "latest-model", started: 1 }),
      ]),
    );
    expect(ledger.query().daily?.[0]?.started).toBe(10001);
  } finally {
    await ledger.close();
  }
});

it("imports statistics once, persists only statistics in SQLite, and replaces late measurements without inflating daily totals", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "local-analytics-"));
  const file = path.join(dir, "usage.sqlite"),
    legacy = path.join(dir, "usage.json");
  const at = Date.parse("2026-10-15T12:00:00Z");
  const event: ExecutionObservation = {
    provider: "claude",
    agentId: "a",
    sessionId: "s",
    turnId: "t",
    phase: "started",
    model: "claude-sonnet-4-6",
    at,
  };
  let ledger = new UsageLedger(file, () => at, legacy);
  try {
    await writeFile(
      legacy,
      JSON.stringify({
        since: at - 86400000,
        records: [
          {
            ...event,
            phase: "completed",
            startedAt: at,
            teamId: "team",
            repository: "repo",
            prompt: "CONTENT_CANARY",
            response: "CONTENT_CANARY",
            tokens: {
              input: 100,
              output: 20,
              cacheRead: 10,
              cacheWrite: null,
              total: 120,
            },
          },
        ],
      }),
    );
    await ledger.load();
    expect(ledger.query({ group: "provider" }).rows[0]).toMatchObject({
      started: 1,
      completed: 1,
      tokens: { total: 120 },
    });
    const timing = { activeMs: 12000, ttftMs: 2000 };
    expect(
      await ledger.observe(
        {
          ...event,
          phase: "usage",
          tokens: {
            input: 100,
            output: 20,
            cacheRead: 10,
            cacheWrite: null,
            total: 120,
          },
          timing,
        },
        { teamId: null, repository: null },
      ),
    ).toBe(true);
    expect(
      await ledger.observe(event, { teamId: null, repository: null }),
    ).toBe(false);
    expect(ledger.query({ group: "model" })).toMatchObject({
      daily: [{ day: "2026-10-15", started: 1, tokens: { total: 120 } }],
      rows: [
        {
          label: event.model,
          // 20 tokens over the 10s after the first output.
          speed: {
            turns: 1,
            outputTokens: 20,
            generationMs: 10000,
            ttftMs: 2000,
            ttftTurns: 1,
          },
        },
      ],
    });
    await ledger.close();
    ledger = new UsageLedger(file, () => at, legacy);
    await ledger.load();
    expect(ledger.query().rows[0]).toMatchObject({
      started: 1,
      speed: { turns: 1, outputTokens: 20, generationMs: 10000 },
    });
    expect(ledger.query({ provider: "codex" }).rows).toStrictEqual([]);
    await ledger.close();
    const bytes = await readFile(file);
    expect(bytes.subarray(0, 16).toString()).toBe("SQLite format 3\0");
    expect(bytes.toString()).not.toContain("CONTENT_CANARY");
  } finally {
    await ledger.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("keeps storage failures isolated and reports analytics as unavailable instead of inventing zero usage", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "local-analytics-failure-"));
  const parent = path.join(dir, "blocked");
  await writeFile(parent, "file");
  const ledger = new UsageLedger(path.join(parent, "usage.sqlite"));
  try {
    await expect(ledger.load()).resolves.toBeUndefined();
    expect(ledger.query()).toMatchObject({ available: false, rows: [] });
  } finally {
    await ledger.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("returns daily provider and model series from the same executions, preserving unknown tokens and late corrections", async () => {
  const at = Date.parse("2026-10-15T12:00:00Z");
  const ledger = new UsageLedger(":memory:", () => at);
  try {
    await ledger.load();
    for (const [turnId, provider, model] of [
      ["one", "claude", "sonnet"],
      ["two", "claude", "opus"],
      ["three", "codex", null],
    ] as const) {
      await ledger.observe(
        {
          agentId: "a",
          sessionId: "s",
          turnId,
          provider,
          model,
          phase: "started",
          at,
        },
        { teamId: null, repository: null },
      );
    }
    const providerDay = ledger.query({ group: "provider" }).daily![0]!;
    expect(providerDay).toMatchObject({
      started: 3,
      groups: [
        { label: "claude", started: 2, tokens: null },
        { label: "codex", started: 1, tokens: null },
      ],
    });
    expect(ledger.query({ group: "model" }).daily![0]).toMatchObject({
      started: 3,
      groups: [
        { label: "sonnet", started: 1 },
        { label: "opus", started: 1 },
        { label: "Unknown", started: 1 },
      ],
    });
    await ledger.observe(
      {
        agentId: "a",
        sessionId: "s",
        turnId: "one",
        provider: "claude",
        model: "sonnet",
        phase: "usage",
        at,
        tokens: {
          total: 100,
          input: 80,
          output: 20,
          cacheRead: 0,
          cacheWrite: null,
        },
      },
      { teamId: null, repository: null },
    );
    expect(
      ledger.query({ group: "model", provider: "claude" }).daily![0],
    ).toMatchObject({
      started: 2,
      groups: [
        { label: "sonnet", started: 1, tokens: { total: 100 } },
        { label: "opus", started: 1, tokens: null },
      ],
    });
    await ledger.observe(
      {
        agentId: "a",
        sessionId: "s",
        turnId: "one",
        provider: "claude",
        model: "sonnet",
        phase: "usage",
        at,
        tokens: null,
      },
      { teamId: null, repository: null },
    );
    expect(ledger.query({ group: "model" }).daily![0]).toMatchObject({
      started: 3,
      tokens: null,
      groups: expect.arrayContaining([
        expect.objectContaining({ label: "sonnet", tokens: null }),
      ]),
    });
  } finally {
    await ledger.close();
  }
});
