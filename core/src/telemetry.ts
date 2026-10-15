/** Zero is allowed only for an explicitly observed behavior sum, never an unsupported measurement. */
export const behaviorSums = [
  "behavior.completed",
  "behavior.failed",
  "behavior.interrupted",
  "behavior.durationMs",
  "behavior.responses",
  "behavior.toolCalls",
  "behavior.toolResponses",
  "behavior.multiToolResponses",
  "behavior.streamTokens",
  "behavior.reasoningTokens",
  "behavior.reasoningOutput",
] as const;
export const behaviorMetrics = [
  ...behaviorSums,
  "behavior.terminalObserved",
  "behavior.durationObserved",
  "behavior.responsesObserved",
  "behavior.toolsObserved",
  "behavior.streamMs",
  "behavior.streamResponses",
  "behavior.reasoningObserved",
] as const;
export const telemetryDisclosureVersion = 2 as const;
/** Reviewed finite wire schema. Identifiers and arbitrary properties never cross this seam. */
export const telemetryMetrics = [
  ...behaviorMetrics,
  "turn.started",
  "turn.completed",
  "turn.failed",
  "turn.interrupted",
  "tokens.total",
  "tokens.input",
  "tokens.output",
  "tokens.cacheRead",
  "tokens.cacheWrite",
  "tokens.reasoning",
  "tokens.observed",
  "duration.lt10s",
  "duration.lt60s",
  "duration.lt5m",
  "duration.ge5m",
  "feature.attempted",
  "feature.succeeded",
  "feature.failed",
  "feature.cancelled",
  "feature.unavailable",
] as const;
export const telemetryFeatures = [
  "agent.create",
  "team.create",
  "delegation.native",
  "delegation.handoff",
  "review.start",
  "review.start.manual",
  "review.start.automatic",
  "review.finish",
  "review.switch.manual",
  "review.export",
  "review.discard",
  "git.branch",
  "git.update",
  "git.merge",
  "git.prune",
  "git.stash",
  "backlog.assign",
  "backlog.source.github",
  "backlog.source.linear",
  "mission.start",
  "mission.finish",
  "automation.run",
  "automation.finish",
  "artifact.open",
  "computer.use",
  "browser.open",
  "browser.responsive",
  "browser.capture",
  "simulator.execute",
  "dictation.start",
  "dictation.stop",
  "dictation.cancel",
  "palette.action",
] as const;
export const publicModels = [
  "gpt-5",
  "gpt-5.4",
  "gpt-5.6",
  "gpt-6",
  "gpt-6.1",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5",
  "custom",
  "unknown",
] as const;
export type TelemetryMetric = (typeof telemetryMetrics)[number];
export type TelemetryFeature = (typeof telemetryFeatures)[number];
export type FeatureOutcome =
  | "attempted"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unavailable";
/** Native/UI operations with an owning completion boundary; no arbitrary capture API. */
export const clientFeatures = [
  "simulator.execute",
  "browser.open",
  "browser.responsive",
  "browser.capture",
  "dictation.start",
  "dictation.stop",
  "dictation.cancel",
  "palette.action",
] as const;
export type ClientFeature = (typeof clientFeatures)[number];
export type PublicModel = (typeof publicModels)[number];
export type TelemetryRow = {
  day: string;
  metric: TelemetryMetric;
  value: number;
  provider?: "codex" | "claude" | "antigravity";
  model?: PublicModel;
  feature?: TelemetryFeature;
};
export type TelemetryReport = {
  schema: 1;
  reportId: string;
  family: "runtime" | "feature" | "behavior";
  version: string;
  channel: "stable" | "preview" | "development";
  platform: "macos" | "windows" | "linux";
  client: "desktop" | "web" | "mobile" | "daemon";
  rows: TelemetryRow[];
};
export const telemetryLimits = {
  bytes: 65536,
  rows: 128,
  count: 1_000_000_000,
  queueBytes: 1048576,
  days: 7,
} as const;
export type TelemetryChoice = { enabled: boolean; disclosure: 1 | 2 };
export type TelemetryPrivacy = {
  choice: TelemetryChoice | null;
  active: boolean;
  blocked: "disclosure" | "configuration" | "administrator" | "environment" | null;
  pending: TelemetryReport[];
};
export function publicModel(model: string | null | undefined): PublicModel {
  return publicModels.includes(model as PublicModel)
    ? (model as PublicModel)
    : model
      ? "custom"
      : "unknown";
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
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
export function isTelemetryChoice(value: unknown): value is TelemetryChoice {
  return (
    object(value) &&
    keys(value, ["enabled", "disclosure"]) &&
    typeof value.enabled === "boolean" &&
    [1, telemetryDisclosureVersion].includes(value.disclosure as number)
  );
}
export function isTelemetryReport(value: unknown): value is TelemetryReport {
  if (
    !object(value) ||
    !keys(value, [
      "schema",
      "reportId",
      "family",
      "version",
      "channel",
      "platform",
      "client",
      "rows",
    ])
  )
    return false;
  if (
    value.schema !== 1 ||
    typeof value.reportId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value.reportId,
    ) ||
    !["runtime", "feature", "behavior"].includes(String(value.family))
  )
    return false;
  if (
    typeof value.version !== "string" ||
    !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value.version) ||
    !["stable", "preview", "development"].includes(String(value.channel)) ||
    !["macos", "windows", "linux"].includes(String(value.platform)) ||
    !["desktop", "web", "mobile", "daemon"].includes(String(value.client))
  )
    return false;
  if (
    !Array.isArray(value.rows) ||
    !value.rows.length ||
    value.rows.length > telemetryLimits.rows ||
    JSON.stringify(value).length > telemetryLimits.bytes
  )
    return false;
  const seen = new Set<string>();
  return value.rows.every((row) => {
    if (
      !object(row) ||
      !keys(row, ["day", "metric", "value", "provider", "model", "feature"]) ||
      !isUtcDay(row.day) ||
      !telemetryMetrics.includes(row.metric as TelemetryMetric) ||
      !Number.isSafeInteger(row.value) ||
      (row.value as number) < 0 ||
      (row.value === 0 &&
        !behaviorSums.includes(row.metric as (typeof behaviorSums)[number])) ||
      (row.value as number) > telemetryLimits.count
    )
      return false;
    if (value.family === "feature") {
      if (
        !String(row.metric).startsWith("feature.") ||
        !telemetryFeatures.includes(row.feature as TelemetryFeature) ||
        row.provider !== undefined ||
        row.model !== undefined
      )
        return false;
    } else if (
      String(row.metric).startsWith("feature.") ||
      (value.family === "behavior") !==
        String(row.metric).startsWith("behavior.") ||
      !["codex", "claude", "antigravity"].includes(String(row.provider)) ||
      !publicModels.includes(row.model as PublicModel) ||
      row.feature !== undefined
    )
      return false;
    const key = JSON.stringify([
      row.day,
      row.metric,
      row.provider,
      row.model,
      row.feature,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
