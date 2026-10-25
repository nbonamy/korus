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
      <svg viewBox="0 0 160 160" role="img" :aria-label="$t('analytics.share')">
        <defs>
          <linearGradient
            v-for="(slice, index) in slices"
            :id="`${uid}-${index}`"
            :key="slice.key"
            x1="0"
            y1="0"
            x2="1"
            y2="1"
          >
            <stop offset="0" :style="{ stopColor: slice.color }" />
            <stop
              offset="1"
              :style="{ stopColor: slice.color, stopOpacity: 0.6 }"
            />
          </linearGradient>
        </defs>
        <circle cx="80" cy="80" :r="radius" class="ring-track" />
        <circle
          v-for="(slice, index) in slices"
          :key="slice.key"
          class="ring-slice"
          :class="{ dimmed: active !== null && active !== slice.key }"
          cx="80"
          cy="80"
          :r="radius"
          fill="none"
          :stroke-width="active === slice.key ? thickness + 3 : thickness"
          :stroke="`url(#${uid}-${index})`"
          :stroke-dasharray="
            Math.max(0.5, slice.length - gap) + ' ' + circumference
          "
          :stroke-dashoffset="-(slice.offset + gap / 2)"
          transform="rotate(-90 80 80)"
          tabindex="0"
          :aria-label="
            slice.label +
            ': ' +
            measureFormat(slice.value, measure) +
            ' · ' +
            chartFormat(slice.percent) +
            '%'
          "
          @pointerenter="active = slice.key"
          @pointerleave="active = null"
          @focus="active = slice.key"
          @blur="active = null"
        />
        <text
          x="80"
          y="80"
          text-anchor="middle"
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
        </text>
        <text x="80" y="99" text-anchor="middle" class="ring-unit">
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
        </text>
      </svg>
      <ul>
        <li
          v-for="row in series"
          :key="row.key"
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
import UsageCard from "./UsageCard.vue";
import { computed, ref, useId } from "vue";
import {
  chartFormat,
  measureFormat,
  type UsageMeasure,
  type UsageSeries,
} from "./usage-chart";
const props = defineProps<{
  series: UsageSeries[];
  measure: Exclude<UsageMeasure, "ratio">;
  subtitle?: string;
}>();
const uid = useId();
const radius = 58,
  thickness = 16,
  gap = 2;
const circumference = 2 * Math.PI * radius;
const active = ref<string | null>(null);
const total = computed(() =>
  props.series.some((row) => row.value !== null)
    ? props.series.reduce((n, row) => n + (row.value ?? 0), 0)
    : null,
);
const slices = computed(() => {
  let offset = 0;
  return props.series.flatMap((row) => {
    if (!total.value || row.value === null || row.value <= 0) return [];
    const length = (row.value / total.value) * circumference,
      slice = {
        ...row,
        percent: (100 * row.value) / total.value,
        length,
        offset,
      };
    offset += length;
    return [slice];
  });
});
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
svg {
  align-self: center;
  width: min(100%, 220px);
  overflow: visible;
}
.ring-track {
  fill: none;
  stroke: color-mix(in srgb, var(--color-text) 6%, transparent);
  stroke-width: 16;
}
.ring-slice {
  outline: none;
  cursor: default;
  transition:
    stroke-width 140ms ease,
    opacity 140ms ease;
}
.ring-slice.dimmed {
  opacity: 0.35;
}
.ring-total.ring-total--cost {
  font-size: var(--font-size-18);
}
.ring-total {
  fill: var(--color-text);
  font-size: 24px;
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.02em;
}
.ring-unit {
  fill: var(--color-text-muted);
  font-size: 9px;
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
