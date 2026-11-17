<template>
  <div class="usage-toolbar">
    <UsageToggle
      :model-value="view"
      :options="tabs.map(tab => ({ value: tab.name, label: tab.label }))"
      :label="$t('analytics.title')"
      @update:model-value="emit('update:view', $event)"
    />
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
            class="app-button usage-date agent-ui-interactive"
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
      <el-select
        id="usage-provider"
        class="usage-provider"
        :model-value="filter.provider"
        :aria-label="$t('analytics.provider')"
        @update:model-value="emit('update:provider', $event)"
      >
        <el-option class="agent-ui-interactive"
          v-for="option in providerOptions"
          :key="option.value"
          :value="option.value"
          :label="option.label"
        >
          <span class="usage-provider-option"
            ><i
              v-if="option.color"
              :style="{ background: option.color }"
            />{{ option.label }}</span
          >
        </el-option>
      </el-select>
      <div v-if="view === 'usage'" id="usage-grouping">
        <UsageToggle
          :model-value="grouping"
          :options="groupingOptions()"
          :label="$t('analytics.groupBy')"
          @update:model-value="emit('update:grouping', $event)"
        />
      </div>
      <AppMenuButton
        :ariaLabel="$t('analytics.options')"
        :items="menuItems"
        @select="emit('update:groupServiceTiers', !groupServiceTiers)"
      >
        <template #trigger="{ attrs }">
          <el-tooltip :content="$t('analytics.options')" placement="top">
            <button v-bind="attrs" class="app-icon-button usage-options agent-ui-interactive" type="button" :aria-label="$t('analytics.options')">
              <DotsVerticalIcon aria-hidden="true" />
            </button>
          </el-tooltip>
        </template>
      </AppMenuButton>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { providerDisplayName } from "@workspace/core/provider-driver";
import { translate } from "../i18n";
import AppMenuButton from "../shared/menu/AppMenuButton.vue";
import type { AppMenuItem } from "../shared/menu/app-menu";
import { BoltIcon, DotsVerticalIcon } from "../shared/icons/app-icons";
import UsageToggle from "./UsageToggle.vue";
import { groupingOptions, type UsageGrouping } from "./usage-chart";
import type { UsageView } from "./use-usage-analytics";
const props = defineProps<{
  view: UsageView;
  grouping: UsageGrouping;
  groupServiceTiers: boolean;
  filter: { from: string; to: string; provider: string };
  selectedPeriod: number | null;
  dateLabel: string;
}>();
const emit = defineEmits<{
  "update:view": [view: UsageView];
  "update:grouping": [grouping: UsageGrouping];
  "update:groupServiceTiers": [value: boolean];
  "update:provider": [provider: string];
  range: [days: number];
  date: [key: "from" | "to", value: string];
}>();
const menuItems = computed<AppMenuItem[]>(() => [{
  id: 'group-service-tiers', type: 'checkbox', label: translate('analytics.groupServiceTiers'), icon: BoltIcon, checked: props.groupServiceTiers,
}]);
const providers = [
  ["codex", 1],
  ["claude", 2],
  ["antigravity", 3],
  ["cursor", 4],
] as const;
const tabs = computed(() => [
  { name: "usage" as const, label: translate("analytics.usageOverview") },
  { name: "performance" as const, label: translate("analytics.performance") },
]);
const providerOptions = computed<
  { value: string; label: string; color?: string }[]
>(() => [
  { value: "", label: translate("analytics.allProviders") },
  ...providers.map(([value, slot]) => ({
    value: value as string,
    label: providerDisplayName(value),
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
.usage-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
}
.usage-date {
  --agent-ui-state-rest: var(--color-control-fill);
  white-space: nowrap;
}
.usage-options {
  border: 1px solid var(--color-border);
}
.usage-provider {
  width: 160px;
}
.usage-provider-option {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
}
.usage-provider-option i {
  width: 8px;
  height: 8px;
  border-radius: 3px;
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
