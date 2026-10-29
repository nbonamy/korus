<template>
  <component :is="sidebar.organizationMode === 'repository' ? AgentSidebarRepo : AgentSidebarActivity" :model="sidebar" />
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
