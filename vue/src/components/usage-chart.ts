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
    ? translate("telemetry.unknown")
    : new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 1,
        ...(compact ? { notation: "compact" as const } : {}),
      }).format(value);
export const chartValue = (
  row: { started: number; tokens: UsageSummary["rows"][number]["tokens"] },
  measure: UsageMeasure,
) => (measure === "turns" ? row.started : (row.tokens?.[measure] ?? null));
const palette = [
  "var(--color-primary)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-secondary)",
  "var(--color-error)",
  "var(--color-text-muted)",
];
export function chartSeries(
  summary: UsageSummary | undefined,
  measure: UsageMeasure,
  group: UsageGrouping,
): UsageSeries[] {
  return (summary?.rows ?? [])
    .map((row) => {
      const hash = [...row.label].reduce(
        (n, c) => (n * 31 + c.charCodeAt(0)) >>> 0,
        0,
      );
      const index =
        group === "provider"
          ? ["claude", "codex", "antigravity"].indexOf(row.label)
          : hash % palette.length;
      return {
        key: row.label,
        label:
          row.label === "Unknown"
            ? translate("analytics.unknownModel")
            : group === "provider" &&
                ["claude", "codex", "antigravity"].includes(row.label)
              ? backendDisplayName(row.label as AgentBackend)
              : row.label,
        color:
          row.label === "Unknown"
            ? "var(--color-text-muted)"
            : palette[Math.max(0, index)]!,
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
