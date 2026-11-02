<template>
  <section aria-label="Spend breakdown">
    <dl class="cards usage-totals">
      <div class="panel" aria-label="Known estimated spend">
        <dt>Estimated spend</dt>
        <dd :title="exactMoney(data.totals.estimatedCostUsd)">
          {{ money(data.totals.estimatedCostUsd) }}
        </dd>
      </div>
    </dl>
    <MetricChart
      title="Daily estimated spend"
      :days="days"
      :series="dailyProviders"
      measure="usd"
      stacked
      ><ReportGrouping v-model="grouping" label="Spend grouping"
    /></MetricChart>
    <MetricRanking
      :title="grouping === 'provider' ? 'Spend by provider' : 'Spend by model'"
      :rows="ranked"
      measure="usd"
    />
  </section>
</template>
<script setup lang="ts">
import { computed } from "vue";
import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";
import MetricChart from "./MetricChart.vue";
import MetricRanking from "./MetricRanking.vue";
import ReportGrouping from "./ReportGrouping.vue";
import {
  useReportGroups,
  rankReportGroups,
  type ReportGrouping as Grouping,
} from "./use-report-groups";
import { money, exactMoney } from "./format";
const props = defineProps<{ data: TelemetryMetrics }>();
const grouping = defineModel<Grouping>("grouping", { default: "provider" });
const { groups, days, value } = useReportGroups(
  () => props.data,
  () => grouping.value,
);
const ordered = computed(() =>
  rankReportGroups(groups.value, "estimatedCostUsd"),
);
const ranked = computed(() =>
  ordered.value.map((row) => ({
    label: row.label,
    color: row.color,
    value: row.estimatedCostUsd ?? null,
  })),
);
const dailyProviders = computed(() => {
  if (!props.data.modelDaily?.some((row) => "estimatedCostUsd" in row))
    return [
      {
        label: "Estimated USD",
        values: props.data.daily.map((row) => row.estimatedCostUsd),
      },
    ];
  return ordered.value
    .map((row) => ({
      label: row.label,
      color: row.color,
      values: days.value.map((day) => value(row, day, "estimatedCostUsd")),
    }))
    .filter((row) => row.values.some((amount) => amount !== null));
});
</script>
