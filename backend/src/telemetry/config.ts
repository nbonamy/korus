import type { ReporterConfig } from "./reporter";

/** Local analytics phase: the remote destination is disconnected regardless of saved consent or endpoint configuration. */
export function runtimeTelemetryConfig(version: string): ReporterConfig {
  return {
    endpoint: null,
    forceOff: process.env.APP_TELEMETRY_FORCE_OFF === "1",
    environment: !process.env.CI && process.env.NODE_ENV !== "test",
    version,
    channel: "stable",
    immediate: process.env.NODE_ENV === "development",
    platform:
      process.platform === "darwin"
        ? "macos"
        : process.platform === "win32"
          ? "windows"
          : "linux",
    client: "daemon",
  };
}
