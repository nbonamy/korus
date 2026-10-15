import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it, expect, vi } from "vitest";
import { AppBackendServer } from "../../server";
import { createTestSnapshot } from "../../__tests__/server-test-fixtures";
import { UsageService } from "../usage-service";
import { UsageLedger } from "../usage-ledger";
import { TelemetryReporter } from "../reporter";
it("counts completion at the owning command and routes per-client choices without exporting private team content", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "usage-rpc-"));
  const reporter = new TelemetryReporter(path.join(dir, "outbox"), {
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
  await local.load();
  await reporter.load();
  const snapshot = createTestSnapshot();
  const usage = new UsageService(local, reporter, (id) =>
    snapshot.agents.find((a) => a.id === id),
  );
  const saveReport = vi.fn(async () => "/CANARY_private_report.md");
  const server = new AppBackendServer({
    version: "test",
    snapshot,
    usage,
    saveCodeReviewReport: saveReport,
    codeReviewTools: {
      createReviewToolContext: () => ({
        id: "local-review",
        url: "http://127.0.0.1/review",
      }),
      closeReviewToolContext: () => undefined,
    },
  });
  const call = (method: string, params: unknown = {}) =>
    server.handleMessage({ jsonrpc: "2.0", id: Math.random(), method, params });
  try {
    await call("telemetry/privacy/set", {
      choice: { enabled: true, disclosure: 1 },
    });
    await call("team/create", {
      input: { name: "CANARY_private_team", color: "#7158D4" },
    });
    await call("team/create", {
      _clientId: "remote-unsynchronized",
      input: { name: "CANARY_remote_team", color: "#7158D4" },
    });
    expect(snapshot.teams).toHaveLength(3);
    await reporter.drain();
    expect(reporter.privacy("desktop").pending[0]?.rows).toStrictEqual(
      ["feature.attempted", "feature.succeeded"].map((metric) => ({
        day: new Date().toISOString().slice(0, 10),
        metric,
        feature: "team.create",
        value: 1,
      })),
    );
    expect(JSON.stringify(reporter.privacy("desktop").pending)).not.toContain(
      "CANARY",
    );
    await call("agent/codeReview/start", {
      agentId: "missing",
      input: { automation: { enabled: true } },
    });
    await call("workProvider/backlog/configure", {
      input: { provider: "github", configuration: {} },
    });
    await reporter.drain();
    expect(reporter.privacy("desktop").pending.flatMap((b) => b.rows)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          feature: "review.start.automatic",
          metric: "feature.failed",
          value: 1,
        }),
        expect.objectContaining({
          feature: "backlog.source.github",
          metric: "feature.failed",
          value: 1,
        }),
      ]),
    );
    await expect(
      call("mission/execution/update", { input: { action: "configure" } }),
    ).rejects.toThrow("Invalid mission command");
    expect(
      reporter
        .privacy("desktop")
        .pending.flatMap((b) => b.rows)
        .some((r) => r.feature === "mission.start"),
    ).toBe(false);
    await expect(
      call("mission/execution/update", { input: { action: "run" } }),
    ).rejects.toThrow("Invalid mission command");
    await reporter.drain();
    expect(reporter.privacy("desktop").pending.flatMap((b) => b.rows)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          feature: "mission.start",
          metric: "feature.failed",
          value: 1,
        }),
      ]),
    );
    const agent: import("@workspace/core/contracts").Agent = {
      id: "reviewer",
      name: "CANARY_reviewer",
      folder: "/CANARY_repository",
      backend: "codex",
      status: { type: "idle" },
      createdAt: "now",
      updatedAt: "now",
      teamId: "team-test",
    };
    snapshot.agents.push(agent);
    snapshot.teams[0]!.agentIds.push(agent.id);
    agent.codeReview = {
      id: "review",
      targetAgentId: agent.id,
      reviewerAgentId: agent.id,
      scope: { type: "uncommitted" },
      threadMode: "current",
      status: "reviewing",
      activeRoundId: "round",
      rounds: [
        {
          id: "round",
          number: 1,
          status: "reviewing",
          findings: [],
          startedAt: "now",
        },
      ],
      createdAt: "now",
      updatedAt: "now",
      automation: {
        enabled: true,
        maxPriority: "p2",
        maxRounds: 3,
        state: "running",
        commits: [],
      },
    };
    expect(
      await call("agent/codeReview/discard", {
        agentId: agent.id,
        sessionId: "review",
      }),
    ).toHaveProperty("result");
    expect(agent.codeReview.automation?.state).toBe("paused");
    await reporter.drain();
    expect(reporter.privacy("desktop").pending.flatMap((b) => b.rows)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          feature: "review.switch.manual",
          metric: "feature.succeeded",
          value: 1,
        }),
      ]),
    );
    await expect(
      call("agent/codeReview/finish", {
        agentId: agent.id,
        sessionId: "review",
      }),
    ).rejects.toThrow("The review is not ready to finish.");
    expect(saveReport).not.toHaveBeenCalled();
    expect(
      reporter
        .privacy("desktop")
        .pending.flatMap((b) => b.rows)
        .some((r) => r.feature === "review.export"),
    ).toBe(false);
    agent.codeReview.status = "readyToFinish";
    agent.codeReview.rounds[0]!.status = "completed";
    expect(
      await call("agent/codeReview/finish", {
        agentId: agent.id,
        sessionId: "review",
      }),
    ).toHaveProperty("result");
    expect(saveReport).toHaveBeenCalledOnce();
    await reporter.drain();
    expect(reporter.privacy("desktop").pending.flatMap((b) => b.rows)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          feature: "review.export",
          metric: "feature.succeeded",
          value: 1,
        }),
      ]),
    );
    expect(JSON.stringify(reporter.privacy("desktop").pending)).not.toContain(
      "CANARY",
    );
    const invalid = await call("telemetry/privacy/set", {
      choice: { enabled: true, disclosure: 1, account: "secret" },
    });
    expect(invalid).toHaveProperty("error");
    await call("telemetry/privacy/set", {
      choice: { enabled: false, disclosure: 1 },
    });
    await call("team/create", {
      input: { name: "local only", color: "#7158D4" },
    });
    await reporter.drain();
    expect(reporter.privacy("desktop").pending).toStrictEqual([]);
    expect(
      await call("usage/get", { filter: { group: "provider" } }),
    ).toMatchObject({ result: { rows: [] } });
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("clears queued statistics through the app contract without resurrecting legacy data or touching provider history", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "usage-clear-"));
  const legacy = path.join(dir, "usage.json"),
    file = path.join(dir, "usage.sqlite"),
    history = path.join(dir, "provider-history.json");
  const at = Date.now();
  const observation = {
    provider: "codex",
    model: null,
    agentId: "a",
    sessionId: "s",
    turnId: "legacy",
    phase: "completed",
    startedAt: at,
    at,
  };
  await writeFile(
    legacy,
    JSON.stringify({ since: at, records: [observation] }),
  );
  await writeFile(history, "provider-owned");
  const local = new UsageLedger(file, Date.now, legacy);
  const reporter = new TelemetryReporter(path.join(dir, "outbox"), {
    environment: true,
    forceOff: false,
    endpoint: null,
    version: "test",
    channel: "stable",
    platform: "macos",
    client: "daemon",
  });
  await local.load();
  await reporter.load();
  const usage = new UsageService(local, reporter, () => undefined);
  const server = new AppBackendServer({
    version: "test",
    snapshot: createTestSnapshot(),
    usage,
  });
  const call = (method: string, params: unknown = {}) =>
    server.handleMessage({ jsonrpc: "2.0", id: 1, method, params });
  try {
    usage.observe({
      ...observation,
      provider: "codex",
      phase: "started",
      turnId: "queued",
    });
    expect(
      await call("usage/clear", { filter: { provider: "codex" } }),
    ).toHaveProperty("error");
    expect(await call("usage/get")).toMatchObject({
      result: { rows: [{ started: 2 }] },
    });
    expect(await call("usage/clear")).toMatchObject({ result: null });
    expect(await call("usage/get")).toMatchObject({
      result: { rows: [], daily: [] },
    });
    await expect(readFile(legacy)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(history, "utf8")).toBe("provider-owned");
    await local.close();
    const reopened = new UsageLedger(file, Date.now, legacy);
    try {
      await reopened.load();
      expect(reopened.query().rows).toStrictEqual([]);
      expect(reopened.query().recordedSince).toBeGreaterThanOrEqual(at);
    } finally {
      await reopened.close();
    }
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
