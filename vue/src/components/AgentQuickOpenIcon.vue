<template>
  <MessageIcon
    v-if="agent?.sessionKind === 'quickChat'"
    class="agent-quick-open-icon__session"
    data-icon="message"
    aria-hidden="true"
  />
  <RepositoryIcon v-else-if="repositoryIcon || agent?.workspace?.kind !== 'git'"
    :icon="repositoryIcon ?? agent?.avatar"
    :name="name"
  />
  <component
    :is="agent.workspace.isLinkedWorktree ? GitForkIcon : GitBranchIcon"
    v-else
    class="agent-quick-open-icon__session"
    :class="`agent-quick-open-icon__session--${kind}`"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
import type { Agent } from '@workspace/core/contracts';
import { repositoryIconForAgent } from '@workspace/core/workspace-sidebar';
import { computed } from 'vue';
import { GitBranchIcon, GitForkIcon, MessageIcon } from '../shared/icons/app-icons';
import RepositoryIcon from './RepositoryIcon.vue';

const props = defineProps<{
  agent?: Agent;
  name: string;
  repositoryIcons: Readonly<Record<string, string>>;
}>();

const repositoryIcon = computed(() => repositoryIconForAgent(props.agent, props.repositoryIcons));
const kind = computed(() => {
  const workspace = props.agent?.workspace;
  if (workspace?.kind !== 'git') return 'folder';
  if (workspace.isLinkedWorktree) return 'worktree';
  if (workspace.branch === 'main' || workspace.branch === 'master') return 'main';
  return workspace.branch ? 'branch' : 'detached';
});
</script>

<style scoped>
.agent-quick-open-icon__session {
  width: var(--space-8);
  height: var(--space-8);
  stroke-width: 1.8;
  color: var(--color-text-muted);
}
.agent-quick-open-icon__session--main { color: var(--color-primary); }
.agent-quick-open-icon__session--branch { color: var(--color-success); }
.agent-quick-open-icon__session--worktree { color: var(--color-warning); }
</style>
