import { computed } from "vue";
import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";
import { seriesColor } from "@workspace/core/analytics-palette";
import { modelLabel } from "./model-label";
import { addAmounts } from "./report-data";
import {
  modelKey,
  comparisonLabel,
  modelValue,
  descending,
  type ModelMeasure,
  type ModelValues,
} from "./use-model-comparison";
export type ReportGrouping = "provider" | "model";
type GroupValues = ModelValues & { estimatedCostUsd: string | null };
export type ReportGroup = GroupValues & {
  key: string;
  label: string;
  color: string;
  provider: string;
  modelLabel: string | null;
  cachedInputTokens: string | null;
};
const providerLabels = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor", antigravity: "Antigravity",
};
function totals(rows: readonly ModelValues[]): GroupValues {
  return {
    turns: addAmounts(rows.map((row) => row.turns)) ?? "0",
    inputTokens: addAmounts(rows.map((row) => row.inputTokens)),
    outputTokens: addAmounts(rows.map((row) => row.outputTokens)),
    totalTokens: addAmounts(rows.map((row) => row.totalTokens)),
    estimatedCostUsd: addAmounts(
      rows.map((row) => row.estimatedCostUsd ?? null),
    ),
  };
}
export const rankReportGroups = (
  rows: readonly ReportGroup[],
  measure: ModelMeasure,
) =>
  [...rows].sort(
    (a, b) =>
      descending(modelValue(a, measure), modelValue(b, measure)) ||
      a.key.localeCompare(b.key),
  );
export function useReportGroups(
  data: () => TelemetryMetrics | null,
  grouping: () => ReportGrouping,
) {
  const key = (row: TelemetryMetrics["models"][number]) =>
    grouping() === "provider" ? row.provider : modelKey(row);
  const groups = computed<ReportGroup[]>(() => {
    const report = data();
    if (!report) return [];
    const buckets = new Map<string, TelemetryMetrics["models"]>();
    for (const row of report.models) {
      const id = key(row),
        items = buckets.get(id) ?? [];
      items.push(row);
      buckets.set(id, items);
    }
    return [...buckets].map(([id, rows]) => {
      const row = rows[0]!,
        provider = grouping() === "provider";
      return {
        ...totals(rows),
        key: id,
        provider: row.provider,
        modelLabel: provider ? null : modelLabel(row),
        label: provider ? providerLabels[row.provider] : comparisonLabel(row),
        cachedInputTokens: addAmounts(
          rows.map((item) => item.cachedInputTokens),
        ),
        color: provider
          ? seriesColor(row.provider, "provider")
          : seriesColor(
              report.range.groupServiceTiers
                ? row.model
                : JSON.stringify([
                    row.model === "unknown" ? null : row.model,
                    row.serviceTier ?? null,
                  ]),
              "model",
            ),
      };
    });
  });
  const days = computed(() =>
    data()?.daily.length
      ? data()!.daily.map((row) => row.day)
      : [...new Set((data()?.modelDaily ?? []).map((row) => row.day))].sort(),
  );
  const daily = computed(() => {
    const buckets = new Map<string, ModelValues[]>();
    for (const row of data()?.modelDaily ?? []) {
      const id = `${row.day}/${grouping() === "provider" ? row.provider : modelKey(row)}`,
        rows = buckets.get(id) ?? [];
      rows.push(row);
      buckets.set(id, rows);
    }
    return new Map([...buckets].map(([id, rows]) => [id, totals(rows)]));
  });
  const reportedDays = computed(
    () =>
      new Set(
        (data()?.daily ?? [])
          .filter((row) => row.groups !== "0")
          .map((row) => row.day),
      ),
  );
  const costDays = computed(
    () =>
      new Set(
        (data()?.daily ?? [])
          .filter((row) => row.estimatedCostUsd !== null)
          .map((row) => row.day),
      ),
  );
  const value = (group: ReportGroup, day: string, measure: ModelMeasure) => {
    const row = daily.value.get(`${day}/${group.key}`);
    if (row) return modelValue(row, measure);
    if (measure === "inputRatio") return null;
    if (measure === "estimatedCostUsd")
      return group.estimatedCostUsd !== null && costDays.value.has(day)
        ? "0"
        : null;
    return reportedDays.value.has(day) ? "0" : null;
  };
  const observed = (group: ReportGroup, day: string) =>
    daily.value.has(`${day}/${group.key}`);
  return { groups, days, value, observed };
}
