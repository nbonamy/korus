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
  reasoningEffort?: string | null;
  serviceTier?: string | null;
  tokens?: Consumption | null;
  /** Producer attestation that every billable request in this execution is represented. */
  requestCoverage?: "complete" | "partial" | null;
  /** Why the producer cannot establish a complete request set. */
  requestCoverageReason?: RequestCoverageReason | null;
  durationMs?: number;
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
  apiProvider?: ApiPricingProvider;
  group?:
    | "provider"
    | "apiProvider"
    | "model"
    | "teamId"
    | "repository"
    | "agentId";
};
/** Additive timing samples; divide summed output by summed generation time for a rate. */
export type UsageSpeed = {
  turns: number;
  outputTokens: number;
  generationMs: number;
  ttftMs: number;
  ttftTurns: number;
};
export type UsageSummary = {
  cost?: UsageCost;
  available?: boolean;
  daily?: {
    day: string;
    started: number;
    tokens: Consumption | null;
    measuredTurns: number;
    speed?: UsageSpeed;
    cost?: UsageCost;
    /** Same grouping as rows, retaining each day's observed contributions. */
    groups?: {
      label: string;
      started: number;
      tokens: Consumption | null;
      measuredTurns: number;
      speed?: UsageSpeed;
      cost?: UsageCost;
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
    speed?: UsageSpeed;
    cost?: UsageCost;
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

export function utcDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}
export function isUtcDay(day: unknown): day is string {
  return (
    typeof day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day
  );
}

/** Exact API identity; model aliases must be resolved explicitly by the producer. */
export type ApiPricingProvider = "openai" | "anthropic" | "google";
/** A replaceable numeric sample for one independently billable request, including retries/subagents.
 * at is the immutable request timestamp. revision increases for corrections, including after final.
 * A final sample cannot be downgraded to provisional. Unknown evidence is null, never zero.
 */
export type RequestObservation = {
  provider: AgentBackend;
  agentId: string;
  sessionId: string;
  turnId: string;
  requestId: string;
  at: number;
  revision: number;
  status: "provisional" | "final";
  apiProvider: ApiPricingProvider | null;
  model: string | null;
  /** All measured tokens must belong to this billing modality; mixed/unknown usage is unpriced. */
  modality: "text" | null;
  cacheMode: "implicit" | "explicit" | null;
  tokens: {
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    /** Empty means proven no writes. Keys are billable lifetimes, or "default" for a scalar write rate. */
    cacheWrite: Record<string, number> | null;
    reasoning: number | null;
    inputIncludesCacheRead: boolean | null;
    inputIncludesCacheWrite: boolean | null;
    outputIncludesReasoning: boolean | null;
  };
  /** context is the provider's request pricing measure, including cached input when applicable. */
  pricingContext: { context: number | null; region: string | null };
  requestedServiceTier: string | null;
  reportedServiceTier: string | null;
  /** Use only an unambiguous documented billing default, never the requested tier. */
  defaultServiceTier?: { tier: string; source: string };
  reportedMode: string | null;
};
export type RequestCoverageReason =
  | "public-runtime-request-evidence-unavailable"
  | "missing-sdk-request-evidence"
  | "incompatible-sdk-request-evidence";
export function validRequestCoverageReason(
  value: unknown,
): value is RequestCoverageReason {
  return [
    "public-runtime-request-evidence-unavailable",
    "missing-sdk-request-evidence",
    "incompatible-sdk-request-evidence",
  ].includes(value as string);
}
export type UsageCostReason =
  | RequestCoverageReason
  | "unknown-request-coverage"
  | "provisional-usage"
  | "before-pricing-history"
  | "unknown-provider"
  | "unknown-model"
  | "unpriced-model"
  | "unsupported-token-modality"
  | "missing-token-usage"
  | "missing-cache-usage"
  | "missing-token-semantics"
  | "inconsistent-token-usage"
  | "missing-pricing-context"
  | "missing-service-tier"
  | "unsupported-service-tier"
  | "unsupported-mode"
  | "missing-cache-rate"
  | "missing-token-rate";
/** Only sufficiently evidenced requests contribute USD. requests counts observed identities;
 * unknownRequestExecutions explicitly represents unknown additional request counts.
 */
export type UsageCost = {
  usd: number | null;
  coverage: "complete" | "partial" | "unavailable";
  requests: number;
  pricedRequests: number;
  unpricedRequests: number;
  unknownRequestExecutions: number;
  reasons: { reason: UsageCostReason; count: number }[];
};

export function validRequestObservation(
  value: unknown,
): value is RequestObservation {
  const object = (v: unknown, keys: string[]): v is Record<string, unknown> =>
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).every((k) => keys.includes(k));
  const count = (v: unknown) =>
    v === null ||
    (Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 1e9);
  const text = (v: unknown) =>
    typeof v === "string" && v.length > 0 && v.length <= 2048;
  const nullableText = (v: unknown) => v === null || text(v);
  const nullableBool = (v: unknown) => v === null || typeof v === "boolean";
  if (
    !object(value, [
      "provider",
      "agentId",
      "sessionId",
      "turnId",
      "requestId",
      "at",
      "revision",
      "status",
      "apiProvider",
      "model",
      "modality",
      "cacheMode",
      "tokens",
      "pricingContext",
      "requestedServiceTier",
      "reportedServiceTier",
      "defaultServiceTier",
      "reportedMode",
    ])
  )
    return false;
  const v = value;
  const tokens = v.tokens;
  const context = v.pricingContext;
  return (
    ["codex", "claude", "antigravity"].includes(v.provider as string) &&
    [v.agentId, v.sessionId, v.turnId, v.requestId].every(text) &&
    Number.isSafeInteger(v.at) &&
    (v.at as number) >= 0 &&
    (v.at as number) <= 8640000000000000 &&
    Number.isSafeInteger(v.revision) &&
    (v.revision as number) >= 0 &&
    ["provisional", "final"].includes(v.status as string) &&
    (v.apiProvider === null ||
      ["openai", "anthropic", "google"].includes(v.apiProvider as string)) &&
    nullableText(v.model) &&
    (v.modality === null || v.modality === "text") &&
    (v.cacheMode === null ||
      v.cacheMode === "implicit" ||
      v.cacheMode === "explicit") &&
    [v.requestedServiceTier, v.reportedServiceTier, v.reportedMode].every(
      nullableText,
    ) &&
    (v.defaultServiceTier === undefined ||
      (object(v.defaultServiceTier, ["tier", "source"]) &&
        text(v.defaultServiceTier.tier) &&
        text(v.defaultServiceTier.source))) &&
    object(context, ["context", "region"]) &&
    count(context.context) &&
    nullableText(context.region) &&
    object(tokens, [
      "input",
      "output",
      "cacheRead",
      "cacheWrite",
      "reasoning",
      "inputIncludesCacheRead",
      "inputIncludesCacheWrite",
      "outputIncludesReasoning",
    ]) &&
    [tokens.input, tokens.output, tokens.cacheRead, tokens.reasoning].every(
      count,
    ) &&
    [
      tokens.inputIncludesCacheRead,
      tokens.inputIncludesCacheWrite,
      tokens.outputIncludesReasoning,
    ].every(nullableBool) &&
    (tokens.cacheWrite === null ||
      (typeof tokens.cacheWrite === "object" &&
        !Array.isArray(tokens.cacheWrite) &&
        tokens.cacheWrite !== null &&
        Object.entries(tokens.cacheWrite).length <= 32 &&
        Object.entries(tokens.cacheWrite).every(
          ([k, n]) => text(k) && n !== null && count(n),
        )))
  );
}
