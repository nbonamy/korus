import { dayOf } from "@workspace/core/usage-time";
import { missionsRepositoryKey, type UsageCost, type UsageSummary } from "@workspace/core/usage";
import type { AgentBackend } from "@workspace/core/contracts";
import { backendDisplayName } from "@workspace/core/backend-driver";
import { translate } from "../i18n";
export type UsageMeasure = "turns" | "total" | "input" | "output" | "ratio" | "cost";
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
export function sortUsageValues<T extends { label: string }>(rows: readonly T[], value: (row: T) => number | null | undefined): T[] {
  return [...rows].sort((a, b) =>
    (value(b) ?? -Infinity) - (value(a) ?? -Infinity) || a.label.localeCompare(b.label),
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
export function usageFormat(tokens: number | null | undefined, usd: number | null | undefined): string {
  return `${chartFormat(tokens, true)} / ${usdFormat(usd)}`;
}
export const measureFormat = (
  value: number | null | undefined,
  measure: UsageMeasure,
  compact = true,
) => {
  if (measure === "cost") return compact ? usdCompactFormat(value) : usdFormat(value);
  if (measure === "ratio")
    return value == null ? translate("analytics.notAvailable") : chartFormat(value) + "%";
  return chartFormat(value, compact);
};
/** Input's percentage of measured total tokens; an empty denominator is unknown. */
export const inputRatio = (tokens: { input: number; total?: number | null } | null | undefined) =>
  tokens?.total != null && tokens.total > 0 ? (100 * tokens.input) / tokens.total : null;
export const chartValue = (
  row: {
    started: number;
    tokens: UsageSummary["rows"][number]["tokens"];
    cost?: UsageCost;
    speed?: Speed;
  },
  measure: UsageMeasure | "speed",
) =>
  measure === "speed"
    ? tokensPerSecond(row.speed)
    : measure === "cost"
    ? (row.cost?.usd ?? null)
    : measure === "ratio"
      ? inputRatio(row.tokens)
    : measure === "turns"
      ? row.started
      : (row.tokens?.[measure] ?? null);
const slot = (n: number) => `var(--chart-${n})`;
const providerSlots: Record<string, number> = {
  codex: 1,
  claude: 2,
  antigravity: 3,
};
// Models take their provider's hue, shaded per model, so a model list reads
// as families; unrecognized models fall on the remaining slots.
const modelFamilies: Array<[RegExp, number]> = [
  [/claude|opus|sonnet|haiku|fable/i, 2],
  [/gpt|codex|^o\d/i, 1],
  [/gemini|antigravity/i, 3],
];
const shades = [
  (c: string) => c,
  (c: string) => `color-mix(in oklab, ${c} 68%, white)`,
  (c: string) => `color-mix(in oklab, ${c} 46%, white)`,
];
const hashOf = (label: string) =>
  [...label].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
function seriesColor(label: string, group: UsageGrouping): string {
  if (label === "Unknown") return "var(--color-text-muted)";
  if (group === "provider") return slot(providerSlots[label] ?? 4);
  const hash = hashOf(label);
  // Repositories stay off the provider hues (1-3) so a colour never suggests a provider.
  if (group === "repository") return shades[(hash >>> 3) % shades.length]!(slot(4 + (hash % 5)));
  const family = modelFamilies.find(([pattern]) => pattern.test(label))?.[1];
  return family
    ? shades[hash % shades.length]!(slot(family))
    : slot(4 + (hash % 5));
}
/** Returns the shared provider hue for a known model family. */
export function providerColorForModel(label: string): string {
  if (label === "Unknown") return "var(--color-text-muted)";
  const family = modelFamilies.find(([pattern]) => pattern.test(label))?.[1];
  return family ? slot(family) : "var(--chart-4)";
}
/** Rounds an axis maximum up to a clean tick step. */
export function niceScale(
  maximum: number,
  ticks = 4,
  fractional = false,
): { max: number; step: number } {
  const raw = Math.max(maximum, fractional ? Number.MIN_VALUE : 1) / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 2.5, 5, 10].find((n) => raw <= n * magnitude) ?? 10;
  const step = fractional ? unit * magnitude : Math.max(1, unit * magnitude);
  return { max: step * ticks, step };
}
/** A repository's folder name; when two share one, the folder above tells them apart. */
function repositoryLabels(paths: string[]): Map<string, string> {
  const parts = (value: string) => value.split(/[\\/]/u).filter(Boolean);
  const names = new Map<string, number>();
  for (const value of paths) names.set(parts(value).at(-1) ?? value, (names.get(parts(value).at(-1) ?? value) ?? 0) + 1);
  return new Map(paths.map((value) => {
    const segments = parts(value);
    const name = segments.at(-1) ?? value;
    return [value, (names.get(name) ?? 0) > 1 && segments.length > 1 ? segments.slice(-2).join("/") : name];
  }));
}
export function chartSeries(
  summary: UsageSummary | undefined,
  measure: UsageMeasure | "speed",
  group: UsageGrouping,
): UsageSeries[] {
  const repositoryNames = group === "repository" ? repositoryLabels((summary?.rows ?? []).map((row) => row.label)) : undefined;
  return sortUsageValues((summary?.rows ?? [])
    .map((row) => {
      return {
        key: row.label,
        label:
          row.label === "Unknown"
            ? translate(group === "repository" ? "analytics.unknownRepository" : "analytics.unknownModel")
            : repositoryNames
              ? row.label === missionsRepositoryKey ? translate("analytics.missions") : repositoryNames.get(row.label)!
              : group === "provider" &&
                ["claude", "codex", "antigravity"].includes(row.label)
              ? backendDisplayName(row.label as AgentBackend)
              : row.label,
        color: seriesColor(row.label, group),
        value: chartValue(row, measure),
        turns: row.started,
        tokens: row.tokens?.total ?? null,
        ...(row.cost ? { cost: row.cost } : {}),
      };
    }), row => row.value);
}
/** Monotone cubic path through the points: smooth, never overshooting the data. */
export function smoothPath(
  points: { x: number; y: number }[],
  move = true,
): string {
  const n = points.length;
  if (!n) return "";
  const f = (v: number) => Math.round(v * 100) / 100;
  let path = `${move ? "M" : "L"}${f(points[0]!.x)} ${f(points[0]!.y)}`;
  if (n === 1) return path;
  const dx = points.slice(1).map((p, i) => p.x - points[i]!.x);
  const slope = points.slice(1).map((p, i) => (p.y - points[i]!.y) / dx[i]!);
  const tangent = points.map((_, i) => {
    if (i === 0) return slope[0]!;
    if (i === n - 1) return slope[n - 2]!;
    if (slope[i - 1]! * slope[i]! <= 0) return 0;
    const w1 = 2 * dx[i]! + dx[i - 1]!,
      w2 = dx[i]! + 2 * dx[i - 1]!;
    return (w1 + w2) / (w1 / slope[i - 1]! + w2 / slope[i]!);
  });
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]!,
      b = points[i + 1]!,
      third = dx[i]! / 3;
    path += `C${f(a.x + third)} ${f(a.y + tangent[i]! * third)} ${f(b.x - third)} ${f(b.y - tangent[i + 1]! * third)} ${f(b.x)} ${f(b.y)}`;
  }
  return path;
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
export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
/** The calendar day (YYYY-MM-DD) an instant falls on for the reader. */
export const localDay = (at = Date.now(), timeZone = browserTimeZone()) => dayOf(at, timeZone);
/** Calendar arithmetic on day labels; days are labels here, so clock changes cannot skew it. */
export const shiftDay = (day: string, days: number) => new Date(Date.parse(day) + days * 86400000).toISOString().slice(0, 10);
export function activityWindow(now = Date.now(), timeZone = browserTimeZone()): { from: string; to: string } {
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
