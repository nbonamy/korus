import pg from "pg";
import type {
  DailyTelemetryPayload,
  TelemetryOs,
  TelemetryProvider,
  TelemetryModel,
} from "@workspace/core/telemetry";
import { telemetryMigrations } from "./migrations";

// PostgreSQL returns bigint/numeric as strings. Keep them exact at the SQL seam;
// aggregate API owners must explicitly convert only bounded results.
export type InstallRow = { install_id: string; first_reported_day: string };
export type InstallDayRow = {
  install_id: string;
  day: string;
  app_version: string;
  os: TelemetryOs;
  received_at: Date;
};
export type UsageDailyRow = {
  install_id: string;
  day: string;
  provider: TelemetryProvider;
  model: TelemetryModel;
  turns: string;
  input_tokens: string | null;
  cached_input_tokens: string | null;
  output_tokens: string | null;
  estimated_cost_usd: string | null;
};

export function createTelemetryPool(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 20,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 3000,
    query_timeout: 4000,
    lock_timeout: 2000,
    idle_in_transaction_session_timeout: 5000,
    options: "-c transaction_timeout=5000 -c timezone=UTC",
    application_name: "telemetry-collector",
    types: {
      getTypeParser: (oid, format) =>
        oid === pg.types.builtins.DATE && format !== "binary"
          ? (value: string) => value
          : pg.types.getTypeParser(oid, format),
    },
  });
  // Idle disconnects are recoverable. Never log PostgreSQL errors: they may carry
  // SQL parameters, identifiers, addresses or operator configuration.
  pool.on("error", () => {});
  // Checked-out clients can emit a second connection error after the active
  // query rejects. Handle it too, without replacing that query's rejection.
  pool.on("connect", (client) => {
    client.on("error", () => {});
  });
  return pool;
}

export class TelemetryStore {
  constructor(private readonly pool: pg.Pool) {}

  /** Explicit deployment command, separate from the least-privilege write role. */
  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    let failed = false;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(742018, 1)");
      await client.query(
        "CREATE TABLE IF NOT EXISTS telemetry_migrations (version integer PRIMARY KEY)",
      );
      for (const migration of telemetryMigrations) {
        if (
          (
            await client.query(
              "SELECT version FROM telemetry_migrations WHERE version=$1",
              [migration.version],
            )
          ).rowCount
        )
          continue;
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO telemetry_migrations(version) VALUES ($1)",
          [migration.version],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      failed = true;
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release(failed);
    }
  }

  /** The upsert locks the unique parent even when it did not exist before this
   * transaction. It serializes the entire replacement across all processes;
   * no in-memory lock or read/then-insert race is involved. */
  async replace(payload: DailyTelemetryPayload): Promise<void> {
    const client = await this.pool.connect();
    let failed = false;
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO install_days(install_id, day, app_version, os)
        VALUES ($1, $2, $3, $4) ON CONFLICT (install_id, day) DO UPDATE
        SET app_version=EXCLUDED.app_version, os=EXCLUDED.os, received_at=clock_timestamp()`,
        [payload.installId, payload.day, payload.appVersion, payload.os],
      );
      await client.query(
        "DELETE FROM usage_daily WHERE install_id=$1 AND day=$2",
        [payload.installId, payload.day],
      );
      if (payload.usage.length) {
        const rows = payload.usage;
        await client.query(
          `INSERT INTO usage_daily(install_id, day, provider, model, turns, input_tokens, cached_input_tokens, output_tokens, estimated_cost_usd, speed_turns, speed_output_tokens, generation_ms, ttft_ms, ttft_turns, service_tier)
          SELECT $1::uuid, $2::date, * FROM unnest($3::text[], $4::text[], $5::bigint[], $6::bigint[], $7::bigint[], $8::bigint[], $9::numeric[], $10::bigint[], $11::bigint[], $12::bigint[], $13::bigint[], $14::bigint[], $15::text[])`,
          [
            payload.installId,
            payload.day,
            rows.map((r) => r.provider),
            rows.map((r) => r.model),
            rows.map((r) => r.turns),
            rows.map((r) => r.inputTokens),
            rows.map((r) => r.cachedInputTokens),
            rows.map((r) => r.outputTokens),
            rows.map((r) => r.estimatedCostUsd),
            rows.map((r) => r.performance?.speedTurns ?? null),
            rows.map((r) => r.performance?.outputTokens ?? null),
            rows.map((r) => r.performance?.generationMs ?? null),
            rows.map((r) => r.performance?.ttftMs ?? null),
            rows.map((r) => r.performance?.ttftTurns ?? null),
            rows.map((r) => r.serviceTier ?? "unknown"),
          ],
        );
      }
      // First successfully reported reporting day, not install time. A later
      // arrival for an earlier reporting date must not rewrite this registry.
      await client.query(
        "INSERT INTO installs(install_id, first_reported_day) VALUES ($1, $2) ON CONFLICT (install_id) DO NOTHING",
        [payload.installId, payload.day],
      );
      await client.query("COMMIT");
    } catch (error) {
      failed = true;
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release(failed);
    }
  }
}
