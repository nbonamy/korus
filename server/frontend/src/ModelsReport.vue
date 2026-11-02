<template>
  <section
    class="popularity"
    :class="{ panel: view === 'ranking' }"
    aria-label="Most used models"
  >
    <header class="panel-heading">
      <h2>Most used models</h2>
      <div class="comparison-controls">
        <ElSegmented
          v-model="measure"
          aria-label="Model usage measure"
          :options="[
            { label: 'Turns', value: 'turns' },
            { label: 'Tokens', value: 'totalTokens' },
            { label: 'Input', value: 'inputTokens' },
            { label: 'Output', value: 'outputTokens' },
          ]"
        />
        <ElSegmented
          v-model="view"
          aria-label="Model usage view"
          :options="[
            { label: 'Ranking', value: 'ranking' },
            { label: 'Over time', value: 'trend' },
          ]"
        />
      </div>
    </header>
    <ol
      v-if="view === 'ranking'"
      class="model-ranking"
      aria-label="Model usage ranking"
    >
      <li v-for="row in ranked" :key="modelKey(row)" role="listitem">
        <span class="rank-label">{{ comparisonLabel(row) }}</span>
        <span class="rank-track" aria-hidden="true"
          ><span
            :style="{
              width: barWidth(row),
              background: `linear-gradient(90deg, ${color(row)}, color-mix(in srgb, ${color(row)} 55%, var(--color-surface-lowest)))`,
            }"
        /></span>
        <strong :title="count(row[measure])">{{
          measure === "turns" ? count(row[measure]) : tokens(row[measure])
        }}</strong>
        <span class="muted">{{
          row[measure] === null || !total
            ? "—"
            : percent(Number(row[measure]) / Number(total))
        }}</span>
      </li>
    </ol>
    <div v-else class="model-trend">
      <div class="comparison-controls">
        <ModelComparisonControl v-model="selected" :choices="choices" />
        <ElSegmented
          v-model="chart"
          aria-label="Model trend style"
          :options="[
            { label: 'Stacked bars', value: 'stacked' },
            { label: 'Lines', value: 'line' },
          ]"
        />
      </div>
      <MetricChart
        title="Model usage over time"
        :days="days"
        :series="series"
        :measure="measure === 'turns' ? 'count' : 'tokens'"
        :variant="chart"
        :total-label="
          compared.length === choices.length ? 'Total' : 'Selected total'
        "
      />
      <p v-if="!selected.length" class="muted">Choose models to compare.</p>
    </div>
    <p v-if="!ranked.length" class="muted">
      No model usage for this selection.
    </p>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { ElSegmented } from "element-plus";
import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";
import { count, tokens, percent, plotValue } from "./format";
import MetricChart from "./MetricChart.vue";
import ModelComparisonControl from "./ModelComparisonControl.vue";
import {
  modelKey,
  comparisonLabel,
  descending,
  useModelComparison,
  type ModelRow,
} from "./use-model-comparison";
const props = defineProps<{ data: TelemetryMetrics }>();
const { choices, selected, compared, days, daily, color, dash, reportedDays } =
  useModelComparison(toRef(props, "data"));
const measure = ref<"turns" | "totalTokens" | "inputTokens" | "outputTokens">(
  "turns",
);
const view = ref("ranking"),
  chart = ref<"stacked" | "line">("stacked");
const ranked = computed(() =>
  [...props.data.models].sort(
    (a, b) =>
      descending(a[measure.value], b[measure.value]) ||
      modelKey(a).localeCompare(modelKey(b)),
  ),
);
const total = computed(() =>
  ranked.value.reduce((sum, row) => sum + BigInt(row[measure.value] ?? 0), 0n),
);
const barWidth = (row: ModelRow) => {
  const n = plotValue(row[measure.value]);
  const max = plotValue(ranked.value[0]?.[measure.value] ?? null);
  return `${n !== null && max ? (n / max) * 100 : 0}%`;
};
const series = computed(() =>
  compared.value.map((row) => ({
    label: comparisonLabel(row),
    color: color(row),
    dash: dash(row),
    values: days.value.map((day) => {
      const entry = daily.value.get(`${day}/${modelKey(row)}`);
      return entry
        ? entry[measure.value]
        : reportedDays.value.has(day)
          ? "0"
          : null;
    }),
  })),
);
</script>
