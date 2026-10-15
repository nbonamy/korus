import { isUtcDay, utcDay } from "@workspace/core/telemetry";
import {
  validConsumption,
  validExecutionBehavior,
  type ExecutionObservation,
  type UsageRecord,
  type UsageFilter,
  type UsageSummary,
  type Consumption,
} from "@workspace/core/usage";
import { JsonStore } from "./json-store";
const retention = 90 * 86400000;
export class UsageLedger {
  private records: UsageRecord[] = [];
  private since: number;
  private readonly store: JsonStore<{ since: number; records: UsageRecord[] }>;
  constructor(
    file: string,
    private readonly now: () => number = Date.now,
  ) {
    this.store = new JsonStore(file);
    this.since = now();
  }
  async load(): Promise<void> {
    const data = (await this.store.read()) as {
      since?: number;
      records?: UsageRecord[];
    } | null;
    if (data && Number.isFinite(data.since) && Array.isArray(data.records)) {
      this.since = data.since!;
      this.records = data.records
        .filter(
          (r) =>
            r &&
            typeof r.sessionId === "string" &&
            typeof r.turnId === "string" &&
            Number.isFinite(r.startedAt) &&
            r.startedAt >= this.now() - retention &&
            (!r.tokens || validConsumption(r.tokens)) &&
            (!r.behavior || validExecutionBehavior(r.behavior)),
        )
        .slice(-10000);
    }
  }
  async observe(
    observation: ExecutionObservation,
    attribution: { teamId: string | null; repository: string | null },
  ): Promise<boolean> {
    if (
      !Number.isFinite(observation.at) ||
      observation.at < this.now() - retention ||
      observation.at > this.now() + 60000 ||
      (observation.tokens && !validConsumption(observation.tokens)) ||
      (observation.behavior && !validExecutionBehavior(observation.behavior))
    )
      return false;
    this.records = this.records.filter(
      (r) => r.startedAt >= this.now() - retention,
    );
    const existing = this.records.find(
      (r) =>
        r.provider === observation.provider &&
        r.sessionId === observation.sessionId &&
        r.turnId === observation.turnId,
    );
    if (!existing) {
      if (observation.phase !== "started") return false;
      this.records.push({
        ...observation,
        phase: "started",
        startedAt: observation.at,
        ...attribution,
      });
    } else {
      if (
        observation.phase === "started" ||
        (observation.phase !== "usage" && existing.phase !== "started")
      )
        return false;
      Object.assign(existing, {
        ...(observation.phase !== "usage"
          ? { phase: observation.phase, at: observation.at }
          : {}),
        model: observation.model,
        ...(observation.behavior !== undefined
          ? { behavior: observation.behavior }
          : {}),
        ...(observation.tokens !== undefined
          ? { tokens: observation.tokens }
          : {}),
        ...(observation.durationMs !== undefined
          ? { durationMs: observation.durationMs }
          : {}),
      });
    }
    this.records = this.records.slice(-10000);
    await this.store.save({ since: this.since, records: this.records });
    return true;
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
        ))
    )
      throw new Error("Invalid usage filter.");
    if (
      (filter.from && !isUtcDay(filter.from)) ||
      (filter.to && !isUtcDay(filter.to))
    )
      throw new Error("Invalid date range.");
    const rows = new Map<string, UsageSummary["rows"][number]>();
    for (const r of this.records) {
      const day = utcDay(r.startedAt);
      if (
        (filter.from && day < filter.from) ||
        (filter.to && day > filter.to) ||
        ["provider", "model", "teamId", "repository", "agentId"].some(
          (k) =>
            filter[k as keyof UsageFilter] &&
            filter[k as keyof UsageFilter] !== r[k as keyof UsageRecord],
        )
      )
        continue;
      const label = String(
        filter.group ? (r[filter.group] ?? "Unknown") : "All",
      );
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
      if (r.phase === "started") row.inProgress++;
      else row[r.phase]++;
      if (r.tokens) {
        row.measuredTurns++;
        row.tokens ??= {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
          total: 0,
        };
        for (const k of [
          "input",
          "output",
          "cacheRead",
          "cacheWrite",
          "reasoning",
          "total",
        ] as (keyof Consumption)[]) {
          const value =
            k === "total"
              ? (r.tokens.total ??
                (r.provider === "claude"
                  ? r.tokens.input + r.tokens.output
                  : null))
              : r.tokens[k];
          if (value === null || value === undefined || row.tokens[k] === null)
            (row.tokens as Record<string, number | null>)[k] = null;
          else
            (row.tokens as Record<string, number | null>)[k] =
              (row.tokens[k] ?? 0) + value;
        }
      }
      rows.set(label, row);
    }
    return {
      recordedSince: this.since,
      retainedSince: Math.max(this.since, this.now() - retention),
      rows: [...rows.values()],
    };
  }
  async close(): Promise<void> {
    await this.store.close();
  }
}
