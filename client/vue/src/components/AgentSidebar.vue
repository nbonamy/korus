<template>
  <!-- A stable root: the parent pane transition follows the root element, so swapping variants must not replace it. -->
  <div class="agent-sidebar-pane" :style="sidebar.sidebarStyle">
    <component :is="sidebar.organizationMode === 'activity' ? AgentSidebarActivity : AgentSidebarRepo" :model="sidebar" />
  </div>
</template>

<script setup lang="ts">
import { toRefs } from 'vue';
import AgentSidebarRepo from './AgentSidebarRepo.vue';
import AgentSidebarActivity from './AgentSidebarActivity.vue';
import { useAgentSidebar } from './use-agent-sidebar';
import type { AgentSidebarProps, AgentSidebarEvents } from './agent-sidebar-contracts';

const props = defineProps<AgentSidebarProps>();
const emit = defineEmits<AgentSidebarEvents>();
const sidebar = useAgentSidebar(props, emit);
const { quickSwitchAgentIds } = toRefs(sidebar);
defineExpose({ quickSwitchAgentIds });
</script>

<style scoped>
.agent-sidebar-pane {
  --agent-sidebar-width: 260px;
  --agent-sidebar-min-width: 200px;
  --agent-sidebar-max-width: 420px;
  display: flex;
  flex: 0 0 clamp(var(--agent-sidebar-min-width), var(--agent-sidebar-width), var(--agent-sidebar-max-width));
  width: clamp(var(--agent-sidebar-min-width), var(--agent-sidebar-width), var(--agent-sidebar-max-width));
  min-width: var(--agent-sidebar-min-width);
  max-width: var(--agent-sidebar-max-width);
  min-height: 0;
}
</style>
