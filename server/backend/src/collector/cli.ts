import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import type { Server } from "node:http";
import { z } from "zod";
import { normalizedAddress } from "./admission";
import { createConsoleAuthServer } from "./console-auth";
import { createMetricsServer } from "./metrics-server";
import { createCollectorServer } from "./server";
import {
  createDiagnostics,
  diagnosticService,
  type DiagnosticSink,
} from "./diagnostics";
import {
  createTelemetryPool,
  TelemetryStore,
  type InstallRow,
  type InstallDayRow,
} from "./store";

const configSchema = z
  .object({
    listenHost: z.string().refine((value) => isIP(value) !== 0),
    listenPort: z.number().int().min(1024).max(65535),
    trustedProxies: z
      .array(z.string().refine((value) => normalizedAddress(value) !== null))
      .max(64)
      .default([]),
  })
  .strict();

const readConfigSchema = z
  .object({
    listenHost: z.string().refine((value) => isIP(value) !== 0),
    listenPort: z.number().int().min(1024).max(65535),
    consoleOrigin: z.string(),
    accessTokenFile: z.string().min(1),
  })
  .strict();

const authConfigSchema = z
  .object({
    listenHost: z.string().refine((value) => isIP(value) !== 0),
    listenPort: z.number().int().min(1024).max(65535),
    consoleOrigin: z.string(),
    allowInsecureLoopback: z.boolean().default(false),
  })
  .strict();

/** Configuration and DB credentials are read at runtime, never bundled. DDL is
 * an explicit migrate command using a separately supplied migration role. */
export async function runCollector(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  sink?: DiagnosticSink,
): Promise<{ close(): Promise<void> } | undefined> {
  let pool: ReturnType<typeof createTelemetryPool> | undefined;
  let server: Server | undefined;
  const diagnostics = createDiagnostics(diagnosticService(args[0]), sink);
  let operation: Parameters<typeof diagnostics.failure>[0] = "configuration";
  try {
    if (args[0] === "auth" && args.length === 2) {
      const config = authConfigSchema.parse(
        JSON.parse(await readFile(args[1]!, "utf8")),
      );
      server = createConsoleAuthServer({
        diagnostics,
        consoleOrigin: config.consoleOrigin,
        password: env.BACKEND_ADMIN_PASSWORD ?? "",
        allowInsecureLoopback: config.allowInsecureLoopback,
      });
      operation = "listen";
      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(config.listenPort, config.listenHost, () => {
          server!.off("error", reject);
          resolve();
        });
      });
      server.on("error", (error) => diagnostics.failure("listen", error));
      diagnostics.info("ready");
      let closing: Promise<void> | undefined;
      return {
        close: () =>
          (closing ??= new Promise<void>((resolve) => {
            server!.close(() => resolve());
            server!.closeAllConnections();
          }).then(() => {
            diagnostics.info("stopped");
          })),
      };
    }
    if (
      !env.TELEMETRY_DATABASE_URL ||
      !(
        (args[0] === "migrate" && args.length === 1) ||
        (["serve", "read"].includes(args[0]!) && args.length === 2)
      )
    )
      throw new Error();
    const config =
      args[0] !== "migrate"
        ? (args[0] === "read" ? readConfigSchema : configSchema).parse(
            JSON.parse(await readFile(args[1]!, "utf8")),
          )
        : undefined;
    operation = "database_readiness";
    pool = createTelemetryPool(env.TELEMETRY_DATABASE_URL, diagnostics);
    const store = new TelemetryStore(pool);
    if (!config) {
      operation = "migration";
      await store.migrate();
      await pool.end();
      diagnostics.info("migration_complete");
      return;
    }
    // Fail before accepting requests when migrations/readiness are missing. This
    // reads no install records and never creates schema under the ingestion role.
    await Promise.all([
      pool.query<InstallRow>(
        "SELECT install_id, first_reported_day, first_reported_hour FROM installs LIMIT 0",
      ),
      pool.query<InstallDayRow>("SELECT * FROM install_days LIMIT 0"),
      pool.query(
        "SELECT measured_turns, cost_coverage FROM usage_daily LIMIT 0",
      ),
    ]);
    const providerSchema = await pool.query(
      "SELECT 1 FROM pg_constraint WHERE conrelid='usage_daily'::regclass AND conname='usage_daily_provider_v8_check'",
    );
    if (providerSchema.rowCount !== 1) throw Object.assign(new Error("Missing provider migration."), {code:"SCHEMA_OUTDATED"});
    operation = "credentials";
    server =
      "accessTokenFile" in config
        ? createMetricsServer({
            diagnostics,
            pool,
            accessToken: (
              await readFile(config.accessTokenFile, "utf8")
            ).replace(/\n+$/, ""),
            consoleOrigin: config.consoleOrigin,
          })
        : createCollectorServer({
            diagnostics,
            store,
            trustedProxies: config.trustedProxies,
          });
    operation = "listen";
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(config.listenPort, config.listenHost, () => {
        server!.off("error", reject);
        resolve();
      });
    });
    server.on("error", (error) => diagnostics.failure("listen", error));
    diagnostics.info("ready");
    let closing: Promise<void> | undefined;
    return {
      close: () =>
        (closing ??= (async () => {
          await new Promise<void>((resolve) => {
            server!.close(() => resolve());
            server!.closeAllConnections();
          });
          await pool!.end();
          diagnostics.info("stopped");
        })().catch((error) => {
          diagnostics.failure("shutdown", error);
          throw new Error("Collector shutdown failed.");
        })),
    };
  } catch (error) {
    diagnostics.failure(operation, error, "startup_failed");
    server?.closeAllConnections();
    server?.close();
    await pool?.end().catch(() => {});
    // The caller receives no raw error, even when its logger is unavailable.
    throw new Error("Collector startup failed.");
  }
}
