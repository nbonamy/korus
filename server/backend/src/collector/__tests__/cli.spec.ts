import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";
import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { runCollector } from "../cli";
import { createTelemetryPool } from "../store";
import { disposablePostgres } from "./postgres";

// Separate executable ownership: explicit external config, no automatic DDL in
// the ingestion process, bounded DB failure and cleanup on failed startup.
let database: Awaited<ReturnType<typeof disposablePostgres>>;
let directory: string;
beforeAll(async () => {
  database = await disposablePostgres();
  directory = await mkdtemp(path.join(os.tmpdir(), "collector-cli-"));
}, 120_000);
afterAll(async () => {
  await database?.stop();
  await rm(directory, { recursive: true, force: true });
});
it("runs explicit migrations and serves independently with supplied runtime configuration", async () => {
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
  };
  const config = path.join(directory, "operator.json");
  // Reserve then release a disposable listener; no repository-local host config.
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  await writeFile(
    config,
    JSON.stringify({
      listenHost: "127.0.0.1",
      listenPort: port,
      trustedProxies: [],
    }),
  );
  const env = { TELEMETRY_DATABASE_URL: database.url };
  await expect(runCollector(["serve", config], env, log)).rejects.toThrow(
    "Collector startup failed.",
  );
  expect(await runCollector(["migrate"], env, log)).toBeUndefined();
  expect(await runCollector(["migrate"], env, log)).toBeUndefined();
  const admin = createTelemetryPool(database.url);
  try {
    // A v7 schema must not advertise Cursor before its provider constraint is migrated.
    await admin.query(`ALTER TABLE usage_daily DROP CONSTRAINT usage_daily_provider_v8_check;
      ALTER TABLE usage_daily ADD CONSTRAINT usage_daily_provider_check CHECK (provider IN ('codex','claude','antigravity'));
      DELETE FROM telemetry_migrations WHERE version=8`);
    await expect(runCollector(["serve", config], env, log)).rejects.toThrow("Collector startup failed.");
    expect(await runCollector(["migrate"], env, log)).toBeUndefined();
    // A deployed v6 database has tables but cannot accept coverage-aware writes.
    await admin.query(`ALTER TABLE usage_daily DROP COLUMN measured_turns, DROP COLUMN cost_coverage;
      DELETE FROM telemetry_migrations WHERE version=7`);
    await expect(
      (async () => {
        const stale = await runCollector(["serve", config], env, log);
        await stale?.close();
      })(),
    ).rejects.toThrow("Collector startup failed.");
    expect(await runCollector(["migrate"], env, log)).toBeUndefined();
  } finally {
    await admin.end();
  }
  const collector = await runCollector(["serve", config], env, log);
  try {
    const now = Date.now();
    const response = await fetch(
      `http://127.0.0.1:${port}/v1/telemetry/daily`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installId: "d8b65ff5-179c-49b9-ac3a-f60a54a0f43f",
          day: new Date(now - 86_400_000).toISOString().slice(0, 10),
          appVersion: "1.2.3",
          os: "unknown",
          usage: [],
        }),
      },
    );
    expect(response.status).toBe(204);
    const readConfig = path.join(directory, "read.json");
    const accessFile = path.join(directory, "read-access");
    const access = "synthetic-service-token-32-characters";
    await writeFile(accessFile, access + "\n");
    // A distinct executable role never exposes anonymous reads on ingestion.
    const readProbe = createServer();
    await new Promise<void>((resolve) =>
      readProbe.listen(0, "127.0.0.1", resolve),
    );
    const readPort = (readProbe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => readProbe.close(() => resolve()));
    await writeFile(
      readConfig,
      JSON.stringify({
        listenHost: "127.0.0.1",
        listenPort: readPort,
        consoleOrigin: "https://console.invalid",
        accessTokenFile: accessFile,
      }),
    );
    const reader = await runCollector(["read", readConfig], env, log);
    const day = new Date(now - 86_400_000).toISOString().slice(0, 10);
    const readUrl = `http://127.0.0.1:${readPort}/v1/telemetry/metrics?from=${day}&to=${day}`;
    try {
      expect((await fetch(readUrl)).status).toBe(401);
      const result = await fetch(readUrl, {
        headers: {
          authorization: `Bearer ${access}`,
          origin: "https://console.invalid",
        },
      });
      expect(result.status).toBe(200);
      expect(((await result.json()) as TelemetryMetrics).overview.dau).toBe(
        "1",
      );
    } finally {
      await reader?.close();
    }
    await expect(runCollector(["serve", config], env, log)).rejects.toThrow(
      "Collector startup failed.",
    );
  } finally {
    await collector?.close();
    await collector?.close();
  }
  const events = lines.map((line) => JSON.parse(line));
  expect(
    events.filter((entry) => entry.event === "startup_failed"),
  ).toStrictEqual([
    {
      timestamp: expect.any(String),
      level: "error",
      service: "collector",
      event: "startup_failed",
      operation: "database_readiness",
      reason: "database_schema_missing",
      code: "42P01",
      message: expect.any(String),
    },
    {
      timestamp: expect.any(String),
      level: "error",
      service: "collector",
      event: "startup_failed",
      operation: "database_readiness",
      reason: "database_schema_mismatch",
      code: "SCHEMA_OUTDATED",
      message: expect.any(String),
    },
    {
      timestamp: expect.any(String),
      level: "error",
      service: "collector",
      event: "startup_failed",
      operation: "database_readiness",
      reason: "database_schema_mismatch",
      code: "42703",
      message: expect.any(String),
    },
    {
      timestamp: expect.any(String),
      level: "error",
      service: "collector",
      event: "startup_failed",
      operation: "listen",
      reason: "address_in_use",
      code: "EADDRINUSE",
      message: expect.any(String),
    },
  ]);
  expect(
    events
      .filter((entry) => entry.event === "stopped")
      .map((entry) => entry.service),
  ).toStrictEqual(["metrics", "collector"]);
  expect(lines.join("")).not.toMatch(
    /d8b65ff5|synthetic-service-token|console\.invalid|postgresql|SELECT/,
  );
});
it("rejects malformed/missing operator settings and keeps errors generic", async () => {
  const config = path.join(directory, "bad.json");
  for (const contents of [
    "private-canary",
    "{}",
    '{"listenHost":"private-canary","listenPort":1234}',
    '{"listenHost":"127.0.0.1","listenPort":1234,"trustedProxies":["private-canary"]}',
    '{"listenHost":"127.0.0.1","listenPort":1234,"secret":"private-canary"}',
  ]) {
    await writeFile(config, contents);
    await expect(
      runCollector(["serve", config], { TELEMETRY_DATABASE_URL: database.url }),
    ).rejects.toThrow("Collector startup failed.");
  }
  for (const args of [
    [],
    ["unknown"],
    ["migrate", "private-canary"],
    ["serve"],
    ["serve", config, "private-canary"],
  ])
    await expect(runCollector(args, {})).rejects.toThrow(
      "Collector startup failed.",
    );
  await expect(
    runCollector(["migrate"], { TELEMETRY_DATABASE_URL: "private-canary" }),
  ).rejects.toThrow("Collector startup failed.");
});
