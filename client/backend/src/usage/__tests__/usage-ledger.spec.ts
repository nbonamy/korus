import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { UsageLedger } from "../usage-ledger";
import type { ExecutionObservation } from "@workspace/core/usage";

it("retains known token and cost subtotals with coverage and replaces late measurements before sealing", async () => {
  const at = Date.parse("2026-10-15T12:00:00Z");
  const ledger = new UsageLedger(":memory:", () => at);
  const input = {
    day: "2026-10-15",
  };
  const base = {
    provider: "codex" as const,
    agentId: "agent",
    sessionId: "s",
    model: "gpt-6-sol",
    at,
  };
  const attribution = { teamId: null, repository: null };
  try {
    await ledger.load();
    for (const [turnId, tokens] of [
      ["one", { input: 10, cacheRead: 5, cacheWrite: null, output: 2 }],
      ["two", null],
      ["zero", { input: 0, cacheRead: 0, cacheWrite: null, output: 0 }],
    ] as const) {
      await ledger.observe(
        {
          ...base,
          turnId,
          model: turnId === "zero" ? "gpt-5.6-sol" : base.model,
          phase: "started",
          tokens,
        },
        attribution,
      );
    }
    expect(ledger.projectDailyTelemetry(input)).toStrictEqual([
      {
        provider: "codex",
        model: "gpt-5.6-sol",
        serviceTier: "unknown",
        turns: 1,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        measuredTurns: 1, costCoverage: "complete",
      },
      {
        provider: "codex",
        model: "gpt-6-sol",
        serviceTier: "unknown",
        turns: 2,
        inputTokens: 10,
        cachedInputTokens: 5,
        outputTokens: 2,
        estimatedCostUsd: 0.000031,
        measuredTurns: 1, costCoverage: "partial",
      },
    ]);
    await ledger.observe(
      {
        ...base,
        turnId: "two",
        phase: "usage",
        tokens: { input: 10, cacheRead: 5, cacheWrite: null, output: 2 },
      },
      attribution,
    );
    // 10 input * 2 + 10 reads * .2 + 4 output * 10, per million.
    expect(ledger.projectDailyTelemetry(input)[1]).toStrictEqual({
      provider: "codex",
      model: "gpt-6-sol",
      serviceTier: "unknown",
      turns: 2,
      inputTokens: 20,
      cachedInputTokens: 10,
      outputTokens: 4,
      estimatedCostUsd: 0.000062,
      measuredTurns: 2, costCoverage: "complete",
    });
    expect(
      ledger.projectDailyTelemetry({ day: "2026-10-16" }),
    ).toStrictEqual([]);
    expect(
      ledger.projectDailyTelemetry({ day: "2026-10-14" }),
    ).toStrictEqual([]);
  } finally {
    await ledger.close();
  }
});
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
      await ledger.observe({ ...turn, phase: "completed", reasoningEffort: "low", serviceTier: "changed", durationMs: 9000, taskDurationMs: 3000 }, { teamId: null, repository: null });
      await ledger.observe({ ...turn, phase: "usage" }, { teamId: null, repository: null });
    }
    await ledger.close();
    const reopened = new UsageLedger(file, () => at);
    try {
      await reopened.load();
      expect(reopened.query().longestTurnMs).toBe(3000);
    } finally { await reopened.close(); }
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

// A real SQLite ledger with more than ten thousand executions exercises retention.
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
}, 3_000);

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
    await ledger.observe({
      ...event, provider: "codex", turnId: "orphan", model: "gpt-6-sol", phase: "started",
      tokens: { input: 10, output: 5, total: 15, cacheRead: 0, cacheWrite: null },
    }, { teamId: "team", repository: "repo" });
    await ledger.close();
    ledger = new UsageLedger(file, () => at + 60000);
    await ledger.load({ interruptOpenExecutions: true });
    expect(ledger.query().rows[0]).toMatchObject({
      started: 2, completed: 1, interrupted: 1, inProgress: 0,
      speed: { turns: 1, outputTokens: 20, generationMs: 10000 },
    });
    expect(ledger.query({ provider: "codex" }).rows[0]).toMatchObject({
      started: 1, interrupted: 1, inProgress: 0, tokens: { total: 15 },
    });
    await ledger.observe({ ...event, provider: "codex", turnId: "orphan", phase: "usage",
      tokens: { input: 20, output: 10, total: 30, cacheRead: 0, cacheWrite: null },
    }, { teamId: null, repository: null });
    expect(ledger.query({ provider: "codex" }).rows[0]).toMatchObject({
      started: 1, interrupted: 1, inProgress: 0, tokens: { total: 30 },
    });
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

it("projects additive measured performance from the existing ledger", async () => {
  const at = Date.parse("2026-10-15T12:00Z");
  const ledger = new UsageLedger(":memory:", () => at);
  try {
    await ledger.load();
    for (const [turnId, serviceTier, output, activeMs, ttftMs] of [["a","normal",10,1100,100],["b","priority",90,3900,900]] as const) {
      const base = {provider:"codex" as const,agentId:"a",sessionId:"s",turnId,model:"gpt-6-sol",at,serviceTier};
      await ledger.observe({...base,phase:"started"}, {teamId:null,repository:null});
      await ledger.observe({...base,phase:"completed",tokens:{input:100,cacheRead:50,cacheWrite:null,output},timing:{activeMs,ttftMs}}, {teamId:null,repository:null});
    }
    const rows = ledger.projectDailyTelemetry({day:"2026-10-15"});
    expect(rows).toHaveLength(2);
    expect(rows.map(row => [row.model, row.serviceTier, row.performance?.outputTokens])).toStrictEqual([["gpt-6-sol", "fast", 90], ["gpt-6-sol", "standard", 10]]);
  } finally { await ledger.close(); }
});

it("reports completed task duration including tools, with elapsed duration for historical rows", async () => {
  const at = Date.parse("2026-10-15T12:00Z");
  const ledger = new UsageLedger(":memory:", () => at);
  try {
    await ledger.load();
    expect(ledger.query({}).longestTurnMs).toBeUndefined();
    for (const [turnId, durationMs, timing] of [["a", 90000, { activeMs: 4000, ttftMs: 100 }], ["b", 3000, undefined], ["c", 2000, undefined]] as const) {
      const base = { provider: "codex" as const, agentId: "a", sessionId: "s", turnId, model: "gpt-6-sol", at };
      await ledger.observe({ ...base, phase: "started" }, { teamId: null, repository: null });
      await ledger.observe({ ...base, phase: "completed", durationMs, ...(timing ? { timing } : {}) }, { teamId: null, repository: null });
    }
    expect(ledger.query({}).longestTurnMs).toBe(90000);
    const base = { provider: "codex" as const, agentId: "a", sessionId: "s", turnId: "measured", model: "gpt-6-sol", at };
    await ledger.observe({ ...base, phase: "started" }, { teamId: null, repository: null });
    await ledger.observe({ ...base, phase: "completed", durationMs: 200000, taskDurationMs: 95000, timing: { activeMs: 4000, ttftMs: 100 } }, { teamId: null, repository: null });
    expect(ledger.query({}).longestTurnMs).toBe(95000);
  } finally { await ledger.close(); }
});

it("sums stored totals without reconstructing missing totals from any provider", async () => {
  const at = Date.parse("2026-11-05T12:00Z");
  const ledger = new UsageLedger(":memory:", () => at);
  const attribution = { teamId: null, repository: null };
  const base = { agentId: "a", sessionId: "s", phase: "started" as const, at };
  try {
    await ledger.load();
    await ledger.observe({ ...base, provider: "codex", turnId: "codex", model: "gpt-6.1-sol",
      tokens: { input: 80, output: 20, total: 100, cacheRead: 40, cacheWrite: null } }, attribution);
    for (const provider of ["antigravity", "claude", "codex"] as const) {
      await ledger.observe({ ...base, provider, turnId: "missing", model: `${provider}-missing`,
        tokens: { input: 8, output: 2, cacheRead: 4, cacheWrite: 0, reasoning: 1 } }, attribution);
    }
    for (const group of ["provider", "model"] as const) {
      const summary = ledger.query({ group });
      expect(summary.daily?.map(day => ({
        day: day.day, total: day.tokens?.total,
        groups: day.groups?.map(row => row.tokens?.total),
      }))).toStrictEqual([{ day: "2026-11-05", total: 100, groups: group === "model" ? [100, 0, 0, 0] : [100, 0, 0] }]);
      expect(summary.rows.map(row => row.tokens?.total)).toStrictEqual(group === "model" ? [100, 0, 0, 0] : [100, 0, 0]);
    }
  } finally { await ledger.close(); }
});

it("prices Antigravity executions from reported token categories as a Google API-equivalent estimate", async () => {
  const at = Date.parse("2026-10-15T12:00Z");
  const ledger = new UsageLedger(":memory:", () => at);
  const attribution = { teamId: null, repository: null };
  const consumption = { input: 1_200_000, cacheRead: 200_000, cacheWrite: 0, output: 100_000, reasoning: 0 };
  try {
    await ledger.load();
    for (const [turnId, model, tokens] of [
      ["flash", "gemini-3.8-flash", consumption],
      ["suffixed", "gemini-3.8-flash-high", consumption],
      ["preview", "gemini-3.1-pro-high", consumption],
      ["foreign", "claude-sonnet-4-6", consumption],
      ["unmeasured", "gemini-3.1-flash-lite", null],
    ] as const) {
      const base = { provider: "antigravity" as const, agentId: "a", sessionId: "s", turnId, model, at,
        requestCoverage: "partial" as const, requestCoverageReason: "acp-request-evidence-unavailable" as const };
      await ledger.observe({ ...base, phase: "started" }, attribution);
      await ledger.observe({ ...base, phase: "completed", tokens }, attribution);
    }
    const byModel = Object.fromEntries(ledger.query({ group: "model" }).rows.map(row => [row.label, row.cost]));
    // 1.0M uncached input at $0.75 + 0.2M cached at $0.075 + 0.1M output at $3.75 per million.
    expect(byModel["gemini-3.8-flash"]).toMatchObject({ usd: 1.14 });
    expect(byModel["gemini-3.1-flash-lite"]).toMatchObject({ usd: null, coverage: "unavailable", reasons: [{ reason: "acp-request-evidence-unavailable", count: 1 }] });
    expect(byModel["gemini-3.8-flash-high"]).toMatchObject({ usd: 1.14 });
    expect(typeof byModel["gemini-3.1-pro-high"]?.usd).toBe("number");
    expect(byModel["claude-sonnet-4-6"]).toMatchObject({ usd: null, coverage: "unavailable" });
    expect(ledger.query({ group: "apiProvider" }).rows.map(row => row.label)).toContain("google");
  } finally { await ledger.close(); }
});
