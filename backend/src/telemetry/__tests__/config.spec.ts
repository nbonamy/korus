import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runtimeTelemetryConfig } from "../config";
import { TelemetryReporter } from "../reporter";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("keeps the server destination disabled for packaged and development apps even with configured endpoints and saved opt-in", async () => {
  vi.stubGlobal("__APP_TELEMETRY_URL__", "https://packaged.example.test");
  vi.stubEnv("APP_TELEMETRY_URL", "https://configured.example.test");
  vi.stubEnv("CI", "");
  const dir = await mkdtemp(path.join(os.tmpdir(), "analytics-local-only-"));
  const deliver = vi.fn(async () => new Response(null, { status: 200 }));
  try {
    for (const mode of ["development", "production"]) {
      vi.stubEnv("NODE_ENV", mode);
      const config = runtimeTelemetryConfig("0.35.1");
      expect(config.endpoint).toBeNull();
      const now = Date.now();
      await writeFile(
        path.join(dir, mode),
        JSON.stringify({
          choices: { desktop: { enabled: true, disclosure: 2 } },
          seen: [],
          queue: [
            {
              created: now,
              next: now,
              attempts: 0,
              sealed: true,
              report: {
                schema: 1,
                reportId: randomUUID(),
                family: "runtime",
                version: "0.35.1",
                channel: "stable",
                platform: "macos",
                client: "daemon",
                rows: [
                  {
                    day: new Date(now).toISOString().slice(0, 10),
                    metric: "turn.started",
                    provider: "codex",
                    model: "unknown",
                    value: 1,
                  },
                ],
              },
            },
          ],
        }),
      );
      const reporter = new TelemetryReporter(
        path.join(dir, mode),
        config,
        Date.now,
        deliver,
      );
      try {
        await reporter.load();
        await reporter.choose("desktop", { enabled: true, disclosure: 2 });
        await reporter.feature(
          "desktop",
          "operation",
          "browser.open",
          "succeeded",
        );
        await reporter.flush();
        expect(reporter.privacy("desktop")).toMatchObject({
          active: false,
          pending: [],
        });
      } finally {
        await reporter.close();
      }
    }
    expect(deliver).not.toHaveBeenCalled();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("preserves host policy and test-environment isolation independently of local analytics", () => {
  vi.stubEnv("APP_TELEMETRY_FORCE_OFF", "1");
  vi.stubEnv("NODE_ENV", "test");
  expect(runtimeTelemetryConfig("0.35.1")).toMatchObject({
    forceOff: true,
    environment: false,
    endpoint: null,
    client: "daemon",
  });
});
