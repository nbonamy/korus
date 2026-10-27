<template>
  <AppMenuButton v-model:open="open" :ariaLabel="$t('surface.agentHeader.moreActions')" :items="items" :width="240" @select="onSelect">
    <template #trigger="{ attrs }">
      <button
        v-bind="attrs"
        class="agent-more-menu__trigger"
        :class="{ 'agent-more-menu__trigger--shared': shareActive }"
        type="button"
        :aria-label="$t('surface.agentHeader.moreActions')"
      >
        <IconDots aria-hidden="true" />
      </button>
    </template>
  </AppMenuButton>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { IconDots, IconShare } from '@tabler/icons-vue';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { translate } from '../i18n';
import { agentCostFor, cachedShare, formatCost } from './agent-cost';
import { useUsageByAgent } from './use-usage-by-agent';

const props = defineProps<{
  agentId: string;
  shareAvailable?: boolean;
  shareActive?: boolean;
}>();

const emit = defineEmits<{ share: [] }>();

const open = ref(false);
const { summary, loaded, refresh } = useUsageByAgent();
watch(open, (isOpen) => { if (isOpen) void refresh(); });

const items = computed<AppMenuItem[]>(() => {
  const rows: AppMenuItem[] = [];
  if (props.shareAvailable) rows.push({ id: 'share', type: 'action', label: translate('sharing.share'), icon: IconShare });
  const cost = agentCostFor(summary.value, [props.agentId]);
  if (loaded.value) {
    if (rows.length > 0) rows.push({ id: 'separator-cost', type: 'separator' });
    rows.push({
      id: 'cost',
      type: 'info',
      label: translate('surface.agentHeader.estimatedCost'),
      value: formatCost(cost?.usd ?? null),
      ...(cost?.coverage === 'partial' ? { description: translate('surface.agentHeader.costPartial') } : {}),
    });
    const cached = cost ? cachedShare(cost) : null;
    if (cached !== null) {
      rows.push({ id: 'cached', type: 'info', label: translate('surface.agentHeader.cachedInput'), value: `${Math.round(cached * 100)}%` });
    }
  }
  return rows;
});

function onSelect(itemId: string): void {
  if (itemId === 'share') emit('share');
}
</script>

<style scoped>
.agent-more-menu__trigger {
  -webkit-app-region: no-drag;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.agent-more-menu__trigger:hover,
.agent-more-menu__trigger[aria-expanded="true"] {
  background: var(--color-surface-high);
  color: var(--color-text);
}

.agent-more-menu__trigger--shared,
.agent-more-menu__trigger--shared:hover {
  color: var(--color-primary);
}

.agent-more-menu__trigger :deep(svg) {
  width: var(--icon-md);
  height: var(--icon-md);
}
</style>
