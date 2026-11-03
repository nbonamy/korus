<template>
  <section aria-label="Model performance">
    <dl class="performance-totals">
      <div class="panel" aria-label="Time to first output summary">
        <dt>Time to First Token (TTFT)</dt>
        <dd>
          <strong>{{ performanceNumber(ttft, "milliseconds") }}</strong>
          <span v-if="ttft !== null">{{ " " }}s</span>
        </dd>
      </div>
      <div class="panel" aria-label="Output speed summary">
        <dt>Output Speed</dt>
        <dd>
          <strong>{{ performanceNumber(speed, "rate") }}</strong>
          <span v-if="speed !== null">{{ " " }}tokens/s</span>
        </dd>
      </div>
    </dl>
    <MetricChart
      class="performance-trend"
      title="Output speed over time"
      subtitle="tokens/s"
      :days="days"
      :series="speedSeries"
      measure="rate"
    />
    <div class="performance-grid">
      <PerformanceRanking kind="ttft" :rows="ttftRows" />
      <PerformanceRanking kind="speed" :rows="speedRows" />
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, toRef } from "vue";
import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";
import { providerColorForModel } from "@workspace/core/analytics-palette";
import {
  modelKey,
  useModelComparison,
  type ModelRow,
} from "./use-model-comparison";
import { modelLabel } from "./model-label";
import { performanceNumber } from "./format";
import MetricChart from "./MetricChart.vue";
import PerformanceRanking from "./PerformanceRanking.vue";
const props = defineProps<{ data: TelemetryMetrics }>();
const { choices, days, daily, color } = useModelComparison(
  toRef(props, "data"),
);
const ttft = computed(
  () => props.data.totals.performance?.timeToFirstOutputMs ?? null,
);
const speed = computed(
  () => props.data.totals.performance?.outputTokensPerSecond ?? null,
);
const label = (row: ModelRow) =>
  choices.value.filter((item) => modelLabel(item) === modelLabel(row)).length >
  1
    ? `${modelLabel(row)} (${row.provider})`
    : modelLabel(row);
const speedSeries = computed(() =>
  choices.value
    .map((row) => ({
      label: label(row),
      color: color(row),
      values: days.value.map(
        (day) =>
          daily.value.get(`${day}/${modelKey(row)}`)?.performance
            ?.outputTokensPerSecond ?? null,
      ),
    }))
    .filter((row) => row.values.some((value) => value !== null)),
);
const rows = (field: "timeToFirstOutputMs" | "outputTokensPerSecond") =>
  props.data.models.map((row) => ({
    key: modelKey(row),
    label: label(row),
    color: providerColorForModel(
      row.model === "unknown" ? "Unknown" : row.model,
    ),
    value: row.performance?.[field] ?? null,
  }));
const ttftRows = computed(() => rows("timeToFirstOutputMs"));
const speedRows = computed(() => rows("outputTokensPerSecond"));
</script>
<style scoped>
.performance-totals,
.performance-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-8);
}
.performance-totals {
  margin-bottom: var(--space-8);
}
.performance-totals > .panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-10);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-sm);
}
.performance-totals dt {
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-semibold);
}
.performance-totals dd {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin: 0;
}
.performance-totals strong {
  font-size: var(--font-size-28);
  font-weight: var(--font-weight-bold);
  line-height: var(--line-height-32);
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.performance-totals dd > span {
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0;
}
.performance-trend {
  padding: var(--space-10);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-sm);
}
@media (max-width: 900px) {
  .performance-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 560px) {
  .performance-totals {
    gap: 10px;
  }
  .performance-totals > .panel,
  .performance-trend {
    padding: 16px 14px;
    border-radius: var(--console-radius);
  }
  .performance-totals dd {
    flex-wrap: wrap;
  }
}
</style>
