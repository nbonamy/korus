import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { runCollector } from "../cli";
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
  await expect(runCollector(["serve", config], env)).rejects.toThrow(
    "Collector startup failed.",
  );
  expect(await runCollector(["migrate"], env)).toBeUndefined();
  expect(await runCollector(["migrate"], env)).toBeUndefined();
  const collector = await runCollector(["serve", config], env);
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
    await expect(runCollector(["serve", config], env)).rejects.toThrow(
      "Collector startup failed.",
    );
  } finally {
    await collector?.close();
    await collector?.close();
  }
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
