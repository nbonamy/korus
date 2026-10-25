<template>
  <UsageCard as="section" :aria-label="$t('analytics.breakdown')">
    <header>
      <h3>
        {{
          $t(
            grouping === "provider"
              ? "analytics.providerUsage"
              : "analytics.modelUsage",
          )
        }}
      </h3>
      <el-tooltip
        :content="$t('analytics.shareNote')"
        ><span
          class="breakdown-info"
          tabindex="0"
          :aria-label="$t('analytics.shareNote')"
          >ⓘ</span
        ></el-tooltip
      >
    </header>
    <table>
      <thead>
        <tr>
          <th>{{ $t("analytics." + grouping) }}</th>
          <th class="num">{{ $t("analytics.turns") }}</th>
          <th class="num">{{ $t("analytics.measuredTokens") }}</th>
          <th class="num">{{ $t("analytics.cost") }}</th>
          <th>{{ $t("analytics.tokenShare") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.key">
          <td>
            <i class="breakdown-dot" :style="{ background: row.color }" />{{
              row.label
            }}
          </td>
          <td class="num">{{ chartFormat(row.turns, true) }}</td>
          <td class="num">{{ chartFormat(row.tokens, true) }}</td>
          <td class="num">{{ usdFormat(row.cost?.usd) }}</td>
          <td>
            <span class="breakdown-share"
              ><UsageBar :value="share(row)" :color="row.color" /><b>{{
                share(row) === null
                  ? $t("analytics.notAvailable")
                  : chartFormat(share(row)) + "%"
              }}</b></span
            >
          </td>
        </tr>
      </tbody>
    </table>
  </UsageCard>
</template>
<script setup lang="ts">
import { computed } from "vue";
import UsageBar from "./UsageBar.vue";
import UsageCard from "./UsageCard.vue";
import {
  chartFormat,
  usdFormat,
  type UsageGrouping,
  type UsageSeries,
} from "./usage-chart";
const props = defineProps<{
  series: UsageSeries[];
  grouping: UsageGrouping;
}>();
const rows = computed(() => [...props.series].sort((a, b) =>
  (b.tokens ?? -1) - (a.tokens ?? -1) || a.label.localeCompare(b.label),
));
const measuredTotal = computed(() =>
  props.series.reduce((n, row) => n + (row.tokens ?? 0), 0),
);
/** A row's percentage of the measured total, null where it was not measured. */
const share = (row: UsageSeries) =>
  row.tokens === null || !measuredTotal.value
    ? null
    : (100 * row.tokens) / measuredTotal.value;
</script>
<style scoped>
.usage-card {
  overflow: auto;
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
.breakdown-info {
  color: var(--color-text-muted);
  cursor: help;
  font-size: var(--font-size-12);
}
table {
  width: 100%;
  border-collapse: collapse;
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
tbody tr {
  transition: background 120ms ease;
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
.num {
  text-align: right;
}
td {
  white-space: nowrap;
}
.breakdown-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: var(--space-4);
  border-radius: 3px;
}
.breakdown-share {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}
.breakdown-share b {
  min-width: 44px;
  font-weight: var(--font-weight-semibold);
}
.breakdown-share .usage-bar {
  flex: 1;
  min-width: 70px;
  max-width: 280px;
}
</style>
