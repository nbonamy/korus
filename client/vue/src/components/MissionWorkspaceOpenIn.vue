<template>
  <OpenInControl
    v-if="showUnavailable || (available && catalog.applications.length > 0)"
    :application="effectiveOpenInApplication(agent, catalog)"
    :catalog="catalog"
    :disabled="!available || catalog.applications.length === 0"
    @open="emit('open', { agentId: agent.id, application: $event, path: workspacePath })"
  />
</template>

<script setup lang="ts">
import type { Agent, OpenInApplication, OpenInApplicationCatalog } from '@workspace/core/contracts';
import { effectiveOpenInApplication } from '../shared/open-in';
import OpenInControl from '../shared/OpenInControl.vue';

export type MissionWorkspaceOpenRequest = {
  agentId: string;
  application: OpenInApplication;
  path: string;
};

defineProps<{
  agent: Agent;
  available?: boolean;
  catalog: OpenInApplicationCatalog;
  showUnavailable?: boolean;
  workspacePath: string;
}>();

const emit = defineEmits<{ open: [request: MissionWorkspaceOpenRequest] }>();
</script>
