import { afterEach, expect, it, vi } from "vitest";
import { runtimeTelemetryConfig } from "../config";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("requires an explicitly configured server URL on every daemon, independent of the initiating desktop or mobile client", () => {
  vi.stubEnv("APP_TELEMETRY_URL", undefined);
  vi.stubEnv("APP_TELEMETRY_REVIEWED_ROLLOUT", undefined);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CI", "");
  expect(runtimeTelemetryConfig("0.33.0").endpoint).toBeNull();
  vi.stubEnv("APP_TELEMETRY_URL", "https://api.example.test/");
  expect(runtimeTelemetryConfig("0.33.0").rollout).toBe(false);
  vi.stubEnv("APP_TELEMETRY_REVIEWED_ROLLOUT", "1");
  expect(runtimeTelemetryConfig("0.33.0")).toMatchObject({
    endpoint: "https://api.example.test/v1/telemetry/reports",
    rollout: true,
    environment: true,
    client: "daemon",
  });
  vi.stubEnv("APP_TELEMETRY_FORCE_OFF", "1");
  expect(runtimeTelemetryConfig("0.33.0").forceOff).toBe(true);
  vi.stubEnv("CI", "1");
  expect(runtimeTelemetryConfig("0.33.0").environment).toBe(false);
  vi.stubEnv("CI", "");
  vi.stubEnv("NODE_ENV", "development");
  expect(runtimeTelemetryConfig("0.33.0").environment).toBe(false);
});
it("rejects non-HTTPS servers, embedded secrets and unexpected paths or query properties", () => {
  for (const url of [
    "http://api.example.test",
    "https://secret:password@api.example.test",
    "https://api.example.test/private",
    "https://api.example.test?secret=CANARY",
    "not-url",
  ]) {
    vi.stubEnv("APP_TELEMETRY_URL", url);
    expect(runtimeTelemetryConfig("0.33.0").endpoint).toBeNull();
  }
});

it("keeps packaged reporting behind explicit reviewed rollout and honors empty runtime overrides", () => {
  vi.stubGlobal("__APP_TELEMETRY_URL__", "https://packaged.example.test");
  vi.stubGlobal("__APP_TELEMETRY_REVIEWED_ROLLOUT__", true);
  vi.stubEnv("APP_TELEMETRY_URL", undefined);
  vi.stubEnv("APP_TELEMETRY_REVIEWED_ROLLOUT", undefined);
  expect(runtimeTelemetryConfig("0.33.0")).toMatchObject({
    endpoint: "https://packaged.example.test/v1/telemetry/reports",
    rollout: true,
  });
  vi.stubEnv("APP_TELEMETRY_REVIEWED_ROLLOUT", "0");
  expect(runtimeTelemetryConfig("0.33.0").rollout).toBe(false);
  vi.stubEnv("APP_TELEMETRY_REVIEWED_ROLLOUT", "1");
  vi.stubEnv("APP_TELEMETRY_URL", "");
  expect(runtimeTelemetryConfig("0.33.0")).toMatchObject({
    endpoint: null,
    rollout: false,
  });
});
