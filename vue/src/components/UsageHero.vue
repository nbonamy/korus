<template>
  <UsageCard class="usage-hero">
    <UsageTrend
      :daily="daily"
      :series="series"
      :measure="measure"
      :from="from"
      :to="to"
    >
      <template #header>
        <header class="hero-header">
          <div class="hero-figure">
            <span class="hero-label">{{ measureLabel(measure) }}</span>
            <div class="hero-number">
              <strong>{{ measureFormat(total, measure) }}</strong>
              <span
                v-if="delta"
                class="hero-delta"
                :class="'hero-delta--' + delta.direction"
                ><span aria-hidden="true">{{
                  { up: "▲", down: "▼", flat: "•" }[delta.direction]
                }}</span>
                {{ delta.text
                }}<small>{{
                  $t("analytics.vsPrevious", { count: periodDays })
                }}</small></span
              >
            </div>
          </div>
          <div class="hero-controls">
            <div id="usage-measure">
              <UsageToggle
                :model-value="measure"
                :options="measureOptions"
                :label="$t('analytics.measure')"
                @update:model-value="emit('update:measure', $event)"
              />
            </div>
          </div>
        </header>
      </template>
    </UsageTrend>
    <div v-if="measure === 'cost'" class="hero-cost-notes">
      <p>{{ $t("analytics.costExplanation") }}</p>
      <UsageCostCoverage
        :cost="current.cost"
        :label="$t('analytics.costCurrent')"
      />
      <UsageCostCoverage
        :cost="previous?.cost"
        :label="$t('analytics.costPrevious')"
        show-value
      />
    </div>
  </UsageCard>
</template>
<script setup lang="ts">
import { computed } from "vue";
import type { UsageSummary } from "@workspace/core/usage";
import { translate } from "../i18n";
import UsageCostCoverage from "./UsageCostCoverage.vue";
import UsageCard from "./UsageCard.vue";
import UsageToggle from "./UsageToggle.vue";
import UsageTrend from "./UsageTrend.vue";
import {
  chartFormat,
  chartSeries,
  measureLabel,
  measureFormat,
  sumValues,
  type UsageMeasure,
  type UsageSeries,
} from "./usage-chart";
const props = defineProps<{
  series: UsageSeries[];
  daily: NonNullable<UsageSummary["daily"]>;
  measure: UsageMeasure;
  from: string;
  to: string;
  periodDays: number;
  /** The selection and the period before it, both grouped by provider. */
  current: UsageSummary;
  previous: UsageSummary | null;
}>();
const emit = defineEmits<{
  "update:measure": [measure: UsageMeasure];
}>();
const measureOptions = computed(() => [
  { value: "cost" as const, label: translate("analytics.estimatedCost") },
  { value: "turns" as const, label: translate("analytics.turns") },
  { value: "total" as const, label: translate("analytics.measureTotal") },
  { value: "input" as const, label: translate("analytics.measureInput") },
  { value: "output" as const, label: translate("analytics.measureOutput") },
]);
const totalOf = (summary: UsageSummary | null | undefined) =>
  props.measure === "cost"
    ? (summary?.cost?.usd ?? null)
    : sumValues(
        chartSeries(summary ?? undefined, props.measure, "provider").map(
          (item) => item.value,
        ),
      );
const total = computed(() => totalOf(props.current));
const delta = computed(() => {
  if (
    props.measure === "cost" &&
    (props.current.cost?.coverage !== "complete" ||
      props.previous?.cost?.coverage !== "complete")
  )
    return null;
  const before = totalOf(props.previous);
  if (total.value === null || !before) return null;
  const change = ((total.value - before) / before) * 100;
  const rounded = Math.round(Math.abs(change) * 10) / 10;
  return {
    direction:
      rounded === 0
        ? ("flat" as const)
        : change > 0
          ? ("up" as const)
          : ("down" as const),
    text: chartFormat(rounded) + "%",
  };
});
</script>
<style scoped>
.usage-hero {
  padding: var(--space-12) var(--space-12) var(--space-8);
  background:
    radial-gradient(
      55% 60% at 0% 0%,
      color-mix(in srgb, var(--chart-1) 9%, transparent),
      transparent 70%
    ),
    radial-gradient(
      45% 55% at 100% 0%,
      color-mix(in srgb, var(--chart-2) 8%, transparent),
      transparent 70%
    ),
    var(--color-surface-lowest);
}
.hero-cost-notes {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-6);
}
.hero-cost-notes p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}
.hero-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-8);
  margin-bottom: var(--space-6);
}
.hero-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.hero-number {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-4) var(--space-6);
}
.hero-number strong {
  font-size: 56px;
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.035em;
  line-height: 1.05;
}
.hero-delta {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-4);
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-text) 7%, transparent);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-bold);
}
.hero-delta small {
  margin-left: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-regular);
}
.hero-delta--up {
  background: color-mix(in srgb, var(--chart-3) 16%, transparent);
}
.hero-delta--down {
  background: color-mix(in srgb, var(--chart-2) 16%, transparent);
}
.hero-controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-4);
}
@media (max-width: 720px) {
  .hero-header {
    flex-direction: column;
  }
  .hero-number strong {
    font-size: 44px;
  }
}
</style>
