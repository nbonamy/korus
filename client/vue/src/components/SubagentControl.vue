<template>
  <div ref="root" class="subagent-control">
    <button
      class="subagent-control__trigger"
      type="button"
      :aria-label="triggerLabel"
      :title="triggerLabel"
      :aria-expanded="menuOpen"
      @click.stop="menuOpen = !menuOpen"
    >
      <IconLego aria-hidden="true" />
      <span v-if="activeCount > 0" class="subagent-control__count" aria-hidden="true">{{ activeCount }}</span>
    </button>

    <section
      v-if="menuOpen"
      class="subagent-control__menu"
      role="menu"
      :aria-label="t('chat.subagents.label')"
    >
      <header class="subagent-control__menu-header">
        <strong>{{ t('chat.subagents.label') }}</strong>
        <span>{{ t('chat.subagents.totalCount', { count: nodes.length }) }}</span>
      </header>
      <button
        v-for="entry in displayedEntries"
        :key="entry.node.conversationId"
        class="subagent-control__row"
        :class="{ 'subagent-control__row--selected': entry.node.conversationId === selectedConversationId }"
        :style="{ '--subagent-depth': String(entry.depth) }"
        type="button"
        role="menuitem"
        @click="selectSubagent(entry.node.conversationId)"
      >
        <span
          class="subagent-control__status"
          :data-status="entry.node.status"
          aria-hidden="true"
        />
        <span class="subagent-control__info">
          <strong class="subagent-control__name">{{ nodeLabel(entry.node) }}</strong>
        </span>
        <span class="subagent-control__time">{{ nodeTime(entry.node) }}</span>
      </button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { IconLego } from '@tabler/icons-vue';
import { useI18n } from 'vue-i18n';
import type { AgentSubagentTree, SubagentNode } from '@workspace/core/contracts';

const props = defineProps<{
  tree: AgentSubagentTree;
  selectedConversationId?: string | null;
}>();

const emit = defineEmits<{
  select: [conversationId: string];
}>();

const { t } = useI18n();

const root = ref<HTMLElement | null>(null);
const menuOpen = ref(false);
const nodes = computed(() => Object.values(props.tree.nodes).filter((node) => (
  node.conversationId !== props.tree.rootConversationId
)));
const activeCount = computed(() => nodes.value.filter((node) => node.status === 'running' || node.status === 'pendingInit').length);
const triggerLabel = computed(() => activeCount.value > 0
  ? t('chat.subagents.triggerActive', { count: activeCount.value })
  : t('chat.subagents.label'));
const flattenedNodes = computed(() => flattenNodes(props.tree));
const activeEntries = computed(() => flattenedNodes.value.filter(({ node }) => isActive(node)));
const doneEntries = computed(() => flattenedNodes.value.filter(({ node }) => !isActive(node)));
const displayedEntries = computed(() => [...activeEntries.value, ...doneEntries.value]);
const now = ref(Date.now());
let clockInterval: number | undefined;

onMounted(() => document.addEventListener('click', closeMenuOnOutsideClick));
onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenuOnOutsideClick);
  stopClock();
});

watch([menuOpen, activeCount], ([isOpen, count]) => {
  stopClock();
  now.value = Date.now();
  if (isOpen && count > 0) {
    clockInterval = window.setInterval(() => {
      now.value = Date.now();
    }, 1_000);
  }
});

function selectSubagent(conversationId: string): void {
  menuOpen.value = false;
  emit('select', conversationId);
}

function closeMenuOnOutsideClick(event: MouseEvent): void {
  if (!root.value?.contains(event.target as Node)) menuOpen.value = false;
}

function nodeLabel(node: SubagentNode): string {
  const nickname = node.agentNickname?.trim();
  const pathLabel = node.agentPath?.split('/').filter(Boolean).at(-1)?.trim();
  return nickname || pathLabel || t('chat.subagents.unnamed');
}

function isActive(node: SubagentNode): boolean {
  return node.status === 'running' || node.status === 'pendingInit';
}

function nodeTime(node: SubagentNode): string {
  return isActive(node)
    ? formatElapsed(node.createdAt, now.value)
    : formatRelative(node.updatedAt, now.value);
}

function formatElapsed(value: string, currentTime: number): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, Math.floor((currentTime - timestamp) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function formatRelative(value: string, currentTime: number): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, Math.floor((currentTime - timestamp) / 1_000));
  if (seconds < 60) return t('chat.subagents.now');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('chat.subagents.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('chat.subagents.hoursAgo', { count: hours });
  return t('chat.subagents.daysAgo', { count: Math.floor(hours / 24) });
}

function stopClock(): void {
  if (clockInterval !== undefined) {
    window.clearInterval(clockInterval);
    clockInterval = undefined;
  }
}

function flattenNodes(tree: AgentSubagentTree): Array<{ node: SubagentNode; depth: number }> {
  const nodesByParent = new Map<string, SubagentNode[]>();
  for (const node of Object.values(tree.nodes)) {
    if (node.conversationId === tree.rootConversationId) continue;
    const children = nodesByParent.get(node.parentConversationId) ?? [];
    children.push(node);
    nodesByParent.set(node.parentConversationId, children);
  }
  for (const children of nodesByParent.values()) {
    children.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  const result: Array<{ node: SubagentNode; depth: number }> = [];
  const visited = new Set<string>();
  const visit = (parentConversationId: string, depth: number) => {
    for (const node of nodesByParent.get(parentConversationId) ?? []) {
      if (visited.has(node.conversationId)) continue;
      visited.add(node.conversationId);
      result.push({ node, depth: Math.min(depth, 3) });
      visit(node.conversationId, depth + 1);
    }
  };
  visit(tree.rootConversationId, 0);
  for (const node of Object.values(tree.nodes)) {
    if (node.conversationId === tree.rootConversationId) continue;
    if (visited.has(node.conversationId)) continue;
    visited.add(node.conversationId);
    result.push({ node, depth: 0 });
    visit(node.conversationId, 1);
  }
  return result;
}
</script>

<style scoped>
.subagent-control {
  position: relative;
  -webkit-app-region: no-drag;
}

.subagent-control__trigger {
  position: relative;
  display: grid;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  place-items: center;
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.subagent-control__trigger:hover,
.subagent-control__trigger[aria-expanded="true"] {
  color: var(--color-text);
  background: var(--color-surface-high);
}

.subagent-control__trigger svg {
  width: var(--icon-md);
  height: var(--icon-md);
}

.subagent-control__count {
  position: absolute;
  top: -2px;
  right: -3px;
  min-width: 16px;
  height: 16px;
  padding: 0 var(--space-1);
  border: 2px solid var(--color-shell-main);
  border-radius: var(--radius-full);
  color: var(--color-on-primary);
  background: var(--color-primary);
  font-size: var(--font-size-10);
  font-weight: var(--font-weight-bold);
  line-height: 12px;
}

.subagent-control__menu {
  position: absolute;
  z-index: 40;
  top: calc(100% + var(--space-2));
  right: 0;
  display: flex;
  width: 200px;
  max-height: min(
    320px,
    calc(100vh - var(--workbench-appbar-height) - var(--space-8))
  );
  padding: var(--space-4);
  flex-direction: column;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-menu);
}

.subagent-control__menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4) var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.subagent-control__menu-header strong {
  color: var(--color-text);
  font-size: var(--font-size-13);
}

.subagent-control__row {
  --subagent-depth: 0;

  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  padding-left: calc(var(--space-4) + var(--subagent-depth) * var(--space-8));
  border: 0;
  border-radius: var(--radius-lg);
  color: var(--color-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.subagent-control__row:hover,
.subagent-control__row--selected {
  background: var(--color-surface-low);
}

.subagent-control__status {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--color-outline);
}

.subagent-control__status[data-status="running"] {
  background: var(--color-warning);
}

.subagent-control__status[data-status="pendingInit"] {
  background: var(--color-primary);
}

.subagent-control__status[data-status="errored"],
.subagent-control__status[data-status="notFound"] {
  background: var(--color-error);
}

.subagent-control__name {
  display: block;
  min-width: 0;
  overflow: hidden;
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-regular);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subagent-control__info {
  min-width: 0;
  flex: 1 1 auto;
}

.subagent-control__time {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-variant-numeric: tabular-nums;
  font-weight: var(--font-weight-regular);
  white-space: nowrap;
}
</style>
