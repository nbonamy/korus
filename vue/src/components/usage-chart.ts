import type { UsageSummary } from "@workspace/core/usage";
import type { AgentBackend } from "@workspace/core/contracts";
import { backendDisplayName } from "@workspace/core/backend-driver";
import { translate } from "../i18n";
export type UsageMeasure = "turns" | "total" | "input" | "output";
export type UsageGrouping = "provider" | "model";
export type UsageSeries = {
  key: string;
  label: string;
  color: string;
  value: number | null;
  turns: number;
  tokens: number | null;
};
export const chartFormat = (
  value: number | null | undefined,
  compact = false,
): string =>
  value == null
    ? translate("analytics.unknown")
    : new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 1,
        ...(compact ? { notation: "compact" as const } : {}),
      }).format(value);
export const chartValue = (
  row: { started: number; tokens: UsageSummary["rows"][number]["tokens"] },
  measure: UsageMeasure,
) => (measure === "turns" ? row.started : (row.tokens?.[measure] ?? null));
const slot = (n: number) => `var(--chart-${n})`;
const providerSlots: Record<string, number> = {
  codex: 1,
  claude: 2,
  antigravity: 3,
};
// Models take their provider's hue, shaded per model, so a model list reads
// as families; unrecognized models fall on the remaining slots.
const modelFamilies: Array<[RegExp, number]> = [
  [/claude|opus|sonnet|haiku/i, 2],
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
  const family = modelFamilies.find(([pattern]) => pattern.test(label))?.[1];
  return family
    ? shades[hash % shades.length]!(slot(family))
    : slot(4 + (hash % 5));
}
/** Rounds an axis maximum up to a clean tick step. */
export function niceScale(
  maximum: number,
  ticks = 4,
): { max: number; step: number } {
  const raw = Math.max(maximum, 1) / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 2.5, 5, 10].find((n) => raw <= n * magnitude) ?? 10;
  const step = Math.max(1, unit * magnitude);
  return { max: step * ticks, step };
}
export function chartSeries(
  summary: UsageSummary | undefined,
  measure: UsageMeasure,
  group: UsageGrouping,
): UsageSeries[] {
  return (summary?.rows ?? [])
    .map((row) => {
      return {
        key: row.label,
        label:
          row.label === "Unknown"
            ? translate("analytics.unknownModel")
            : group === "provider" &&
                ["claude", "codex", "antigravity"].includes(row.label)
              ? backendDisplayName(row.label as AgentBackend)
              : row.label,
        color: seriesColor(row.label, group),
        value: chartValue(row, measure),
        turns: row.started,
        tokens: row.tokens?.total ?? null,
      };
    })
    .sort(
      (a, b) =>
        (b.value ?? -1) - (a.value ?? -1) || a.label.localeCompare(b.label),
    );
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
const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);
export function activityWindow(now = Date.now()): { from: string; to: string } {
  const today = Date.parse(utcDay(now));
  const sinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  return {
    from: utcDay(today - (sinceMonday + (ACTIVITY_WEEKS - 1) * 7) * 86400000),
    to: utcDay(today),
  };
}
export const sumValues = (values: (number | null | undefined)[]) =>
  values.some((value) => value !== null && value !== undefined)
    ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
const measureKeys: Record<UsageMeasure, string> = {
  turns: "turns",
  total: "totalTokens",
  input: "inputTokens",
  output: "outputTokens",
};
export const measureLabel = (measure: UsageMeasure) =>
  translate("analytics." + measureKeys[measure]);
export const groupingOptions = () => [
  { value: "provider" as const, label: translate("analytics.provider") },
  { value: "model" as const, label: translate("analytics.model") },
];
export const seconds = (value: number) =>
  translate("analytics.seconds", { value: chartFormat(value) });
