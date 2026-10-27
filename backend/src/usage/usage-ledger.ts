import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isUtcDay, utcDay } from "@workspace/core/usage";
import {
  validConsumption,
  validRequestObservation,
  validRequestCoverageReason,
  type RequestObservation,
  validExecutionTiming,
  type ExecutionObservation,
  type UsageRecord,
  type UsageFilter,
  type UsageSummary,
  type UsageCostReason,
  type Consumption,
} from "@workspace/core/usage";
import { loadPricingHistory } from "../pricing/catalog";
import type { PricingHistory } from "../pricing/schema";
import {
  priceRequest,
  priceExecution,
  type RequestPrice,
} from "../pricing/evaluate";
import { addCost, emptyCost } from "./cost";
const retention = 365 * 86400000;
type Bucket = UsageSummary["rows"][number];
/** Statistics only. Provider conversation stores remain the sole owners of content. */
export class UsageLedger {
  private db: DatabaseSync | null = null;
  private since: number;
  private available = true;
  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
    private readonly prices: PricingHistory = loadPricingHistory(),
  ) {
    this.since = now();
  }
  private open(): DatabaseSync | null {
    if (this.db || !this.available) return this.db;
    try {
      if (this.file !== ":memory:")
        mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      this.db = new DatabaseSync(this.file);
      if (this.file !== ":memory:") chmodSync(this.file, 0o600);
      this.db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS executions(provider TEXT NOT NULL,session_id TEXT NOT NULL,turn_id TEXT NOT NULL,agent_id TEXT NOT NULL,model TEXT,reasoning_effort TEXT,service_tier TEXT,team_id TEXT,repository TEXT,phase TEXT NOT NULL,started_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,duration_ms INTEGER,tokens TEXT,timing TEXT,PRIMARY KEY(provider,session_id,turn_id)); CREATE INDEX IF NOT EXISTS executions_started ON executions(started_at);",
      );
      const columns = this.db.prepare("PRAGMA table_info(executions)").all();
      if (!columns.some((c) => c.name === "request_coverage"))
        this.db.exec("ALTER TABLE executions ADD COLUMN request_coverage TEXT");
      if (!columns.some((c) => c.name === "request_coverage_reason"))
        this.db.exec(
          "ALTER TABLE executions ADD COLUMN request_coverage_reason TEXT",
        );
      this.db.exec(
        "CREATE TABLE IF NOT EXISTS requests(provider TEXT NOT NULL,session_id TEXT NOT NULL,turn_id TEXT NOT NULL,request_id TEXT NOT NULL,at INTEGER NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,observation TEXT NOT NULL,PRIMARY KEY(provider,session_id,turn_id,request_id)); CREATE INDEX IF NOT EXISTS requests_at ON requests(at); CREATE TRIGGER IF NOT EXISTS execution_requests_delete AFTER DELETE ON executions BEGIN DELETE FROM requests WHERE provider=OLD.provider AND session_id=OLD.session_id AND turn_id=OLD.turn_id; END;",
      );
      const since = this.db
        .prepare("SELECT value FROM metadata WHERE key='since'")
        .get()?.value;
      if (since !== undefined && Number.isFinite(Number(since)))
        this.since = Number(since);
      else
        this.db
          .prepare("INSERT OR REPLACE INTO metadata VALUES('since',?)")
          .run(String(this.since));
    } catch {
      this.available = false;
      this.db?.close();
      this.db = null;
    }
    return this.db;
  }
  async load(): Promise<void> {
    const db = this.open();
    if (!db) return;
    try {
      this.prune();
    } catch {
      this.available = false;
      db.close();
      this.db = null;
    }
  }
  private valid(value: ExecutionObservation): boolean {
    return (
      !!value &&
      ["codex", "claude", "antigravity"].includes(value.provider) &&
      ["started", "completed", "failed", "interrupted", "usage"].includes(
        value.phase,
      ) &&
      [value.agentId, value.sessionId, value.turnId].every(
        (v) => typeof v === "string" && v.length > 0 && v.length <= 2048,
      ) &&
      (value.model === null ||
        (typeof value.model === "string" && value.model.length <= 200)) &&
      [value.reasoningEffort, value.serviceTier].every(
        (v) =>
          v == null ||
          (typeof v === "string" && v.length > 0 && v.length <= 200),
      ) &&
      (value.requestCoverage == null ||
        ["complete", "partial"].includes(value.requestCoverage)) &&
      (value.requestCoverageReason == null ||
        validRequestCoverageReason(value.requestCoverageReason)) &&
      Number.isFinite(value.at) &&
      value.at >= this.now() - retention &&
      value.at <= this.now() + 60000 &&
      (!value.tokens || validConsumption(value.tokens)) &&
      (!value.timing || validExecutionTiming(value.timing)) &&
      (value.durationMs === undefined ||
        (Number.isSafeInteger(value.durationMs) &&
          value.durationMs >= 0 &&
          value.durationMs <= 1e9))
    );
  }
  private save(record: UsageRecord): void {
    const reference = (v: unknown) =>
      typeof v === "string" && v.length <= 4096 ? v : null;
    this.db!.prepare(
      "INSERT INTO executions(provider,session_id,turn_id,agent_id,model,reasoning_effort,service_tier,team_id,repository,phase,started_at,updated_at,duration_ms,tokens,timing,request_coverage,request_coverage_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,session_id,turn_id) DO UPDATE SET agent_id=excluded.agent_id,model=excluded.model,reasoning_effort=excluded.reasoning_effort,service_tier=excluded.service_tier,team_id=excluded.team_id,repository=excluded.repository,phase=excluded.phase,started_at=excluded.started_at,updated_at=excluded.updated_at,duration_ms=excluded.duration_ms,tokens=excluded.tokens,timing=excluded.timing,request_coverage=excluded.request_coverage,request_coverage_reason=excluded.request_coverage_reason",
    ).run(
      record.provider,
      record.sessionId,
      record.turnId,
      record.agentId,
      record.model,
      record.reasoningEffort ?? null,
      record.serviceTier ?? null,
      reference(record.teamId),
      reference(record.repository),
      record.phase,
      record.startedAt,
      record.at,
      record.durationMs ?? null,
      record.tokens ? JSON.stringify(record.tokens) : null,
      record.timing ? JSON.stringify(record.timing) : null,
      record.requestCoverage ?? null,
      record.requestCoverageReason ?? null,
    );
  }
  private decode(row: Record<string, unknown>): UsageRecord {
    return {
      provider: row.provider,
      sessionId: row.session_id,
      turnId: row.turn_id,
      agentId: row.agent_id,
      model: row.model,
      reasoningEffort: row.reasoning_effort,
      serviceTier: row.service_tier,
      teamId: row.team_id,
      repository: row.repository,
      phase: row.phase,
      requestCoverage: row.request_coverage ?? null,
      requestCoverageReason: validRequestCoverageReason(
        row.request_coverage_reason,
      )
        ? row.request_coverage_reason
        : null,
      startedAt: row.started_at,
      at: row.updated_at,
      ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
      tokens: row.tokens ? JSON.parse(String(row.tokens)) : null,
      ...(row.timing ? { timing: JSON.parse(String(row.timing)) } : {}),
    } as UsageRecord;
  }
  private prune(): void {
    this.db!.prepare("DELETE FROM executions WHERE started_at<?").run(
      this.now() - retention,
    );
    this.db!.exec(
      "DELETE FROM executions WHERE rowid IN (SELECT rowid FROM executions ORDER BY started_at DESC,rowid DESC LIMIT -1 OFFSET 50000)",
    );
  }
  async observe(
    event: ExecutionObservation,
    attribution: { teamId: string | null; repository: string | null },
  ): Promise<boolean> {
    if (!this.valid(event)) return false;
    const db = this.open();
    if (!db) return false;
    const found = db
      .prepare(
        "SELECT * FROM executions WHERE provider=? AND session_id=? AND turn_id=?",
      )
      .get(event.provider, event.sessionId, event.turnId);
    if (!found && event.phase !== "started") return false;
    if (
      found &&
      (event.phase === "started" ||
        (event.phase !== "usage" && found.phase !== "started"))
    )
      return false;
    const previous = found ? this.decode(found) : null;
    const record: UsageRecord = {
      agentId: event.agentId,
      sessionId: event.sessionId,
      turnId: event.turnId,
      provider: event.provider,
      model: event.model,
      reasoningEffort: event.reasoningEffort ?? null,
      serviceTier: event.serviceTier ?? null,
      at: event.at,
      phase: event.phase === "usage" ? previous!.phase : event.phase,
      startedAt: previous?.startedAt ?? event.at,
      teamId: previous?.teamId ?? attribution.teamId,
      repository: previous?.repository ?? attribution.repository,
      ...(previous
        ? { ...previous, model: event.model ?? previous.model }
        : {}),
      ...(event.phase !== "usage" ? { phase: event.phase, at: event.at } : {}),
      ...(event.requestCoverage !== undefined
        ? { requestCoverage: event.requestCoverage }
        : {}),
      ...(event.requestCoverageReason !== undefined
        ? { requestCoverageReason: event.requestCoverageReason }
        : {}),
      ...(event.tokens !== undefined ? { tokens: event.tokens } : {}),
      ...(event.timing !== undefined ? { timing: event.timing } : {}),
      ...(event.durationMs !== undefined
        ? { durationMs: event.durationMs }
        : {}),
    };
    db.exec("BEGIN IMMEDIATE");
    try {
      this.save(record);
      this.prune();
      db.exec("COMMIT");
      return true;
    } catch {
      db.exec("ROLLBACK");
      return false;
    }
  }
  /** Parent must already exist. Revision and finality survive process restarts. */
  async observeRequest(event: RequestObservation): Promise<boolean> {
    if (
      !validRequestObservation(event) ||
      (event.provider === "claude" && event.model === "<synthetic>") ||
      event.at < this.now() - retention ||
      event.at > this.now() + 60000
    )
      return false;
    const db = this.open();
    if (!db) return false;
    try {
      const parent = db
        .prepare(
          "SELECT agent_id,started_at FROM executions WHERE provider=? AND session_id=? AND turn_id=?",
        )
        .get(event.provider, event.sessionId, event.turnId);
      if (
        !parent ||
        parent.agent_id !== event.agentId ||
        Number(parent.started_at) < this.now() - retention
      )
        return false;
      const found = db
        .prepare(
          "SELECT at,revision,status FROM requests WHERE provider=? AND session_id=? AND turn_id=? AND request_id=?",
        )
        .get(event.provider, event.sessionId, event.turnId, event.requestId);
      if (
        found &&
        (found.at !== event.at ||
          Number(found.revision) >= event.revision ||
          (found.status === "final" && event.status !== "final"))
      )
        return false;
      db.prepare(
        "INSERT INTO requests VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(provider,session_id,turn_id,request_id) DO UPDATE SET revision=excluded.revision,status=excluded.status,observation=excluded.observation",
      ).run(
        event.provider,
        event.sessionId,
        event.turnId,
        event.requestId,
        event.at,
        event.revision,
        event.status,
        JSON.stringify(event),
      );
      return true;
    } catch {
      return false;
    }
  }
  async deleteExecution(
    provider: ExecutionObservation["provider"],
    sessionId: string,
    turnId: string,
  ): Promise<void> {
    const db = this.open();
    if (!db) throw new Error("Statistics are unavailable.");
    db.prepare(
      "DELETE FROM executions WHERE provider=? AND session_id=? AND turn_id=?",
    ).run(provider, sessionId, turnId);
  }
  query(filter: UsageFilter = {}): UsageSummary {
    if (
      !filter ||
      typeof filter !== "object" ||
      Array.isArray(filter) ||
      Object.keys(filter).some(
        (k) =>
          ![
            "from",
            "to",
            "provider",
            "apiProvider",
            "model",
            "teamId",
            "repository",
            "agentId",
            "group",
          ].includes(k),
      ) ||
      Object.values(filter).some(
        (v) => typeof v !== "string" || v.length > 4096,
      ) ||
      (filter.group &&
        ![
          "provider",
          "apiProvider",
          "model",
          "teamId",
          "repository",
          "agentId",
        ].includes(filter.group)) ||
      (filter.from && !isUtcDay(filter.from)) ||
      (filter.to && !isUtcDay(filter.to)) ||
      (filter.from && filter.to && filter.from > filter.to)
    )
      throw new Error("Invalid usage filter.");
    const db = this.open(),
      rows = new Map<string, Bucket>(),
      daily = new Map<string, Bucket>(),
      dailyGroups = new Map<string, Map<string, Bucket>>(),
      cost = emptyCost();
    if (db) {
      const requestRows = db
        .prepare(
          "SELECT r.observation,e.* FROM requests r JOIN executions e USING(provider,session_id,turn_id) WHERE e.started_at>=? AND r.at>=? AND (r.provider<>'claude' OR json_extract(r.observation,'$.model') IS NOT '<synthetic>') ORDER BY r.at,r.request_id",
        )
        .all(this.now() - retention, this.now() - retention);
      const observedExecutions = new Set(
        requestRows.map((row) =>
          JSON.stringify([row.provider, row.session_id, row.turn_id]),
        ),
      );
      const conditions = ["started_at>=?"],
        args: (string | number)[] = [this.now() - retention];
      if (filter.from) {
        conditions.push("started_at>=?");
        args.push(Date.parse(filter.from));
      }
      if (filter.to) {
        conditions.push("started_at<?");
        args.push(Date.parse(filter.to) + 86400000);
      }
      for (const [key, column] of [
        ["provider", "provider"],
        ["model", "model"],
        ["teamId", "team_id"],
        ["repository", "repository"],
        ["agentId", "agent_id"],
      ] as const)
        if (filter[key]) {
          conditions.push(column + "=?");
          args.push(filter[key]!);
        }
      for (const row of db
        .prepare(
          "SELECT * FROM executions WHERE " +
            conditions.join(" AND ") +
            " ORDER BY started_at LIMIT 50000",
        )
        .all(...args)) {
        const record = this.decode(row);
        // Legacy Claude rows predate request capture. Modern rows must retain
        // their request/provider evidence, including unresolved proxy routing.
        const executionEstimate =
          (record.provider === "codex" ||
            (record.provider === "claude" &&
              record.tokens !== null &&
              record.requestCoverage == null)) &&
          !observedExecutions.has(
            JSON.stringify([record.provider, record.sessionId, record.turnId]),
          );
        const estimatedProvider = executionEstimate
          ? record.provider === "claude"
            ? "anthropic"
            : "openai"
          : null;
        if (filter.apiProvider && filter.apiProvider !== estimatedProvider)
          continue;
        const label = filter.group
          ? String(
              filter.group === "apiProvider"
                ? "Unknown"
                : (record[filter.group] ?? "Unknown"),
            )
          : "All";
        if (!filter.apiProvider) {
          this.aggregate(rows, record, label);
          this.aggregate(daily, record, utcDay(record.startedAt));
          const day = utcDay(record.startedAt);
          const groups = dailyGroups.get(day) ?? new Map<string, Bucket>();
          this.aggregate(groups, record, label);
          dailyGroups.set(day, groups);
        }
        if (executionEstimate) {
          this.aggregateCost(
            rows,
            daily,
            dailyGroups,
            record.startedAt,
            filter.group === "apiProvider" ? estimatedProvider! : label,
            priceExecution(record, this.prices),
            cost,
            undefined,
            true,
          );
        } else if (record.requestCoverage !== "complete")
          this.aggregateCost(
            rows,
            daily,
            dailyGroups,
            record.startedAt,
            label,
            null,
            cost,
            record.requestCoverageReason ?? undefined,
          );
      }
      for (const row of requestRows) {
        const event = JSON.parse(String(row.observation)) as RequestObservation;
        const parent = this.decode(row);
        if (
          (filter.from && event.at < Date.parse(filter.from)) ||
          (filter.to && event.at >= Date.parse(filter.to) + 86400000) ||
          (filter.model && event.model !== filter.model) ||
          (filter.apiProvider && event.apiProvider !== filter.apiProvider) ||
          (["provider", "agentId", "teamId", "repository"] as const).some(
            (k) => filter[k] && filter[k] !== parent[k],
          )
        )
          continue;
        const label =
          filter.group === "model"
            ? (event.model ?? "Unknown")
            : filter.group === "apiProvider"
              ? (event.apiProvider ?? "Unknown")
              : filter.group
                ? String(parent[filter.group] ?? "Unknown")
                : "All";
        this.aggregateCost(
          rows,
          daily,
          dailyGroups,
          event.at,
          label,
          priceRequest(event, this.prices),
          cost,
        );
      }
    }
    return {
      cost,
      recordedSince: this.since,
      retainedSince: Math.max(this.since, this.now() - retention),
      ...(this.available ? {} : { available: false }),
      rows: [...rows.values()],
      daily: [...daily]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, row]) => ({
          day,
          started: row.started,
          tokens: row.tokens,
          measuredTurns: row.measuredTurns,
          cost: row.cost,
          ...(row.speed ? { speed: row.speed } : {}),
          groups: [...dailyGroups.get(day)!.values()].map(
            ({ label, started, tokens, measuredTurns, speed, cost }) => ({
              label,
              started,
              tokens,
              measuredTurns,
              cost,
              ...(speed ? { speed } : {}),
            }),
          ),
        })),
    };
  }
  private bucket(rows: Map<string, Bucket>, label: string): Bucket {
    let row = rows.get(label);
    if (!row) {
      row = {
        label,
        started: 0,
        completed: 0,
        failed: 0,
        interrupted: 0,
        inProgress: 0,
        measuredTurns: 0,
        tokens: null,
        cost: emptyCost(),
      };
      rows.set(label, row);
    }
    return row;
  }
  private aggregateCost(
    rows: Map<string, Bucket>,
    daily: Map<string, Bucket>,
    dailyGroups: Map<string, Map<string, Bucket>>,
    at: number,
    label: string,
    price: RequestPrice | null,
    total: NonNullable<UsageSummary["cost"]>,
    unknownReason?: UsageCostReason,
    execution = false,
  ): void {
    const day = utcDay(at);
    const groups = dailyGroups.get(day) ?? new Map<string, Bucket>();
    dailyGroups.set(day, groups);
    for (const bucket of [
      this.bucket(rows, label),
      this.bucket(daily, day),
      this.bucket(groups, label),
    ])
      addCost(bucket.cost!, price, unknownReason, execution);
    addCost(total, price, unknownReason, execution);
  }
  private aggregate(
    rows: Map<string, Bucket>,
    record: UsageRecord,
    label: string,
  ): void {
    const row = this.bucket(rows, label);
    row.started++;
    if (record.phase === "started") row.inProgress++;
    else row[record.phase]++;
    if (record.tokens) {
      row.measuredTurns++;
      row.tokens ??= {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        total: 0,
      };
      for (const key of [
        "input",
        "output",
        "cacheRead",
        "cacheWrite",
        "reasoning",
        "total",
      ] as (keyof Consumption)[]) {
        const value =
          key === "total"
            ? (record.tokens.total ??
              (record.provider === "claude"
                ? record.tokens.input + record.tokens.output
                : null))
            : record.tokens[key];
        (row.tokens as Record<string, number | null>)[key] =
          value === null || value === undefined || row.tokens[key] === null
            ? null
            : (row.tokens[key] ?? 0) + value;
      }
    }
    const timing = record.timing;
    if (timing) {
      row.speed ??= {
        turns: 0,
        outputTokens: 0,
        generationMs: 0,
        ttftMs: 0,
        ttftTurns: 0,
      };
      if (timing.ttftMs !== null) {
        row.speed.ttftMs += timing.ttftMs;
        row.speed.ttftTurns++;
        const output = record.tokens?.output ?? 0;
        if (output > 0 && timing.activeMs > timing.ttftMs) {
          row.speed.turns++;
          row.speed.outputTokens += output;
          row.speed.generationMs += timing.activeMs - timing.ttftMs;
        }
      }
    }
    rows.set(label, row);
  }
  async clear(): Promise<void> {
    const db = this.open();
    if (!db) throw new Error("Statistics are unavailable.");
    const since = this.now();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DELETE FROM executions");
      db.prepare("INSERT OR REPLACE INTO metadata VALUES('since',?)").run(
        String(since),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    this.since = since;
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }
}
