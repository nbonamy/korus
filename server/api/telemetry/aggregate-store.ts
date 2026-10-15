import { summarizeModelBehavior, type ModelBehavior } from "./model-behavior";
import { demoBuckets } from "./demo-data";
import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  isUtcDay,
  telemetryLimits,
  utcDay,
  type TelemetryReport,
} from "@workspace/core/telemetry";
import {
  summarizeOperatorRows,
  type OperatorSummary,
} from "./operator-summary";
export const operatorDimensions = [
  "platform",
  "version",
  "channel",
  "provider",
  "model",
  "feature",
] as const;
type OperatorDimension = (typeof operatorDimensions)[number];
export type OperatorQuery = {
  from: string;
  to: string;
  dimension: OperatorDimension;
  value?: string;
};
export type OperatorRow = {
  day: string;
  metric: string;
  dimension: string;
  value: string;
  total: number;
  reports: number;
};
/** Independent one-dimensional marginals, never correlated installation fingerprints. */
export class AggregateStore {
  private readonly db: DatabaseSync;
  constructor(
    file: string,
    private readonly now: () => number = Date.now,
  ) {
    this.db = new DatabaseSync(file);
    if (file !== ":memory:") chmodSync(file, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS dedupe(id TEXT PRIMARY KEY, received INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS buckets(period TEXT NOT NULL, day TEXT NOT NULL, metric TEXT NOT NULL, dimension TEXT NOT NULL, value TEXT NOT NULL, total INTEGER NOT NULL, reports INTEGER NOT NULL, PRIMARY KEY(period,day,metric,dimension,value));",
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(
        "INSERT INTO buckets SELECT 'daily',day,metric,dimension,CASE WHEN dimension='channel' AND value='development' THEN 'stable' ELSE value END,total,reports FROM buckets WHERE period='development-daily' ON CONFLICT(period,day,metric,dimension,value) DO UPDATE SET total=total+excluded.total,reports=reports+excluded.reports; DELETE FROM buckets WHERE period='development-daily'; COMMIT;",
      );
    } catch {
      this.db.exec("ROLLBACK");
      this.db.close();
      throw new Error("Aggregate migration failed.");
    }
  }
  setDemo(enabled: boolean): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("DELETE FROM buckets WHERE period='demo-daily'");
      if (enabled) {
        const insert = this.db.prepare(
          "INSERT INTO buckets VALUES('demo-daily',?,?,?,?,?,?)",
        );
        for (const row of demoBuckets(this.now()))
          insert.run(
            row.day,
            row.metric,
            row.dimension,
            row.value,
            row.total,
            row.reports,
          );
        if (
          Number(
            this.db.prepare("SELECT COUNT(*) AS count FROM buckets").get()!
              .count,
          ) > 100000
        )
          throw new Error("Capacity reached.");
      }
      this.db.exec("COMMIT");
    } catch {
      this.db.exec("ROLLBACK");
      throw new Error("Demo data could not be updated.");
    }
  }
  ingest(report: TelemetryReport): "accepted" | "duplicate" {
    const now = this.now();
    const today = utcDay(now);
    const cutoff = utcDay(now - (telemetryLimits.days - 1) * 86400000);
    if (report.rows.some((r) => r.day < cutoff || r.day > today))
      throw new Error("Invalid report age.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (
        this.db.prepare("SELECT 1 FROM dedupe WHERE id=?").get(report.reportId)
      ) {
        this.db.exec("ROLLBACK");
        return "duplicate";
      }
      if (
        (this.db.prepare("SELECT COUNT(*) AS count FROM buckets").get()!
          .count as number) > 100000 ||
        (this.db.prepare("SELECT COUNT(*) AS count FROM dedupe").get()!
          .count as number) > 100000
      )
        throw new Error("Capacity reached.");
      this.db
        .prepare("INSERT INTO dedupe VALUES(?,?)")
        .run(report.reportId, now);
      const increments = new Map<
        string,
        {
          period: string;
          day: string;
          metric: string;
          dimension: string;
          value: string;
          total: number;
        }
      >();
      for (const row of report.rows) {
        const dimensions: Record<string, string | undefined> = {
          platform: report.platform,
          version: report.version,
          channel: report.channel === "development" ? "stable" : report.channel,
          provider: row.provider,
          model: row.model,
          feature: row.feature,
        };
        for (const [dimension, value] of Object.entries(dimensions))
          if (value)
            for (const period of ["daily", "monthly"]) {
              const day =
                period !== "monthly" ? row.day : row.day.slice(0, 7) + "-01";
              const key = JSON.stringify([
                period,
                day,
                row.metric,
                dimension,
                value,
              ]);
              const old = increments.get(key);
              if (old) old.total += row.value;
              else
                increments.set(key, {
                  period,
                  day,
                  metric: row.metric,
                  dimension,
                  value,
                  total: row.value,
                });
            }
      }
      const select = this.db.prepare(
        "SELECT total FROM buckets WHERE period=? AND day=? AND metric=? AND dimension=? AND value=?",
      );
      const update = this.db.prepare(
        "INSERT INTO buckets VALUES(?,?,?,?,?,?,1) ON CONFLICT(period,day,metric,dimension,value) DO UPDATE SET total=total+excluded.total,reports=reports+1",
      );
      for (const row of increments.values()) {
        const args = [
          row.period,
          row.day,
          row.metric,
          row.dimension,
          row.value,
        ];
        const existing = select.get(...args);
        if (Number(existing?.total ?? 0) + row.total > 1e15)
          throw new Error("Aggregate capacity reached.");
        update.run(...args, row.total);
      }
      if (
        (this.db.prepare("SELECT COUNT(*) AS count FROM buckets").get()!
          .count as number) > 100000 ||
        (this.db.prepare("SELECT COUNT(*) AS count FROM dedupe").get()!
          .count as number) > 100000
      )
        throw new Error("Capacity reached.");
      this.db.exec("COMMIT");
      return "accepted";
    } catch {
      this.db.exec("ROLLBACK");
      throw new Error("Report could not be stored.");
    }
  }
  query(query: OperatorQuery): {
    rows: OperatorRow[];
    summary: OperatorSummary[];
    behavior: ModelBehavior[];
    minimumReports: number;
    demo: boolean;
    partial: boolean;
    updatedAt: string;
    coverage: string;
  } {
    if (
      !operatorDimensions.includes(query.dimension) ||
      !isUtcDay(query.from) ||
      !isUtcDay(query.to) ||
      query.from > query.to ||
      Date.parse(query.to) - Date.parse(query.from) > 90 * 86400000 ||
      (query.value &&
        (query.value.length > 64 || !/^[-a-zA-Z0-9.]+$/.test(query.value)))
    )
      throw new Error("Invalid query.");
    const demo = !!this.db
      .prepare("SELECT 1 FROM buckets WHERE period='demo-daily' LIMIT 1")
      .get();
    const released = this.db
      .prepare(
        "SELECT day,metric,dimension,value,total,reports FROM buckets WHERE period=? AND day>=? AND day<=? AND day<=? AND dimension=? AND (? IS NULL OR value=?) ORDER BY day,metric,value LIMIT 2000",
      )
      .all(
        demo ? "demo-daily" : "daily",
        query.from,
        query.to,
        utcDay(this.now()),
        query.dimension,
        query.value ?? null,
        query.value ?? null,
      ) as unknown as OperatorRow[];
    const rows = released.map((row) => ({ ...row }));
    return {
      rows,
      summary: summarizeOperatorRows(rows, query.dimension, !!query.value),
      behavior: query.dimension === "model" ? summarizeModelBehavior(rows) : [],
      minimumReports: 1,
      demo,
      partial: true,
      updatedAt: utcDay(this.now()),
      coverage:
        (demo
          ? "Demo data only. Sample values are separate from real reports and can be deleted. "
          : "Exact anonymous numeric aggregates, including today. Report volume is not people. ") +
        "Codex consumption is local-only; token observations cover supported Claude main-loop executions. Input includes cache reads and Claude cache creation; output includes reasoning. Filters use independent marginals and cannot be combined. Missing measurements remain unavailable.",
    };
  }
  cleanup(): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("DELETE FROM dedupe WHERE received<?")
        .run(this.now() - 7 * 86400000);
      this.db
        .prepare("DELETE FROM buckets WHERE period='demo-daily' AND day<?")
        .run(utcDay(this.now() - 6 * 86400000));
      this.db
        .prepare("DELETE FROM buckets WHERE period='daily' AND day<?")
        .run(utcDay(this.now() - 90 * 86400000));
      const month = new Date(this.now());
      month.setUTCMonth(month.getUTCMonth() - 11, 1);
      this.db
        .prepare("DELETE FROM buckets WHERE period='monthly' AND day<?")
        .run(utcDay(month.getTime()));
      this.db.exec("COMMIT; PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      this.db.exec("ROLLBACK");
      throw new Error("Retention maintenance failed.");
    }
  }
  close(): void {
    this.db.close();
  }
}
