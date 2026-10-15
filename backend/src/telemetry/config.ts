import type { ReporterConfig } from "./reporter";

/** Public build configuration, with an explicit runtime override (including an empty override). */
export function runtimeTelemetryConfig(version: string): ReporterConfig {
  const configured = (
    process.env.APP_TELEMETRY_URL ??
    (typeof __APP_TELEMETRY_URL__ === "string" ? __APP_TELEMETRY_URL__ : "")
  ).trim();
  let endpoint: string | null = null;
  try {
    const url = new URL(configured);
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
    )
      endpoint = url.origin + "/v1/telemetry/reports";
  } catch {
    /* Missing or invalid configuration disables reporting. */
  }
  return {
    endpoint,
    forceOff: process.env.APP_TELEMETRY_FORCE_OFF === "1",
    environment: !process.env.CI && process.env.NODE_ENV !== "test",
    version,
    channel: "stable",
    platform:
      process.platform === "darwin"
        ? "macos"
        : process.platform === "win32"
          ? "windows"
          : "linux",
    client: "daemon",
  };
}
