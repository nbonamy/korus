import { seriesColor } from "@workspace/core/analytics-palette";
import { niceChartScale as niceScale } from "@workspace/core/analytics-chart";
export { niceScale };
import { dayOf } from "@workspace/core/usage-time";
import {
  missionsRepositoryKey,
  type UsageCost,
  type UsageSummary,
} from "@workspace/core/usage";
import type { AgentBackend } from "@workspace/core/contracts";
import { backendDisplayName } from "@workspace/core/backend-driver";
import { translate } from "../i18n";
export type UsageMeasure =
  | "turns"
  | "total"
  | "input"
  | "output"
  | "ratio"
  | "cost";
export type UsageGrouping = "provider" | "model" | "repository";
export type UsageSeries = {
  key: string;
  label: string;
  color: string;
  value: number | null;
  turns: number;
  tokens: number | null;
  cost?: UsageCost;
};
/** Rank the displayed measurement, keeping unavailable values last and ties stable by label. */
export function sortUsageValues<T extends { label: string }>(
  rows: readonly T[],
  value: (row: T) => number | null | undefined,
): T[] {
  return [...rows].sort(
    (a, b) =>
      (value(b) ?? -Infinity) - (value(a) ?? -Infinity) ||
      a.label.localeCompare(b.label),
  );
}
export const chartFormat = (
  value: number | null | undefined,
  compact = false,
): string =>
  value == null
    ? translate("analytics.notAvailable")
    : new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 1,
        ...(compact ? { notation: "compact" as const } : {}),
      }).format(value);
/** Display USD consistently to the nearest cent. */
export function usdFormat(value: number | null | undefined): string {
  if (value == null) return translate("analytics.costUnavailable");
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
/** Headline and axis figures: whole dollars once cents stop mattering, exact below $10 where they still do. */
export function usdCompactFormat(value: number | null | undefined): string {
  if (value == null || Math.abs(value) < 10) return usdFormat(value);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  }).format(value);
}
export function usageFormat(
  tokens: number | null | undefined,
  usd: number | null | undefined,
): string {
  return `${chartFormat(tokens, true)} / ${usdFormat(usd)}`;
}
export const measureFormat = (
  value: number | null | undefined,
  measure: UsageMeasure,
  compact = true,
) => {
  if (measure === "cost")
    return compact ? usdCompactFormat(value) : usdFormat(value);
  if (measure === "ratio")
    return value == null
      ? translate("analytics.notAvailable")
      : chartFormat(value) + "%";
  return chartFormat(value, compact);
};
/** Input's percentage of measured total tokens; an empty denominator is unknown. */
export const inputRatio = (
  tokens: { input: number; total?: number | null } | null | undefined,
) =>
  tokens?.total != null && tokens.total > 0
    ? (100 * tokens.input) / tokens.total
    : null;
export const chartValue = (
  row: {
    started: number;
    reportsTokens?: boolean;
    tokens: UsageSummary["rows"][number]["tokens"];
    cost?: UsageCost;
    speed?: Speed;
  },
  measure: UsageMeasure | "speed",
) =>
  row.reportsTokens === false && measure !== "turns" && measure !== "cost"
    ? null
    : measure === "speed"
    ? tokensPerSecond(row.speed)
    : measure === "cost"
      ? (row.cost?.usd ?? null)
      : measure === "ratio"
        ? inputRatio(row.tokens)
        : measure === "turns"
          ? row.started
          : measure === "total"
            ? (row.tokens?.total ?? 0)
            : (row.tokens?.[measure] ?? null);
export { providerColorForModel } from "@workspace/core/analytics-palette";
/** A repository's folder name; when two share one, the folder above tells them apart. */
function repositoryLabels(paths: string[]): Map<string, string> {
  const parts = (value: string) => value.split(/[\\/]/u).filter(Boolean);
  const names = new Map<string, number>();
  for (const value of paths)
    names.set(
      parts(value).at(-1) ?? value,
      (names.get(parts(value).at(-1) ?? value) ?? 0) + 1,
    );
  return new Map(
    paths.map((value) => {
      const segments = parts(value);
      const name = segments.at(-1) ?? value;
      return [
        value,
        (names.get(name) ?? 0) > 1 && segments.length > 1
          ? segments.slice(-2).join("/")
          : name,
      ];
    }),
  );
}
export const usageRowKey = (row: { key?: string; label: string }): string =>
  row.key ?? row.label;
export function modelUsageLabel(
  row: Pick<UsageSummary["rows"][number], "label" | "modelVariant">,
): string {
  if (!row.modelVariant)
    return row.label === "Unknown"
      ? translate("analytics.unknownModel")
      : row.label;
  const { model, serviceTier } = row.modelVariant;
  const name = model ?? translate("analytics.unknownModel");
  if (serviceTier === null || serviceTier === "standard") return name;
  const tiers: Record<string, string> = {
    fast: translate("analytics.fastTier"),
    ultrafast: translate("analytics.ultrafastTier"),
    flex: translate("analytics.flexTier"),
  };
  return `${name} · ${tiers[serviceTier] ?? serviceTier}`;
}
export function chartSeries(
  summary: UsageSummary | undefined,
  measure: UsageMeasure | "speed",
  group: UsageGrouping,
): UsageSeries[] {
  const repositoryNames =
    group === "repository"
      ? repositoryLabels((summary?.rows ?? []).map((row) => row.label))
      : undefined;
  return sortUsageValues(
    (summary?.rows ?? []).filter(row => measure === "turns" || measure === "cost" || row.reportsTokens !== false).map((row) => {
      return {
        key: usageRowKey(row),
        label:
          group === "model"
            ? modelUsageLabel(row)
            : row.label === "Unknown"
              ? translate(
                  group === "repository"
                    ? "analytics.unknownRepository"
                    : "analytics.unknownModel",
                )
              : repositoryNames
                ? row.label === missionsRepositoryKey
                  ? translate("analytics.missions")
                  : repositoryNames.get(row.label)!
                : group === "provider" &&
                    ["claude", "codex", "antigravity", "cursor"].includes(row.label)
                  ? backendDisplayName(row.label as AgentBackend)
                  : row.label,
        color: seriesColor(
          row.label === "Unknown" ? row.label : usageRowKey(row),
          group,
        ),
        value: chartValue(row, measure),
        turns: row.started,
        tokens: row.tokens?.total ?? 0,
        ...(row.cost ? { cost: row.cost } : {}),
      };
    }),
    (row) => row.value,
  );
}
type Speed = NonNullable<UsageSummary["rows"][number]["speed"]>;
/** Provider-reported output tokens per second of working time after the first token. */
export const tokensPerSecond = (speed: Speed | undefined): number | null =>
  speed?.generationMs ? speed.outputTokens / (speed.generationMs / 1000) : null;
export const averageTtftSeconds = (speed: Speed | undefined): number | null =>
  speed?.ttftTurns ? speed.ttftMs / speed.ttftTurns / 1000 : null;
export const sumSpeed = (speeds: (Speed | undefined)[]): Speed | undefined =>
  speeds.reduce<Speed | undefined>(
    (all, speed) =>
      speed
        ? {
            turns: (all?.turns ?? 0) + speed.turns,
            outputTokens: (all?.outputTokens ?? 0) + speed.outputTokens,
            generationMs: (all?.generationMs ?? 0) + speed.generationMs,
            ttftMs: (all?.ttftMs ?? 0) + speed.ttftMs,
            ttftTurns: (all?.ttftTurns ?? 0) + speed.ttftTurns,
          }
        : all,
    undefined,
  );
/** The activity grid spans whole Monday-first weeks ending with the current one. */
export const ACTIVITY_WEEKS = 53;
/** The reader's own timezone: days on the Analytics screen start and end on their clock. */
export const browserTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
/** The calendar day (YYYY-MM-DD) an instant falls on for the reader. */
export const localDay = (at = Date.now(), timeZone = browserTimeZone()) =>
  dayOf(at, timeZone);
/** Calendar arithmetic on day labels; days are labels here, so clock changes cannot skew it. */
export const shiftDay = (day: string, days: number) =>
  new Date(Date.parse(day) + days * 86400000).toISOString().slice(0, 10);
export function activityWindow(
  now = Date.now(),
  timeZone = browserTimeZone(),
): { from: string; to: string } {
  const todayLabel = localDay(now, timeZone);
  const today = Date.parse(todayLabel);
  const sinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  return {
    from: shiftDay(todayLabel, -(sinceMonday + (ACTIVITY_WEEKS - 1) * 7)),
    to: todayLabel,
  };
}
export const sumValues = (values: (number | null | undefined)[]) =>
  values.some((value) => value !== null && value !== undefined)
    ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
const measureKeys: Record<UsageMeasure, string> = {
  cost: "cost",
  turns: "turns",
  total: "totalTokens",
  input: "inputTokens",
  output: "outputTokens",
  ratio: "inputRatio",
};
export const measureLabel = (measure: UsageMeasure) =>
  translate("analytics." + measureKeys[measure]);
export const groupingOptions = () => [
  { value: "provider" as const, label: translate("analytics.provider") },
  { value: "model" as const, label: translate("analytics.model") },
  { value: "repository" as const, label: translate("analytics.repository") },
];
export const seconds = (value: number) =>
  translate("analytics.seconds", { value: chartFormat(value) });

/** Compact elapsed time such as "45s", "4m 12s" or "1h 5m". */
export function durationFormat(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
