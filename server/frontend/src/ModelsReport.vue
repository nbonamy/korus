<template>
  <section class="panel popularity" aria-label="Most used models">
    <header class="panel-heading">
      <div class="model-heading">
        <h2>
          {{
            grouping === "provider" ? "Most used providers" : "Most used models"
          }}
        </h2>
        <ModelComparisonControl
          v-if="view === 'trend'"
          v-model="selected"
          :choices="choices"
          :label="
            grouping === 'provider' ? 'Compare providers' : 'Compare models'
          "
        />
      </div>
      <div class="comparison-controls">
        <ReportGrouping v-model="grouping" label="Model usage grouping" />
        <div class="model-measures">
          <ElSegmented
            v-model="primaryMeasure"
            aria-label="Model usage measure"
            :options="[
              { label: 'Turns', value: 'turns' },
              { label: 'Tokens', value: 'tokens' },
              { label: 'Cost', value: 'cost' },
            ]"
          />
          <ElSegmented
            v-model="measure"
            class="model-token-measure"
            :class="{ 'model-token-measure--hidden': !isTokenMeasure }"
            :aria-hidden="!isTokenMeasure"
            :inert="!isTokenMeasure"
            aria-label="Model token measure"
            :options="[
              { label: 'Total', value: 'totalTokens' },
              { label: 'Input', value: 'inputTokens' },
              { label: 'Output', value: 'outputTokens' },
              { label: 'Ratio', value: 'inputRatio' },
            ]"
          />
        </div>
        <ElSegmented
          v-model="view"
          aria-label="Model usage view"
          :options="[
            { label: 'Trend', value: 'trend' },
            { label: 'Ranking', value: 'ranking' },
          ]"
        />
      </div>
    </header>
    <ol
      v-if="view === 'ranking'"
      class="model-ranking"
      :class="{ 'model-ranking--ratio': measure === 'inputRatio' }"
      aria-label="Model usage ranking"
    >
      <li v-for="row in ranked" :key="row.key" role="listitem">
        <span class="rank-label">{{ row.label }}</span>
        <span class="rank-track" aria-hidden="true"
          ><span
            :style="{
              width: barWidth(row),
              background: `linear-gradient(90deg, ${row.color}, color-mix(in srgb, ${row.color} 55%, var(--color-surface-lowest)))`,
            }"
        /></span>
        <strong :title="exactMeasurement(modelValue(row, measure), unit)">{{
          measurement(modelValue(row, measure), unit)
        }}</strong>
        <span v-if="measure !== 'inputRatio'" class="muted">{{
          modelValue(row, measure) === null || !Number(total)
            ? "—"
            : percent(Number(modelValue(row, measure)) / Number(total))
        }}</span>
      </li>
    </ol>
    <div v-else class="model-trend">
      <MetricChart
        :title="
          grouping === 'provider'
            ? 'Provider usage over time'
            : 'Model usage over time'
        "
        :days="days"
        :series="series"
        :measure="unit"
        :stacked="measure !== 'inputRatio'"
        :area="measure === 'inputRatio' ? 'none' : undefined"
        :total-label="
          compared.length === choices.length ? 'Total' : 'Selected total'
        "
      />
      <p v-if="!selected.length" class="muted">
        Choose {{ grouping === "provider" ? "providers" : "models" }} to
        compare.
      </p>
    </div>
    <p v-if="!ranked.length" class="muted">No usage for this selection.</p>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElSegmented } from "element-plus";
import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";
import {
  measurement,
  exactMeasurement,
  percent,
  plotValue,
  type Measure,
} from "./format";
import { addAmounts } from "./report-data";
import MetricChart from "./MetricChart.vue";
import ModelComparisonControl from "./ModelComparisonControl.vue";
import { modelValue, type ModelMeasure } from "./use-model-comparison";
import {
  useReportGroups,
  rankReportGroups,
  type ReportGrouping as Grouping,
  type ReportGroup,
} from "./use-report-groups";
import ReportGrouping from "./ReportGrouping.vue";
const props = defineProps<{ data: TelemetryMetrics }>();
const grouping = defineModel<Grouping>("grouping", { default: "model" });
const { groups, days, value, observed } = useReportGroups(
  () => props.data,
  () => grouping.value,
);
const choices = computed(() => rankReportGroups(groups.value, "turns"));
const selected = ref<string[]>([]);
watch(
  () =>
    choices.value
      .map((row) => row.key)
      .sort()
      .join("|"),
  () => {
    selected.value = choices.value
      .slice(0, grouping.value === "provider" ? choices.value.length : 5)
      .map((row) => row.key);
  },
  { immediate: true },
);
const compared = computed(() =>
  choices.value.filter((row) => selected.value.includes(row.key)),
);
const measure = defineModel<ModelMeasure>("measure", { default: "turns" });
const isTokenMeasure = computed(
  () => !["turns", "estimatedCostUsd"].includes(measure.value),
);
const primaryMeasure = computed({
  get: () =>
    isTokenMeasure.value
      ? "tokens"
      : measure.value === "estimatedCostUsd"
        ? "cost"
        : "turns",
  set: (value: string) => {
    measure.value =
      value === "tokens"
        ? "totalTokens"
        : value === "cost"
          ? "estimatedCostUsd"
          : "turns";
  },
});
const unit = computed<Measure>(() =>
  measure.value === "turns"
    ? "count"
    : measure.value === "estimatedCostUsd"
      ? "usd"
      : measure.value === "inputRatio"
        ? "ratio"
        : "tokens",
);
const view = ref("trend");
const ranked = computed(() => rankReportGroups(groups.value, measure.value));
const total = computed(() =>
  measure.value === "inputRatio"
    ? null
    : addAmounts(ranked.value.map((row) => modelValue(row, measure.value))),
);
const barWidth = (row: ReportGroup) => {
  const n = plotValue(modelValue(row, measure.value));
  const max = plotValue(
    ranked.value[0] ? modelValue(ranked.value[0], measure.value) : null,
  );
  return `${n !== null && max ? (n / max) * 100 : 0}%`;
};
const series = computed(() =>
  rankReportGroups(compared.value, measure.value).map((row) => ({
    label: row.label,
    color: row.color,
    values: days.value.map((day) => value(row, day, measure.value)),
    observed: days.value.map((day) => observed(row, day)),
  })),
);
</script>

<style scoped>
.popularity > .panel-heading {
  align-items: flex-start;
  margin-bottom: var(--space-6);
}
.model-heading {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  min-width: 0;
}
.model-heading > h2 {
  padding-top: var(--space-4);
}
.panel-heading > .comparison-controls {
  align-items: flex-start;
}
.model-measures {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-4);
}
.model-token-measure {
  --el-segmented-padding: var(--space-1);
  min-height: 24px;
  font-size: var(--font-size-11);
}
.model-token-measure :deep(.el-segmented__item) {
  padding: 0 var(--space-6);
}
.model-token-measure--hidden {
  visibility: hidden;
  pointer-events: none;
}
.model-ranking--ratio li {
  grid-template-columns: minmax(200px, 1fr) minmax(80px, 2fr) 84px;
}
@media (max-width: 768px) {
  .model-ranking--ratio li {
    grid-template-columns: minmax(0, 1fr) 72px;
  }
}
</style>
