<template>
  <AppDataList
    class="automation-execution-log"
    :title="automation.name"
    :subtitle="executionCountLabel"
    :aria-label="$t('surface.automationExecutionLog.automationExecutionLog')"
    :columns="executionColumns"
    :empty-text="$t('dynamic.automations.noExecutions')"
    :rows="executionRows"
  >
    <template #headerActions>
      <div class="automation-execution-log__header-actions">
        <el-button
          type="danger"
          :disabled="automation.executionLog.length === 0"
          @click="emit('clear-history', automation.id)"
        > {{ $t('surface.automationExecutionLog.clear') }} </el-button>
        <el-button
          @click="emit('close')"
        > {{ $t('surface.automationExecutionLog.back') }} </el-button>
      </div>
    </template>

    <template #cell-ticket="{ row }">
      <div class="automation-execution-log__ticket-cell">
        <span>{{ row.agentName }}</span>
        <p
          v-if="row.error"
          class="automation-execution-log__error"
        >
          {{ row.error }}
        </p>
      </div>
    </template>

    <template #cell-startedAt="{ row }">
      <time :datetime="startedAtForRow(row)">{{ row.time }}</time>
    </template>

    <template #cell-duration="{ row }">
      <span class="automation-execution-log__muted">{{ row.duration }}</span>
    </template>

    <template #cell-status="{ row }">
      <AutomationExecutionStatusActions
        :status="statusForRow(row)"
        :status-label="statusLabelForRow(row)"
        :ticket="ticketForRow(row)"
        @delete-execution="deleteExecution(row)"
        @view-conversation="openConversation(row)"
      />
    </template>
  </AppDataList>

  <AutomationExecutionConversationOverlay
    v-if="selectedConversation"
    :agent-name="selectedConversation.agentName"
    :error="selectedConversation.error"
    :loading="selectedConversation.loading"
    :messages="selectedConversationMessages"
    :ticket="selectedConversation.ticket"
    @close="closeConversation"
  />
</template>

<script setup lang="ts">
import { translate } from '../i18n';
import { computed, ref } from 'vue';
import type { BackendConversationRef, Automation, AutomationExecutionStatus, RendererMessage } from '@workspace/core/contracts';
import AppDataList from './AppDataList.vue';
import type { AppDataListColumn, AppDataListRow } from './app-data-list';
import AutomationExecutionConversationOverlay from './AutomationExecutionConversationOverlay.vue';
import AutomationExecutionStatusActions from './AutomationExecutionStatusActions.vue';

const props = defineProps<{
  automation: Automation;
  readConversationMessages: (ref: BackendConversationRef, agentId: string) => Promise<RendererMessage[]>;
}>();

const emit = defineEmits<{
  'clear-history': [automationId: string];
  'delete-execution': [payload: { executionId: string; automationId: string }];
  close: [];
}>();

type SelectedConversation = {
  executionId: string;
  agentId: string;
  agentName: string;
  error: string | null;
  loading: boolean;
  messages: RendererMessage[];
  ticket: string;
};

const selectedConversation = ref<SelectedConversation | null>(null);

const entries = computed(() => [...props.automation.executionLog].sort((left, right) => (
  Date.parse(right.startedAt) - Date.parse(left.startedAt)
)));

const executionCountLabel = computed(() => (
  `${entries.value.length} ${entries.value.length === 1 ? 'execution' : 'executions'}`
));

const executionColumns: AppDataListColumn[] = [{
  id: 'ticket',
  label: translate('promptAutomation.conversationTitle'),
  width: 'minmax(0, 1fr)',
}, {
  id: 'startedAt',
  label: translate('surface.automationExecutionLog.startTime'),
  width: 'max-content',
  align: 'end',
}, {
  id: 'duration',
  label: translate('surface.automationExecutionLog.executionTime'),
  width: 'max-content',
  align: 'end',
}, {
  id: 'status',
  label: translate('surface.automationExecutionLog.status'),
  width: 'max-content',
  align: 'end',
}];

const executionRows = computed<AppDataListRow[]>(() => entries.value.map((entry) => ({
  agentId: entry.agentId ?? '',
  agentName: entry.agentName ?? 'Agent',
  conversationRef: entry.conversationRef ?? null,
  id: entry.id,
  duration: formatDuration(entry.startedAt, entry.completedAt),
  error: entry.error ?? '',
  startedAt: entry.startedAt,
  status: entry.status,
  statusLabel: statusLabel(entry.status),
  ticket: entry.id,
  time: formatDate(entry.startedAt),
})));

const selectedConversationMessages = computed<RendererMessage[]>(() => selectedConversation.value?.messages ?? []);

function statusLabel(status: AutomationExecutionStatus): string {
  if (status === 'awaitingInput') return translate('promptAutomation.needsInput');
  if (status === 'completed') {
    return translate('surface.automationExecutionLog.completed');
  }
  return status === 'failed' ? translate('surface.automationExecutionLog.failed') : translate('surface.automationExecutionLog.working');
}

function startedAtForRow(row: AppDataListRow): string {
  return typeof row.startedAt === 'string' ? row.startedAt : '';
}

function statusForRow(row: AppDataListRow): AutomationExecutionStatus {
  return row.status === 'completed' || row.status === 'failed' || row.status === 'working' || row.status === 'awaitingInput'
    ? row.status
    : 'working';
}

function statusLabelForRow(row: AppDataListRow): string {
  return typeof row.statusLabel === 'string' && row.statusLabel.trim()
    ? row.statusLabel
    : statusLabel(statusForRow(row));
}

function ticketForRow(row: AppDataListRow): string {
  return typeof row.ticket === 'string' && row.ticket.trim() ? row.ticket : 'execution';
}

function conversationRefForRow(row: AppDataListRow): BackendConversationRef | null {
  if (!isBackendConversationRef(row.conversationRef)) {
    return null;
  }

  return row.conversationRef.backend === 'codex'
    ? { backend: 'codex', threadId: row.conversationRef.threadId }
    : {
        backend: 'claude',
        folder: row.conversationRef.folder,
        sessionId: row.conversationRef.sessionId,
      };
}

function agentIdForRow(row: AppDataListRow): string {
  return typeof row.agentId === 'string' ? row.agentId : '';
}

function agentNameForRow(row: AppDataListRow): string {
  return typeof row.agentName === 'string' && row.agentName.trim() ? row.agentName : translate('surface.automationExecutionLog.agent');
}

function executionIdForRow(row: AppDataListRow): string {
  return typeof row.id === 'string' ? row.id : '';
}

async function openConversation(row: AppDataListRow): Promise<void> {
  const agentId = agentIdForRow(row);
  if (!agentId) {
    return;
  }

  const conversationRef = conversationRefForRow(row);
  selectedConversation.value = {
    executionId: executionIdForRow(row),
    agentId,
    agentName: agentNameForRow(row),
    error: null,
    loading: Boolean(conversationRef),
    messages: [],
    ticket: formatDate(startedAtForRow(row)),
  };

  if (!conversationRef) {
    return;
  }

  try {
    const messages = await props.readConversationMessages(conversationRef, agentId);
    if (selectedConversation.value?.executionId === executionIdForRow(row)) {
      selectedConversation.value = {
        ...selectedConversation.value,
        loading: false,
        messages,
      };
    }
  } catch (error) {
    if (selectedConversation.value?.executionId === executionIdForRow(row)) {
      selectedConversation.value = {
        ...selectedConversation.value,
        error: error instanceof Error ? error.message : String(error),
        loading: false,
        messages: [],
      };
    }
  }
}

function deleteExecution(row: AppDataListRow): void {
  const executionId = executionIdForRow(row);
  if (executionId) {
    emit('delete-execution', {
      executionId,
      automationId: props.automation.id,
    });
  }
}

function closeConversation(): void {
  selectedConversation.value = null;
}

function isBackendConversationRef(value: unknown): value is BackendConversationRef {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<BackendConversationRef>;
  if (candidate.backend === 'codex') {
    return typeof candidate.threadId === 'string' && candidate.threadId.trim().length > 0;
  }

  return (candidate.backend === 'claude' || candidate.backend === 'antigravity') &&
    typeof candidate.sessionId === 'string' &&
    candidate.sessionId.trim().length > 0 &&
    (candidate.folder === null || typeof candidate.folder === 'string');
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return translate('surface.automationExecutionLog.unknownTime');
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatDuration(startedAt: string, completedAt?: string): string {
  if (!completedAt) {
    return '-';
  }

  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
    return translate('surface.automationExecutionLog.unknown');
  }

  const seconds = Math.round((completed - started) / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

</script>

<style scoped>
.automation-execution-log__muted {
  display: block;
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-18);
  text-align: right;
  white-space: nowrap;
}

.automation-execution-log__ticket-cell {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.automation-execution-log__ticket-cell a {
  display: block;
  overflow: hidden;
  color: var(--color-text);
  text-overflow: ellipsis;
  text-decoration: none;
  white-space: nowrap;
}

.automation-execution-log__ticket-cell a:hover,
.automation-execution-log__ticket-cell a:focus-visible {
  color: var(--color-primary);
}

.automation-execution-log__ticket-cell p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-18);
}

.automation-execution-log__error {
  color: var(--color-error);
}

.automation-execution-log time {
  display: block;
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
  text-align: right;
  white-space: nowrap;
}
</style>
