<template>
  <UsageCard
    as="section"
    class="usage-share"
    :aria-label="$t('analytics.share')"
  >
    <header>
      <div class="chart-heading">
        <h3>{{ $t("analytics.share") }}</h3>
        <p v-if="subtitle">{{ subtitle }}</p>
      </div>
    </header>
    <div class="share-content">
      <div class="ring">
        <VueChart
          type="doughnut"
          :data="chartData"
          :options="chartOptions as unknown as ChartOptions"
          :plugins="[ringTrack]"
          role="img"
          :aria-label="$t('analytics.share')"
        />
        <div class="ring-labels">
          <div
            class="ring-total"
            :class="{ 'ring-total--cost': measure === 'cost' }"
          >
            {{
              highlighted
                ? chartFormat(highlighted.percent) + "%"
                : total === null
                  ? measure === "cost"
                    ? $t("analytics.costUnavailable")
                    : "—"
                  : measureFormat(total, measure)
            }}
          </div>
          <div class="ring-unit">
            {{
              highlighted
                ? clip(highlighted.label)
                : $t(
                    measure === "cost"
                      ? "analytics.costShareUnit"
                      : measure === "turns"
                        ? "analytics.turnsUnit"
                        : "analytics.measuredTokens",
                  )
            }}
          </div>
        </div>
      </div>
      <ul>
        <li
          v-for="row in orderedSeries"
          :key="row.key"
          :tabindex="row.value !== null && row.value > 0 ? 0 : -1"
          :aria-label="
            row.value !== null && total
              ? `${row.label}: ${measureFormat(row.value, measure)} · ${chartFormat((100 * row.value) / total)}%`
              : undefined
          "
          @focus="active = row.key"
          @blur="active = null"
          :class="{ dimmed: active !== null && active !== row.key }"
          @pointerenter="active = row.key"
          @pointerleave="active = null"
        >
          <i :style="{ background: row.color }" />
          <strong :title="row.label">{{ row.label }}</strong>
          <span class="share-percent">{{
            row.value === null || !total
              ? $t("analytics.notAvailable")
              : chartFormat((100 * row.value) / total) + "%"
          }}</span>
          <span class="share-value">{{
            row.value === null
              ? $t(
                  measure === "cost"
                    ? "analytics.costUnavailable"
                    : "analytics.notAvailable",
                )
              : measureFormat(row.value, measure)
          }}</span>
        </li>
      </ul>
    </div>
  </UsageCard>
</template>
<script setup lang="ts">
import { Chart as VueChart } from "vue-chartjs";
import {
  Chart as ChartJS,
  ArcElement,
  DoughnutController,
  type ChartData,
  type ChartOptions,
  type Plugin,
} from "chart.js";
import { resolveChartColor } from "@workspace/core/analytics-chart";
import { readAnalyticsTheme } from "./analytics-theme";
ChartJS.register(ArcElement, DoughnutController);
import UsageCard from "./UsageCard.vue";
import { computed, ref, onMounted, onUnmounted } from "vue";
import {
  chartFormat,
  measureFormat,
  sortUsageValues,
  type UsageMeasure,
  type UsageSeries,
} from "./usage-chart";
const props = defineProps<{
  series: UsageSeries[];
  measure: Exclude<UsageMeasure, "ratio">;
  subtitle?: string;
}>();
const orderedSeries = computed(() =>
  sortUsageValues(props.series, (row) => row.value),
);
const active = ref<string | null>(null);
const total = computed(() =>
  props.series.some((row) => row.value !== null)
    ? props.series.reduce((n, row) => n + (row.value ?? 0), 0)
    : null,
);
const slices = computed(() =>
  orderedSeries.value
    .filter((row) => total.value && row.value !== null && row.value > 0)
    .map((row) => ({ ...row, percent: (100 * row.value!) / total.value! })),
);
const theme = ref(readAnalyticsTheme());
const ringTrack: Plugin = {
  id: "usage-share-track",
  beforeDraw(chart) {
    const size = Math.min(chart.width, chart.height),
      ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(
      chart.width / 2,
      chart.height / 2,
      (size * 58) / 160,
      0,
      2 * Math.PI,
    );
    ctx.lineWidth = (size * 16) / 160;
    ctx.strokeStyle = `color-mix(in srgb, ${resolveChartColor(theme.value.tokens["--color-text"] || "#111", theme.value.tokens)} 6%, transparent)`;
    ctx.stroke();
    ctx.restore();
  },
};
const chartData = computed<ChartData<"doughnut">>(() => ({
  labels: slices.value.map((row) => row.label),
  datasets: [
    {
      data: slices.value.map((row) => row.value!),
      borderWidth: 0,
      spacing: 2,
      radius: "82.5%",
      cutout: "75.76%",
      backgroundColor: (context) => {
        const row = slices.value[context.dataIndex];
        if (!row) return "transparent";
        const color = resolveChartColor(row.color, theme.value.tokens),
          chart = context.chart;
        const gradient = chart.ctx.createLinearGradient(19, 19, 201, 201),
          opacity =
            active.value !== null && active.value !== row.key ? 35 : 100;
        gradient.addColorStop(
          0,
          `color-mix(in srgb, ${color} ${opacity}%, transparent)`,
        );
        gradient.addColorStop(
          1,
          `color-mix(in srgb, ${color} ${opacity * 0.6}%, transparent)`,
        );
        return gradient;
      },
      hoverOffset: 2,
    },
  ],
}));
const chartOptions = computed<ChartOptions<"doughnut">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  onHover: (_event, elements) => {
    active.value = elements[0]
      ? (slices.value[elements[0].index]?.key ?? null)
      : null;
  },
}));
let observer: MutationObserver | undefined;
onMounted(() => {
  observer = new MutationObserver(() => (theme.value = readAnalyticsTheme()));
  observer.observe(document.documentElement, { attributes: true });
});
onUnmounted(() => observer?.disconnect());
const highlighted = computed(
  () => slices.value.find((slice) => slice.key === active.value) ?? null,
);
const clip = (label: string) =>
  label.length > 16 ? label.slice(0, 15) + "…" : label;
</script>
<style scoped>
header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-6);
  margin-bottom: var(--space-8);
}
h3 {
  margin: 0;
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-bold);
}
.chart-heading p {
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}
.share-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}
.ring {
  position: relative;
  align-self: center;
  width: min(100%, 220px);
  height: 220px;
}
.ring-labels {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -55%);
  text-align: center;
  pointer-events: none;
}
.ring-total {
  color: var(--color-text);
  font-size: 33px;
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.02em;
}
.ring-total--cost {
  font-size: 25px;
}
.ring-unit {
  margin-top: 4px;
  color: var(--color-text-muted);
  font-size: 12px;
  white-space: nowrap;
}

ul {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}
li {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto 52px;
  grid-template-areas: "dot name value percent";
  column-gap: var(--space-4);
  align-items: center;
  padding: var(--space-3) var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--font-size-12);
  transition:
    opacity 140ms ease,
    background 140ms ease;
}
li:hover {
  background: color-mix(in srgb, var(--color-text) 4%, transparent);
}
li.dimmed {
  opacity: 0.45;
}
li i {
  grid-area: dot;
  align-self: center;
  width: 10px;
  height: 10px;
  border-radius: 4px;
}
strong {
  grid-area: name;
  align-self: center;
  overflow: hidden;
  font-weight: var(--font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.share-percent {
  grid-area: percent;
  justify-self: end;
  font-weight: var(--font-weight-bold);
}
.share-value {
  grid-area: value;
  justify-self: end;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
