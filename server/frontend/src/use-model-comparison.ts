import { computed, ref, watch, type Ref } from "vue";
import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";
import { modelLabel, providerLabel } from "./model-label";
import { seriesColor } from "@workspace/core/analytics-palette";
export type ModelRow = TelemetryMetrics["models"][number];
export type ModelMeasure =
  | "turns"
  | "totalTokens"
  | "inputTokens"
  | "outputTokens"
  | "estimatedCostUsd"
  | "inputRatio";
export const modelKey = (
  row: Pick<ModelRow, "provider" | "model" | "serviceTier">,
) => JSON.stringify([row.provider, row.model, row.serviceTier ?? null]);
export const comparisonLabel = (row: ModelRow) =>
  `${providerLabel(row.provider)} / ${modelLabel(row)}`;
export function descending(a: string | null, b: string | null) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const precision = Math.max(
    a.split(".")[1]?.length ?? 0,
    b.split(".")[1]?.length ?? 0,
  );
  const scaled = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole! + fraction.padEnd(precision, "0"));
  };
  const left = scaled(a),
    right = scaled(b);
  return left === right ? 0 : left > right ? -1 : 1;
}
export type ModelValues = Pick<
  ModelRow,
  "turns" | "totalTokens" | "inputTokens" | "outputTokens"
> & { estimatedCostUsd?: string | null };
/** Input's share of the known measured total, expressed as a fraction for charts. */
export function modelValue(
  row: ModelValues,
  measure: ModelMeasure,
): string | null {
  if (measure !== "inputRatio") return row[measure] ?? null;
  if (
    row.inputTokens === null ||
    row.totalTokens === null ||
    BigInt(row.totalTokens) === 0n
  )
    return null;
  const scaled = (
    (BigInt(row.inputTokens) * 100000000n) /
    BigInt(row.totalTokens)
  )
    .toString()
    .padStart(9, "0");
  return `${scaled.slice(0, -8)}.${scaled.slice(-8)}`;
}
export function useModelComparison(data: Ref<TelemetryMetrics>) {
  const choices = computed(() =>
    [...data.value.models].sort(
      (a, b) =>
        descending(a.turns, b.turns) || modelKey(a).localeCompare(modelKey(b)),
    ),
  );
  const selected = ref<string[]>([]);
  watch(
    () => choices.value.map(modelKey).sort().join("|"),
    () => {
      selected.value = choices.value.slice(0, 5).map(modelKey);
    },
    { immediate: true },
  );
  const compared = computed(() =>
    choices.value.filter((row) => selected.value.includes(modelKey(row))),
  );
  const days = computed(() =>
    data.value.daily.length
      ? data.value.daily.map((row) => row.day)
      : [
          ...new Set((data.value.modelDaily ?? []).map((row) => row.day)),
        ].sort(),
  );
  const daily = computed(
    () =>
      new Map(
        (data.value.modelDaily ?? []).map((row) => [
          `${row.day}/${modelKey(row)}`,
          row,
        ]),
      ),
  );
  const reportedDays = computed(
    () =>
      new Set(
        data.value.daily
          .filter((row) => row.groups !== "0")
          .map((row) => row.day),
      ),
  );
  const color = (row: ModelRow) =>
    seriesColor(
      data.value.range.groupServiceTiers
        ? row.model
        : JSON.stringify([
            row.model === "unknown" ? null : row.model,
            row.serviceTier ?? null,
          ]),
      "model",
    );
  return {
    choices,
    selected,
    compared,
    days,
    daily,
    color,
    reportedDays,
  };
}
