import type { AgentBackend } from "./contracts";
/** Live numeric observation only; no historical snapshots or inherited fork history. */
export type ExecutionObservation = {
  agentId: string;
  sessionId: string;
  turnId: string;
  provider: AgentBackend;
  phase: "started" | "completed" | "failed" | "interrupted" | "usage";
  at: number;
  model: string | null;
  tokens?: Consumption | null;
  durationMs?: number;
  behavior?: ExecutionBehavior | null;
  /** Measured by the backend, never by a driver. */
  timing?: ExecutionTiming | null;
};
/** Time a turn really spent working: wall time minus waits for the user, split at the first generated output. */
export type ExecutionTiming = { activeMs: number; ttftMs: number | null };
export function validExecutionTiming(value: unknown): value is ExecutionTiming {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).every((k) => ["activeMs", "ttftMs"].includes(k)) &&
    Number.isSafeInteger(v.activeMs) &&
    (v.activeMs as number) > 0 &&
    (v.activeMs as number) <= 1e9 &&
    (v.ttftMs === null ||
      (Number.isSafeInteger(v.ttftMs) &&
        (v.ttftMs as number) >= 0 &&
        (v.ttftMs as number) <= (v.activeMs as number)))
  );
}
/** Input includes cache reads. Claude also includes cache creation; Codex cache-write inclusion is unspecified. Reasoning is a subset of output. Never add cache categories to input. */
export type Consumption = {
  total?: number | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number | null;
  reasoning?: number | null;
};
export type UsageRecord = Omit<ExecutionObservation, "phase"> & {
  phase: Exclude<ExecutionObservation["phase"], "usage">;
  startedAt: number;
  teamId: string | null;
  repository: string | null;
};
export type UsageFilter = {
  from?: string;
  to?: string;
  provider?: AgentBackend;
  model?: string;
  teamId?: string;
  repository?: string;
  agentId?: string;
  group?: "provider" | "model" | "teamId" | "repository" | "agentId";
};
export type UsageSummary = {
  available?: boolean;
  daily?: {
    day: string;
    started: number;
    tokens: Consumption | null;
    measuredTurns: number;
    /** Same grouping as rows, retaining each day's observed contributions. */
    groups?: {
      label: string;
      started: number;
      tokens: Consumption | null;
      measuredTurns: number;
    }[];
  }[];
  recordedSince: number;
  retainedSince: number;
  rows: {
    label: string;
    started: number;
    completed: number;
    failed: number;
    interrupted: number;
    inProgress: number;
    measuredTurns: number;
    tokens: Consumption | null;
    /** Turns with provider-reported output tokens and measured timing. */
    speed?: {
      turns: number;
      outputTokens: number;
      generationMs: number;
      ttftMs: number;
      ttftTurns: number;
    };
  }[];
};
export function validConsumption(value: unknown): value is Consumption {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) =>
      [
        "total",
        "input",
        "output",
        "cacheRead",
        "cacheWrite",
        "reasoning",
      ].includes(key),
    ) &&
    ["input", "output", "cacheRead"].every(
      (key) =>
        Number.isSafeInteger(record[key]) &&
        (record[key] as number) >= 0 &&
        (record[key] as number) <= 1e9,
    ) &&
    (record.cacheRead as number) <= (record.input as number) &&
    (record.total === undefined ||
      record.total === null ||
      (Number.isSafeInteger(record.total) &&
        (record.total as number) >= 0 &&
        (record.total as number) <= 1e9)) &&
    (record.cacheWrite === null ||
      (Number.isSafeInteger(record.cacheWrite) &&
        (record.cacheWrite as number) >= 0 &&
        (record.cacheWrite as number) <= 1e9)) &&
    (record.reasoning === undefined ||
      record.reasoning === null ||
      (Number.isSafeInteger(record.reasoning) &&
        (record.reasoning as number) >= 0 &&
        (record.reasoning as number) <= (record.output as number)))
  );
}

/** Provider account-wide history, never per-agent usage and never product telemetry. Large counters stay decimal strings. */
export type AccountUsage = {
  summary: {
    lifetimeTokens: string | null;
    peakDailyTokens: string | null;
    longestRunningTurnSec: string | null;
    currentStreakDays: string | null;
    longestStreakDays: string | null;
  };
  dailyUsageBuckets: readonly { startDate: string; tokens: string }[] | null;
};

/** Numeric live metadata only. Counts describe observed main-loop responses/tools, not hidden provider work. */
export type ExecutionBehavior = {
  model: string | null;
  responses: number | null;
  toolCalls: number | null;
  toolResponses: number | null;
  multiToolResponses: number | null;
  stream: {
    outputTokens: number;
    durationMs: number;
    responses: number;
  } | null;
};
export function validExecutionBehavior(
  value: unknown,
): value is ExecutionBehavior {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const count = (n: unknown) =>
    Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= 1e9;
  if (
    Object.keys(v).some(
      (k) =>
        ![
          "model",
          "responses",
          "toolCalls",
          "toolResponses",
          "multiToolResponses",
          "stream",
        ].includes(k),
    ) ||
    !(
      v.model === null ||
      (typeof v.model === "string" && v.model.length <= 200)
    )
  )
    return false;
  if (
    ![v.responses, v.toolCalls, v.toolResponses, v.multiToolResponses].every(
      (n) => n === null || count(n),
    )
  )
    return false;
  if (
    v.toolResponses !== null &&
    (v.responses === null ||
      (v.toolResponses as number) > (v.responses as number))
  )
    return false;
  if (
    v.multiToolResponses !== null &&
    (v.toolResponses === null ||
      (v.multiToolResponses as number) > (v.toolResponses as number))
  )
    return false;
  if (v.stream === null) return true;
  if (!v.stream || typeof v.stream !== "object" || Array.isArray(v.stream))
    return false;
  const stream = v.stream as Record<string, unknown>;
  return (
    Object.keys(stream).every((k) =>
      ["outputTokens", "durationMs", "responses"].includes(k),
    ) &&
    count(stream.outputTokens) &&
    count(stream.durationMs) &&
    (stream.durationMs as number) > 0 &&
    count(stream.responses) &&
    (stream.responses as number) > 0 &&
    v.responses !== null &&
    (stream.responses as number) <= (v.responses as number)
  );
}
