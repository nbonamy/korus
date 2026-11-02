<template>
  <section class="panel chart" :aria-label="title">
    <header class="panel-heading">
      <h2>{{ title }}</h2>
      <slot />
    </header>
    <ul class="legend" v-if="series.length > 1" aria-label="Series">
      <li v-for="(item, i) in series" :key="item.label">
        <i
          :style="{
            borderColor: color(i),
            borderStyle: item.dash ? 'dashed' : 'solid',
          }"
        />{{ item.label }}
      </li>
    </ul>
    <div
      ref="stage"
      class="chart-stage"
      @pointermove="track"
      @pointerdown="track"
      @pointerleave="$event.pointerType !== 'touch' && (active = null)"
    >
      <svg
        :viewBox="`0 0 ${width} ${height}`"
        :width="width"
        :height="height"
        role="img"
        :aria-label="`${title}. Left and right arrows inspect dates; Home and End jump to the edges.`"
        tabindex="0"
        @keydown="key"
        @focus="active ??= 0"
        @blur="active = null"
      >
        <defs>
          <linearGradient
            v-for="(_, i) in series"
            :id="`${id}-${i}`"
            :key="i"
            x1="0"
            x2="0"
            y1="0"
            y2="1"
          >
            <stop
              offset="0"
              :stop-color="color(i)"
              :stop-opacity="variant && variant !== 'line' ? 0.9 : 0.18"
            />
            <stop
              offset="1"
              :stop-color="color(i)"
              :stop-opacity="variant && variant !== 'line' ? 0.35 : 0"
            />
          </linearGradient>
        </defs>
        <g v-for="ratio in [0, 0.25, 0.5, 0.75, 1]" :key="ratio" class="grid">
          <line
            :x1="left"
            :x2="width - right"
            :y1="y(max * ratio)"
            :y2="y(max * ratio)"
          />
          <text :x="left - 9" :y="y(max * ratio) + 4" text-anchor="end">
            {{ axis(max * ratio) }}
          </text>
        </g>
        <template
          v-if="!variant || variant === 'line'"
          v-for="(layer, i) in layers"
          :key="i"
        >
          <g v-for="(run, j) in layer" :key="j">
            <path
              :d="`${line(run)} L${run.at(-1)!.x} ${baseline} L${run[0]!.x} ${baseline}Z`"
              :fill="`url(#${id}-${i})`"
            />
            <path
              class="chart-line"
              :d="line(run)"
              :stroke="color(i)"
              :stroke-dasharray="series[i]?.dash"
            />
          </g>
        </template>
        <g v-if="variant === 'bar' || variant === 'stacked'">
          <rect
            v-for="(bar, index) in bars"
            :key="index"
            :x="bar.x"
            :y="bar.y"
            :width="bar.width"
            :height="bar.height"
            :fill="`url(#${id}-${bar.series})`"
          >
            <title>
              {{ days[bar.day] }} · {{ series[bar.series]!.label }}:
              {{
                exactMeasurement(
                  series[bar.series]!.values[bar.day] ?? null,
                  measure,
                )
              }}
            </title>
          </rect>
        </g>
        <g v-for="index in ticks" :key="index" class="date-label">
          <text
            :x="x(index)"
            :y="height - 8"
            :text-anchor="
              index === 0
                ? 'start'
                : index === days.length - 1
                  ? 'end'
                  : 'middle'
            "
          >
            {{ days[index] }}
          </text>
        </g>
        <g v-if="active !== null && days[active]">
          <line
            class="crosshair"
            :x1="x(active)"
            :x2="x(active)"
            y1="16"
            :y2="baseline"
          />
          <template v-for="(item, i) in series" :key="i">
            <circle
              v-if="
                (!variant || variant === 'line') &&
                plotValue(item.values[active] ?? null) !== null
              "
              :cx="x(active)"
              :cy="y(plotValue(item.values[active]!)!)"
              r="3"
              :fill="color(i)"
            />
          </template>
        </g>
      </svg>
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
            <span class="tooltip-name">{{ item.label }}</span>
            <b :title="exactMeasurement(item.value, measure)">{{
              measurement(item.value, measure)
            }}</b>
          </li>
        </ul>
        <div v-if="tooltipTotal !== null" class="tooltip-total">
          <span>{{ totalLabel ?? "Total" }}</span
          ><b :title="count(tooltipTotal)">{{
            measurement(tooltipTotal, measure)
          }}</b>
        </div>
      </output>
    </div>
    <p v-if="outsideRange" class="muted">
      Chart limit exceeded. Inspect exact values.
    </p>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, useId, watch, onMounted, onUnmounted } from "vue";
import {
  count,
  measurement,
  exactMeasurement,
  tokens,
  rate,
  duration,
  money,
  percent,
  plotValue,
  type Measure,
} from "./format";
const props = defineProps<{
  title: string;
  days: string[];
  series: {
    label: string;
    values: (string | null)[];
    color?: string;
    dash?: string;
  }[];
  variant?: "line" | "bar" | "stacked";
  measure: Measure;
  totalLabel?: string;
}>();
const id = useId(),
  stage = ref<HTMLElement | null>(null),
  width = ref(640),
  active = ref<number | null>(null);
const height = 220,
  left = 72,
  right = 16,
  baseline = height - 32;
const color = (i: number) =>
  props.series[i]?.color ?? `var(--chart-${(i % 8) + 1})`;
watch(
  stage,
  (element, _, cleanup) => {
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 180)
        width.value = entry.contentRect.width;
    });
    observer.observe(element);
    cleanup(() => observer.disconnect());
  },
  { flush: "post" },
);
const sums = computed(() =>
  props.days.map((_, index) =>
    props.series.reduce(
      (sum, item) => sum + (plotValue(item.values[index] ?? null) ?? 0),
      0,
    ),
  ),
);
const max = computed(
  () =>
    (props.variant === "stacked"
      ? sums.value.filter((v) => v <= Number.MAX_SAFE_INTEGER)
      : props.series.flatMap((s) => s.values.map((v) => plotValue(v) ?? 0))
    ).reduce((max, value) => Math.max(max, value), 0) || 1,
);
const band = computed(
  () => (width.value - left - right) / Math.max(props.days.length, 1),
);
const x = (index: number) =>
  props.variant && props.variant !== "line"
    ? left + band.value * (index + 0.5)
    : props.days.length < 2
      ? left + (width.value - left - right) / 2
      : left + (index * (width.value - left - right)) / (props.days.length - 1);
const y = (value: number) => baseline - (value / max.value) * (baseline - 16);
const bars = computed(() =>
  props.days.flatMap((_, day) => {
    let base = 0;
    if (
      props.variant === "stacked" &&
      sums.value[day]! > Number.MAX_SAFE_INTEGER
    )
      return [];
    return props.series.flatMap((item, series) => {
      const value = plotValue(item.values[day] ?? null);
      if (value === null) return [];
      const stacked = props.variant === "stacked";
      const width = Math.max(
        0.1,
        (band.value * 0.75) / (stacked ? 1 : Math.max(props.series.length, 1)),
      );
      const bottom = stacked ? base : 0;
      base += value;
      return [
        {
          day,
          series,
          x: x(day) - band.value * 0.375 + (stacked ? 0 : series * width),
          y: y(bottom + value),
          width,
          height: y(bottom) - y(bottom + value),
        },
      ];
    });
  }),
);
const tooltipStyle = computed(() => {
  const popupWidth = Math.min(340, width.value - 16),
    point = x(active.value ?? 0);
  return {
    width: `${popupWidth}px`,
    left: `${Math.max(8, Math.min(width.value - popupWidth - 8, point > width.value * 0.6 ? point - popupWidth - 16 : point + 16))}px`,
    top: "8px",
  };
});
const tooltipDay = computed(() =>
  active.value === null || !props.days[active.value]
    ? ""
    : new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${props.days[active.value]}T00:00:00Z`)),
);
const tooltipRows = computed(() =>
  props.series
    .map((item, index) => ({
      label: item.label,
      color: color(index),
      value: active.value === null ? null : (item.values[active.value] ?? null),
    }))
    .sort((a, b) =>
      a.value === null
        ? b.value === null
          ? 0
          : 1
        : b.value === null
          ? -1
          : props.measure === "milliseconds"
            ? Number(a.value) - Number(b.value)
            : Number(b.value) - Number(a.value),
    ),
);
const tooltipTotal = computed(() => {
  if (
    !(props.totalLabel || props.variant === "stacked") ||
    props.series.length < 2 ||
    !["count", "tokens"].includes(props.measure)
  )
    return null;
  const known = tooltipRows.value.filter(
    (row) => row.value !== null && /^\d+$/.test(row.value),
  );
  return known.length
    ? known.reduce((total, row) => total + BigInt(row.value!), 0n).toString()
    : null;
});
function dismissOutside(event: PointerEvent) {
  if (event.target instanceof Node && !stage.value?.contains(event.target))
    active.value = null;
}
onMounted(() => document.addEventListener("pointerdown", dismissOutside));
onUnmounted(() => document.removeEventListener("pointerdown", dismissOutside));
type Point = { x: number; y: number };
const layers = computed(() =>
  props.series.map((item) => {
    const runs: Point[][] = [];
    item.values.forEach((value, index) => {
      const n = plotValue(value);
      if (n === null) return;
      if (!index || plotValue(item.values[index - 1]!) === null) runs.push([]);
      runs.at(-1)!.push({ x: x(index), y: y(n) });
    });
    return runs.map((run) =>
      run.length === 1
        ? [
            { x: run[0]!.x - 3, y: run[0]!.y },
            { x: run[0]!.x + 3, y: run[0]!.y },
          ]
        : run,
    );
  }),
);
// Each cubic's controls stay inside its endpoint rectangle. Curves cannot
// overshoot below zero or bridge a missing day; isolated measurements stay visible.
function line(points: Point[]) {
  let path = `M${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!,
      d = (b.x - a.x) / 3;
    path += `C${a.x + d} ${a.y} ${b.x - d} ${b.y} ${b.x} ${b.y}`;
  }
  return path;
}
const ticks = computed(() =>
  props.days.length < 2
    ? [0]
    : [
        ...new Set([
          0,
          ...(width.value > 600
            ? [Math.floor((props.days.length - 1) / 2)]
            : []),
          props.days.length - 1,
        ]),
      ],
);
const outsideRange = computed(
  () =>
    (props.variant === "stacked" &&
      sums.value.some((v) => v > Number.MAX_SAFE_INTEGER)) ||
    props.series.some((item) =>
      item.values.some((value) => value !== null && plotValue(value) === null),
    ),
);
function axis(value: number) {
  if (props.measure === "rate") return rate(String(value));
  if (props.measure === "milliseconds") return duration(String(value));
  if (props.measure === "ratio") return percent(value);
  if (props.measure === "usd") return money(value.toFixed(2));
  if (props.measure === "tokens") return tokens(String(Math.round(value)));
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumSignificantDigits: 3,
  }).format(value);
}
function key(event: KeyboardEvent) {
  if (event.key === "Escape") {
    active.value = null;
    return;
  }
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  active.value =
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
          );
}
function track(event: PointerEvent) {
  const box = (event.currentTarget as SVGElement).getBoundingClientRect();
  active.value = Math.max(
    0,
    Math.min(
      props.days.length - 1,
      props.variant && props.variant !== "line"
        ? Math.floor(
            (((event.clientX - box.left) * width.value) / box.width - left) /
              band.value,
          )
        : Math.round(
            ((((event.clientX - box.left) * width.value) / box.width - left) /
              (width.value - left - right)) *
              (props.days.length - 1),
          ),
    ),
  );
}
watch(
  () => props.days,
  () => (active.value = null),
);
</script>
