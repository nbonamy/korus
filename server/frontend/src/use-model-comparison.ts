import { computed, ref, watch, type Ref } from "vue";
import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";
import { modelLabel } from "./model-label";
export type ModelRow = TelemetryMetrics["models"][number];
export const modelKey = (
  row: Pick<ModelRow, "provider" | "model" | "serviceTier">,
) => JSON.stringify([row.provider, row.model, row.serviceTier ?? null]);
export const comparisonLabel = (row: ModelRow) =>
  `${{ codex: "Codex", claude: "Claude", antigravity: "Antigravity" }[row.provider]} / ${modelLabel(row)}`;
export const descending = (a: string | null, b: string | null) =>
  a === b
    ? 0
    : a === null
      ? 1
      : b === null
        ? -1
        : BigInt(a) > BigInt(b)
          ? -1
          : 1;
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
  // Match desktop Analytics: provider-family hues, with stable model/tier shades.
  const color = (row: ModelRow) => {
    const hash = [...modelKey(row)].reduce(
      (n, c) => (n * 31 + c.charCodeAt(0)) >>> 0,
      0,
    );
    const base = `var(--chart-${{ codex: 1, claude: 2, antigravity: 3 }[row.provider]})`;
    return hash % 3 === 0
      ? base
      : `color-mix(in oklab, ${base} ${hash % 3 === 1 ? 78 : 58}%, var(--color-surface-lowest))`;
  };
  const dash = (row: ModelRow) =>
    row.serviceTier === "fast"
      ? "5 3"
      : row.serviceTier === "ultrafast"
        ? "2 3"
        : undefined;
  return {
    choices,
    selected,
    compared,
    days,
    daily,
    color,
    dash,
    reportedDays,
  };
}
