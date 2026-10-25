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
      <svg
        :viewBox="`0 0 ${width} ${height}`"
        :width="width"
        :height="height"
        role="img"
        :aria-label="title"
        @pointermove="track"
        @pointerleave="active = null"
      >
        <defs v-if="!isSpeed">
          <linearGradient
            v-for="layer in layers"
            :id="gradientId(layer.series.key)"
            :key="layer.series.key"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop
              offset="0"
              :style="{ stopColor: layer.series.color, stopOpacity: 0.92 }"
            />
            <stop
              offset="1"
              :style="{ stopColor: layer.series.color, stopOpacity: 0.28 }"
            />
          </linearGradient>
        </defs>
        <g v-for="tick in ticks" :key="tick.value" class="gridline">
          <line :x1="left" :y1="tick.y" :x2="width - right" :y2="tick.y" />
          <text :x="left - 10" :y="tick.y + 4" text-anchor="end">
            {{
              measure === "cost"
                ? usdFormat(tick.value)
                : chartFormat(tick.value, true)
            }}
          </text>
        </g>
        <g class="layers">
          <template v-if="!isSpeed">
            <path
              v-for="layer in layers"
              :key="layer.series.key"
              class="layer"
              :class="{ dimmed: hovered && !layer.vals[hovered.index] }"
              :d="layer.area"
              :fill="`url(#${gradientId(layer.series.key)})`"
            />
          </template>
          <path
            v-for="layer in layers"
            :key="'edge-' + layer.series.key"
            class="edge"
            :d="layer.edge"
            :stroke="layer.series.color"
          />
        </g>
        <line
          v-if="hovered"
          class="crosshair"
          :x1="hovered.x"
          :x2="hovered.x"
          :y1="top"
          :y2="baseline"
        />
        <template v-for="layer in layers" :key="'dots-' + layer.series.key">
          <template v-for="point in points" :key="point.day">
            <circle
              v-if="
                measure === 'cost'
                  ? layer.vals[point.index] != null
                  : layer.vals[point.index]
              "
              class="marker"
              :class="{
                visible:
                  isSpeed || measure === 'cost' || active === point.index,
              }"
              :cx="point.x"
              :cy="yOf(layer.upper[point.index]!)"
              r="4.5"
              :style="{ fill: layer.series.color }"
              tabindex="0"
              :aria-label="
                point.day +
                ' · ' +
                layer.series.label +
                ': ' +
                metricFormat(layer.vals[point.index]!)
              "
              @focus="active = point.index"
              @blur="active = null"
            />
          </template>
        </template>
        <text
          v-for="point in points.filter((p) => p.tick)"
          :key="point.day"
          class="axis-label"
          :x="point.x"
          :y="height - 6"
          :text-anchor="
            point.index === 0
              ? 'start'
              : point.index === points.length - 1
                ? 'end'
                : 'middle'
          "
        >
          {{ dayLabel(point.day) }}
        </text>
      </svg>
      <div
        v-if="hovered"
        class="chart-tooltip"
        :style="tooltipStyle"
        aria-hidden="true"
      >
        <strong class="tooltip-day">{{ dayLabel(hovered.day, true) }}</strong>
        <ul>
          <li
            v-for="segment in [...hovered.segments].reverse()"
            :key="segment.key"
          >
            <i :style="{ background: segment.color }" />
            <span class="tooltip-name">{{ segment.label }}</span>
            <b>{{ metricFormat(segment.value) }}</b>
          </li>
        </ul>
        <p v-if="isSpeed && !hovered.segments.length">
          {{ $t("analytics.notAvailable") }}
        </p>
        <div
          v-if="!isSpeed && hovered.segments.length > 1"
          class="tooltip-total"
        >
          <span>{{ $t("analytics.total") }}</span>
          <b>{{ metricFormat(hovered.total) }}</b>
        </div>
        <UsageCostCoverage v-if="measure === 'cost'" :cost="hovered.cost" />
      </div>
    </div>
    <div v-if="series.length > 1" class="chart-legend">
      <span v-for="item in series" :key="item.key"
        ><i :style="{ background: item.color }" />{{ item.label }}</span
      >
    </div>
  </section>
</template>
<script setup lang="ts">
import UsageCostCoverage from "./UsageCostCoverage.vue";
import { computed, ref, useId, watch } from "vue";
import type { UsageSummary } from "@workspace/core/usage";
import { translate } from "../i18n";
import {
  chartValue,
  chartFormat,
  usdFormat,
  niceScale,
  smoothPath,
  tokensPerSecond,
  type UsageMeasure,
  type UsageSeries,
} from "./usage-chart";
const props = defineProps<{
  daily: NonNullable<UsageSummary["daily"]>;
  series: UsageSeries[];
  measure: UsageMeasure | "speed";
  from: string;
  to: string;
  subtitle?: string;
}>();
const isSpeed = computed(() => props.measure === "speed");
const title = computed(() =>
  translate(isSpeed.value ? "analytics.speedTrend" : "analytics.trend"),
);
type DailyGroup = NonNullable<
  NonNullable<UsageSummary["daily"]>[number]["groups"]
>[number];
const valueOf = (group: DailyGroup) =>
  props.measure === "speed"
    ? tokensPerSecond(group.speed)
    : chartValue(group, props.measure);
const metricFormat = (value: number | null) =>
  isSpeed.value
    ? `${chartFormat(value, true)} ${translate("analytics.tokensPerSecond")}`
    : props.measure === "cost"
      ? usdFormat(value)
      : chartFormat(value, true);
const uid = useId();
const gradientId = (key: string) =>
  `${uid}-${props.series.findIndex((item) => item.key === key)}`;
const left = computed(() => (props.measure === "cost" ? 88 : 44)),
  right = 8,
  top = 16,
  height = 300,
  baseline = height - 28;
const stage = ref<HTMLElement | null>(null);
const width = ref(640);
const active = ref<number | null>(null);
watch(
  stage,
  (element, _previous, onCleanup) => {
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.floor(entry?.contentRect.width ?? 0);
      if (next > 200) width.value = next;
    });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  },
  { flush: "post" },
);
const observed = computed(() =>
  props.daily.some((row) =>
    row.groups?.some(
      (group) =>
        props.series.some((series) => series.key === group.label) &&
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
      const group = row?.groups?.find((group) => group.label === series.key);
      const value = group ? valueOf(group) : null;
      if (props.measure !== "cost" && (value == null || value === 0)) return [];
      top = isSpeed.value ? Math.max(top, value ?? 0) : top + (value ?? 0);
      return [{ ...series, value, top }];
    });
    rows.push({
      day,
      segments,
      total: props.measure === "cost" ? (row?.cost?.usd ?? null) : top,
      cost: row?.cost,
    });
  }
  return rows;
});
const scale = computed(() =>
  niceScale(
    Math.max(
      props.measure === "cost" ? 0 : 1,
      ...values.value.map((row) => row.total ?? 0),
    ) || 1,
    4,
    props.measure === "cost",
  ),
);
const maximum = computed(() => scale.value.max);
const yOf = (value: number) =>
  baseline - (value * (baseline - top)) / maximum.value;
const ticks = computed(() =>
  [0, 1, 2, 3, 4].map((step) => ({
    value: step * scale.value.step,
    y: yOf(step * scale.value.step),
  })),
);
const xOf = (index: number) => {
  const span = width.value - left.value - right,
    count = values.value.length;
  return count < 2
    ? left.value + span / 2
    : left.value + (index * span) / (count - 1);
};
const points = computed(() =>
  values.value.map((row, index) => ({
    ...row,
    index,
    x: xOf(index),
    tick:
      index === 0 ||
      index === values.value.length - 1 ||
      index % Math.max(1, Math.ceil(values.value.length / 7)) === 0,
  })),
);
const layers = computed(() => {
  const base = values.value.map(() => 0);
  // A lone day has no line to draw, so it is widened into a short plateau.
  const spread = (ys: number[]) =>
    ys.length === 1
      ? [
          { x: xOf(0) - 16, y: ys[0]! },
          { x: xOf(0) + 16, y: ys[0]! },
        ]
      : ys.map((y, index) => ({ x: xOf(index), y }));
  return props.series.flatMap((series) => {
    const vals = values.value.map(
      (row) =>
        row.segments.find((segment) => segment.key === series.key)?.value ??
        (props.measure === "cost" ? null : 0),
    );
    if (
      !vals.some(
        (value) => value !== null && (props.measure === "cost" || value > 0),
      )
    )
      return [];
    if (props.measure === "cost") {
      const lower = [...base];
      vals.forEach((value, index) => (base[index]! += value ?? 0));
      const upper = [...base];
      const runs: number[][] = [];
      vals.forEach((value, index) => {
        if (value === null) return;
        if (index === 0 || vals[index - 1] === null) runs.push([]);
        runs.at(-1)!.push(index);
      });
      const runPoints = (run: number[], ys: number[]) =>
        run.length === 1
          ? [
              { x: xOf(run[0]!) - 4, y: yOf(ys[run[0]!]!) },
              { x: xOf(run[0]!) + 4, y: yOf(ys[run[0]!]!) },
            ]
          : run.map((index) => ({ x: xOf(index), y: yOf(ys[index]!) }));
      return [
        {
          series,
          vals,
          upper,
          edge: runs
            .map((run) =>
              smoothPath(
                run.map((index) => ({ x: xOf(index), y: yOf(upper[index]!) })),
              ),
            )
            .join(""),
          area: runs
            .map(
              (run) =>
                smoothPath(runPoints(run, upper)) +
                smoothPath(runPoints(run, lower).reverse(), false) +
                "Z",
            )
            .join(""),
        },
      ];
    }
    if (isSpeed.value) {
      // Missing timing is a gap, not a zero-rate observation.
      const runs: { x: number; y: number }[][] = [];
      vals.forEach((value, index) => {
        if (!value) return;
        if (index === 0 || !vals[index - 1]) runs.push([]);
        runs.at(-1)!.push({ x: xOf(index), y: yOf(value) });
      });
      return [
        {
          series,
          vals,
          upper: vals,
          edge: runs.map((run) => smoothPath(run)).join(""),
          area: "",
        },
      ];
    }
    const lower = [...base];
    vals.forEach((value, index) => (base[index]! += value ?? 0));
    const upper = [...base];
    const upperPoints = spread(upper.map(yOf)),
      lowerPoints = spread(lower.map(yOf));
    const edge = smoothPath(upperPoints);
    return [
      {
        series,
        vals,
        upper,
        edge,
        area: edge + smoothPath([...lowerPoints].reverse(), false) + "Z",
      },
    ];
  });
});
const hovered = computed(() =>
  active.value === null ? null : (points.value[active.value] ?? null),
);
const tooltipStyle = computed(() => {
  const point = hovered.value;
  if (!point) return {};
  return point.x > width.value * 0.6
    ? { right: `${width.value - point.x + 16}px`, top: "8px" }
    : { left: `${point.x + 16}px`, top: "8px" };
});
function track(event: PointerEvent) {
  const box = (event.currentTarget as SVGElement).getBoundingClientRect();
  const count = values.value.length;
  const span = width.value - left.value - right;
  const index = Math.round(
    ((event.clientX - box.left - left.value) / span) * (count - 1),
  );
  active.value =
    count === 1
      ? 0
      : Math.max(0, Math.min(count - 1, Number.isFinite(index) ? index : 0));
}
function dayLabel(day: string, long = false) {
  return new Date(day + "T00:00:00").toLocaleDateString(
    undefined,
    long
      ? { weekday: "short", month: "short", day: "numeric" }
      : { month: "short", day: "numeric" },
  );
}
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
.chart-stage {
  position: relative;
}
svg {
  display: block;
  overflow: visible;
}
.gridline line {
  stroke: color-mix(in srgb, var(--color-border) 65%, transparent);
  stroke-width: 1;
}
text {
  fill: var(--color-text-muted);
  font-size: 11px;
}
.layer {
  stroke: var(--color-surface-lowest);
  stroke-width: 1.5;
  stroke-linejoin: round;
  transition: opacity 140ms ease;
}
.layer.dimmed {
  opacity: 0.55;
}
.edge {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
}
.crosshair {
  stroke: color-mix(in srgb, var(--color-text) 28%, transparent);
  stroke-width: 1;
  pointer-events: none;
}
.marker {
  stroke: var(--color-surface-lowest);
  stroke-width: 2;
  opacity: 0;
  outline: none;
  pointer-events: none;
}
.marker.visible {
  opacity: 1;
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
