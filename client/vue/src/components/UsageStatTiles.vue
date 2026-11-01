<template>
  <UsageTileGrid :aria-label="$t('analytics.totals')">
    <UsageStatTile
      :label="$t('analytics.turnsPerDay')"
      :value="chartFormat(Math.round((turns / periodDays) * 10) / 10, true)"
      :spark="dailySeries((row) => row.started)"
      spark-color="var(--chart-1)"
    />
    <UsageStatTile
      :label="$t('analytics.totalTokens')"
      :value="
        chartFormat(
          sumValues(summary.rows.map((row) => row.tokens?.total)),
          true,
        )
      "
      :spark="dailySeries((row) => row.tokens?.total)"
      spark-color="var(--chart-7)"
    />
    <UsageTokenMix :rows="summary.rows" />
  </UsageTileGrid>
</template>
<script setup lang="ts">
import { computed } from "vue";
import type { UsageSummary } from "@workspace/core/usage";
import UsageStatTile from "./UsageStatTile.vue";
import UsageTileGrid from "./UsageTileGrid.vue";
import UsageTokenMix from "./UsageTokenMix.vue";
import { chartFormat, sumValues } from "./usage-chart";
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
