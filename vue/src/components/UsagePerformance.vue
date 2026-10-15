<template>
  <UsageTileGrid :aria-label="$t('analytics.totals')">
    <UsageStatTile
      :label="$t('analytics.tokensPerSecond')"
      :value="chartFormat(tokensPerSecond(overall))"
    />
    <UsageStatTile
      :label="$t('analytics.timeToFirstToken')"
      :value="ttft === null ? chartFormat(null) : seconds(ttft)"
    />
    <UsageStatTile
      :label="$t('analytics.timedTurns')"
      :value="chartFormat(overall?.turns ?? null)"
    />
  </UsageTileGrid>
  <UsageCard as="section" :aria-label="$t('analytics.textDelivery')">
    <header>
      <h3>{{ $t("analytics.textDelivery") }}</h3>
      <p>{{ $t("analytics.tokensPerSecond") }}</p>
    </header>
    <article v-for="row in ranking" :key="row.label" class="rank">
      <div class="rank-head">
        <span class="rank-name"
          ><i class="rank-dot" :style="{ background: row.color }" />{{
            row.label
          }}<small>{{
            $t("analytics.samples", { count: row.turns })
          }}</small></span
        ><strong
          >{{ chartFormat(row.value) }}
          <small v-if="row.value !== null">{{
            $t("analytics.tokensPerSecond")
          }}</small
          ><small v-if="row.ttft !== null">
            · {{ seconds(row.ttft) }} {{ $t("analytics.toFirstToken") }}</small
          ></strong
        >
      </div>
      <UsageBar
        :value="row.value === null ? null : row.width"
        :color="row.color"
        thick
      />
    </article>
    <p class="rank-note">{{ $t("analytics.rateNote") }}</p>
  </UsageCard>
</template>
<script setup lang="ts">
import { computed } from "vue";
import type { UsageSummary } from "@workspace/core/usage";
import { translate } from "../i18n";
import UsageBar from "./UsageBar.vue";
import UsageCard from "./UsageCard.vue";
import UsageStatTile from "./UsageStatTile.vue";
import UsageTileGrid from "./UsageTileGrid.vue";
import {
  averageTtftSeconds,
  chartFormat,
  chartSeries,
  seconds,
  sumSpeed,
  tokensPerSecond,
} from "./usage-chart";
const props = defineProps<{ summary: UsageSummary }>();
const overall = computed(() =>
  sumSpeed(props.summary.rows.map((row) => row.speed)),
);
const ttft = computed(() => averageTtftSeconds(overall.value));
/** Models fastest first, each bar scaled against the fastest. */
const ranking = computed(() => {
  const colors = new Map(
    chartSeries(props.summary, "turns", "model").map((item) => [
      item.key,
      item.color,
    ]),
  );
  const top = Math.max(
    1,
    ...props.summary.rows.map((row) => tokensPerSecond(row.speed) ?? 0),
  );
  return props.summary.rows
    .map((row) => ({
      label:
        row.label === "Unknown"
          ? translate("analytics.unknownModel")
          : row.label,
      color: colors.get(row.label) ?? "var(--chart-1)",
      value: tokensPerSecond(row.speed),
      ttft: averageTtftSeconds(row.speed),
      turns: row.speed?.turns ?? 0,
    }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
    .map((row) => ({ ...row, width: ((row.value ?? 0) * 100) / top }));
});
</script>
<style scoped>
header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-6);
  margin-bottom: var(--space-6);
}
header p {
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}
h3 {
  margin: 0;
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-bold);
}
.rank {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-8);
}
.rank:first-of-type {
  margin-top: 0;
}
.rank-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-8);
  font-size: var(--font-size-13);
}
.rank-head strong {
  font-weight: var(--font-weight-bold);
}
.rank-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: var(--space-4);
  border-radius: 3px;
}
.rank-name small {
  margin-left: var(--space-4);
}
small,
.rank-note {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}
.rank-note {
  margin: var(--space-8) 0 0;
}
</style>
