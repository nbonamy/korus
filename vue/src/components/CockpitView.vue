<template>
  <section class="agent-cockpit" :aria-label="$t('surface.cockpitView.agents')">
    <header class="agent-cockpit__header">
      <div>
        <h1>{{ $t('surface.cockpitView.agents') }}</h1>
        <span class="agent-cockpit__count">{{ agents.length }}</span>
      </div>
      <AppMenuChip :label="modeLabel" :ariaLabel="$t('surface.cockpitAgentsView.layout')" :items="modeMenuItems" @select="selectMode" />
    </header>

    <CockpitAgentsView
      :agents="agents"
      :forkable-agent-ids="forkableAgentIds"
      :mode="viewMode"
      :repository-icons="repositoryIcons"
      :response-previews="responsePreviews"
      :teams="teams"
      @add-agent="emit('add-agent', $event)"
      @close-agent="emit('close-agent', $event)"
      @duplicate-agent="emit('duplicate-agent', $event)"
      @edit-agent="emit('edit-agent', $event)"
      @share-agent="emit('share-agent', $event)"
      @fork-agent="emit('fork-agent', $event)"
      @move-agent-to-team="emit('move-agent-to-team', $event)"
      @prompt-agent="emit('prompt-agent', $event)"
      @restart-agent="emit('restart-agent', $event)"
      @select-agent="emit('select-agent', $event)"
      @select-team="emit('select-team', $event)"
    />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IconClockHour8, IconUsers } from '@tabler/icons-vue';
import type { Agent, CockpitAgentViewMode, Team } from '@workspace/core/contracts';
import AppMenuChip from '../shared/menu/AppMenuChip.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { translate } from '../i18n';
import CockpitAgentsView from './CockpitAgentsView.vue';

const props = defineProps<{
  agents: Agent[];
  forkableAgentIds?: string[];
  repositoryIcons?: Record<string, string>;
  responsePreviews?: Record<string, string>;
  teams: Team[];
  viewMode: CockpitAgentViewMode;
}>();

const emit = defineEmits<{
  'add-agent': [teamId: string];
  'close-agent': [agentId: string];
  'duplicate-agent': [agentId: string];
  'edit-agent': [agentId: string];
  'share-agent': [agentId: string];
  'fork-agent': [agentId: string];
  'move-agent-to-team': [payload: { agentId: string; teamId: string }];
  'prompt-agent': [payload: { agentId: string; prompt: string }];
  'restart-agent': [agentId: string];
  'select-agent': [payload: { agentId: string; teamId: string }];
  'select-team': [teamId: string];
  'update-view-mode': [mode: CockpitAgentViewMode];
}>();

const modeLabel = computed(() => translate(`surface.cockpitAgentsView.${props.viewMode}`));
const modeMenuItems = computed<AppMenuItem[]>(() => [
  {
    checked: props.viewMode === 'teams',
    icon: IconUsers,
    id: 'teams',
    label: translate('surface.cockpitAgentsView.teams'),
    type: 'radio',
  },
  {
    checked: props.viewMode === 'recent',
    icon: IconClockHour8,
    id: 'recent',
    label: translate('surface.cockpitAgentsView.recent'),
    type: 'radio',
  },
]);

function selectMode(itemId: string): void {
  if (itemId !== 'teams' && itemId !== 'recent') return;
  emit('update-view-mode', itemId);
}
</script>

<style scoped>
.agent-cockpit {
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--color-text);
  background: var(--color-shell-main);
}

.agent-cockpit__header,
.agent-cockpit__header > div {
  display: flex;
  align-items: center;
}

.agent-cockpit__header {
  height: var(--workbench-appbar-height);
  flex: 0 0 var(--workbench-appbar-height);
  justify-content: space-between;
  gap: var(--space-16);
  padding: 0 var(--space-20);
  border-bottom: 1px solid var(--color-border);
  -webkit-app-region: drag;
}

.agent-cockpit__header > div {
  min-width: 0;
  gap: var(--space-8);
}

.agent-cockpit__header h1 {
  margin: 0;
  font-size: var(--font-size-16);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-20);
}

.agent-cockpit__count {
  min-width: 28px;
  border-radius: var(--radius-full);
  padding: 2px var(--space-4);
  color: var(--color-text-muted);
  background: var(--color-surface-low);
  font-size: var(--font-size-12);
  text-align: center;
}
</style>
