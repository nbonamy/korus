import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, it, expect, vi } from "vitest";
import { TelemetryReporter, type ReporterConfig } from "../reporter";
import { UsageLedger } from "../usage-ledger";
import type { ExecutionObservation } from "@workspace/core/usage";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function file(name: string) {
  const d = await mkdtemp(path.join(os.tmpdir(), "telemetry-"));
  dirs.push(d);
  return path.join(d, name);
}
const config: ReporterConfig = {
  forceOff: false,
  environment: true,
  endpoint: "http://127.0.0.1:9999/report",
  synthetic: true,
  version: "0.33.0",
  channel: "stable",
  platform: "macos",
  client: "desktop",
};
const event: ExecutionObservation = {
  agentId: "CANARY_agent",
  sessionId: "CANARY_session",
  turnId: "one",
  provider: "claude",
  phase: "started",
  at: Date.parse("2026-10-11T23:59:00Z"),
  model: "CANARY_private_model",
};
it("requires disclosure, preserves choices, fails closed and purges immutable retry batches on opt out", async () => {
  let now = event.at;
  const sends: string[] = [];
  const deliver = vi.fn(async (_url: unknown, input: RequestInit) => {
    sends.push(String(input.body));
    return new Response(null, { status: 503 });
  });
  const f = await file("outbox");
  const reporter = new TelemetryReporter(
    f,
    config,
    () => now,
    deliver as typeof fetch,
    () => 0,
  );
  await reporter.load();
  await reporter.feature("desktop", "off", "agent.create", "succeeded");
  expect(reporter.privacy("desktop").pending).toStrictEqual([]);
  await reporter.choose("desktop", { enabled: true, disclosure: 1 });
  await reporter.execution(event, "desktop");
  await reporter.execution(event, "desktop");
  await reporter.feature(
    "unknown-remote",
    "remote",
    "agent.create",
    "succeeded",
  );
  expect(reporter.privacy("desktop").pending[0]?.rows).toStrictEqual([
    {
      day: "2026-10-11",
      metric: "turn.started",
      provider: "claude",
      model: "custom",
      value: 1,
    },
  ]);
  now += 4000000;
  await reporter.flush();
  now += 4000000;
  await reporter.flush();
  expect(sends).toHaveLength(2);
  expect(sends[1]).toBe(sends[0]);
  expect(sends.join()).not.toContain("CANARY");
  await reporter.choose("desktop", { enabled: false, disclosure: 1 });
  expect(reporter.privacy("desktop").pending).toStrictEqual([]);
  await reporter.close();
  const restored = new TelemetryReporter(f, config, () => now);
  await restored.load();
  expect(restored.privacy("desktop").choice).toStrictEqual({
    enabled: false,
    disclosure: 1,
  });
  await restored.close();
  for (const override of [
    { forceOff: true },
    { endpoint: null },
    { environment: false },
  ]) {
    const blocked = new TelemetryReporter(
      f,
      { ...config, ...override },
      () => now,
    );
    await blocked.load();
    await blocked.choose("desktop", { enabled: true, disclosure: 1 });
    expect(blocked.allowed("desktop")).toBe(false);
    await blocked.close();
  }
});
it("invalidates an in-flight upload and never resurrects pre-disable counters", async () => {
  let now = event.at;
  let finish!: (r: Response) => void;
  const request = new Promise<Response>((r) => (finish = r));
  let signal: AbortSignal | null | undefined;
  const reporter = new TelemetryReporter(
    await file("outbox"),
    config,
    () => now,
    vi.fn((_u, _i) => {
      signal = _i?.signal;
      return request;
    }) as typeof fetch,
    () => 0,
  );
  await reporter.load();
  await reporter.choose("desktop", { enabled: true, disclosure: 1 });
  await reporter.execution(event, "desktop");
  now += 4000000;
  const flush = reporter.flush();
  await vi.waitFor(() => expect(signal).toBeDefined());
  await reporter.choose("desktop", { enabled: false, disclosure: 1 });
  expect(signal!.aborted).toBe(true);
  await reporter.choose("desktop", { enabled: true, disclosure: 1 });
  finish(new Response(null, { status: 200 }));
  await flush;
  await reporter.execution(
    { ...event, phase: "completed", at: now },
    "desktop",
  );
  expect(reporter.privacy("desktop").pending).toStrictEqual([]);
  await reporter.close();
});
it("bounds expired queues and drops incompatible reports without affecting work", async () => {
  let now = event.at;
  const reporter = new TelemetryReporter(
    await file("outbox"),
    config,
    () => now,
    vi.fn(async () => new Response(null, { status: 422 })) as typeof fetch,
    () => 0,
  );
  await reporter.load();
  await reporter.choose("desktop", { enabled: true, disclosure: 1 });
  await reporter.feature("desktop", "one", "git.branch", "failed");
  now += 4000000;
  await reporter.flush();
  expect(reporter.privacy("desktop").pending).toStrictEqual([]);
  await reporter.feature("desktop", "two", "git.branch", "cancelled");
  now += 8 * 86400000;
  await reporter.flush();
  expect(reporter.privacy("desktop").pending).toStrictEqual([]);
  await reporter.close();
});
it("deduplicates typed completion hooks, distinguishes failures/cancellation, and binds originating permission", async () => {
  const reporter = new TelemetryReporter(
    await file("outbox"),
    config,
    () => event.at,
  );
  await reporter.load();
  expect(await reporter.beginFeature("desktop", "browser.open")).toBeNull();
  await reporter.choose("desktop", { enabled: true, disclosure: 1 });
  const id = await reporter.beginFeature("desktop", "browser.open");
  await reporter.finishFeature("other", id!, "succeeded");
  await reporter.finishFeature("desktop", id!, "cancelled");
  await reporter.finishFeature("desktop", id!, "failed");
  const failure = await reporter.beginFeature("desktop", "dictation.start");
  await reporter.finishFeature("desktop", failure!, "failed");
  expect(
    reporter
      .privacy("desktop")
      .pending[0]?.rows.map((r) => [r.feature, r.metric, r.value]),
  ).toStrictEqual([
    ["browser.open", "feature.attempted", 1],
    ["browser.open", "feature.cancelled", 1],
    ["dictation.start", "feature.attempted", 1],
    ["dictation.start", "feature.failed", 1],
  ]);
  const stale = await reporter.beginFeature("desktop", "browser.open");
  await reporter.choose("desktop", { enabled: false, disclosure: 1 });
  await reporter.choose("desktop", { enabled: true, disclosure: 1 });
  await reporter.finishFeature("desktop", stale!, "succeeded");
  expect(reporter.privacy("desktop").pending).toStrictEqual([]);
  await expect(
    reporter.beginFeature("desktop", "CANARY_tool" as never),
  ).rejects.toThrow("Invalid feature.");
  await reporter.close();
});
it("persists one actual execution and terminal outcome across restart, with unknown consumption and start-date attribution", async () => {
  const f = await file("local");
  let now = event.at;
  let ledger = new UsageLedger(f, () => now);
  await ledger.load();
  expect(
    await ledger.observe(event, {
      teamId: "team",
      repository: "/private/repo",
    }),
  ).toBe(true);
  expect(await ledger.observe(event, { teamId: null, repository: null })).toBe(
    false,
  );
  now += 120000;
  await ledger.observe(
    { ...event, phase: "completed", at: now },
    { teamId: null, repository: null },
  );
  await ledger.close();
  ledger = new UsageLedger(f, () => now);
  await ledger.load();
  expect(await ledger.observe(event, { teamId: null, repository: null })).toBe(
    false,
  );
  await ledger.observe(
    { ...event, sessionId: "fork", turnId: "retry", at: now },
    { teamId: "team", repository: "/private/repo" },
  );
  await ledger.observe(
    {
      ...event,
      sessionId: "fork",
      turnId: "retry",
      at: now,
      phase: "failed",
      tokens: {
        input: 100,
        cacheRead: 20,
        cacheWrite: 5,
        output: 30,
        reasoning: 10,
      },
    },
    { teamId: null, repository: null },
  );
  expect(
    ledger.query({ from: "2026-10-11", to: "2026-10-11", group: "provider" })
      .rows,
  ).toStrictEqual([
    {
      label: "claude",
      started: 1,
      completed: 1,
      failed: 0,
      interrupted: 0,
      inProgress: 0,
      measuredTurns: 0,
      tokens: null,
    },
  ]);
  expect(
    ledger.query({ agentId: "CANARY_agent", from: "2026-10-12" }).rows[0]
      ?.tokens,
  ).toStrictEqual({
    input: 100,
    output: 30,
    cacheRead: 20,
    cacheWrite: 5,
    reasoning: 10,
    total: 130,
  });
  await ledger.close();
});
it("replaces late local consumption and invalidates it without adding turns or uploading mutable Codex tokens", async () => {
  const f = await file("local");
  const now = event.at;
  const ledger = new UsageLedger(f, () => now);
  await ledger.load();
  const codex = { ...event, provider: "codex" as const };
  const attribution = { teamId: null, repository: null };
  const reporter = new TelemetryReporter(
    await file("outbox"),
    config,
    () => now,
  );
  await reporter.load();
  await reporter.choose("desktop", { enabled: true, disclosure: 1 });
  await ledger.observe(codex, attribution);
  await reporter.execution(codex, "desktop");
  const terminal = {
    ...codex,
    phase: "completed" as const,
    tokens: {
      input: 100,
      output: 20,
      cacheRead: 50,
      cacheWrite: null,
      reasoning: 10,
    },
  };
  await ledger.observe(terminal, attribution);
  await reporter.execution(terminal, "desktop");
  await ledger.observe(
    { ...terminal, phase: "usage", tokens: { ...terminal.tokens, input: 120 } },
    attribution,
  );
  expect(ledger.query().rows[0]).toMatchObject({
    started: 1,
    completed: 1,
    measuredTurns: 1,
    tokens: { input: 120, cacheWrite: null },
  });
  expect(
    reporter
      .privacy("desktop")
      .pending.flatMap((b) => b.rows)
      .map((r) => r.metric),
  ).toStrictEqual(["turn.started", "turn.completed"]);
  await ledger.observe(
    { ...terminal, phase: "usage", tokens: null },
    attribution,
  );
  await ledger.close();
  const restored = new UsageLedger(f, () => now);
  await restored.load();
  expect(restored.query().rows[0]).toMatchObject({
    started: 1,
    completed: 1,
    measuredTurns: 0,
    tokens: null,
  });
  expect(
    await restored.observe(
      { ...terminal, turnId: "inherited", phase: "usage" },
      attribution,
    ),
  ).toBe(false);
  await restored.close();
  await reporter.close();
});

it("fails closed on invalid configuration, oversized storage and persistence failure without preventing app startup or shutdown", async () => {
  for (const endpoint of [
    "bad endpoint",
    "https://secret:password@invalid.test/reports",
    "http://invalid.test/reports",
  ]) {
    const reporter = new TelemetryReporter(await file("queue"), {
      ...config,
      endpoint,
    });
    await reporter.load();
    await reporter.choose("desktop", { enabled: true, disclosure: 1 });
    expect(reporter.allowed("desktop")).toBe(false);
    await reporter.close();
  }
  const oversized = await file("oversized");
  await writeFile(oversized, " ".repeat(1024 * 1024 + 1));
  const bounded = new TelemetryReporter(oversized, config);
  await bounded.load();
  expect(bounded.privacy("desktop")).toMatchObject({
    choice: null,
    active: false,
    pending: [],
  });
  await bounded.close();
  const parent = await file("not-directory");
  await writeFile(parent, "blocked");
  const failing = new TelemetryReporter(path.join(parent, "queue"), config);
  await expect(failing.load()).resolves.toBeUndefined();
  expect(failing.allowed("desktop")).toBe(false);
  await expect(failing.close()).resolves.toBeUndefined();
});

it("requires renewed behavior disclosure, emits explicit zero samples, preserves Codex local-only usage and drops pre-consent or post-opt-out behavior", async () => {
  let now = event.at;
  const reporter = new TelemetryReporter(
    await file("behavior"),
    config,
    () => now,
  );
  const completed: ExecutionObservation = {
    ...event,
    phase: "completed",
    durationMs: 20000,
    model: "claude-sonnet-4-6",
    behavior: {
      model: "claude-sonnet-4-6",
      responses: 2,
      toolCalls: 0,
      toolResponses: 0,
      multiToolResponses: 0,
      stream: { outputTokens: 120, durationMs: 2000, responses: 2 },
    },
  };
  try {
    await reporter.load();
    await reporter.choose("desktop", { enabled: true, disclosure: 1 });
    await reporter.execution(event, "desktop");
    await reporter.execution(completed, "desktop");
    expect(
      reporter.privacy("desktop").pending.some((b) => b.family === "behavior"),
    ).toBe(false);
    await reporter.choose("desktop", { enabled: true, disclosure: 2 });
    await reporter.execution(
      { ...completed, turnId: "before-consent" },
      "desktop",
    );
    expect(reporter.privacy("desktop").pending).toStrictEqual([]);
    const start = { ...event, turnId: "new" };
    await reporter.execution(start, "desktop");
    await reporter.execution({ ...completed, turnId: "new" }, "desktop");
    const rows = reporter
      .privacy("desktop")
      .pending.find((b) => b.family === "behavior")!.rows;
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: "behavior.toolCalls", value: 0 }),
        expect.objectContaining({ metric: "behavior.toolsObserved", value: 1 }),
        expect.objectContaining({
          metric: "behavior.streamTokens",
          value: 120,
        }),
        expect.objectContaining({ metric: "behavior.streamMs", value: 2000 }),
      ]),
    );
    expect(JSON.stringify(rows)).not.toContain("CANARY");
    await reporter.execution(
      { ...event, provider: "codex", turnId: "codex" },
      "desktop",
    );
    await reporter.execution(
      {
        ...completed,
        provider: "codex",
        turnId: "codex",
        model: null,
        behavior: {
          model: null,
          responses: null,
          toolCalls: 1,
          toolResponses: null,
          multiToolResponses: null,
          stream: null,
        },
        tokens: {
          input: 100,
          output: 20,
          reasoning: 10,
          cacheRead: 0,
          cacheWrite: null,
        },
      },
      "desktop",
    );
    const codex = reporter
      .privacy("desktop")
      .pending.filter((b) => b.family === "behavior")
      .flatMap((b) => b.rows)
      .filter((r) => r.provider === "codex");
    expect(
      codex.some(
        (r) =>
          r.metric === "behavior.reasoningTokens" ||
          r.metric === "behavior.streamTokens" ||
          r.metric === "behavior.responses",
      ),
    ).toBe(false);
    expect(codex).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: "behavior.toolCalls",
          model: "unknown",
          value: 1,
        }),
      ]),
    );
    await reporter.execution(
      { ...event, turnId: "unproven", model: "claude-sonnet-4-6" },
      "desktop",
    );
    await reporter.execution(
      { ...completed, turnId: "unproven", behavior: null },
      "desktop",
    );
    expect(
      reporter
        .privacy("desktop")
        .pending.filter((b) => b.family === "behavior")
        .flatMap((b) => b.rows),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: "behavior.terminalObserved",
          provider: "claude",
          model: "unknown",
          value: 1,
        }),
      ]),
    );
    const permission = reporter.permission("desktop");
    await reporter.choose("desktop", { enabled: false, disclosure: 2 });
    await reporter.execution(
      { ...event, turnId: "off" },
      "desktop",
      permission,
    );
    await reporter.execution(
      { ...completed, turnId: "off" },
      "desktop",
      permission,
    );
    expect(reporter.privacy("desktop").pending).toStrictEqual([]);
  } finally {
    await reporter.close();
  }
});

it("gives services a nonblocking typed operation port with one outcome and permission captured before work", async () => {
  const reporter = new TelemetryReporter(
    await file("operations"),
    config,
    () => event.at,
  );
  await reporter.load();
  const features = reporter.forSource("desktop");
  expect(
    await features.track("browser.open", () => "opened while disabled"),
  ).toBe("opened while disabled");
  await reporter.choose("desktop", { enabled: true, disclosure: 2 });
  const finish = features.begin("mission.start");
  finish("cancelled");
  finish("succeeded");
  const result = { status: "unavailable" as const, secret: "CANARY_content" };
  expect(
    await features.track(
      "browser.open",
      () => result,
      (value) => value.status,
    ),
  ).toBe(result);
  const failure = new Error("CANARY_error");
  await expect(
    features.track("review.start.manual", () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  await reporter.drain();
  expect(
    reporter
      .privacy("desktop")
      .pending.flatMap((batch) => batch.rows)
      .map((row) => [row.feature, row.metric, row.value]),
  ).toStrictEqual([
    ["mission.start", "feature.attempted", 1],
    ["mission.start", "feature.cancelled", 1],
    ["browser.open", "feature.attempted", 1],
    ["browser.open", "feature.unavailable", 1],
    ["review.start.manual", "feature.attempted", 1],
    ["review.start.manual", "feature.failed", 1],
  ]);
  expect(JSON.stringify(reporter.privacy("desktop").pending)).not.toContain(
    "CANARY",
  );
  const pending = features.begin("mission.finish");
  await reporter.choose("desktop", { enabled: false, disclosure: 2 });
  await reporter.choose("desktop", { enabled: true, disclosure: 2 });
  pending("succeeded");
  await reporter.drain();
  expect(reporter.privacy("desktop").pending).toStrictEqual([]);
  await reporter.close();
});

it("keeps successful operations successful when reporting or outcome classification fails", async () => {
  const queue = await file("queue");
  const reporter = new TelemetryReporter(queue, config);
  await reporter.load();
  await reporter.choose("desktop", { enabled: true, disclosure: 2 });
  await rm(path.dirname(queue), { recursive: true });
  await writeFile(path.dirname(queue), "not-a-directory");
  const features = reporter.forSource("desktop");
  const result = { succeeded: true };
  expect(await features.track("browser.open", () => result)).toBe(result);
  expect(
    await features.track(
      "agent.create",
      () => result,
      () => {
        throw new Error("classifier");
      },
    ),
  ).toBe(result);
  features.record("CANARY_arbitrary_event" as never);
  await reporter.close();
  expect(reporter.privacy("desktop").pending).toStrictEqual([]);
});

it("binds native callbacks to the initiating source permission while allowing only the observing client to finish them", async () => {
  const reporter = new TelemetryReporter(
    await file("native-source"),
    config,
    () => event.at,
  );
  await reporter.load();
  await reporter.choose("desktop", { enabled: true, disclosure: 2 });
  await reporter.choose("mobile", { enabled: false, disclosure: 2 });
  expect(
    await reporter.beginFeature("desktop", "browser.open", null),
  ).toBeNull();
  expect(
    await reporter.beginFeature("desktop", "browser.open", {
      source: "mobile",
      permission: null,
    }),
  ).toBeNull();
  expect(reporter.privacy("desktop").pending).toStrictEqual([]);
  await reporter.choose("mobile", { enabled: true, disclosure: 2 });
  const id = await reporter.beginFeature("desktop", "browser.open", {
    source: "mobile",
    permission: reporter.permission("mobile"),
  });
  expect(id).not.toBeNull();
  await reporter.finishFeature("other-client", id!, "failed");
  await reporter.finishFeature("desktop", id!, "succeeded");
  expect(
    reporter
      .privacy("desktop")
      .pending.flatMap((report) => report.rows)
      .map((row) => [row.metric, row.value]),
  ).toStrictEqual([
    ["feature.attempted", 1],
    ["feature.succeeded", 1],
  ]);
  const late = await reporter.beginFeature("desktop", "browser.capture", {
    source: "mobile",
    permission: reporter.permission("mobile"),
  });
  await reporter.choose("mobile", { enabled: false, disclosure: 2 });
  await reporter.choose("mobile", { enabled: true, disclosure: 2 });
  await reporter.finishFeature("desktop", late!, "succeeded");
  expect(reporter.privacy("desktop").pending).toStrictEqual([]);
  await reporter.close();
});
