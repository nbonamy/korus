<template>
  <UsageTileGrid
    style="--usage-tile-columns: 2"
    :aria-label="$t('analytics.totals')"
  >
    <UsageStatTile
      :label="$t('analytics.timeToFirstToken')"
      :value="
        ttft === null
          ? $t('analytics.notAvailable')
          : chartFormat(ttft, true)
      "
      :unit="ttft === null ? undefined : $t('analytics.secondsUnit')"
    />
    <UsageStatTile
      :label="$t('analytics.tokenSpeed')"
      :value="performanceValue(speed)"
      :unit="speed === null ? undefined : $t('analytics.tokensPerSecond')"
    />
  </UsageTileGrid>
  <UsageCard>
    <UsageTrend
      :daily="summary.daily ?? []"
      :series="speedSeries"
      measure="speed"
      :from="from"
      :to="to"
      :subtitle="$t('analytics.tokensPerSecond')"
    />
  </UsageCard>
  <div class="performance-grid">
    <UsageCard
      as="section"
      class="behavior-card"
      :aria-label="$t('analytics.timeToFirstToken')"
    >
      <header>
        <h3>{{ $t("analytics.timeToFirstToken") }}</h3>
      </header>
      <table>
        <thead>
          <tr>
            <th>{{ $t("analytics.model") }}</th>
            <th class="num">{{ $t("analytics.firstTokenColumn") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in ttftRanking" :key="row.label">
            <td class="model-cell">
              <i class="rank-dot" :style="{ background: row.color }" />{{
                row.label
              }}
            </td>
            <td class="metric-cell">
              <span class="value-track" aria-hidden="true">
                <span
                  class="value-fill"
                  :style="{
                    width: `${row.ttftWidth}%`,
                    backgroundColor: row.color,
                  }"
                />
              </span>
              <span class="num">{{
                row.ttft === null
                  ? $t("analytics.notAvailable")
                  : chartFormat(row.ttft, true)
              }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </UsageCard>

    <UsageCard
      as="section"
      class="behavior-card"
      :aria-label="$t('analytics.tokenSpeed')"
    >
      <header>
        <h3>{{ $t("analytics.tokenSpeed") }}</h3>
      </header>
      <table>
        <thead>
          <tr>
            <th>{{ $t("analytics.model") }}</th>
            <th class="num">{{ $t("analytics.speedColumn") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in speedRanking" :key="row.label">
            <td class="model-cell">
              <i class="rank-dot" :style="{ background: row.color }" />{{
                row.label
              }}
            </td>
            <td class="metric-cell">
              <span class="value-track" aria-hidden="true">
                <span
                  class="value-fill"
                  :style="{
                    width: `${row.speedWidth}%`,
                    backgroundColor: row.color,
                  }"
                />
              </span>
              <span class="num">{{ performanceValue(row.speed) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </UsageCard>
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue";
import type { UsageSummary } from "@workspace/core/usage";
import { translate } from "../i18n";
import UsageCard from "./UsageCard.vue";
import UsageStatTile from "./UsageStatTile.vue";
import UsageTileGrid from "./UsageTileGrid.vue";
import UsageTrend from "./UsageTrend.vue";
import {
  averageTtftSeconds,
  chartFormat,
  chartSeries,
  providerColorForModel,
  sumSpeed,
  sortUsageValues,
  tokensPerSecond,
} from "./usage-chart";

const props = defineProps<{
  summary: UsageSummary;
  from: string;
  to: string;
}>();
const speedSeries = computed(() =>
  chartSeries(props.summary, "speed", "model").filter((series) =>
    props.summary.daily?.some((day) =>
      day.groups?.some(
        (group) =>
          group.label === series.key && tokensPerSecond(group.speed) !== null,
      ),
    ),
  ),
);
const overall = computed(() =>
  sumSpeed(props.summary.rows.map((row) => row.speed)),
);
const ttft = computed(() => averageTtftSeconds(overall.value));
const speed = computed(() => tokensPerSecond(overall.value));
const performanceValue = (value: number | null): string =>
  value === null
    ? translate("analytics.notAvailable")
    : chartFormat(value, true);
const relativeWidth = (value: number | null, maximum: number): number =>
  value === null || maximum <= 0
    ? 0
    : Number(((value / maximum) * 100).toFixed(1));
const rows = computed(() => {
  return props.summary.rows.map((row) => ({
    label:
      row.label === "Unknown"
        ? translate("analytics.unknownModel")
        : row.label,
    color: providerColorForModel(row.label),
    ttft: averageTtftSeconds(row.speed),
    speed: tokensPerSecond(row.speed),
  }));
});
const maximumTtft = computed(() =>
  Math.max(0, ...rows.value.map((row) => row.ttft ?? 0)),
);
const maximumSpeed = computed(() =>
  Math.max(0, ...rows.value.map((row) => row.speed ?? 0)),
);
/** Fastest first token first; models without a sample sort last. */
const ttftRanking = computed(() =>
  [...rows.value].sort(
    (a, b) =>
      (a.ttft ?? Number.POSITIVE_INFINITY) -
        (b.ttft ?? Number.POSITIVE_INFINITY) ||
      a.label.localeCompare(b.label),
  ).map((row) => ({
    ...row,
    ttftWidth: relativeWidth(row.ttft, maximumTtft.value),
  })),
);
/** Highest provider-reported generation rate first. */
const speedRanking = computed(() =>
  sortUsageValues(rows.value, row => row.speed).map((row) => ({
    ...row,
    speedWidth: relativeWidth(row.speed, maximumSpeed.value),
  })),
);
</script>
<style scoped>
.performance-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-8);
}
.behavior-card {
  min-width: 0;
  overflow-x: auto;
}
header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-6);
  margin-bottom: var(--space-6);
}
h3 {
  margin: 0;
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-bold);
}
table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: var(--font-size-13);
}
th,
td {
  padding: var(--space-4);
  border-bottom: 1px solid
    color-mix(in srgb, var(--color-border) 60%, transparent);
  text-align: left;
}
th {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-regular);
}
tbody tr:hover {
  background: color-mix(in srgb, var(--color-text) 3%, transparent);
}
tbody tr:last-child td {
  border-bottom: 0;
}
th:first-child,
td:first-child {
  padding-left: 0;
}
th:last-child,
td:last-child {
  padding-right: 0;
}
.metric-cell {
  display: grid;
  grid-template-columns: minmax(24px, 1fr) max-content;
  align-items: center;
  gap: var(--space-4);
}
.value-track {
  display: block;
  height: 10px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-text) 6%, transparent);
}
.value-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  transition: width 240ms ease;
}
.num {
  text-align: right;
  white-space: nowrap;
}
.model-cell {
  white-space: nowrap;
}
.rank-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: var(--space-4);
  border-radius: 3px;
}
@media (max-width: 900px) {
  .performance-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
