<template>
  <AppMenuButton v-model:open="open" placement="bottom-end" :ariaLabel="t('missions.costMenu')" :items="items" :width="260">
    <template #trigger="{ attrs }">
      <button v-bind="attrs" class="mission-cost-menu__trigger" type="button" :aria-label="t('missions.costMenu')" :title="t('missions.costMenu')">
        <IconDots aria-hidden="true" />
      </button>
    </template>
  </AppMenuButton>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconDots } from '@tabler/icons-vue';
import type { Mission } from '@workspace/core/missions';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { usageFormat } from './usage-chart';
import { missionCostGroups } from './mission-cost';
import { useUsageByAgent } from './use-usage-by-agent';

const props = defineProps<{ mission: Mission }>();
const { t } = useI18n();

const open = ref(false);
const { summary, loaded, refresh } = useUsageByAgent();
watch(open, (isOpen) => { if (isOpen) void refresh(); });

const items = computed<AppMenuItem[]>(() => {
  if (!loaded.value) return [];
  const { rows, total } = missionCostGroups(props.mission, summary.value);
  if (!total) return [{ id: 'none', type: 'info', label: t('missions.costNoUsage') }];
  return [
    ...rows.map((row): AppMenuItem => ({
      id: `cost:${row.id}`,
      type: 'info',
      label: row.label ?? t(row.id === 'lead' ? 'missions.costLead' : 'missions.costOther'),
      value: usageFormat(row.cost!.totalTokens, row.cost!.usd),
    })),
    { id: 'separator-total', type: 'separator' },
    { id: 'cost:total', type: 'info', label: t('missions.costTotal'), value: usageFormat(total.totalTokens, total.usd) },
  ];
});
</script>

<style scoped>
.mission-cost-menu__trigger {
  -webkit-app-region: no-drag;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.mission-cost-menu__trigger:hover,
.mission-cost-menu__trigger[aria-expanded="true"] {
  background: var(--color-surface-high);
  color: var(--color-text);
}

.mission-cost-menu__trigger :deep(svg) {
  width: var(--icon-md);
  height: var(--icon-md);
}
</style>
