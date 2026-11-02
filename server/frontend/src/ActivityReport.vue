<template>
  <section aria-label="Global activity">
    <dl class="cards overview-section">
      <div class="panel" aria-label="Participating installs">
        <dt>Participating installs</dt>
        <dd>{{ count(data.overview.participatingInstalls) }}</dd>
      </div>
      <div class="panel" aria-label="Daily active installs">
        <dt>Daily active</dt>
        <dd>{{ count(data.overview.dau) }}</dd>
      </div>
      <div class="panel" aria-label="Weekly active installs">
        <dt>Weekly active</dt>
        <dd>{{ count(data.overview.wau) }}</dd>
      </div>
      <div class="panel" aria-label="Monthly active installs">
        <dt>Monthly active</dt>
        <dd>{{ count(data.overview.mau) }}</dd>
      </div>
    </dl>
    <div class="chart-grid">
      <MetricChart
        title="Daily activity"
        :days="days"
        :series="activity"
        measure="count"
        area="gradient"
      />
      <MetricChart
        title="Installation growth"
        :days="days"
        :series="[
          {
            label: 'Participating installs',
            color: 'var(--chart-3)',
            values: installGrowth(data),
          },
        ]"
        measure="count"
        area="gradient"
      />
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed } from "vue";
import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";
import MetricChart from "./MetricChart.vue";
import { count } from "./format";
import { installGrowth } from "./report-data";
const props = defineProps<{ data: TelemetryMetrics }>();
const days = computed(() => props.data.activity.map((row) => row.day));
const activity = computed(() => [
  {
    label: "Active installs",
    color: "var(--chart-1)",
    values: props.data.activity.map((row) => row.activeInstalls),
  },
]);
</script>
