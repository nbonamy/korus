<template>
  <button class="agent-sidebar__repository-agent">
    <ShareIcon v-if="session.shared" class="agent-sidebar__session-icon" role="img" :aria-label="$t('guest.shared')" />
    <el-tooltip v-if="groupKind === 'repository' && host" :content="host.label" placement="top" :show-after="300">
      <span class="agent-sidebar__session-glyph" role="img" :aria-label="host.label">
        <NetworkIcon v-if="host.offline" class="agent-sidebar__session-icon agent-sidebar__session-icon--offline" aria-hidden="true" />
        <template v-else>
          <component :is="session.kind === 'worktree' ? GitForkIcon : GitBranchIcon" class="agent-sidebar__session-icon" aria-hidden="true" />
          <NetworkIcon class="agent-sidebar__session-badge" aria-hidden="true" />
        </template>
      </span>
    </el-tooltip>
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
import { GitBranchIcon, GitForkIcon, NetworkIcon } from '../shared/icons/app-icons';
import { IconShare as ShareIcon } from '@tabler/icons-vue';

defineProps<{ session: WorkspaceSidebarSession; groupKind: WorkspaceSidebarGroup['kind']; host?: { label: string; offline: boolean } }>();
</script>

<style scoped src="./agent-row.css"></style>
