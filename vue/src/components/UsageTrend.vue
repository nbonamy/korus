<template>
  <section class="usage-trend" :aria-label="$t('analytics.trend')">
    <header>
      <h3>{{ $t("analytics.trend") }}</h3>
      <slot name="controls" />
    </header>
    <p v-if="!observed" class="chart-empty">
      {{ $t("telemetry.unknown") }}
    </p>
    <svg
      v-else
      viewBox="0 0 640 255"
      role="img"
      :aria-label="$t('analytics.trend')"
    >
      <g v-for="step in [0, 1, 2, 3, 4]" :key="step" class="gridline">
        <line x1="42" :y1="215 - step * 47" x2="630" :y2="215 - step * 47" />
        <text x="34" :y="219 - step * 47" text-anchor="end">
          {{ chartFormat((maximum * step) / 4, true) }}
        </text>
      </g>
      <g v-for="point in points" :key="point.day">
        <rect
          v-for="segment in point.segments"
          :key="segment.key"
          :x="point.x"
          :y="215 - (segment.top * 188) / maximum"
          :width="barWidth"
          :height="(segment.value * 188) / maximum"
          :fill="segment.color"
          tabindex="0"
          :aria-label="
            point.day +
            ' · ' +
            segment.label +
            ': ' +
            chartFormat(segment.value)
          "
        >
          <title>
            {{ point.day }} · {{ segment.label }}:
            {{ chartFormat(segment.value) }}
          </title>
        </rect>
        <text
          v-if="point.tick"
          :x="point.x + barWidth / 2"
          y="242"
          text-anchor="middle"
        >
          {{ point.day.slice(5) }}
        </text>
      </g>
    </svg>
    <div class="chart-legend">
      <span v-for="item in series" :key="item.key"
        ><i :style="{ background: item.color }" />{{ item.label }}</span
      >
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed } from "vue";
import type { UsageSummary } from "@workspace/core/usage";
import {
  chartValue,
  chartFormat,
  type UsageMeasure,
  type UsageSeries,
} from "./usage-chart";
const props = defineProps<{
  daily: NonNullable<UsageSummary["daily"]>;
  series: UsageSeries[];
  measure: UsageMeasure;
  from: string;
  to: string;
}>();
const observed = computed(() =>
  props.daily.some((row) =>
    row.groups?.some(
      (group) =>
        props.series.some((series) => series.key === group.label) &&
        chartValue(group, props.measure) !== null,
    ),
  ),
);
const values = computed(() => {
  const days = new Map(props.daily.map((row) => [row.day, row]));
  const rows = [];
  for (
    let at = Date.parse(props.from);
    at <= Date.parse(props.to) && rows.length < 90;
    at += 86400000
  ) {
    const day = new Date(at).toISOString().slice(0, 10),
      row = days.get(day);
    let top = 0;
    const segments = props.series.flatMap((series) => {
      const group = row?.groups?.find((group) => group.label === series.key);
      const value = group ? chartValue(group, props.measure) : null;
      if (value == null || value === 0) return [];
      top += value;
      return [{ ...series, value, top }];
    });
    rows.push({ day, segments, total: top });
  }
  return rows;
});
const maximum = computed(() =>
  Math.max(1, ...values.value.map((row) => row.total)),
);
const barWidth = computed(() =>
  Math.max(1, (588 / Math.max(1, values.value.length)) * 0.68),
);
const points = computed(() =>
  values.value.map((row, index) => ({
    ...row,
    x:
      42 +
      (index * 588) / values.value.length +
      (588 / values.value.length - barWidth.value) / 2,
    tick:
      index === 0 ||
      index === values.value.length - 1 ||
      index % Math.max(1, Math.ceil(values.value.length / 7)) === 0,
  })),
);
</script>
<style scoped>
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
  margin-bottom: var(--space-8);
}
h3 {
  margin: 0;
  font-size: var(--font-size-14);
  font-weight: 600;
}
svg {
  display: block;
  width: 100%;
}
.gridline line {
  stroke: var(--color-border);
  stroke-dasharray: 3 4;
}
text {
  fill: var(--color-text-muted);
  font-size: 11px;
}
rect {
  opacity: 0.9;
}
rect:focus {
  opacity: 1;
  outline: 2px solid var(--color-text);
}
.chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4) var(--space-8);
  margin-top: var(--space-6);
  font-size: var(--font-size-12);
}
.chart-legend span {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}
.chart-empty {
  min-height: 180px;
  display: grid;
  place-content: center;
  color: var(--color-text-muted);
}
</style>
