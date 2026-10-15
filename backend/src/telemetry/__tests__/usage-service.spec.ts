import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import type { AppSnapshot } from "@workspace/core/contracts";
import { createTestSnapshot } from "../../__tests__/server-test-fixtures";
import { TelemetryReporter } from "../reporter";
import { UsageLedger } from "../usage-ledger";
import { UsageService } from "../usage-service";

it("binds new asynchronous outcomes to their initiating permission; history, repeats and post-opt-out completion cannot export", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "usage-outcomes-"));
  const reporter = new TelemetryReporter(path.join(dir, "queue"), {
    environment: true,
    forceOff: false,
    endpoint: "http://127.0.0.1:1/reports",
    synthetic: true,
    version: "0.33.0",
    channel: "stable",
    platform: "macos",
    client: "desktop",
  });
  const local = new UsageLedger(path.join(dir, "local"));
  const usage = new UsageService(local, reporter, () => undefined);
  const snapshot = createTestSnapshot();
  const runs = [
    { id: "old", status: "completed" },
    { id: "new", status: "running" },
  ];
  // Only run identity/status participates; fixtures deliberately contain no execution content.
  snapshot.automations = [
    { id: "automation", executionLog: runs },
  ] as AppSnapshot["automations"];
  try {
    await local.load();
    await reporter.load();
    await reporter.choose("desktop", { enabled: true, disclosure: 1 });
    usage.trackOutcomes(
      "automation",
      ["automation:old"],
      snapshot,
      "desktop",
      reporter.permission("desktop"),
    );
    usage.observeSnapshot(snapshot);
    expect(reporter.privacy("desktop").pending).toEqual([]);
    runs[1].status = "completed";
    usage.observeSnapshot(snapshot);
    usage.observeSnapshot(snapshot);
    await usage.drain();
    expect(
      reporter.privacy("desktop").pending.flatMap((r) => r.rows),
    ).toMatchObject([
      { feature: "automation.finish", metric: "feature.succeeded", value: 1 },
    ]);
    runs.push({ id: "later", status: "running" });
    usage.trackOutcomes(
      "automation",
      ["automation:old", "automation:new"],
      snapshot,
      "desktop",
      reporter.permission("desktop"),
    );
    await reporter.choose("desktop", { enabled: false, disclosure: 1 });
    await reporter.choose("desktop", { enabled: true, disclosure: 1 });
    runs[2].status = "failed";
    usage.observeSnapshot(snapshot);
    await usage.drain();
    expect(reporter.privacy("desktop").pending).toEqual([]);
  } finally {
    await usage.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("keeps local executions when request origins are rejected, concurrent or unavailable, without attributing them to another client", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "usage-source-"));
  const reporter = new TelemetryReporter(path.join(dir, "queue"), {
    environment: true,
    forceOff: false,
    endpoint: "http://127.0.0.1:1/reports",
    synthetic: true,
    version: "0.33.0",
    channel: "stable",
    platform: "macos",
    client: "desktop",
  });
  const local = new UsageLedger(path.join(dir, "local"));
  const usage = new UsageService(local, reporter, () => undefined);
  const event = {
    provider: "claude" as const,
    agentId: "agent",
    sessionId: "session",
    turnId: "one",
    phase: "started" as const,
    at: Date.now(),
    model: null,
  };
  try {
    await local.load();
    await reporter.load();
    await reporter.choose("desktop", { enabled: true, disclosure: 1 });
    const rejected = usage.source("agent", "desktop");
    usage.cancelSource("agent", rejected);
    usage.observe(event);
    usage.observe({ ...event, phase: "completed" });
    const prior = usage.source("agent", "desktop");
    usage.source("agent", "unknown");
    usage.cancelSource("agent", prior);
    usage.observe({ ...event, turnId: "two" });
    usage.observe({ ...event, turnId: "two", phase: "completed" });
    await usage.drain();
    expect(local.query().rows[0]).toMatchObject({
      started: 2,
      completed: 2,
      measuredTurns: 0,
      tokens: null,
    });
    expect(reporter.privacy("desktop").pending).toEqual([]);
  } finally {
    await usage.close();
    await rm(dir, { recursive: true, force: true });
  }
});
