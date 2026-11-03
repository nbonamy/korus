<template>
  <section class="panel chart" :aria-label="title">
    <header class="panel-heading">
      <div class="chart-heading">
        <h2>{{ title }}</h2>
        <p v-if="subtitle">{{ subtitle }}</p>
      </div>
      <slot />
    </header>
    <div ref="stage" class="chart-stage">
      <div class="chart-canvas">
        <VueChart
          :key="configuration.type"
          ref="chart"
          :type="configuration.type"
          :data="chartData"
          :options="chartOptions"
          :plugins="configuration.plugins"
          role="img"
          :aria-label="`${title}. Left and right arrows inspect dates; Home and End jump to the edges.`"
          tabindex="0"
          @keydown="key"
          @focus="activate(active ?? 0)"
          @blur="activate(null)"
        />
      </div>
      <div class="chart-observations" aria-label="Chart observations">
        <template v-for="(day, index) in days" :key="day"
          ><template v-for="item in series" :key="item.label">
            <button
              v-if="
                item.values[index] != null && item.observed?.[index] !== false
              "
              class="chart-observation"
              tabindex="-1"
              :aria-label="`${day} · ${item.label}: ${measurement(item.values[index]!, measure)}`"
              @focus="activate(index)"
              @blur="activate(null)"
            /> </template
        ></template>
      </div>
      <output
        v-if="active !== null && days[active]"
        class="chart-tooltip"
        role="status"
        aria-live="polite"
        :style="tooltipStyle"
        @pointermove.stop
        @pointerdown.stop
      >
        <strong class="tooltip-day" :title="days[active]">{{
          tooltipDay
        }}</strong>
        <ul>
          <li v-for="item in tooltipRows" :key="item.label">
            <i :style="{ background: item.color }" aria-hidden="true" />
            <span class="tooltip-name" :title="item.label">{{
              item.label
            }}</span>
            <b :title="exactMeasurement(item.value, measure)">{{
              measurement(item.value, measure)
            }}</b>
          </li>
        </ul>
        <p v-if="!tooltipRows.length">Unavailable</p>
        <div v-if="tooltipTotal !== null" class="tooltip-total">
          <span>{{ totalLabel ?? "Total" }}</span
          ><b :title="exactMeasurement(tooltipTotal, measure)">{{
            measurement(tooltipTotal, measure)
          }}</b>
        </div>
      </output>
    </div>
    <ul
      class="legend"
      v-if="!hideLegend && legendItems.length > 1"
      aria-label="Series"
    >
      <li v-for="item in legendItems" :key="item.label">
        <i
          :style="{
            background: item.color,
          }"
        />{{ item.label }}
      </li>
    </ul>
    <p v-if="outsideRange" class="muted">
      Chart limit exceeded. Inspect exact values.
    </p>
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
import {
  buildAnalyticsChart,
  analyticsDay,
} from "@workspace/core/analytics-chart";
import { measurement, exactMeasurement, type Measure } from "./format";
import { addAmounts } from "./report-data";
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
  title: string;
  subtitle?: string;
  days: string[];
  series: {
    label: string;
    values: (string | null)[];
    color?: string;
    dash?: string;
    order?: number;
    /** False for zeroes supplied only to keep the plotted stack continuous. */
    observed?: boolean[];
    /** True for bars still accumulating (today); drawn hatched in bar charts. */
    partial?: boolean[];
  }[];
  dayLabels?: Record<string, string>;
  variant?: "line" | "bar" | "stacked";
  stacked?: boolean;
  measure: Measure;
  area?: "gradient" | "solid" | "none";
  totalLabel?: string;
  hideLegend?: boolean;
}>();
const stage = ref<HTMLElement | null>(null),
  chart = ref<{ chart: ChartJS | null } | null>(null),
  active = ref<number | null>(null),
  theme = ref(readAnalyticsTheme());
const color = (index: number) =>
  props.series[index]?.color ?? `var(--chart-${(index % 8) + 1})`;
const legendItems = computed(() =>
  props.series.flatMap((row, index) =>
    row.values.some(
      (value, day) => value != null && row.observed?.[day] !== false,
    )
      ? [{ label: row.label, color: color(index) }]
      : [],
  ),
);
const interaction = {
  index: null as number | null,
  renderedWidth: () =>
    chart.value?.chart?.canvas.getBoundingClientRect().width ?? 0,
};
const configuration = computed(() =>
  buildAnalyticsChart(
    {
      days: props.days,
      series: props.series.map((row, index) => ({
        ...row,
        color: color(index),
      })),
      measure: props.measure,
      variant: props.variant,
      stacked: props.stacked,
      legend: false,
      area: props.area,
      dayLabels: props.dayLabels,
    },
    theme.value,
    (index) => (active.value = index),
    interaction,
  ),
);
const outsideRange = computed(() => configuration.value.unsupported);
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
const tooltipDay = computed(() =>
  active.value === null || !props.days[active.value]
    ? ""
    : analyticsDay(props.days[active.value]!, true),
);
const tooltipRows = computed(() =>
  props.series
    .map((row, index) => ({
      label: row.label,
      color: color(index),
      value: active.value === null ? null : (row.values[active.value] ?? null),
      observed: active.value !== null && row.observed?.[active.value] !== false,
    }))
    .filter((row) => row.value !== null && row.observed)
    .sort((a, b) =>
      props.measure === "milliseconds"
        ? Number(a.value) - Number(b.value)
        : Number(b.value) - Number(a.value),
    ),
);
const tooltipTotal = computed(() => {
  if (
    !(props.totalLabel || props.stacked || props.variant === "stacked") ||
    props.series.length < 2 ||
    !["count", "tokens", "usd"].includes(props.measure)
  )
    return null;
  return addAmounts(tooltipRows.value.map((row) => row.value));
});
const tooltipStyle = computed(() => {
  const width = chart.value?.chart?.width ?? 640,
    popupWidth = Math.min(480, width - 16),
    point =
      chart.value?.chart?.scales.x?.getPixelForValue(active.value ?? 0) ?? 16;
  return {
    maxWidth: `${popupWidth}px`,
    width: "max-content",
    left: `${Math.max(8, Math.min(width - popupWidth - 8, point > width * 0.6 ? point - popupWidth - 16 : point + 16))}px`,
    top: "8px",
  };
});
function key(event: KeyboardEvent) {
  if (event.key === "Escape") return activate(null);
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  activate(
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? props.days.length - 1
        : Math.max(
            0,
            Math.min(
              props.days.length - 1,
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
  () => props.days,
  () => activate(null),
);
</script>
<style scoped>
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
</style>
