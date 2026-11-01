<template>
  <div
    class="automation-execution-conversation-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="automation-execution-conversation-title"
  >
    <div
      class="automation-execution-conversation-overlay__scrim"
      aria-hidden="true"
    />
    <div class="automation-execution-conversation-overlay__card">
      <header class="automation-execution-conversation-overlay__header">
        <div>
          <h4 id="automation-execution-conversation-title">
            {{ ticket }}
          </h4>
          <span>{{ agentName }}</span>
        </div>
        <button
          type="button"
          :aria-label="$t('surface.automationExecutionConversationOverlay.closeConversationPreview')"
          @click="emit('close')"
        >
          <X aria-hidden="true" />
        </button>
      </header>

      <div
        v-if="loading"
        class="automation-execution-conversation-overlay__empty"
      > {{ $t('surface.automationExecutionConversationOverlay.loadingConversation') }} </div>
      <div
        v-else-if="error"
        class="automation-execution-conversation-overlay__empty"
      >
        {{ error }}
      </div>
      <CodexMessageList
        v-else-if="messages.length > 0"
        class="automation-execution-conversation-overlay__messages"
        actions-disabled
        :can-delete-message="false"
        :can-edit-message="false"
        :can-retry-message="false"
        follow-ups-disabled
        :messages="messages"
        :tool-visibility="isAppToolVisible"
      />
      <div
        v-else
        class="automation-execution-conversation-overlay__empty"
      > {{ $t('surface.automationExecutionConversationOverlay.noMessagesForThisExecution') }} </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { RendererMessage } from '@workspace/core/contracts';
import { CodexMessageList } from '@codex-app-sdk/vue';
import { useI18n } from 'vue-i18n';
import { X } from '../shared/icons/app-icons';
import { isAppToolVisible, provideAppToolPresentation } from '../tool-presentation';

const { t } = useI18n();
provideAppToolPresentation((key, params) => t(key, params ?? {}));

const props = defineProps<{
  agentName: string;
  error?: string | null;
  loading?: boolean;
  messages: RendererMessage[];
  ticket: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

</script>

<style scoped>
.automation-execution-conversation-overlay {
  position: fixed;
  inset: var(--space-32);
  z-index: 20;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: var(--space-24);
  background: transparent;
}

.automation-execution-conversation-overlay__scrim {
  position: absolute;
  inset: 0;
  background: var(--color-overlay);
  backdrop-filter: blur(8px);
}

.automation-execution-conversation-overlay__card {
  position: relative;
  z-index: 1;
  width: min(960px, 100%);
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-2xl);
  background: var(--color-shell-main);
  box-shadow: var(--shadow-lg);
}

.automation-execution-conversation-overlay__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-16);
  padding: var(--space-12) var(--space-16);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-shell-main);
}

.automation-execution-conversation-overlay__header div {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.automation-execution-conversation-overlay__header h4,
.automation-execution-conversation-overlay__header span {
  margin: 0;
}

.automation-execution-conversation-overlay__header h4 {
  color: var(--color-text);
  font-size: var(--font-size-15);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-20);
}

.automation-execution-conversation-overlay__header span {
  display: block;
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.automation-execution-conversation-overlay__header button {
  width: 32px;
  height: 32px;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.automation-execution-conversation-overlay__header button:hover,
.automation-execution-conversation-overlay__header button:focus-visible {
  color: var(--color-text);
  background: var(--color-surface);
}

.automation-execution-conversation-overlay__header svg {
  width: var(--icon-md);
  height: var(--icon-md);
}

.automation-execution-conversation-overlay__messages {
  min-height: 0;
  background: var(--color-shell-main);
  --message-list-content-width: 780px;
}

.automation-execution-conversation-overlay__empty {
  flex: 1 1 auto;
  display: grid;
  place-items: center;
  padding: var(--space-32);
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
  line-height: var(--line-height-20);
}
</style>
