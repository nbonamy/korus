<template>
  <section class="usage-share" :aria-label="$t('analytics.share')">
    <header>
      <h3>{{ $t("analytics.share") }}</h3>
      <slot name="controls" />
    </header>
    <div class="share-content">
      <svg viewBox="0 0 160 160" role="img" :aria-label="$t('analytics.share')">
        <circle cx="80" cy="80" r="57" class="ring-track" />
        <circle
          v-for="slice in slices"
          :key="slice.key"
          cx="80"
          cy="80"
          r="57"
          fill="none"
          stroke-width="19"
          :stroke="slice.color"
          :stroke-dasharray="slice.length + ' ' + circumference"
          :stroke-dashoffset="-slice.offset"
          transform="rotate(-90 80 80)"
          tabindex="0"
          :aria-label="
            slice.label +
            ': ' +
            chartFormat(slice.value) +
            ' · ' +
            chartFormat(slice.percent) +
            '%'
          "
        >
          <title>{{ slice.label }} · {{ chartFormat(slice.percent) }}%</title>
        </circle>
        <text x="80" y="79" text-anchor="middle" class="ring-total">
          {{ total === null ? "—" : chartFormat(total, true) }}
        </text>
        <text x="80" y="99" text-anchor="middle" class="ring-unit">
          {{
            $t(
              measure === "turns"
                ? "analytics.turnsUnit"
                : "analytics.measuredTokens",
            )
          }}
        </text>
      </svg>
      <ul>
        <li v-for="row in series" :key="row.key">
          <i :style="{ background: row.color }" />
          <div>
            <strong>{{ row.label }}</strong
            ><span
              >{{ chartFormat(row.value) }} ·
              {{
                row.value === null || !total
                  ? $t("telemetry.unknown")
                  : chartFormat((100 * row.value) / total) + "%"
              }}</span
            >
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed } from "vue";
import {
  chartFormat,
  type UsageMeasure,
  type UsageSeries,
} from "./usage-chart";
const props = defineProps<{ series: UsageSeries[]; measure: UsageMeasure }>();
const circumference = 2 * Math.PI * 57;
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
.share-content {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  min-height: 220px;
}
svg {
  width: 49%;
  max-width: 230px;
  flex-shrink: 0;
}
.ring-track {
  fill: none;
  stroke: var(--color-surface-high);
  stroke-width: 19;
}
.ring-total {
  fill: var(--color-text);
  font-size: 22px;
  font-weight: 600;
}
.ring-unit {
  fill: var(--color-text-muted);
  font-size: 9px;
}
circle:focus {
  outline: none;
  stroke-width: 23px;
}
ul {
  list-style: none;
  padding: 0;
  margin: 0;
  min-width: 0;
  max-height: 250px;
  overflow: auto;
  flex: 1;
}
li {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
  padding: var(--space-4) 0;
  font-size: var(--font-size-12);
}
i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}
li div {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}
strong {
  font-weight: 500;
  overflow-wrap: anywhere;
}
li span {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
