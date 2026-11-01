<template>
  <UsageStatTile
    :label="$t('analytics.tokenMix')"
    :value="parts.length ? undefined : $t('analytics.notAvailable')"
  >
    <template v-if="parts.length">
      <div class="mix-bar" role="img" :aria-label="$t('analytics.tokenMix')">
        <span
          v-for="part in parts.filter((part) => !part.parent)"
          :key="part.id"
          :style="{
            flexGrow: part.value,
            background: `linear-gradient(180deg, ${part.color}, color-mix(in srgb, ${part.color} 70%, transparent))`,
          }"
        />
      </div>
      <ul class="mix-legend">
        <li v-for="part in legendParts" :key="part.id">
          <i :style="{ background: part.color }" />
          <span>{{ part.label }}</span>
          <b>{{ chartFormat(part.percent) }}%</b>
        </li>
      </ul>
    </template>
  </UsageStatTile>
</template>
<script setup lang="ts">
import { computed } from "vue";
import type { UsageSummary } from "@workspace/core/usage";
import { translate } from "../i18n";
import UsageStatTile from "./UsageStatTile.vue";
import { chartFormat, sortUsageValues, sumValues } from "./usage-chart";
const props = defineProps<{
  rows: UsageSummary["rows"];
}>();
// Only inclusive input/output form the mix; other counters are compared to input/output separately.
const kinds = [
  ["input", "inputTokens", "var(--chart-7)", null],
  ["output", "outputTokens", "var(--chart-5)", null],
  [
    "cacheRead",
    "cacheRead",
    "color-mix(in oklab, var(--chart-7) 50%, white)",
    "input",
  ],
  [
    "cacheWrite",
    "cacheWrite",
    "color-mix(in oklab, var(--chart-5) 50%, white)",
    "input",
  ],
  ["reasoning", "reasoning", "var(--chart-4)", "output"],
] as const;
const parts = computed(() => {
  const tokens = props.rows.flatMap((row) => (row.tokens ? [row.tokens] : []));
  const all = tokens.reduce((n, row) => n + row.input + row.output, 0);
  return kinds.flatMap(([id, label, color, parent]) => {
    // A partial counter measurement cannot be compared to the full parent total.
    if (parent && tokens.some((row) => row[id] == null)) return [];
    const value = sumValues(tokens.map((row) => row[id]));
    const denominator = parent
      ? sumValues(tokens.map((row) => row[parent]))
      : all;
    return value && denominator
      ? [
          {
            id,
            parent,
            value,
            color,
            label:
              translate("analytics." + label) +
              (parent
                ? " (" +
                  translate(
                    parent === "input"
                      ? "analytics.percentOfInput"
                      : "analytics.percentOfOutput",
                  ) +
                  ")"
                : ""),
            percent: (100 * value) / denominator,
          },
        ]
      : [];
  });
});
const legendParts = computed(() => sortUsageValues(parts.value, part => part.percent));
</script>
<style scoped>
.mix-bar {
  display: flex;
  gap: 2px;
  height: 14px;
  margin: var(--space-4) 0 var(--space-3);
}
.mix-bar > span {
  min-width: 4px;
  border-radius: var(--radius-sm);
}
.mix-legend {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--font-size-12);
}
.mix-legend li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.mix-legend span {
  flex: 1;
  color: var(--color-text-muted);
}
.mix-legend i {
  width: 8px;
  height: 8px;
  border-radius: 3px;
}
</style>
