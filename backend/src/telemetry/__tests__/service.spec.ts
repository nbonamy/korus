import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { startTelemetryService } from "../service";
import { TelemetryReporter, type ReporterConfig } from "../reporter";
import { UsageLedger } from "../usage-ledger";
import { UsageService } from "../usage-service";
import { utcDay, type TelemetryReport } from "@workspace/core/telemetry";
async function readJson(
  response: Response,
): Promise<{ status?: string; rows: { total: number }[] }> {
  return (await response.json()) as {
    status?: string;
    rows: { total: number }[];
  };
}
const token = "synthetic-operator-token-for-isolated-tests-only";
const yesterday = Date.now() - 86400000;
function report(): TelemetryReport {
  return {
    schema: 1,
    reportId: randomUUID(),
    family: "runtime",
    version: "0.33.0",
    channel: "stable",
    platform: "macos",
    client: "desktop",
    rows: [
      {
        day: utcDay(yesterday),
        metric: "turn.started",
        provider: "codex",
        model: "unknown",
        value: 100,
      },
    ],
  };
}
describe("isolated real telemetry HTTP and storage", () => {
  it("authenticates operators, atomically deduplicates concurrent batches, rejects unsafe input and releases only bounded marginals", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "telemetry-service-"));
    const database = path.join(dir, "aggregate.sqlite");
    let service = await startTelemetryService({
      database,
      operatorToken: token,
      host: "127.0.0.1",
      port: 0,
      synthetic: true,
    });
    const headers = { "content-type": "application/json" };
    try {
      expect((await fetch(service.url + "/")).status).toBe(401);
      expect((await fetch(service.url + "/operator/metrics")).status).toBe(401);
      expect(
        (
          await fetch(service.url + "/reports", {
            method: "POST",
            headers,
            body: JSON.stringify({ ...report(), prompt: "CANARY_secret" }),
          })
        ).status,
      ).toBe(422);
      const r = report();
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          fetch(service.url + "/reports", {
            method: "POST",
            headers,
            body: JSON.stringify(r),
          }).then(readJson),
        ),
      );
      expect(responses.filter((r) => r.status === "accepted")).toHaveLength(1);
      expect(responses.filter((r) => r.status === "duplicate")).toHaveLength(4);
      const query =
        "/operator/metrics?from=" +
        utcDay(yesterday) +
        "&to=" +
        utcDay(yesterday) +
        "&dimension=provider";
      const auth = { authorization: "Bearer " + token };
      expect(
        (await fetch(service.url + query, { headers: auth }).then(readJson))
          .rows,
      ).toStrictEqual([]);
      for (let i = 0; i < 9; i++)
        expect(
          (
            await fetch(service.url + "/reports", {
              method: "POST",
              headers,
              body: JSON.stringify(report()),
            })
          ).status,
        ).toBe(200);
      const released = await fetch(service.url + query, { headers: auth }).then(
        readJson,
      );
      expect(released.rows).toStrictEqual([
        {
          day: utcDay(yesterday),
          metric: "turn.started",
          dimension: "provider",
          value: "codex",
          total: 1000,
          reports: 10,
        },
      ]);
      expect(
        (await fetch(service.url + query + "&model=unknown", { headers: auth }))
          .status,
      ).toBe(400);
      const page = await fetch(service.url + "/", { headers: auth }).then((r) =>
        r.text(),
      );
      expect(page).toContain("Released metric cells");
      expect(page).not.toContain("CANARY");
      const audit = await fetch(service.url + "/operator/status", {
        headers: auth,
      }).then((r) => r.json());
      expect(audit).toMatchObject({
        acceptedReports: 10,
        duplicateReports: 4,
        rejectedReports: 1,
        authorizationDenied: 2,
        retentionHealthy: true,
      });
      expect(JSON.stringify(audit)).not.toContain("CANARY");
      await service.close();
      service = await startTelemetryService({
        database,
        operatorToken: token,
        host: "127.0.0.1",
        port: 0,
        synthetic: true,
      });
      expect(
        (
          await fetch(service.url + "/reports", {
            method: "POST",
            headers,
            body: JSON.stringify(r),
          }).then(readJson)
        ).status,
      ).toBe("duplicate");
      expect(
        (await fetch(service.url + query, { headers: auth }).then(readJson))
          .rows[0].total,
      ).toBe(1000);
    } finally {
      await service.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("disclosed enabled source → numeric local history → safe report → private dashboard; opt-out and remote ownership remain closed", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "telemetry-e2e-"));
    const service = await startTelemetryService({
      database: path.join(dir, "db"),
      operatorToken: token,
      host: "127.0.0.1",
      port: 0,
      synthetic: true,
    });
    let now = yesterday;
    const bodies: string[] = [];
    const config: ReporterConfig = {
      rollout: true,
      forceOff: false,
      environment: true,
      synthetic: true,
      endpoint: service.url + "/reports",
      version: "0.33.0",
      channel: "stable",
      platform: "macos",
      client: "desktop",
    };
    const reporter = new TelemetryReporter(
      path.join(dir, "outbox"),
      config,
      () => now,
      async (url, input) => {
        bodies.push(String(input?.body));
        return fetch(url, input);
      },
      () => 0,
    );
    const ledger = new UsageLedger(path.join(dir, "local"), () => now);
    const usage = new UsageService(ledger, reporter, () => ({
      id: "CANARY_agent",
      name: "CANARY_name",
      folder: "/CANARY_repo",
      backend: "claude",
      teamId: "CANARY_team",
      status: { type: "idle" },
      createdAt: "",
      updatedAt: "",
    }));
    try {
      await ledger.load();
      await reporter.load();
      await reporter.choose("desktop", { enabled: true, disclosure: 1 });
      const event = {
        agentId: "CANARY_agent",
        sessionId: "CANARY_session",
        turnId: "one",
        provider: "claude" as const,
        phase: "started" as const,
        at: now,
        model: "CANARY_model",
      };
      usage.source(event.agentId, "desktop");
      usage.observe(event);
      usage.observe({
        ...event,
        phase: "completed",
        tokens: {
          total: 65,
          input: 45,
          output: 20,
          cacheRead: 30,
          cacheWrite: 5,
        },
      });
      await usage.drain();
      expect(ledger.query().rows[0]?.measuredTurns).toBe(1);
      now += 4000000;
      await reporter.flush();
      expect(bodies).toHaveLength(1);
      expect(bodies.join()).not.toContain("CANARY");
      await reporter.choose("desktop", { enabled: false, disclosure: 1 });
      usage.source(event.agentId, "desktop");
      usage.observe({ ...event, turnId: "two" });
      usage.observe({ ...event, turnId: "two", phase: "interrupted" });
      await usage.drain();
      await reporter.flush();
      expect(bodies).toHaveLength(1);
      expect(ledger.query().rows[0]?.started).toBe(2);
      await reporter.choose("desktop", { enabled: true, disclosure: 1 });
      await reporter.choose("remote-unsynchronized", {
        enabled: true,
        disclosure: 1,
      });
      usage.source(event.agentId, "remote-unsynchronized");
      usage.observe({ ...event, turnId: "remote" });
      usage.observe({ ...event, turnId: "remote", phase: "completed" });
      await usage.drain();
      expect(reporter.privacy("desktop").pending).toStrictEqual([]);
    } finally {
      await usage.close();
      await service.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

it("rolls back whole batches on aggregate overflow and expires dedupe/daily/monthly data", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { AggregateStore } = await import("../aggregate-store");
  const dir = await mkdtemp(path.join(os.tmpdir(), "telemetry-retention-"));
  const file = path.join(dir, "db");
  let now = Date.now();
  const store = new AggregateStore(file, () => now, 10);
  try {
    const r = report();
    store.ingest(r);
    const db = new DatabaseSync(file);
    db.prepare("UPDATE buckets SET total=? WHERE dimension='provider'").run(
      1e15,
    );
    const retry = {
      ...report(),
      rows: [
        { ...r.rows[0]!, metric: "turn.completed" as const },
        { ...r.rows[0]!, metric: "turn.started" as const },
      ],
    };
    expect(() => store.ingest(retry)).toThrow("Report could not be stored");
    expect(
      db.prepare("SELECT 1 FROM dedupe WHERE id=?").get(retry.reportId),
    ).toBeUndefined();
    expect(
      db.prepare("SELECT 1 FROM buckets WHERE metric='turn.completed'").get(),
    ).toBeUndefined();
    db.prepare("UPDATE buckets SET total=100").run();
    expect(store.ingest(retry)).toBe("accepted");
    const expiredMonth = new Date(now),
      retainedMonth = new Date(now);
    expiredMonth.setUTCMonth(expiredMonth.getUTCMonth() - 12, 1);
    retainedMonth.setUTCMonth(retainedMonth.getUTCMonth() - 11, 1);
    for (const date of [expiredMonth, retainedMonth])
      db.prepare("INSERT INTO buckets VALUES(?,?,?,?,?,?,?)").run(
        "monthly",
        utcDay(date.getTime()),
        "turn.failed",
        "provider",
        "claude",
        10,
        10,
      );
    store.cleanup();
    expect(
      db
        .prepare("SELECT 1 FROM buckets WHERE day=?")
        .get(utcDay(expiredMonth.getTime())),
    ).toBeUndefined();
    expect(
      db
        .prepare("SELECT 1 FROM buckets WHERE day=?")
        .get(utcDay(retainedMonth.getTime())),
    ).toBeDefined();
    now += 91 * 86400000;
    store.cleanup();
    expect(db.prepare("SELECT COUNT(*) AS n FROM dedupe").get()!.n).toBe(0);
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM buckets WHERE period='daily'")
        .get()!.n,
    ).toBe(0);
    expect(
      Number(
        db
          .prepare("SELECT COUNT(*) AS n FROM buckets WHERE period='monthly'")
          .get()!.n,
      ),
    ).toBeGreaterThan(0);
    now += 400 * 86400000;
    store.cleanup();
    expect(db.prepare("SELECT COUNT(*) AS n FROM buckets").get()!.n).toBe(0);
    db.close();
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("fails closed for public plaintext listeners, missing operator authentication and weakened release thresholds", async () => {
  for (const override of [
    { synthetic: false },
    { host: "0.0.0.0" },
    { operatorToken: "short" },
    { minimumReports: 1 },
    { minimumReports: NaN },
  ])
    await expect(
      startTelemetryService({
        database: ":memory:",
        operatorToken: token,
        host: "127.0.0.1",
        port: 0,
        synthetic: true,
        ...override,
      }),
    ).rejects.toThrow();
});

it("suppresses complementary marginals so filters and cross-dimension subtraction cannot recover a rare category", async () => {
  const { AggregateStore } = await import("../aggregate-store");
  const store = new AggregateStore(":memory:");
  try {
    for (let i = 0; i < 10; i++) store.ingest(report());
    store.ingest({
      ...report(),
      rows: [
        {
          day: utcDay(yesterday),
          provider: "claude",
          model: "custom",
          metric: "turn.started",
          value: 17,
        },
      ],
    });
    for (const dimension of ["provider", "model", "platform"] as const)
      expect(
        store.query({
          from: utcDay(yesterday),
          to: utcDay(yesterday),
          dimension,
        }).rows,
      ).toEqual([]);
    expect(
      store.query({
        from: utcDay(yesterday),
        to: utcDay(yesterday),
        dimension: "provider",
        value: "codex",
      }).rows,
    ).toEqual([]);
  } finally {
    store.close();
  }
});

it("serves model comparisons from paired released samples, including genuine zero outcomes, through the authenticated API", async () => {
  const service = await startTelemetryService({
    database: ":memory:",
    operatorToken: token,
    host: "127.0.0.1",
    port: 0,
    synthetic: true,
  });
  try {
    const values = {
      "behavior.terminalObserved": 1,
      "behavior.completed": 1,
      "behavior.failed": 0,
      "behavior.interrupted": 0,
      "behavior.durationMs": 30000,
      "behavior.durationObserved": 1,
      "behavior.responses": 3,
      "behavior.responsesObserved": 1,
      "behavior.toolCalls": 6,
      "behavior.toolsObserved": 1,
      "behavior.multiToolResponses": 1,
      "behavior.streamTokens": 1000,
      "behavior.streamMs": 20000,
      "behavior.streamResponses": 2,
    };
    for (let i = 0; i < 10; i++) {
      const payload = {
        ...report(),
        family: "behavior",
        rows: Object.entries(values).map(([metric, value]) => ({
          day: utcDay(yesterday),
          metric,
          value,
          provider: "claude",
          model: "claude-sonnet-4-6",
        })),
      };
      expect(
        (
          await fetch(service.url + "/reports", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        ).status,
      ).toBe(200);
    }
    const result = (await fetch(
      service.url +
        "/operator/metrics?from=" +
        utcDay(yesterday) +
        "&to=" +
        utcDay(yesterday) +
        "&dimension=model",
      { headers: { authorization: "Bearer " + token } },
    ).then((r) => r.json())) as {
      behavior: import("../model-behavior").ModelBehavior[];
    };
    const metrics = result.behavior[0]!.metrics;
    expect(metrics.streamRate).toStrictEqual({
      value: 50,
      samples: 20,
      days: 1,
    });
    expect(metrics.responsesPerTurn).toStrictEqual({
      value: 3,
      samples: 10,
      days: 1,
    });
    expect(metrics.failedRate).toStrictEqual({
      value: 0,
      samples: 10,
      days: 1,
    });
    expect(metrics.reasoningShare.value).toBeNull();
  } finally {
    await service.close();
  }
});
