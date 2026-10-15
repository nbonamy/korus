<template>
  <SettingsPanelFrame
    class="analytics"
    :title="$t('analytics.title')"
    title-id="usage-title"
  >
    <template #actions>
      <button
        class="app-button analytics-refresh"
        type="button"
        :aria-label="$t('analytics.refresh')"
        :disabled="busy"
        @click="load()"
      >
        <RefreshIcon :size="14" />{{ $t("analytics.refresh") }}
      </button>
    </template>
    <UsageActivity
      v-if="projections"
      class="analytics-header"
      :days="activityDays"
    />
    <UsageToolbar
      v-model:view="view"
      :filter="filter"
      :selected-period="selectedPeriod"
      :date-label="dateLabel"
      @range="setRange"
      @date="setDate"
      @update:provider="setProvider"
    />
    <p v-if="error" class="analytics-note" role="alert">
      {{ $t("analytics.loadError") }}
    </p>
    <p v-else-if="busy && !projections" class="analytics-note" role="status">
      {{ $t("analytics.loading") }}
    </p>
    <div
      v-if="projections"
      class="analytics-content"
      :class="{ 'analytics-content--refreshing': busy }"
    >
      <template v-if="view === 'usage'">
        <div class="analytics-bento">
          <UsageHero
            v-model:measure="measure"
            v-model:trend-group="trendGroup"
            :series="trendSeries"
            :daily="trendData?.daily ?? []"
            :from="filter.from"
            :to="filter.to"
            :period-days="periodDays"
            :current="projections.provider"
            :previous="projections.previous"
          />
          <UsageShare
            :series="shareSeries"
            :measure="measure"
            :subtitle="measureLabel(measure)"
          >
            <template #controls>
              <div id="usage-share-group">
                <UsageToggle
                  v-model="shareGroup"
                  :options="groupingOptions()"
                  :label="$t('analytics.shareBreakdown')"
                />
              </div>
            </template>
          </UsageShare>
        </div>
        <UsageStatTiles
          :summary="projections.provider"
          :from="filter.from"
          :to="filter.to"
          :period-days="periodDays"
        />
        <UsageBreakdown :series="shareSeries" :grouping="shareGroup" />
      </template>
      <UsagePerformance v-else :summary="projections.model" />
    </div>
    <div class="analytics-data-actions">
      <button
        class="app-button app-button--tertiary"
        type="button"
        :disabled="busy || clearing"
        @click="clearStatistics"
      >
        {{ $t(clearing ? "analytics.clearing" : "analytics.clear") }}
      </button>
      <p v-if="clearError" role="alert">{{ $t("analytics.clearError") }}</p>
    </div>
  </SettingsPanelFrame>
</template>
<script setup lang="ts">
import { RefreshIcon } from "../shared/icons/app-icons";
import SettingsPanelFrame from "./SettingsPanelFrame.vue";
import UsageActivity from "./UsageActivity.vue";
import UsageBreakdown from "./UsageBreakdown.vue";
import UsageHero from "./UsageHero.vue";
import UsagePerformance from "./UsagePerformance.vue";
import UsageShare from "./UsageShare.vue";
import UsageStatTiles from "./UsageStatTiles.vue";
import UsageToggle from "./UsageToggle.vue";
import UsageToolbar from "./UsageToolbar.vue";
import { groupingOptions, measureLabel } from "./usage-chart";
import { useUsageAnalytics } from "./use-usage-analytics";
const {
  view,
  measure,
  trendGroup,
  shareGroup,
  filter,
  projections,
  busy,
  error,
  clearing,
  clearError,
  selectedPeriod,
  periodDays,
  dateLabel,
  trendData,
  trendSeries,
  shareSeries,
  activityDays,
  load,
  setRange,
  setDate,
  setProvider,
  clearStatistics,
} = useUsageAnalytics();
</script>
<style scoped>
.analytics {
  font-variant-numeric: tabular-nums;
}
.analytics-refresh {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
}
.analytics-header {
  margin-bottom: var(--space-12);
}
.analytics-content {
  display: grid;
  gap: var(--space-8);
  margin-top: var(--space-8);
  transition: opacity 160ms ease;
}
.analytics-content--refreshing {
  opacity: 0.6;
}
.analytics-bento {
  display: grid;
  grid-template-columns: minmax(0, 2.1fr) minmax(280px, 1fr);
  gap: var(--space-8);
}
.analytics-note {
  margin: var(--space-8) 0 0;
  padding: var(--space-12);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-2xl);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  text-align: center;
}
.analytics-data-actions {
  margin-top: var(--space-6);
  padding-top: var(--space-6);
  border-top: 1px solid var(--color-border);
}
.analytics-data-actions p {
  color: var(--color-error);
  font-size: var(--font-size-12);
}
@media (max-width: 1100px) {
  .analytics-bento {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
