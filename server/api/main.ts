import { readFile } from "node:fs/promises";
import { startApiServer } from "./server";
const env = process.env;
try {
  const token = (
    await readFile(env.API_OPERATOR_TOKEN_FILE ?? "", "utf8")
  ).trim();
  const tls =
    env.API_TLS_KEY && env.API_TLS_CERT
      ? {
          key: await readFile(env.API_TLS_KEY),
          cert: await readFile(env.API_TLS_CERT),
        }
      : undefined;
  const service = await startApiServer({
    database: env.API_TELEMETRY_DATABASE ?? "telemetry.sqlite",
    operatorToken: token,
    host: env.API_HOST ?? "127.0.0.1",
    port: Number(env.API_PORT ?? 8443),
    tls,
    synthetic: env.API_SYNTHETIC === "1",
    reverseProxy: env.API_REVERSE_PROXY === "1",
  });
  const shutdown = () => {
    void service.close().then(
      () => process.exit(0),
      () => {
        process.stderr.write("API server shutdown failed.\n");
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch {
  process.stderr.write("API server configuration or startup failed.\n");
  process.exitCode = 1;
}
