<template>
    <AgentContextMenu
      :shared="Boolean(contextMenuAgent?.sharedConversation)"
      v-if="contextMenuAgentId"
      :share-available="Boolean(contextMenuAgentIsLocal && supportsConversationSharing(contextMenuAgent))"
      :fork-disabled="!canForkContextMenuAgent"
      :compress-visible="canReplaceContextMenuConversation"
      :compress-disabled="!canCompressContextMenuAgent"
      :compact-disabled="!canCompactContextMenuAgent"
      :open-in-catalog="resolvedOpenInCatalog"
      :open-in-disabled="!contextMenuAgentIsLocal"
      :move-targets="contextMenuMoveTargets"
      :x="contextMenuPosition.x"
      :y="contextMenuPosition.y"
      @action="emitContextAgentAction"
      @move-agent-to-team="emitContextAgentMove"
      @open-in="emitContextAgentOpenIn"
      @close="closeContextMenu"
    />

    <AppContextMenu
      v-if="contextMenuRepositoryAgentId"
      :x="contextMenuPosition.x"
      :y="contextMenuPosition.y"
      :ariaLabel="t('repositoryDeletion.action')"
      :items="repositoryMenuItems"
      @select="deleteContextRepository"
      @close="contextMenuRepositoryAgentId = null"
    />

    <MissionContextMenu
      v-if="contextMenuMissionId"
      :x="contextMenuPosition.x"
      :y="contextMenuPosition.y"
      @delete="deleteContextMission"
      :workspaces="contextMissionWorkspaces"
      @create-agent="createAgentInContextMissionWorktree"
      @close="closeMissionContextMenu"
    />
</template>

<script setup lang="ts">
import { toRefs } from 'vue';
import type { AgentSidebarModel } from './use-agent-sidebar';
import AgentContextMenu from './AgentContextMenu.vue';
import MissionContextMenu from './MissionContextMenu.vue';
import AppContextMenu from '../shared/menu/AppContextMenu.vue';

const props = defineProps<{ model: AgentSidebarModel }>();
const {
  contextMenuAgentId,
  contextMenuAgent,
  contextMenuAgentIsLocal,
  supportsConversationSharing,
  canForkContextMenuAgent,
  canReplaceContextMenuConversation,
  canCompressContextMenuAgent,
  canCompactContextMenuAgent,
  resolvedOpenInCatalog,
  contextMenuMoveTargets,
  contextMenuPosition,
  emitContextAgentAction,
  emitContextAgentMove,
  emitContextAgentOpenIn,
  closeContextMenu,
  contextMenuRepositoryAgentId,
  t,
  repositoryMenuItems,
  deleteContextRepository,
  contextMenuMissionId,
  deleteContextMission,
  contextMissionWorkspaces,
  createAgentInContextMissionWorktree,
  closeMissionContextMenu,
} = toRefs(props.model);
</script>
