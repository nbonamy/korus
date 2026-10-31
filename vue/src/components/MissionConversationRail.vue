<template>
  <aside class="mission-conversation-rail" :aria-label="t('missions.support')">
    <div class="mission-conversation-rail__navigation">
      <ElTabs
        v-if="conversations.length > 1"
        v-model="selectedAgentId"
        type="border-card"
        class="mission-conversation-rail__switcher"
        :aria-label="t('missions.conversations')"
      >
        <ElTabPane
          v-for="conversation in conversations"
          :key="conversation.key"
          :name="conversation.agentId"
          :label="tabLabel(conversation)"
        >
          <template #label>
            <span class="mission-conversation-rail__tab-label" :aria-label="tabLabel(conversation)">
              <TargetArrowIcon v-if="conversation.key === 'mission-lead'" aria-hidden="true" />
              <RepositoryIcon v-else-if="tabIcon(conversation)" :icon="tabIcon(conversation)" :name="tabTitle(conversation)" aria-hidden="true" />
              <FolderIcon v-else aria-hidden="true" />
              <strong>{{ tabTitle(conversation) }}</strong>
              <i
                v-if="attentionOf(conversation)"
                class="mission-conversation-rail__dot"
                :data-attention="attentionOf(conversation)"
                aria-hidden="true"
              />
            </span>
          </template>
        </ElTabPane>
      </ElTabs>
      <header v-if="conversations.length <= 1" :aria-label="headerTitle">
        <span class="mission-conversation-rail__mark">
          <CodeIcon v-if="selectedConversation?.run.stage === 'implementation'" aria-hidden="true" />
          <TargetArrowIcon v-else aria-hidden="true" />
        </span>
        <div class="mission-conversation-rail__heading">
          <h2>{{ headerTitle }}</h2>
        </div>
      </header>
    </div>
    <div v-if="displayedAgentId" class="mission-conversation-rail__conversation">
      <slot name="conversation" :agent-id="displayedAgentId" />
      <div ref="conversationOverlay" class="mission-conversation-rail__switch-overlay" aria-hidden="true" />
    </div>
    <div v-else class="mission-conversation-rail__empty">
      <SparklesIcon aria-hidden="true" />
      <p>{{ t(mission.stage === 'ship' ? 'missions.shipConversationHint' : 'missions.missionLeadStarting') }}</p>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { ElTabPane, ElTabs } from 'element-plus';
import { useI18n } from 'vue-i18n';
import type { Agent } from '@workspace/core/contracts';
import type { Mission } from '@workspace/core/missions';
import { agentAttention, missionLeadAgentId } from '@workspace/core/mission-attention';
import { missionRunTicketIndex } from '@workspace/core/mission-execution';
import { repositoryIconForAgent } from '@workspace/core/workspace-sidebar';
import RepositoryIcon from './RepositoryIcon.vue';
import { CodeIcon, FolderIcon, SparklesIcon, TargetArrowIcon } from '../shared/icons/app-icons';

type Conversation = { key: string; agentId: string; run: NonNullable<Mission['execution']>['runs'][number] };
const props = defineProps<{ mission: Mission; agents?: Agent[]; unreadAgentIds?: string[]; repositoryIcons?: Record<string, string> }>();
const selectionBinding = defineModel<string>('selectedAgentId', { default: '' });
const selectedAgentId = ref(selectionBinding.value);
watch(selectionBinding, value => { selectedAgentId.value = value; }, { flush: 'sync' });
watch(selectedAgentId, value => { selectionBinding.value = value; }, { flush: 'sync' });
const emit = defineEmits<{ 'open-conversation': [agentId: string] }>();
const { t } = useI18n();
const storageKey = (missionId: string) => `app.missionConversation.${missionId}`;
watch(() => props.mission.id, id => {
  try { selectedAgentId.value = window.localStorage.getItem(storageKey(id)) ?? ''; }
  catch { selectedAgentId.value = ''; }
}, { immediate: true });
const availableAgentIds = computed(() => new Set(props.agents?.map(agent => agent.id) ?? []));
const conversations = computed<Conversation[]>(() => {
  const entries = new Map<string, Conversation>();
  for (const run of props.mission.execution?.runs ?? []) {
    if (!run.workerId || !availableAgentIds.value.has(run.workerId)) continue;
    const key = conversationKey(run);
    entries.set(key, { key, agentId: run.workerId, run });
  }
  return [...entries.values()];
});
const leadAgentId = computed(() => {
  const lead = missionLeadAgentId(props.mission);
  return lead && availableAgentIds.value.has(lead) ? lead : conversations.value.find(conversation => conversation.key === 'mission-lead')?.agentId ?? '';
});
const selectedConversation = computed(() => conversations.value.find(conversation => conversation.agentId === selectedAgentId.value)
  ?? conversations.value.find(conversation => conversation.agentId === leadAgentId.value));
const conversationAgentId = computed(() => selectedConversation.value?.agentId ?? leadAgentId.value);
const displayedAgentId = ref(conversationAgentId.value);
const conversationOverlay = useTemplateRef<HTMLDivElement>('conversationOverlay');
watch(conversationAgentId, async (id, previous, onCleanup) => {
  const overlay = conversationOverlay.value;
  if (!previous || !overlay?.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    displayedAgentId.value = id;
    return;
  }
  const animation = overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-in-out', fill: 'both' });
  let cancelled = false;
  onCleanup(() => { cancelled = true; animation.cancel(); });
  try {
    await animation.finished;
    if (cancelled) return;
    displayedAgentId.value = id;
    await nextTick();
    if (cancelled) return;
    animation.reverse();
    await animation.finished;
    animation.cancel();
  } catch { /* A newer selection or unmount cancels this transition. */ }
}, { flush: 'post' });
const tabIcon = (conversation: Conversation) => repositoryIconForAgent(
  props.agents?.find(agent => agent.id === conversation.agentId), props.repositoryIcons ?? {},
);
const headerTitle = computed(() => selectedConversation.value ? tabTitle(selectedConversation.value) : t('missions.missionLead'));

watch([selectedAgentId, conversations, leadAgentId], ([selected, choices, lead]) => {
  if (selected !== lead && !choices.some(conversation => conversation.agentId === selected)) selectedAgentId.value = lead;
}, { immediate: true });
watch([() => props.mission.id, selectedAgentId], ([id, agentId]) => {
  try {
    if (agentId) window.localStorage.setItem(storageKey(id), agentId);
    else window.localStorage.removeItem(storageKey(id));
  } catch { /* Keep the current selection when client storage is unavailable. */ }
}, { immediate: true });
watch(displayedAgentId, agentId => { if (agentId) emit('open-conversation', agentId); }, { immediate: true });

const unreadIds = computed(() => new Set(props.unreadAgentIds ?? []));
const attentionOf = (conversation: Conversation) => agentAttention(props.agents?.find(agent => agent.id === conversation.agentId), unreadIds.value);
function tabLabel(conversation: Conversation): string {
  const attention = attentionOf(conversation);
  if (!attention) return tabTitle(conversation);
  return `${tabTitle(conversation)}, ${attention === 'needsInput' ? t('status.awaitingInput') : t('sidebar.unread')}`;
}

function tabTitle(conversation: Conversation): string {
  if (conversation.run.stage === 'implementation') {
    const repositoryPath = conversation.run.repositoryPath
      ?? props.mission.artifacts.tickets[conversation.run.ticketIndex ?? -1]?.repositoryPath;
    const name = repositoryPath?.split(/[\\/]/u).filter(Boolean).at(-1) ?? t('missions.builder');
    const siblings = conversations.value.filter(candidate => candidate.run.stage === 'implementation'
      && (candidate.run.repositoryPath ?? props.mission.artifacts.tickets[candidate.run.ticketIndex ?? -1]?.repositoryPath) === repositoryPath);
    const index = missionRunTicketIndex(props.mission, conversation.run);
    const attempts = siblings.filter(candidate => missionRunTicketIndex(props.mission, candidate.run) === index);
    const label = siblings.length > 1 && index !== undefined ? `${name} · ${index + 1}` : name;
    return attempts.length > 1 ? `${label} · ${t('missions.attempt', { count: attempts.indexOf(conversation) + 1 })}` : label;
  }
  return t('missions.missionLead');
}

function conversationKey(run: Conversation['run']): string {
  if (run.stage !== 'implementation') return 'mission-lead';
  return `worker:${run.workerId}`;
}
</script>

<style scoped>
.mission-conversation-rail {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border-left: 1px solid var(--color-border);
  background: var(--color-surface-lowest);
}

.mission-conversation-rail__navigation {
  display: flex;
  height: var(--workbench-subheader-height);
  flex: 0 0 auto;
  flex-direction: column;
  background: var(--color-surface-lowest);
}

.mission-conversation-rail__navigation > header {
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  gap: var(--space-4);
  padding: 0 var(--space-8);
  border-bottom: 1px solid var(--color-border);
}

.mission-conversation-rail__heading {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: var(--space-1);
}

.mission-conversation-rail__heading h2 {
  overflow: hidden;
  margin: 0;
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mission-conversation-rail__mark {
  display: grid;
  width: var(--space-12);
  height: var(--space-12);
  flex: 0 0 var(--space-12);
  place-items: center;
  border-radius: var(--radius-full);
  color: var(--color-primary);
  background: var(--color-primary-container);
}

.mission-conversation-rail__mark svg {
  width: var(--icon-md);
  height: var(--icon-md);
}

.mission-conversation-rail__switcher {
  --el-tabs-header-height: var(--workbench-subheader-height);
  flex: 0 0 auto;
  border: 0;
  box-shadow: none;
}

.mission-conversation-rail__switcher :deep(.el-tabs__content) {
  display: none;
}

.mission-conversation-rail__switcher :deep(.el-tabs__header .el-tabs__item.is-top) {
  padding: 0 var(--space-8);
  color: var(--color-text-muted);
}

.mission-conversation-rail__switcher :deep(.el-tabs__header .el-tabs__item.is-active) {
  border-bottom-color: var(--color-border);
  color: var(--color-primary);
  background-color: var(--color-surface-lowest);
}

.mission-conversation-rail__switcher :deep(.el-tabs__item:focus-visible) {
  border-radius: 0;
  box-shadow: none;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.mission-conversation-rail__tab-label {
  display: flex;
  gap: var(--space-2);
  min-width: 0;
  align-items: center;
}

.mission-conversation-rail__tab-label > svg {
  width: var(--icon-md);
  height: var(--icon-md);
  flex: 0 0 auto;
}

.mission-conversation-rail__conversation {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.mission-conversation-rail__switch-overlay {
  position: absolute;
  z-index: 2;
  inset: 0;
  background: var(--color-surface-lowest);
  opacity: 0;
  pointer-events: none;
}

.mission-conversation-rail__dot {
  align-self: center;
  flex: 0 0 auto;
  width: var(--agent-status-dot-size, 8px);
  height: var(--agent-status-dot-size, 8px);
  border-radius: var(--radius-full);
  background: var(--color-error);
}

.mission-conversation-rail__dot[data-attention="needsInput"] {
  background: var(--color-primary);
}

.mission-conversation-rail__switcher strong {
  overflow: hidden;
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mission-conversation-rail :deep(.conversation-pane) {
  flex: 1;
  min-height: 0;
}

.mission-conversation-rail__empty {
  display: grid;
  flex: 1;
  place-items: center;
  align-content: center;
  gap: var(--space-4);
  padding: var(--space-10);
  color: var(--color-text-muted);
  text-align: center;
}

.mission-conversation-rail__empty svg {
  width: var(--icon-xl);
  height: var(--icon-xl);
  color: var(--color-primary);
}

@container (max-width: 980px) {
  .mission-conversation-rail {
    display: none;
  }
}
</style>
