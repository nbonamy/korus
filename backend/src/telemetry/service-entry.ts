import { readFile } from "node:fs/promises";
import { startTelemetryService } from "./service";
const env = process.env;
try {
  const token = (
    await readFile(env.TELEMETRY_OPERATOR_TOKEN_FILE ?? "", "utf8")
  ).trim();
  const tls =
    env.TELEMETRY_TLS_KEY && env.TELEMETRY_TLS_CERT
      ? {
          key: await readFile(env.TELEMETRY_TLS_KEY),
          cert: await readFile(env.TELEMETRY_TLS_CERT),
        }
      : undefined;
  const service = await startTelemetryService({
    database: env.TELEMETRY_DATABASE ?? "telemetry.sqlite",
    operatorToken: token,
    host: env.TELEMETRY_HOST ?? "127.0.0.1",
    port: Number(env.TELEMETRY_PORT ?? 8443),
    tls,
    synthetic: env.TELEMETRY_SYNTHETIC === "1",
  });
  const shutdown = () => {
    void service.close().then(
      () => process.exit(0),
      () => {
        process.stderr.write("Telemetry service shutdown failed.\n");
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch {
  process.stderr.write("Telemetry service configuration or startup failed.\n");
  process.exitCode = 1;
}
