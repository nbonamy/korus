<template>
  <div class="thread-flag-affordance" role="status">
    <GitBranchIcon v-if="isProposal" class="thread-flag-affordance__icon" aria-hidden="true" />
    <IconChecklist v-else class="thread-flag-affordance__icon" aria-hidden="true" />
    <span class="thread-flag-affordance__prompt">{{ t(copyKey('prompt')) }}</span>
    <div class="thread-flag-affordance__actions">
      <template v-if="isProposal">
        <button
          v-for="choice in proposalChoices"
          :key="choice.action"
          class="thread-flag-affordance__choice"
          type="button"
          :aria-label="t(copyKey(choice.key))"
          :disabled="busy"
          @click="emit('respond', { id: 'work_proposed', action: choice.action })"
        >{{ t(copyKey(choice.key)) }}</button>
      </template>
      <template v-else>
        <button
          class="thread-flag-affordance__action"
          type="button"
          :aria-label="t(copyKey('accept'))"
          :title="t(copyKey('accept'))"
          :disabled="busy"
          @click="emit('respond', { id: 'ready_for_review', action: 'execute' })"
        ><CheckIcon aria-hidden="true" /></button>
        <button
          class="thread-flag-affordance__dismiss"
          type="button"
          :aria-label="t(copyKey('dismiss'))"
          :title="t(copyKey('dismiss'))"
          :disabled="busy"
          @click="emit('respond', { id: 'ready_for_review', action: 'dismiss' })"
        ><X aria-hidden="true" /></button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ThreadFlagId, ThreadFlagResponse } from '@workspace/core/thread-flags';
import { IconChecklist } from '@tabler/icons-vue';
import { CheckIcon, GitBranchIcon, X } from '../shared/icons/app-icons';

const props = defineProps<{ id: ThreadFlagId; busy?: boolean }>();
const emit = defineEmits<{ respond: [response: ThreadFlagResponse] }>();
const { t } = useI18n();
const isProposal = computed(() => props.id !== 'ready_for_review');
const proposalChoices = [
  { action: 'delegate', key: 'delegate' },
  { action: 'create_mission', key: 'createMission' },
  { action: 'dismiss', key: 'dismiss' },
] as const;

function copyKey(kind: 'prompt' | 'accept' | 'dismiss' | 'delegate' | 'createMission'): string {
  return `chat.threadFlags.${isProposal.value ? 'workProposed' : 'readyForReview'}.${kind}`;
}
</script>

<style scoped>
.thread-flag-affordance {
  width: 100%;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-4);
  color: var(--color-text-muted);
}

.thread-flag-affordance__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
  display: block;
  flex: 0 0 auto;
}

.thread-flag-affordance__prompt {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-14);
  line-height: var(--line-height-18);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thread-flag-affordance__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-2);
}

.thread-flag-affordance__action,
.thread-flag-affordance__dismiss,
.thread-flag-affordance__choice {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: transparent;
  font-size: var(--font-size-12);
  line-height: var(--line-height-18);
  cursor: pointer;
}

.thread-flag-affordance__choice {
  min-height: var(--space-12);
  padding: var(--space-2) var(--space-4);
  white-space: nowrap;
}

.thread-flag-affordance__action {
  width: var(--space-12);
  height: var(--space-12);
  padding: 0;
  color: var(--color-text-muted);
}

.thread-flag-affordance__dismiss {
  width: var(--space-12);
  height: var(--space-12);
  padding: 0;
  color: var(--color-text-muted);
}

.thread-flag-affordance__action svg,
.thread-flag-affordance__dismiss svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.thread-flag-affordance button:hover:not(:disabled) {
  background: var(--color-surface-high);
}

.thread-flag-affordance button:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
