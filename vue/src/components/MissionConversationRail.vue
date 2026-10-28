<template>
  <aside class="mission-conversation-rail" :aria-label="t('missions.support')">
    <div class="mission-conversation-rail__navigation">
      <header>
        <span class="mission-conversation-rail__mark">
          <CodeIcon v-if="selectedConversation?.run.stage === 'implementation'" aria-hidden="true" />
          <TargetArrowIcon v-else aria-hidden="true" />
        </span>
        <div class="mission-conversation-rail__heading">
          <h2>{{ headerTitle }}</h2>
          <p><strong>{{ headerRole }}</strong><span>{{ headerHint }}</span></p>
        </div>
      </header>
      <div
        v-if="conversations.length > 1"
        class="mission-conversation-rail__switcher"
        role="tablist"
        :aria-label="t('missions.conversations')"
      >
        <button
          v-for="conversation in conversations"
          :key="conversation.key"
          type="button"
          role="tab"
          :aria-label="tabLabel(conversation)"
          :aria-selected="conversation.key === selectedConversation?.key"
          @click="selectedAgentId = conversation.agentId"
        >
          <strong>{{ tabTitle(conversation) }}</strong>
          <i
            v-if="attentionOf(conversation)"
            class="mission-conversation-rail__dot"
            :data-attention="attentionOf(conversation)"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
    <slot v-if="conversationAgentId" name="conversation" :agent-id="conversationAgentId" />
    <div v-else class="mission-conversation-rail__empty">
      <SparklesIcon aria-hidden="true" />
      <p>{{ t(mission.stage === 'ship' ? 'missions.shipConversationHint' : 'missions.missionLeadStarting') }}</p>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Agent } from '@workspace/core/contracts';
import type { Mission } from '@workspace/core/missions';
import { agentAttention } from '@workspace/core/mission-attention';
import { missionRunTicketIndex, pendingMissionRun } from '@workspace/core/mission-execution';
import { CodeIcon, SparklesIcon, TargetArrowIcon } from '../shared/icons/app-icons';

type Conversation = { key: string; agentId: string; run: NonNullable<Mission['execution']>['runs'][number] };
const props = defineProps<{ mission: Mission; agents?: Agent[]; unreadAgentIds?: string[] }>();
const selectedAgentId = defineModel<string>('selectedAgentId', { default: '' });
const emit = defineEmits<{ 'open-conversation': [agentId: string] }>();
const { t } = useI18n();
const activeRun = computed(() => pendingMissionRun(props.mission));
const preferredAgentId = computed(() => activeRun.value?.workerId
  ?? props.mission.execution?.runs.slice().reverse().find(run => run.stage === props.mission.stage && run.workerId)?.workerId
  ?? props.mission.stageAgentIds[props.mission.stage]
  ?? '');
const conversations = computed<Conversation[]>(() => {
  const entries = new Map<string, Conversation>();
  for (const run of props.mission.execution?.runs ?? []) {
    if (!run.workerId) continue;
    const key = conversationKey(run);
    entries.set(key, { key, agentId: run.workerId, run });
  }
  return [...entries.values()];
});
const selectedConversation = computed(() => conversations.value.find(conversation => conversation.agentId === selectedAgentId.value)
  ?? conversations.value.find(conversation => conversation.agentId === preferredAgentId.value));
const conversationAgentId = computed(() => selectedConversation.value?.agentId ?? preferredAgentId.value);
const headerTitle = computed(() => selectedConversation.value ? tabTitle(selectedConversation.value) : t('missions.missionLead'));
const headerRole = computed(() => selectedConversation.value?.run.stage === 'implementation'
  ? t('missions.builder')
  : t(`missions.${selectedConversation.value?.run.stage ?? props.mission.stage}`));
const headerHint = computed(() => {
  const run = selectedConversation.value?.run;
  if (run?.stage === 'implementation' && run.ticketIndex !== undefined) {
    return props.mission.artifacts.tickets[run.ticketIndex]?.title ?? t('missions.implementationAgentHint');
  }
  return run ? t(`missions.stageActivity.${run.stage}`) : t('missions.missionLeadHint');
});

watch(preferredAgentId, (agentId, previous) => {
  if (!selectedAgentId.value || selectedAgentId.value === previous) selectedAgentId.value = agentId;
}, { immediate: true });
watch(conversationAgentId, agentId => { if (agentId) emit('open-conversation', agentId); }, { immediate: true });

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
    return siblings.length > 1 && index !== undefined ? `${name} · ${index + 1}` : name;
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
  flex: 0 0 auto;
  background: var(--color-surface-lowest);
}

.mission-conversation-rail__navigation > header {
  display: flex;
  min-height: var(--workbench-subheader-height);
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-8);
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

.mission-conversation-rail__heading p {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: var(--space-2);
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  line-height: var(--line-height-18);
}

.mission-conversation-rail__heading p strong {
  flex: 0 0 auto;
  color: var(--color-text);
  font-weight: var(--font-weight-medium);
}

.mission-conversation-rail__heading p span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mission-conversation-rail__heading p span::before {
  margin-right: var(--space-2);
  content: "·";
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
  display: flex;
  gap: var(--space-8);
  padding: 0 var(--space-8);
  overflow-x: auto;
  border-bottom: 1px solid var(--color-border);
}

.mission-conversation-rail__switcher button {
  display: flex;
  gap: var(--space-4);
  min-width: 0;
  flex: 0 0 auto;
  align-items: center;
  padding: var(--space-3) 0 var(--space-4);
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--color-text-muted);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.mission-conversation-rail__switcher button:hover,
.mission-conversation-rail__switcher button:focus-visible {
  color: var(--color-text);
}

.mission-conversation-rail__switcher button[aria-selected="true"] {
  border-bottom-color: var(--color-primary);
  color: var(--color-text);
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
