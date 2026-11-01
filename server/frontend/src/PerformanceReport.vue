<template>
  <section aria-label="Model performance">
    <div class="comparison-controls performance-controls">
      <ModelComparisonControl v-model="selected" :choices="choices" />
    </div>
    <p
      v-if="
        !data.totals.performance || data.totals.performance.ttftTurns === '0'
      "
      class="performance-note muted"
    >
      No performance measurements for this selection yet.
    </p>
    <div class="chart-grid">
      <MetricChart
        title="Output speed"
        description="Higher is faster · measured output per active second."
        :days="days"
        :series="speedSeries"
        measure="rate"
      />
      <MetricChart
        title="Time to first output"
        description="Lower is faster · average active time before first output."
        :days="days"
        :series="ttftSeries"
        measure="milliseconds"
      />
    </div>
    <p v-if="!selected.length" class="muted performance-note">
      Choose models to compare.
    </p>
    <div class="section-heading usage-heading"><h2>All filtered usage</h2></div>
    <dl class="cards performance-totals">
      <div class="panel" aria-label="Output speed summary">
        <dt>Output speed</dt>
        <dd>
          {{ rate(data.totals.performance?.outputTokensPerSecond ?? null) }}
        </dd>
        <small
          >{{ count(data.totals.performance?.speedTurns ?? "0") }} measured
          turns</small
        >
      </div>
      <div class="panel" aria-label="Time to first output summary">
        <dt>Time to first output</dt>
        <dd>
          {{ duration(data.totals.performance?.timeToFirstOutputMs ?? null) }}
        </dd>
        <small
          >{{ count(data.totals.performance?.ttftTurns ?? "0") }} measured
          turns</small
        >
      </div>
      <div class="panel">
        <dt>Timing coverage</dt>
        <dd>
          {{
            percent(
              Number(data.totals.turns) > 0
                ? Number(data.totals.performance?.speedTurns ?? 0) /
                    Number(data.totals.turns)
                : null,
            )
          }}
        </dd>
        <small
          >{{ count(data.totals.performance?.speedTurns ?? "0") }} of
          {{ count(data.totals.turns) }} turns measured</small
        >
      </div>
    </dl>
    <section class="panel model-panel" aria-label="Performance by model">
      <header class="panel-heading">
        <h2>Performance by model</h2>
        <span class="muted"
          >{{ data.models.length }}
          {{ data.range.groupServiceTiers ? "models" : "variants" }}</span
        >
      </header>
      <div
        class="table-scroll"
        tabindex="0"
        aria-label="Model performance data"
      >
        <table>
          <caption class="sr-only">
            App-observed model performance and measurement coverage
          </caption>
          <thead>
            <tr>
              <th scope="col">Provider / model</th>
              <th scope="col">Output speed</th>
              <th scope="col">First output</th>
              <th scope="col">Speed samples</th>
              <th scope="col">First-output samples</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in data.models"
              :key="`${row.provider}/${row.model}/${row.serviceTier}`"
            >
              <th scope="row">
                <span class="provider">{{ row.provider }}</span
                >{{ modelLabel(row) }}
              </th>
              <td>
                {{ rate(row.performance?.outputTokensPerSecond ?? null) }}
              </td>
              <td>
                {{ duration(row.performance?.timeToFirstOutputMs ?? null) }}
              </td>
              <td>
                {{ count(row.performance?.speedTurns ?? "0") }} /
                {{ count(row.turns) }}
              </td>
              <td>
                {{ count(row.performance?.ttftTurns ?? "0") }} /
                {{ count(row.turns) }}
              </td>
            </tr>
            <tr v-if="!data.models.length">
              <td colspan="5">No model measurements.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <p class="performance-note muted">
      Observed in Korus, not a provider benchmark. Tool execution and waits for
      your input are excluded. Rates use total measured output and time. Missing
      samples are not zero.
    </p>
  </section>
</template>
<script setup lang="ts">
import { computed, toRef } from "vue";
import ModelComparisonControl from "./ModelComparisonControl.vue";
import {
  comparisonLabel,
  modelKey,
  useModelComparison,
} from "./use-model-comparison";
import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";
import { modelLabel } from "./model-label";
import MetricChart from "./MetricChart.vue";
import { count, rate, duration, percent } from "./format";
const props = defineProps<{ data: TelemetryMetrics }>();
const { choices, selected, compared, days, daily, color, dash } =
  useModelComparison(toRef(props, "data"));
const performanceSeries = (
  field: "outputTokensPerSecond" | "timeToFirstOutputMs",
) =>
  compared.value.map((row) => ({
    label: comparisonLabel(row),
    color: color(row),
    dash: dash(row),
    values: days.value.map(
      (day) =>
        daily.value.get(`${day}/${modelKey(row)}`)?.performance?.[field] ??
        null,
    ),
  }));
const speedSeries = computed(() => performanceSeries("outputTokensPerSecond"));
const ttftSeries = computed(() => performanceSeries("timeToFirstOutputMs"));
</script>
<style scoped>
.performance-totals {
  margin-bottom: 16px;
}
.performance-note {
  font-size: 11px;
  line-height: 1.6;
  margin: 14px 0;
  max-width: 90ch;
}
</style>
