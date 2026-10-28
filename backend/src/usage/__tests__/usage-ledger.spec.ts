import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { UsageLedger } from "../usage-ledger";
import type { ExecutionObservation } from "@workspace/core/usage";

it("persists turn-start effort and service tier without replacing them on later updates", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "usage-settings-"));
  const file = path.join(dir, "usage.sqlite"), at = Date.now();
  const ledger = new UsageLedger(file, () => at);
  const event = { provider: "codex" as const, agentId: "a", sessionId: "s", model: null, at };
  try {
    await ledger.load();
    for (const [i, serviceTier] of ["normal", "fast", "ultrafast", null].entries()) {
      const turn = { ...event, turnId: String(i) };
      await ledger.observe({ ...turn, model: i === 0 ? "gpt-5.6-sol" : null, phase: "started", reasoningEffort: i < 3 ? "high" : null, serviceTier }, { teamId: null, repository: null });
      if (i === 0) await ledger.observe({ ...turn, model: "gpt-6.1", phase: "usage" }, { teamId: null, repository: null });
      await ledger.observe({ ...turn, phase: "completed", reasoningEffort: "low", serviceTier: "changed" }, { teamId: null, repository: null });
      await ledger.observe({ ...turn, phase: "usage" }, { teamId: null, repository: null });
    }
    await ledger.close();
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      expect({ ...db.prepare("SELECT model FROM executions WHERE turn_id='0'").get() }).toStrictEqual({ model: "gpt-6.1" });
      expect(db.prepare("SELECT reasoning_effort,service_tier FROM executions ORDER BY turn_id").all().map(row => ({ ...row }))).toStrictEqual([
        { reasoning_effort: "high", service_tier: "normal" },
        { reasoning_effort: "high", service_tier: "fast" },
        { reasoning_effort: "high", service_tier: "ultrafast" },
        { reasoning_effort: null, service_tier: null },
      ]);
    } finally { db.close(); }
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

it("persists only statistics in SQLite and replaces late measurements without inflating daily totals", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "local-analytics-"));
  const file = path.join(dir, "usage.sqlite");
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
  let ledger = new UsageLedger(file, () => at);
  try {
    await ledger.load();
    const observation = { ...event, prompt: "CONTENT_CANARY", response: "CONTENT_CANARY" };
    await ledger.observe(observation, { teamId: "team", repository: "repo" });
    await ledger.observe({ ...observation, phase: "completed", tokens: { input: 50, output: 10, cacheRead: 10, cacheWrite: null, total: 60 } }, { teamId: null, repository: null });
    expect(ledger.query({ group: "provider" }).rows[0]).toMatchObject({
      started: 1,
      completed: 1,
      tokens: { total: 60 },
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
      daily: [{
        day: "2026-10-15", started: 1, tokens: { total: 120 },
        speed: { turns: 1, outputTokens: 20, generationMs: 10000, ttftMs: 2000, ttftTurns: 1 },
        groups: [{ label: event.model, speed: { turns: 1, outputTokens: 20, generationMs: 10000, ttftMs: 2000, ttftTurns: 1 } }],
      }],
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
    ledger = new UsageLedger(file, () => at);
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

it("counts a turn on the day it happened in the reader's timezone, for buckets and date ranges alike", async () => {
  const at = Date.parse("2026-10-28T03:00:00Z"); // 10pm on the 27th in Chicago
  const ledger = new UsageLedger(":memory:", () => at);
  try {
    await ledger.load();
    await ledger.observe({ provider: "codex", agentId: "a", sessionId: "s", turnId: "t", model: "m", at, phase: "started" }, { teamId: null, repository: null });
    const days = (filter: Parameters<UsageLedger["query"]>[0]) => ledger.query(filter).daily?.map((row) => row.day) ?? [];
    expect(days({})).toStrictEqual(["2026-10-28"]);
    expect(days({ timeZone: "America/Chicago" })).toStrictEqual(["2026-10-27"]);
    expect(ledger.query({ from: "2026-10-27", to: "2026-10-27", timeZone: "America/Chicago" }).rows).toHaveLength(1);
    expect(ledger.query({ from: "2026-10-28", to: "2026-10-28", timeZone: "America/Chicago" }).rows).toHaveLength(0);
    expect(ledger.query({ from: "2026-10-28", to: "2026-10-28", timeZone: "UTC" }).rows).toHaveLength(1);
    expect(() => ledger.query({ timeZone: "Mars/Olympus" })).toThrow("Invalid usage filter.");
  } finally {
    await ledger.close();
  }
});
