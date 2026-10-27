import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import type { Server } from "node:http";
import { z } from "zod";
import { normalizedAddress } from "./admission";
import { createMetricsServer } from "./metrics-server";
import { createCollectorServer } from "./server";
import {
  createTelemetryPool,
  TelemetryStore,
  type InstallRow,
  type InstallDayRow,
  type UsageDailyRow,
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

/** Configuration and DB credentials are read at runtime, never bundled. DDL is
 * an explicit migrate command using a separately supplied migration role. */
export async function runCollector(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ close(): Promise<void> } | undefined> {
  let pool: ReturnType<typeof createTelemetryPool> | undefined;
  let server: Server | undefined;
  try {
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
    pool = createTelemetryPool(env.TELEMETRY_DATABASE_URL);
    const store = new TelemetryStore(pool);
    if (!config) {
      await store.migrate();
      await pool.end();
      return;
    }
    // Fail before accepting requests when migrations/readiness are missing. This
    // reads no install records and never creates schema under the ingestion role.
    await Promise.all([
      pool.query<InstallRow>(
        "SELECT install_id, first_reported_day FROM installs LIMIT 0",
      ),
      pool.query<InstallDayRow>("SELECT * FROM install_days LIMIT 0"),
      pool.query<UsageDailyRow>("SELECT * FROM usage_daily LIMIT 0"),
    ]);
    server =
      "accessTokenFile" in config
        ? createMetricsServer({
            pool,
            accessToken: (
              await readFile(config.accessTokenFile, "utf8")
            ).replace(/\n+$/, ""),
            consoleOrigin: config.consoleOrigin,
          })
        : createCollectorServer({
            store,
            trustedProxies: config.trustedProxies,
          });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(config.listenPort, config.listenHost, () => {
        server!.off("error", reject);
        resolve();
      });
    });
    // There is no runtime access/error logger. Listener faults must not emit
    // addresses or unhandled error objects to a process supervisor.
    server.on("error", () => {});
    let closing: Promise<void> | undefined;
    return {
      close: () =>
        (closing ??= (async () => {
          await new Promise<void>((resolve) => {
            server!.close(() => resolve());
            server!.closeAllConnections();
          });
          await pool!.end();
        })()),
    };
  } catch {
    server?.closeAllConnections();
    server?.close();
    await pool?.end().catch(() => {});
    // Error causes can contain URL/password/SQL/input. Deliberately discard them.
    throw new Error("Collector startup failed.");
  }
}
