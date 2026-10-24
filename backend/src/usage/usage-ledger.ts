import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isUtcDay, utcDay } from "@workspace/core/usage";
import {
  validConsumption,
  validExecutionTiming,
  type ExecutionObservation,
  type UsageRecord,
  type UsageFilter,
  type UsageSummary,
  type Consumption,
} from "@workspace/core/usage";
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
      [value.reasoningEffort, value.serviceTier].every(v => v == null || (typeof v === "string" && v.length > 0 && v.length <= 200)) &&
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
      "INSERT OR REPLACE INTO executions(provider,session_id,turn_id,agent_id,model,reasoning_effort,service_tier,team_id,repository,phase,started_at,updated_at,duration_ms,tokens,timing) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
      ...(previous ? { ...previous, model: event.model ?? previous.model } : {}),
      ...(event.phase !== "usage" ? { phase: event.phase, at: event.at } : {}),
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
        !["provider", "model", "teamId", "repository", "agentId"].includes(
          filter.group,
        )) ||
      (filter.from && !isUtcDay(filter.from)) ||
      (filter.to && !isUtcDay(filter.to)) ||
      (filter.from && filter.to && filter.from > filter.to)
    )
      throw new Error("Invalid usage filter.");
    const db = this.open(),
      rows = new Map<string, Bucket>(),
      daily = new Map<string, Bucket>(),
      dailyGroups = new Map<string, Map<string, Bucket>>();
    if (db) {
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
        const label = filter.group
          ? String(record[filter.group] ?? "Unknown")
          : "All";
        this.aggregate(rows, record, label);
        this.aggregate(daily, record, utcDay(record.startedAt));
        const day = utcDay(record.startedAt);
        const groups = dailyGroups.get(day) ?? new Map<string, Bucket>();
        this.aggregate(groups, record, label);
        dailyGroups.set(day, groups);
      }
    }
    return {
      recordedSince: this.since,
      retainedSince: Math.max(this.since, this.now() - retention),
      ...(this.available ? {} : { available: false }),
      rows: [...rows.values()],
      daily: [...daily].map(([day, row]) => ({
        day,
        started: row.started,
        tokens: row.tokens,
        measuredTurns: row.measuredTurns,
        ...(row.speed ? { speed: row.speed } : {}),
        groups: [...dailyGroups.get(day)!.values()].map(
          ({ label, started, tokens, measuredTurns, speed }) => ({
            label,
            started,
            tokens,
            measuredTurns,
            ...(speed ? { speed } : {}),
          }),
        ),
      })),
    };
  }
  private aggregate(
    rows: Map<string, Bucket>,
    record: UsageRecord,
    label: string,
  ): void {
    const row = rows.get(label) ?? {
      label,
      started: 0,
      completed: 0,
      failed: 0,
      interrupted: 0,
      inProgress: 0,
      measuredTurns: 0,
      tokens: null,
    };
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
