<template>
  <section aria-label="Token breakdown">
    <dl class="cards usage-totals">
      <div class="panel" aria-label="Measured total tokens">
        <dt>Total tokens</dt>
        <dd :title="count(data.totals.totalTokens)">
          {{ tokens(data.totals.totalTokens) }}
        </dd>
      </div>
      <div class="panel">
        <dt>Input</dt>
        <dd>{{ tokens(data.totals.inputTokens) }}</dd>
      </div>
      <div class="panel">
        <dt>Output</dt>
        <dd>{{ tokens(data.totals.outputTokens) }}</dd>
      </div>
      <div class="panel" aria-label="Measured cache-read share">
        <dt>Cache-read share</dt>
        <dd>{{ percent(data.totals.cacheReadShare) }}</dd>
      </div>
    </dl>
    <MetricChart
      title="Total tokens"
      :days="days"
      :series="[
        {
          label: 'Inclusive input',
          values: data.daily.map((row) => row.inputTokens),
        },
        { label: 'Output', values: data.daily.map((row) => row.outputTokens) },
      ]"
      measure="tokens"
      variant="stacked"
    />
    <MetricRanking title="Tokens by model" :rows="models" measure="tokens" />
  </section>
</template>
<script setup lang="ts">
import { computed, toRef } from "vue";
import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";
import MetricChart from "./MetricChart.vue";
import MetricRanking from "./MetricRanking.vue";
import { count, tokens, percent } from "./format";
import { comparisonLabel, useModelComparison } from "./use-model-comparison";
const props = defineProps<{ data: TelemetryMetrics }>();
const { color } = useModelComparison(toRef(props, "data"));
const days = computed(() => props.data.daily.map((row) => row.day));
const models = computed(() =>
  props.data.models.map((row) => ({
    label: comparisonLabel(row),
    color: color(row),
    value: row.totalTokens,
  })),
);
</script>
