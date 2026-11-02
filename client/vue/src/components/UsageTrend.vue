<template>
  <section class="usage-trend" :aria-label="title">
    <slot name="header">
      <header>
        <div class="chart-heading">
          <h3>{{ title }}</h3>
          <p v-if="subtitle">{{ subtitle }}</p>
        </div>
        <slot name="controls" />
      </header>
    </slot>
    <p v-if="!observed" class="chart-empty">
      {{ $t("analytics.notAvailable") }}
    </p>
    <div v-else ref="stage" class="chart-stage">
      <div class="chart-canvas">
        <VueChart
          ref="chart"
          :type="configuration.type"
          :data="chartData"
          :options="chartOptions"
          :plugins="configuration.plugins"
          role="img"
          :aria-label="title"
          tabindex="0"
          @keydown="key"
        />
      </div>
      <div class="chart-observations">
        <button
          v-for="point in observations"
          :key="point.label"
          class="chart-observation"
          tabindex="-1"
          :aria-label="point.label"
          @focus="activate(point.index)"
          @blur="activate(null)"
        />
      </div>
      <div
        v-if="
          hovered &&
          (!['cost', 'ratio'].includes(measure) || hovered.segments.length)
        "
        class="chart-tooltip"
        :style="tooltipStyle"
        aria-hidden="true"
      >
        <strong class="tooltip-day">{{ dayLabel(hovered.day, true) }}</strong>
        <ul>
          <li v-for="segment in tooltipSegments" :key="segment.key">
            <i :style="{ background: segment.color }" />
            <span class="tooltip-name">{{ segment.label }}</span>
            <b>{{ metricFormat(segment.value) }}</b>
          </li>
        </ul>
        <p v-if="isSpeed && !hovered.segments.length">
          {{ $t("analytics.notAvailable") }}
        </p>
        <div
          v-if="!isRate && hovered.segments.length > 1"
          class="tooltip-total"
        >
          <span>{{ $t("analytics.total") }}</span>
          <b>{{ metricFormat(hovered.total) }}</b>
        </div>
      </div>
    </div>
    <div v-if="series.length > 1" class="chart-legend">
      <span v-for="item in legendSeries" :key="item.key"
        ><i :style="{ background: item.color }" />{{ item.label }}</span
      >
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from "vue";
import { Chart as VueChart } from "vue-chartjs";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  LineController,
  BarController,
  Tooltip,
  Legend,
  Filler,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { buildAnalyticsChart } from "@workspace/core/analytics-chart";
import type { UsageSummary } from "@workspace/core/usage";
import { translate } from "../i18n";
import {
  chartValue,
  chartFormat,
  measureFormat,
  niceScale,
  sortUsageValues,
  usageRowKey,
  type UsageMeasure,
  type UsageSeries,
} from "./usage-chart";
import { readAnalyticsTheme } from "./analytics-theme";
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  LineController,
  BarController,
  Tooltip,
  Legend,
  Filler,
);
const props = defineProps<{
  daily: NonNullable<UsageSummary["daily"]>;
  series: UsageSeries[];
  measure: UsageMeasure | "speed";
  from: string;
  to: string;
  subtitle?: string;
}>();
const isSpeed = computed(() => props.measure === "speed"),
  isRate = computed(() => isSpeed.value || props.measure === "ratio");
const title = computed(() =>
  translate(isSpeed.value ? "analytics.speedTrend" : "analytics.trend"),
);
type DailyGroup = NonNullable<
  NonNullable<UsageSummary["daily"]>[number]["groups"]
>[number];
const valueOf = (group: DailyGroup) => chartValue(group, props.measure);
const stage = ref<HTMLElement | null>(null),
  chart = ref<{ chart: ChartJS | null } | null>(null),
  active = ref<number | null>(null),
  theme = ref(readAnalyticsTheme());
const metricFormat = (value: number | null) => {
  if (props.measure === "speed")
    return `${chartFormat(value, true)} ${translate("analytics.tokensPerSecond")}`;
  if (props.measure === "ratio" && value !== null)
    return (
      new Intl.NumberFormat(undefined, {
        maximumFractionDigits: Math.max(
          1,
          Math.ceil(-Math.log10(scale.value.step)) + 1,
        ),
      }).format(value) + "%"
    );
  return measureFormat(value, props.measure, true);
};
const observed = computed(() =>
  props.daily.some((row) =>
    row.groups?.some(
      (group) =>
        props.series.some((series) => series.key === usageRowKey(group)) &&
        valueOf(group) !== null,
    ),
  ),
);
const values = computed(() => {
  const days = new Map(props.daily.map((row) => [row.day, row]));
  const rows = [];
  for (
    let at = Date.parse(props.from);
    at <= Date.parse(props.to);
    at += 86400000
  ) {
    const day = new Date(at).toISOString().slice(0, 10),
      row = days.get(day);
    let top = 0;
    const segments = props.series.flatMap((series) => {
      const group = row?.groups?.find(
        (group) => usageRowKey(group) === series.key,
      );
      const value = group ? valueOf(group) : null;
      if (
        value == null ||
        (!["cost", "ratio"].includes(props.measure) && value === 0)
      )
        return [];
      top = isRate.value ? Math.max(top, value) : top + value;
      return [{ ...series, value, top }];
    });
    rows.push({
      day,
      segments,
      total: props.measure === "cost" ? (row?.cost?.usd ?? null) : top,
      cost: row?.cost,
      groups: row?.groups,
    });
  }
  return rows;
});
const scale = computed(() => {
  if (props.measure === "ratio") {
    const ratios = values.value.flatMap((row) =>
      row.segments.map((segment) => segment.value),
    );
    if (!ratios.length) return { min: 0, max: 100, step: 25 };
    const low = Math.min(...ratios),
      high = Math.max(...ratios);
    const padding = Math.max((high - low) * 0.1, 0.05);
    const lower = Math.max(0, low - padding),
      upper = Math.min(100, high + padding);
    const step = niceScale(upper - lower, 4, true).step;
    return {
      min: Math.max(0, Math.floor(lower / step) * step),
      max: Math.min(100, Math.ceil(upper / step) * step),
      step,
    };
  }
  return {
    min: 0,
    ...niceScale(
      Math.max(
        props.measure === "cost" ? 0 : 1,
        ...values.value.map((row) => row.total ?? 0),
      ) || 1,
      4,
      props.measure === "cost",
    ),
  };
});

const interaction = {
  index: null as number | null,
  renderedWidth: () =>
    chart.value?.chart?.canvas.getBoundingClientRect().width ?? 0,
};
const configuration = computed(() =>
  buildAnalyticsChart(
    {
      days: values.value.map((row) => row.day),
      measure:
        props.measure === "speed"
          ? "rate"
          : props.measure === "ratio"
            ? "ratio"
            : props.measure === "cost"
              ? "usd"
              : props.measure === "turns"
                ? "count"
                : "tokens",
      stacked: !isRate.value,
      legend: false,
      series: props.series.map((series) => ({
        key: series.key,
        label: series.label,
        color: series.color,
        values: values.value.map((row) => {
          const value = row.segments.find(
            (segment) => segment.key === series.key,
          )?.value;
          if (value !== undefined)
            return props.measure === "ratio" ? value / 100 : value;
          if (props.measure === "cost")
            return series.value !== null &&
              row.cost?.usd != null &&
              !row.groups?.some((group) => usageRowKey(group) === series.key)
              ? 0
              : null;
          return props.measure === "ratio" || isSpeed.value ? null : 0;
        }),
      })),
    },
    theme.value,
    (index) => (active.value = index),
    interaction,
  ),
);
const observations = computed(() =>
  configuration.value.data.datasets.flatMap((series, seriesIndex) =>
    series.data.flatMap((value, index) =>
      value !== null &&
      (["cost", "ratio"].includes(props.measure) || value !== 0)
        ? [
            {
              index,
              label: `${values.value[index]!.day} · ${props.series[seriesIndex]!.label}: ${metricFormat(props.measure === "ratio" ? value * 100 : value)}`,
            },
          ]
        : [],
    ),
  ),
);
const chartData = computed(
  () => configuration.value.data as unknown as ChartData,
);
const chartOptions = computed(
  () => configuration.value.options as unknown as ChartOptions,
);
function activate(index: number | null) {
  configuration.value.activate(index);
  chart.value?.chart?.draw();
}
const hovered = computed(() =>
  active.value === null ? null : values.value[active.value],
);
const tooltipSegments = computed(() =>
  sortUsageValues(hovered.value?.segments ?? [], (row) => row.value),
);
const legendSeries = computed(() =>
  sortUsageValues(props.series, (row) => row.value),
);
const tooltipStyle = computed(() => {
  const width = chart.value?.chart?.width ?? 640,
    popupWidth = Math.min(340, width - 16),
    point =
      chart.value?.chart?.scales.x?.getPixelForValue(active.value ?? 0) ?? 16;
  return {
    boxSizing: "border-box" as const,
    maxWidth: `${popupWidth}px`,
    width: "max-content",
    left: `${Math.max(8, Math.min(width - popupWidth - 8, point > width * 0.6 ? point - popupWidth - 16 : point + 16))}px`,
    top: "8px",
  };
});

function dayLabel(day: string, long = false) {
  return new Date(day + "T00:00:00").toLocaleDateString(
    undefined,
    long
      ? { weekday: "short", month: "short", day: "numeric" }
      : { month: "short", day: "numeric" },
  );
}
function key(event: KeyboardEvent) {
  if (event.key === "Escape") return activate(null);
  if (!["Home", "End", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  activate(
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? values.value.length - 1
        : Math.max(
            0,
            Math.min(
              values.value.length - 1,
              (active.value ?? 0) + (event.key === "ArrowLeft" ? -1 : 1),
            ),
          ),
  );
}
let observer: MutationObserver | undefined;
onMounted(() => {
  theme.value = readAnalyticsTheme();
  observer = new MutationObserver(() => (theme.value = readAnalyticsTheme()));
  observer.observe(document.documentElement, { attributes: true });
});
onUnmounted(() => observer?.disconnect());
watch(
  () => [props.from, props.to, props.measure, props.daily],
  () => activate(null),
);
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
.chart-canvas {
  position: relative;
  min-width: 0;
  width: 100%;
  height: 300px;
}
.chart-canvas :deep(canvas) {
  max-width: 100%;
}
.chart-observations {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.chart-stage {
  position: relative;
}
.chart-tooltip {
  position: absolute;
  z-index: 2;
  min-width: 160px;
  padding: var(--space-4) var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-lg);
  font-size: var(--font-size-12);
  pointer-events: none;
}
.tooltip-day {
  display: block;
  margin-bottom: var(--space-2);
  color: var(--color-text-muted);
  font-weight: var(--font-weight-regular);
}
.chart-tooltip ul {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.chart-tooltip li,
.tooltip-total {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.tooltip-name {
  flex: 1;
  color: var(--color-text-muted);
}
.chart-tooltip b {
  color: var(--color-text);
  font-weight: var(--font-weight-bold);
}
.tooltip-total {
  justify-content: space-between;
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
  color: var(--color-text-muted);
}
.chart-tooltip i {
  width: 10px;
  height: 3px;
  border-radius: 2px;
}
.chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-8);
  margin-top: var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}
.chart-legend span {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
}
.chart-legend i {
  width: 8px;
  height: 8px;
  border-radius: 3px;
  flex-shrink: 0;
}
.chart-empty {
  min-height: 180px;
  display: grid;
  place-content: center;
  color: var(--color-text-muted);
}
</style>
