<template>
  <el-dialog
    class="app-dialog app-dialog--compact conversation-history-dialog"
    :model-value="visible"
    :teleported="false"
    width="520px"
    :aria-label="t('sessions.resume')"
    destroy-on-close
    @update:model-value="onVisibilityChanged"
  >
    <template #header>
      <label class="conversation-history-dialog__filter">
        <SearchIcon aria-hidden="true" />
        <input
          ref="filterInput"
          v-model="history.query.value"
          type="search"
          :placeholder="t('sessions.filter')"
          :aria-label="t('sessions.filter')"
          autocomplete="off"
          spellcheck="false"
        >
      </label>
    </template>

    <section class="conversation-history-dialog__body">
      <div class="conversation-history-dialog__sessions" aria-live="polite">
        <p v-if="history.loading.value" class="conversation-history-dialog__state">{{ t('sessions.loading') }}</p>
        <p v-else-if="history.error.value" class="conversation-history-dialog__state conversation-history-dialog__state--error">{{ history.error.value }}</p>
        <p v-else-if="history.filteredSessions.value.length === 0" class="conversation-history-dialog__state">
          {{ history.sessions.value.length === 0 ? t('sessions.none') : t('sessions.noMatch') }}
        </p>
        <template v-else>
          <button
            v-for="session in history.filteredSessions.value"
            :key="session.id"
            class="conversation-history-dialog__row"
            :class="{ 'conversation-history-dialog__row--current': history.isCurrentSession(session) }"
            type="button"
            :disabled="!history.canResume(session)"
            @click="resume(session)"
          >
            <MessageCircleIcon aria-hidden="true" />
            <strong :class="{ 'conversation-history-dialog__title--empty': !session.title.trim() }">{{ history.sessionTitle(session) }}</strong>
            <span v-if="history.isCurrentSession(session)" class="conversation-history-dialog__badge">{{ t('sessions.current') }}</span>
            <span v-else-if="session.storageState === 'archived'" class="conversation-history-dialog__badge">{{ t('sessions.archived') }}</span>
            <small>{{ relativeSessionDate(session.updatedAt, Date.now(), t) }}</small>
          </button>
        </template>
      </div>
    </section>
  </el-dialog>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconSearch as SearchIcon } from '@tabler/icons-vue';
import type { Agent, ConversationListInput, ConversationResumeTarget, ConversationSummary } from '@workspace/core/contracts';
import { MessageCircleIcon } from '../shared/icons/app-icons';
import { relativeSessionDate, useSessionHistory } from './use-session-history';

const props = withDefaults(defineProps<{
  agent: Agent;
  listConversations?: (agentId: string, input?: ConversationListInput) => Promise<ConversationSummary[]>;
  resumeConversation?: (agentId: string, target: ConversationResumeTarget) => Promise<void>;
  visible: boolean;
}>(), {
  listConversations: async () => [],
  resumeConversation: async () => undefined,
});

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const filterInput = ref<HTMLInputElement | null>(null);
const history = useSessionHistory({
  agent: () => props.agent,
  visible: () => props.visible,
  listConversations: (agentId) => props.listConversations(agentId),
  resumeConversation: (agentId, conversationRef) => props.resumeConversation(agentId, conversationRef),
  translate: t,
});

watch(() => props.visible, async (visible) => {
  if (!visible) return;
  await nextTick();
  filterInput.value?.focus();
}, { immediate: true });

async function resume(session: ConversationSummary): Promise<void> {
  if (await history.resume(session)) emit('close');
}

function onVisibilityChanged(visible: boolean): void {
  if (!visible) emit('close');
}
</script>

<style scoped>
.conversation-history-dialog__body {
  padding: var(--space-4) var(--space-6) var(--space-6);
}

.conversation-history-dialog__filter {
  display: grid;
  grid-template-columns: var(--icon-md) minmax(0, 1fr);
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-6);
}

.conversation-history-dialog__filter svg {
  width: var(--icon-md);
  height: var(--icon-md);
  color: var(--color-text-muted);
}

.conversation-history-dialog__filter input {
  min-width: 0;
  padding: 0;
  border: 0;
  outline: 0;
  color: var(--color-text);
  background: transparent;
  font: inherit;
}

.conversation-history-dialog__sessions {
  max-height: min(48vh, 360px);
  overflow-y: auto;
}

.conversation-history-dialog__row {
  width: 100%;
  min-height: 38px;
  display: grid;
  grid-template-columns: var(--icon-md) minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-6);
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: transparent;
  text-align: left;
}

.conversation-history-dialog__row:hover:not(:disabled),
.conversation-history-dialog__row:focus-visible {
  outline: 0;
  background: var(--color-surface-base);
}

.conversation-history-dialog__row:disabled {
  cursor: default;
}

.conversation-history-dialog__row > svg {
  width: var(--icon-md);
  height: var(--icon-md);
  color: var(--color-text-muted);
}

.conversation-history-dialog__row strong {
  min-width: 0;
  overflow: hidden;
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-history-dialog__row small {
  color: var(--color-text-muted);
  font-size: var(--font-size-11);
  white-space: nowrap;
}

.conversation-history-dialog__title--empty {
  color: var(--color-text-muted);
  font-style: italic;
}

.conversation-history-dialog__badge {
  padding: 1px var(--space-3);
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
  background: var(--color-surface-base);
  font-size: var(--font-size-11);
}

.conversation-history-dialog__state {
  margin: var(--space-16) 0;
  color: var(--color-text-muted);
  text-align: center;
}

.conversation-history-dialog__state--error {
  color: var(--color-error);
}
</style>
