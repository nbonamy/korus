<template>
  <button class="agent-sidebar__repository-agent">
    <component
      :is="session.kind === 'worktree' ? GitForkIcon : GitBranchIcon"
      v-if="groupKind === 'repository'"
      class="agent-sidebar__session-icon"
      aria-hidden="true"
    />
    <span class="agent-sidebar__meta">
      <strong class="agent-sidebar__session-title" :class="{ 'agent-sidebar__session-title--active': session.isActive }">{{ session.displayTitle }}</strong>
    </span>
    <slot />
  </button>
</template>

<script setup lang="ts">
import type { WorkspaceSidebarGroup, WorkspaceSidebarSession } from '@workspace/core/workspace-sidebar';
import { GitBranchIcon, GitForkIcon } from '../shared/icons/app-icons';

defineProps<{ session: WorkspaceSidebarSession; groupKind: WorkspaceSidebarGroup['kind'] }>();
</script>

<style scoped src="./agent-row.css"></style>
