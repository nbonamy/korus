<template>
  <button class="agent-sidebar__activity-agent" :class="{ 'agent-sidebar__activity-agent--cleanup': cleanup }">
    <ShareIcon v-if="session.shared" class="agent-sidebar__session-icon" role="img" :aria-label="$t('guest.shared')" />
    <span v-else-if="repositoryIcon" class="agent-sidebar__repository-mark" aria-hidden="true">
      <RepositoryIcon :icon="repositoryIcon" :name="context ?? ''" />
    </span>
    <component :is="icon" v-else class="agent-sidebar__session-icon" aria-hidden="true" />
    <span class="agent-sidebar__meta">
      <strong class="agent-sidebar__session-title" :class="{ 'agent-sidebar__session-title--active': session.isActive }">{{ session.customName ?? (quickChat ? session.displayTitle : context) ?? session.displayTitle }}</strong>
      <span v-if="subtitle" class="agent-sidebar__session-context">{{ subtitle }}</span>
    </span>
    <slot />
    <span v-if="!shortcutVisible && (unread || age)" class="agent-sidebar__activity-indicator" :class="{ 'agent-sidebar__activity-indicator--age': !unread && age }">
      <span v-if="unread" class="agent-sidebar__activity-unread" :aria-label="unreadLabel" />
      <span v-else-if="age" class="agent-sidebar__session-context agent-sidebar__activity-time">{{ age }}</span>
    </span>
  </button>
</template>

<script setup lang="ts">
import { IconShare as ShareIcon } from '@tabler/icons-vue';
import { computed } from 'vue';
import type { WorkspaceSidebarSession } from '@workspace/core/workspace-sidebar';
import RepositoryIcon from './RepositoryIcon.vue';
import { FolderIcon, FolderRootIcon, GitBranchIcon, GitForkIcon, MessageIcon } from '../shared/icons/app-icons';

const props = defineProps<{ session: WorkspaceSidebarSession; context?: string; repository?: boolean; repositoryIcon?: string; age?: string; quickChat?: boolean; cleanup: boolean; unread?: boolean; unreadLabel?: string; shortcutVisible?: boolean }>();
const subtitle = computed(() => props.quickChat ? props.context
  : [props.session.customName ? props.context : null, props.session.branch].filter(Boolean).join(' · '));
const icon = computed(() => props.quickChat ? MessageIcon
  : props.repository ? FolderRootIcon
  : props.session.kind === 'worktree' ? GitForkIcon
    : props.session.kind === 'folder' ? FolderIcon : GitBranchIcon);
</script>

<style scoped src="./agent-row.css"></style>
<style scoped>
.agent-sidebar__activity-agent.agent-sidebar__agent {
  display: flex;
  gap: 0;
  min-height: 48px;
  padding: var(--space-4) var(--space-6);
  align-items: start;
}

.agent-sidebar__activity-agent--cleanup.agent-sidebar__agent {
  padding-right: calc(var(--space-6) + var(--agent-sidebar-status-column-width, 12px) + var(--space-4));
}

.agent-sidebar__meta {
  flex: 1;
  margin-left: var(--agent-sidebar-workspace-column-gap, 4px);
}

.agent-sidebar__session-icon {
  flex: 0 0 var(--agent-sidebar-repository-icon-column-width, 24px);
  margin-top: var(--space-1);
}

.agent-sidebar__repository-mark {
  display: grid;
  flex: 0 0 var(--agent-sidebar-repository-icon-column-width, 24px);
  place-items: center;
  margin-top: var(--space-1);
  color: var(--color-text-muted);
}

.agent-sidebar__repository-mark .agent-avatar {
  --agent-avatar-size: 14px;
}

.agent-sidebar__activity-agent[data-session-kind="branch"] .agent-sidebar__session-icon {
  color: var(--color-primary);
}

/* One trailing column holds the unread dot or the age. Dots stay tight to the icon. */
.agent-sidebar__activity-indicator {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  align-self: center;
  min-width: var(--agent-status-dot-size, 8px);
  margin-left: var(--space-1);
}

.agent-sidebar__activity-indicator--age {
  width: auto;
  min-width: 3ch;
}

/* Ages stay out of the way until you point at the section; Working always shows how long it has run. */
.agent-sidebar__activity-time {
  font-variant-numeric: tabular-nums;
  opacity: 0;
  transition: opacity 120ms ease;
}

[data-activity-group]:hover .agent-sidebar__activity-time,
[data-activity-group="working"] .agent-sidebar__activity-time {
  opacity: 1;
}

.agent-sidebar__session-context {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  line-height: var(--line-height-16);
}

.agent-sidebar__activity-unread {
  flex: none;
  width: var(--agent-status-dot-size, 8px);
  height: var(--agent-status-dot-size, 8px);
  border-radius: var(--radius-full);
  background: var(--color-error);
}

.agent-sidebar__activity-agent :slotted(.agent-sidebar__engine) {
  align-self: center;
  flex-shrink: 0;
  margin: 0 0 0 var(--space-4);
}

.agent-sidebar__activity-agent :slotted(.agent-sidebar__quick-switch-shortcut) {
  align-self: center;
  flex-shrink: 0;
  margin: 0 0 0 var(--space-4);
}
</style>
