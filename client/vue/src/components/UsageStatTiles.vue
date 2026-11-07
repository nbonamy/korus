<template>
  <UsageTileGrid :aria-label="$t('analytics.totals')">
    <div class="daily-metrics">
      <UsageStatTile
        :label="$t('analytics.turnsPerDay')"
        :value="chartFormat(Math.round((turns / periodDays) * 10) / 10, true)"
        :spark="dailySeries((row) => row.started)"
        spark-color="var(--chart-1)"
      />
      <UsageStatTile
        :label="$t('analytics.tokensPerDay')"
        :value="chartFormat(tokensPerDay, true)"
        :spark="dailySeries((row) => row.tokens?.total)"
        spark-color="var(--chart-7)"
      />
      <UsageStatTile
        :label="$t('analytics.costPerDay')"
        :value="usdFormat(costPerDay)"
        :spark="dailySeries((row) => row.cost?.usd)"
        spark-color="var(--chart-5)"
      />
    </div>
    <UsageTokenMix :rows="summary.rows" />
  </UsageTileGrid>
</template>
<script setup lang="ts">
import { computed } from "vue";
import type { UsageSummary } from "@workspace/core/usage";
import UsageStatTile from "./UsageStatTile.vue";
import UsageTileGrid from "./UsageTileGrid.vue";
import UsageTokenMix from "./UsageTokenMix.vue";
import { chartFormat, sumValues, usdFormat } from "./usage-chart";
type DailyRow = NonNullable<UsageSummary["daily"]>[number];
const props = defineProps<{
  summary: UsageSummary;
  from: string;
  to: string;
  periodDays: number;
}>();
const turns = computed(() =>
  props.summary.rows.reduce((n, row) => n + row.started, 0),
);
const tokensPerDay = computed(() => {
  const total = sumValues(props.summary.rows.map((row) => row.tokens?.total ?? 0));
  return total == null ? null : total / props.periodDays;
});
const costPerDay = computed(() => {
  const total = props.summary.cost?.usd;
  return total == null ? null : total / props.periodDays;
});
/** One value per day of the period, zero where nothing was recorded. */
function dailySeries(pick: (row: DailyRow) => number | null | undefined) {
  const days = new Map(
    (props.summary.daily ?? []).map((row) => [row.day, row]),
  );
  const values: number[] = [];
  for (
    let at = Date.parse(props.from);
    at <= Date.parse(props.to);
    at += 86400000
  ) {
    const row = days.get(new Date(at).toISOString().slice(0, 10));
    values.push(row ? (pick(row) ?? 0) : 0);
  }
  return values;
}
</script>
<style scoped>
.daily-metrics {
  grid-column: span 2;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-8);
}
@media (max-width: 1100px) {
  .daily-metrics {
    grid-column: 1 / -1;
  }
}
@media (max-width: 720px) {
  .daily-metrics {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
