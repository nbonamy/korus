<template>
  <div class="usage-toolbar">
    <div class="usage-tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :id="'usage-tab-' + tab.name"
        :key="tab.name"
        class="usage-tab"
        :class="{ 'usage-tab--active': view === tab.name }"
        type="button"
        role="tab"
        :aria-selected="view === tab.name"
        @click="emit('update:view', tab.name)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div class="usage-filters">
      <UsageToggle
        :model-value="selectedPeriod"
        :options="
          [7, 30, 90].map((value) => ({
            value,
            label: $t('analytics.days', { count: value }),
          }))
        "
        :label="$t('analytics.dateRange')"
        @update:model-value="emit('range', $event)"
      />
      <el-popover trigger="click" :width="300"
        ><template #reference
          ><button
            class="app-button usage-date"
            type="button"
            :aria-label="$t('analytics.dateRange')"
          >
            {{ dateLabel }} ⌄
          </button></template
        >
        <div class="usage-date-fields">
          <label
            v-for="key in ['from', 'to'] as const"
            :key="key"
            :for="'usage-' + key"
            >{{ $t("analytics." + key)
            }}<input
              :id="'usage-' + key"
              :value="filter[key]"
              type="date"
              @change="
                emit('date', key, ($event.target as HTMLInputElement).value)
              "
          /></label>
        </div>
      </el-popover>
      <div id="usage-provider" class="usage-provider">
        <UsageToggle
          :model-value="filter.provider"
          :options="providerOptions"
          :label="$t('analytics.provider')"
          @update:model-value="emit('update:provider', $event)"
        />
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { backendDisplayName } from "@workspace/core/backend-driver";
import { translate } from "../i18n";
import UsageToggle from "./UsageToggle.vue";
import type { UsageView } from "./use-usage-analytics";
defineProps<{
  view: UsageView;
  filter: { from: string; to: string; provider: string };
  selectedPeriod: number | null;
  dateLabel: string;
}>();
const emit = defineEmits<{
  "update:view": [view: UsageView];
  "update:provider": [provider: string];
  range: [days: number];
  date: [key: "from" | "to", value: string];
}>();
const providers = [
  ["codex", 1],
  ["claude", 2],
  ["antigravity", 3],
] as const;
const tabs = computed(() => [
  { name: "usage" as const, label: translate("analytics.usageOverview") },
  { name: "performance" as const, label: translate("analytics.performance") },
]);
const providerOptions = computed(() => [
  { value: "", label: translate("analytics.allProviders") },
  ...providers.map(([value, slot]) => ({
    value: value as string,
    label: backendDisplayName(value),
    color: `var(--chart-${slot})`,
  })),
]);
</script>
<style scoped>
.usage-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
}
.usage-tabs {
  display: inline-flex;
  gap: var(--space-1);
  padding: var(--space-1);
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-text) 6%, transparent);
}
.usage-tab {
  padding: var(--space-2) var(--space-8);
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
  transition:
    background 140ms ease,
    color 140ms ease,
    box-shadow 140ms ease;
}
.usage-tab:hover {
  color: var(--color-text);
}
.usage-tab--active {
  background: var(--color-surface-lowest);
  color: var(--color-text);
  box-shadow: var(--shadow-sm);
}
.usage-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
}
.usage-date {
  white-space: nowrap;
}
.usage-provider {
  display: flex;
}
.usage-date-fields {
  display: flex;
  gap: var(--space-6);
}
.usage-date-fields label {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  font-size: var(--font-size-12);
}
.usage-date-fields input {
  width: 100%;
  box-sizing: border-box;
  color: var(--color-text);
  background: var(--color-surface-lowest);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: var(--space-3);
}
</style>
