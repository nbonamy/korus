/// <reference path="../../../backend/src/build-env.d.ts" />
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { it, expect, vi } from "vitest";
import { startApiServer } from "../server";
import {
  TelemetryReporter,
  type ReporterConfig,
} from "../../../backend/src/telemetry/reporter";
import { UsageLedger } from "../../../backend/src/telemetry/usage-ledger";
import { UsageService } from "../../../backend/src/telemetry/usage-service";
import { runtimeTelemetryConfig } from "../../../backend/src/telemetry/config";
const token = "synthetic-operator-token-for-isolated-tests-only";
it("configured development reporting → disclosed source → numeric local history → safe report; opt-out and remote ownership remain closed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "telemetry-e2e-"));
  const service = await startApiServer({
    database: path.join(dir, "db"),
    operatorToken: token,
    host: "127.0.0.1",
    port: 0,
    synthetic: true,
  });
  const now = Date.now();
  const bodies: string[] = [];
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("CI", "");
  vi.stubEnv("APP_TELEMETRY_URL", "https://api.example.test");
  vi.stubEnv("APP_TELEMETRY_FORCE_OFF", "0");
  const config: ReporterConfig = {
    ...runtimeTelemetryConfig("0.35.0"),
    synthetic: true,
    endpoint: service.url + "/v1/telemetry/reports",
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
    await reporter.flush();
    expect(bodies).toHaveLength(1);
    expect(bodies.join()).not.toContain("CANARY");
    const audit = await fetch(service.url + "/v1/telemetry/status", {
      headers: { authorization: "Bearer " + token },
    }).then((response) => response.json());
    expect(audit).toMatchObject({ acceptedReports: 1, rejectedReports: 0 });
    const day = new Date(now).toISOString().slice(0, 10);
    const metrics = `${service.url}/v1/telemetry/metrics?from=${day}&to=${day}&dimension=provider`;
    const read = async (suffix: string, authenticated = true) => {
      const response = await fetch(metrics + suffix, {
        headers: authenticated ? { authorization: "Bearer " + token } : {},
      });
      return { status: response.status, data: await response.json() };
    };
    expect((await read("", false)).status).toBe(401);
    const development = await read("");
    expect(development.status).toBe(200);
    expect(development.data).toMatchObject({
      minimumReports: 1,
      rows: expect.arrayContaining([
        {
          day,
          metric: "turn.started",
          dimension: "provider",
          value: "claude",
          total: 1,
          reports: 1,
        },
        {
          day,
          metric: "turn.completed",
          dimension: "provider",
          value: "claude",
          total: 1,
          reports: 1,
        },
      ]),
    });
    expect((await read("&environment=arbitrary")).status).toBe(400);
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
    vi.unstubAllEnvs();
    await usage.close();
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
