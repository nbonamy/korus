<template>
  <button class="agent-sidebar__repository-agent">
    <ShareIcon v-if="session.shared" class="agent-sidebar__session-icon" role="img" :aria-label="$t('guest.shared')" />
    <RemoteHostIndicator v-if="groupKind === 'repository' && session.remoteConnectionId" :connection-id="session.remoteConnectionId" :connection="host" branch>
      <component :is="session.kind === 'worktree' ? GitForkIcon : GitBranchIcon" class="agent-sidebar__session-icon" aria-hidden="true" />
    </RemoteHostIndicator>
    <component
      :is="session.kind === 'worktree' ? GitForkIcon : GitBranchIcon"
      v-else-if="groupKind === 'repository'"
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
import type { RemoteConnection } from '@workspace/core/contracts';
import { GitBranchIcon, GitForkIcon } from '../shared/icons/app-icons';
import RemoteHostIndicator from './RemoteHostIndicator.vue';
import { IconShare as ShareIcon } from '@tabler/icons-vue';

defineProps<{ session: WorkspaceSidebarSession; groupKind: WorkspaceSidebarGroup['kind']; host?: RemoteConnection }>();
</script>

<style scoped src="./agent-row.css"></style>
