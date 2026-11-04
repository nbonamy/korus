<template>
  <AppContextMenu
    :x="x"
    :y="y"
    :ariaLabel="t('missions.actions')"
    :items="menuItems"
    @select="selectMenuItem"
    @close="emit('close')"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MissionWorkspace } from '@workspace/core/mission-execution';
import AppContextMenu from '../shared/menu/AppContextMenu.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { ExternalLinkIcon, PlusIcon, Trash2Icon } from '../shared/icons/app-icons';
import { appApi } from '../platform-api';

const props = defineProps<{ x: number; y: number; workspaces?: MissionWorkspace[] }>();
const emit = defineEmits<{ close: []; delete: []; 'open-window': []; 'create-agent': [worktreePath: string] }>();
const { t } = useI18n();
const menuItems = computed<AppMenuItem[]>(() => [
  ...(appApi?.openWindow ? [
    { id: 'open-window', type: 'action', label: t('agents.openInNewWindow'), icon: ExternalLinkIcon } satisfies AppMenuItem,
    { id: 'mission-window-divider', type: 'separator' } satisfies AppMenuItem,
  ] : []),
  ...(props.workspaces?.length ? [{
    id: 'new-agent-in-worktree',
    type: 'submenu' as const,
    label: t('missions.newAgentInWorktree'),
    icon: PlusIcon,
    items: props.workspaces.map(workspace => ({
      id: `worktree:${workspace.path}`,
      type: 'action' as const,
      label: workspace.repositoryPath.split(/[\\/]/u).filter(Boolean).at(-1) ?? workspace.repositoryPath,
    })),
  }, { id: 'mission-actions-divider', type: 'separator' as const }] : []),
  { id: 'delete-mission', type: 'action', label: t('missions.deleteAction'), icon: Trash2Icon, danger: true },
]);

function selectMenuItem(itemId: string): void {
  if (itemId === 'open-window') emit('open-window');
  else if (itemId === 'delete-mission') emit('delete');
  else {
    const workspace = props.workspaces?.find(candidate => `worktree:${candidate.path}` === itemId);
    if (workspace) emit('create-agent', workspace.path);
  }
}
</script>
