<template>
  <div class="automation-execution-log__status-cell">
    <span
      class="automation-execution-log__status"
      :data-status="status"
    >
      {{ statusLabel }}
    </span>
    <div class="automation-execution-log__row-actions">
      <button
        type="button"
        :aria-label="$t('dynamic.automations.viewConversation', { ticket })"
        @click.stop="emit('view-conversation')"
      >
        <EyeIcon aria-hidden="true" />
      </button>
      <button
        type="button"
        :aria-label="$t('dynamic.automations.deleteExecution', { ticket })"
        :disabled="status === 'working' || status === 'awaitingInput'"
        @click.stop="emit('delete-execution')"
      >
        <Trash2Icon aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AutomationExecutionStatus } from '@workspace/core/contracts';
import { EyeIcon, Trash2Icon } from '../shared/icons/app-icons';

defineProps<{
  status: AutomationExecutionStatus;
  statusLabel: string;
  ticket: string;
}>();

const emit = defineEmits<{
  'delete-execution': [];
  'view-conversation': [];
}>();
</script>

<style scoped>
.automation-execution-log__status {
  display: block;
  color: var(--color-success);
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-18);
  white-space: nowrap;
}

.automation-execution-log__status-cell {
  height: 18px;
  min-width: 68px;
  display: flex;
  align-items: center;
  justify-items: end;
}

.automation-execution-log__status[data-status="working"],
.automation-execution-log__status[data-status="awaitingInput"] {
  color: var(--color-warning);
}

.automation-execution-log__status[data-status="failed"] {
  color: var(--color-error);
}

.automation-execution-log__row-actions {
  display: none;
  align-items: center;
  gap: var(--space-2);
}

.automation-execution-log__status-cell:hover .automation-execution-log__status,
.automation-execution-log__status-cell:focus-within .automation-execution-log__status {
  display: none;
}

.automation-execution-log__status-cell:hover .automation-execution-log__row-actions,
.automation-execution-log__status-cell:focus-within .automation-execution-log__row-actions {
  display: flex;
}

.automation-execution-log__row-actions button {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.automation-execution-log__row-actions button:hover,
.automation-execution-log__row-actions button:focus-visible {
  color: var(--color-text);
}

.automation-execution-log__row-actions svg {
  width: var(--icon-md);
  height: var(--icon-md);
}
</style>
