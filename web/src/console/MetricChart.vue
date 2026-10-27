<template>
  <section class="panel chart" :aria-label="title">
    <header class="panel-heading">
      <h2>{{ title }}</h2>
      <slot />
    </header>
    <p class="muted chart-description">{{ description }}</p>
    <ul class="legend" v-if="series.length > 1" aria-label="Series">
      <li v-for="(item, i) in series" :key="item.label">
        <i
          :style="{
            borderColor: color(i),
            borderStyle: i ? 'dashed' : 'solid',
          }"
        />{{ item.label }}
      </li>
    </ul>
    <div ref="stage" class="chart-stage">
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
        @pointermove="track"
        @pointerdown="track"
        @pointerleave="$event.pointerType !== 'touch' && (active = null)"
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
            <stop offset="0" :stop-color="color(i)" stop-opacity="0.18" />
            <stop offset="1" :stop-color="color(i)" stop-opacity="0" />
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
        <template v-for="(layer, i) in layers" :key="i">
          <g v-for="(run, j) in layer" :key="j">
            <path
              :d="`${line(run)} L${run.at(-1)!.x} ${baseline} L${run[0]!.x} ${baseline}Z`"
              :fill="`url(#${id}-${i})`"
            />
            <path
              class="chart-line"
              :d="line(run)"
              :stroke="color(i)"
              :stroke-dasharray="i ? '5 3' : undefined"
            />
          </g>
        </template>
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
              v-if="plotValue(item.values[active] ?? null) !== null"
              :cx="x(active)"
              :cy="y(plotValue(item.values[active]!)!)"
              r="3"
              :fill="color(i)"
            />
          </template>
        </g>
      </svg>
    </div>
    <output class="chart-inspection" role="status" aria-live="polite"
      ><template v-if="active !== null && days[active]"
        ><strong>{{ days[active] }} UTC</strong
        ><span v-for="item in series" :key="item.label"
          >{{ item.label }}:
          {{ measurement(item.values[active] ?? null, measure)
          }}<template v-if="notes?.[active]">
            · {{ notes[active] }}</template
          ></span
        ></template
      ><span v-else class="muted"
        >Hover, tap or use arrow keys to inspect.</span
      ></output
    >
    <p v-if="outsideRange" class="muted">
      Some values exceed chart precision. Exact values are in the data table.
    </p>
    <details @toggle="expanded = ($event.target as HTMLDetailsElement).open">
      <summary>View data</summary>
      <div
        v-if="expanded"
        class="table-scroll"
        tabindex="0"
        :aria-label="`${title} data`"
      >
        <table>
          <caption>
            {{
              title
            }}
            · UTC
          </caption>
          <thead>
            <tr>
              <th scope="col">
                {{
                  measure === "count" && title === "Weekly tokens"
                    ? "Week starting"
                    : "Day"
                }}
              </th>
              <th v-for="item in series" :key="item.label" scope="col">
                {{ item.label }}
              </th>
              <th v-if="notes" scope="col">Coverage</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(day, index) in days" :key="day">
              <th scope="row">{{ day }}</th>
              <td v-for="item in series" :key="item.label">
                {{ measurement(item.values[index] ?? null, measure) }}
              </td>
              <td v-if="notes">{{ notes[index] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { measurement, plotValue, type Measure } from "./format";
const props = defineProps<{
  title: string;
  description: string;
  days: string[];
  series: { label: string; values: (string | null)[] }[];
  measure: Measure;
  notes?: string[];
}>();
const id = useId(),
  stage = ref<HTMLElement | null>(null),
  width = ref(640),
  active = ref<number | null>(null),
  expanded = ref(false);
const height = 260,
  left = 72,
  right = 16,
  baseline = height - 32;
const color = (i: number) =>
  ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"][i % 3];
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
const max = computed(
  () =>
    Math.max(
      0,
      ...props.series.flatMap((s) => s.values.map((v) => plotValue(v) ?? 0)),
    ) || 1,
);
const x = (index: number) =>
  props.days.length < 2
    ? left + (width.value - left - right) / 2
    : left + (index * (width.value - left - right)) / (props.days.length - 1);
const y = (value: number) => baseline - (value / max.value) * (baseline - 16);
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
const outsideRange = computed(() =>
  props.series.some((item) =>
    item.values.some((value) => value !== null && plotValue(value) === null),
  ),
);
function axis(value: number) {
  if (props.measure === "ratio")
    return new Intl.NumberFormat("en-US", {
      style: "percent",
      maximumSignificantDigits: 3,
    }).format(value);
  const formatted = new Intl.NumberFormat("en-US", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumSignificantDigits: 3,
  }).format(value);
  return props.measure === "usd" ? `$${formatted}` : formatted;
}
function key(event: KeyboardEvent) {
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
      Math.round(
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
