<template>
  <section class="work-item-assignment-picker">
    <template v-if="reuseAction && existingWorktreePath">
      <WorktreeReusePrompt :branch="branchName" :path="existingWorktreePath" />
      <div class="work-item-assignment-picker__body"><slot /></div>
      <footer>
        <button class="app-button app-button--tertiary" type="button" @click="reuseAction = null">
          {{ t('common.cancel') }}
        </button>
        <button class="app-button app-button--primary" type="button" @click="confirmReuse">
          {{ t('worktreeReuse.action') }}
        </button>
      </footer>
    </template>
    <template v-else>
      <section class="work-item-assignment-picker__section">
        <h3 class="app-section-label">{{ t('repositoryBacklog.workIn') }}</h3>
        <div class="work-item-assignment-picker__target-options">
          <button
            type="button"
            :class="{ 'is-selected': destination === 'new' }"
            :aria-pressed="destination === 'new'"
            :disabled="busy"
            @click="destination = 'new'"
          >
            <IconCopy aria-hidden="true" />
            <strong>{{ t('repositoryBacklog.newIsolatedSession') }}</strong>
            <span>{{ t('repositoryBacklog.newIsolatedSessionDetail') }}</span>
          </button>
          <button
            type="button"
            :class="{ 'is-selected': destination === 'existing' }"
            :aria-pressed="destination === 'existing'"
            :disabled="busy || eligibleSessions.length === 0"
            @click="destination = 'existing'"
          >
            <IconRobotFace aria-hidden="true" />
            <strong>{{ t('repositoryBacklog.useExistingSession') }}</strong>
            <span v-if="sessions.length === 0">{{ t('repositoryBacklog.noExistingSessions') }}</span>
            <span v-else-if="eligibleSessions.length === 0">{{ t('repositoryBacklog.noPullRequestSessions') }}</span>
            <span v-else>{{ t('repositoryBacklog.useExistingSessionDetail') }}</span>
          </button>
        </div>
      </section>

      <section class="work-item-assignment-picker__section">
        <h3 class="app-section-label">{{ t('repositoryBacklog.session') }}</h3>
        <div v-if="destination === 'new'" class="work-item-assignment-picker__model-selectors">
          <BackendModelSelector v-model:backend="backend" v-model:model="model" v-model:reasoning-effort="reasoningEffort" :agent-id="modelCatalogAgentId" :disabled="busy" />
        </div>
        <el-select
          v-else
          v-model="selectedAgentId"
          :disabled="busy"
          :aria-label="t('repositoryBacklog.existingSession')"
          :placeholder="t('repositoryBacklog.chooseSession')"
        >
          <el-option
            v-for="session in eligibleSessions"
            :key="session.agentId"
            :label="session.label"
            :value="session.agentId"
          />
        </el-select>
      </section>

      <section class="work-item-assignment-picker__section">
        <h3 class="app-section-label">{{ t('repositoryBacklog.branch') }}</h3>
        <el-input
          class="work-item-assignment-picker__branch"
          :model-value="displayedBranch"
          :aria-label="t('repositoryBacklog.branch')"
          readonly
        >
          <template #prefix>
            <IconGitPullRequest v-if="item.kind === 'pullRequest'" aria-hidden="true" />
            <IconGitBranch v-else aria-hidden="true" />
          </template>
        </el-input>
        <!-- Always laid out so switching destination does not shift the content below. -->
        <p class="work-item-assignment-picker__branch-warning" :class="{ 'is-hidden': destination !== 'existing' }">
          <IconAlertTriangle aria-hidden="true" />
          <span>{{ t('repositoryBacklog.existingSessionBranchWarning') }}</span>
        </p>
      </section>

      <div class="work-item-assignment-picker__body"><slot /></div>

      <p v-if="error" class="work-item-assignment-picker__error" role="alert">{{ error }}</p>

      <footer>
        <button class="app-button app-button--tertiary" type="button" :disabled="!canSubmit" @click="requestCustom">
          {{ t('repositoryBacklog.custom') }}
        </button>
        <button class="app-button app-button--secondary" type="button" :disabled="!canSubmit" @click="requestSubmit(secondaryAction)">
          {{ item.kind === 'pullRequest' ? t('repositoryBacklog.addressFeedback') : t('repositoryBacklog.investigate') }}
        </button>
        <button class="app-button app-button--primary" type="button" :disabled="!canSubmit" @click="requestSubmit(primaryAction)">
          {{ item.kind === 'pullRequest' ? t('repositoryBacklog.review') : t('repositoryBacklog.fix') }}
        </button>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconAlertTriangle, IconCopy, IconGitBranch, IconGitPullRequest, IconRobotFace } from '@tabler/icons-vue';
import type { WorkItem } from '@workspace/core/contracts';
import type { WorkItemAssignmentAction } from '@workspace/core/work-item-prompts';
import WorktreeReusePrompt from './WorktreeReusePrompt.vue';
import BackendModelSelector from './BackendModelSelector.vue';
import { useBackendChoices, useNewAgentBackend } from './backend-selection';
const backend = defineModel<import('@workspace/core/contracts').AgentBackend>('backend');
useNewAgentBackend(backend, useBackendChoices());

export type WorkItemAssignmentDestination = 'existing' | 'new';

export type WorkItemAssignmentSession = {
  agentId: string;
  branch?: string;
  label: string;
};

export type WorkItemAssignmentSelection = {
  isCurrent?: () => boolean;
  backend?: import('@workspace/core/contracts').AgentBackend;
  model?: string;
  reasoningEffort?: string;
  action: WorkItemAssignmentAction;
  agentId?: string;
  destination: WorkItemAssignmentDestination;
  item: WorkItem;
  reuseExisting?: boolean;
};

const props = withDefaults(defineProps<{
  branchName: string;
  busy?: boolean;
  error?: string | null;
  existingWorktreePath?: string;
  item: WorkItem;
  modelAgentId?: string;
  sessions?: WorkItemAssignmentSession[];
}>(), {
  busy: false,
  error: null,
  existingWorktreePath: '',
  modelAgentId: '',
  sessions: () => [],
});

const emit = defineEmits<{
  custom: [selection: Omit<WorkItemAssignmentSelection, 'action'>];
  submit: [selection: WorkItemAssignmentSelection];
}>();

const { t } = useI18n();
const destination = ref<WorkItemAssignmentDestination>('new');
const selectedAgentId = ref('');
const model = ref('');
const reasoningEffort = ref('');
const modelCatalogAgentId = computed(() => props.modelAgentId || props.sessions[0]?.agentId || '');
const reuseAction = ref<WorkItemAssignmentAction | 'custom' | null>(null);
const secondaryAction = computed<WorkItemAssignmentAction>(() => props.item.kind === 'pullRequest' ? 'addressFeedback' : 'investigate');
const primaryAction = computed<WorkItemAssignmentAction>(() => props.item.kind === 'pullRequest' ? 'review' : 'fix');
// A pull request needs its own code, so only agents already on its head branch can take it.
const eligibleSessions = computed(() => {
  if (props.item.kind !== 'pullRequest') return props.sessions;
  const head = props.item.branchName?.trim();
  return head ? props.sessions.filter(session => session.branch === head) : [];
});
const displayedBranch = computed(() => destination.value === 'existing'
  ? eligibleSessions.value.find(session => session.agentId === selectedAgentId.value)?.branch ?? ''
  : props.branchName);
const canSubmit = computed(() => !props.busy
  && (destination.value === 'new'
    ? props.branchName.trim().length > 0 && Boolean(backend.value)
    : Boolean(selectedAgentId.value)));

watch(() => [props.item.id, eligibleSessions.value.map((session) => session.agentId).join('|')] as const, () => {
  destination.value = 'new';
  selectedAgentId.value = eligibleSessions.value[0]?.agentId ?? '';
  reuseAction.value = null;
}, { immediate: true });

function requestCustom(): void {
  if (!canSubmit.value) return;
  if (requestReuse('custom')) return;
  emit('custom', selection());
}

function requestSubmit(action: WorkItemAssignmentAction): void {
  if (!canSubmit.value) return;
  if (requestReuse(action)) return;
  emit('submit', { ...selection(), action });
}

function requestReuse(action: WorkItemAssignmentAction | 'custom'): boolean {
  if (destination.value !== 'new' || !props.existingWorktreePath) return false;
  reuseAction.value = action;
  return true;
}

function confirmReuse(): void {
  const action = reuseAction.value;
  if (!action) return;
  reuseAction.value = null;
  const nextSelection = selection(true);
  if (action === 'custom') emit('custom', nextSelection);
  else emit('submit', { ...nextSelection, action });
}

function selection(reuseExisting = false): Omit<WorkItemAssignmentSelection, 'action'> {
  return {
    destination: destination.value,
    ...(destination.value === 'new' ? { backend: backend.value } : {}),
    ...(destination.value === 'new' && model.value ? { model: model.value } : {}),
    ...(destination.value === 'new' && reasoningEffort.value ? { reasoningEffort: reasoningEffort.value } : {}),
    ...(destination.value === 'existing' ? { agentId: selectedAgentId.value } : {}),
    item: props.item,
    ...(reuseExisting ? { reuseExisting: true } : {}),
  };
}
</script>

<style scoped>
.work-item-assignment-picker {
  display: grid;
  gap: var(--space-6);
}

.work-item-assignment-picker__target-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.work-item-assignment-picker__model-selectors {
  display: grid;
  gap: var(--space-3);
}

.work-item-assignment-picker__model-selectors > *,
.work-item-assignment-picker__model-selectors :deep(.el-select) {
  min-width: 0;
  width: 100%;
}

.work-item-assignment-picker__body {
  padding-top: var(--space-6);
  border-top: 1px solid var(--color-border);
}

.work-item-assignment-picker__body :deep(.work-item-detail__body) {
  max-height: min(40vh, 420px);
  overflow-y: auto;
}

.work-item-assignment-picker__body :deep(.work-item-detail) {
  padding: 0;
}

.work-item-assignment-picker__target-options > button {
  min-width: 0;
  min-height: 66px;
  display: grid;
  grid-template-columns: var(--icon-lg) minmax(0, 1fr);
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: var(--space-6);
  row-gap: var(--space-1);
  align-content: center;
  padding: var(--space-4) var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  color: var(--color-text);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.work-item-assignment-picker__target-options > button:hover:not(:disabled):not(.is-selected) {
  border-color: var(--color-outline);
  background: var(--color-surface-low);
}

.work-item-assignment-picker__target-options > button.is-selected {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-container);
}

.work-item-assignment-picker__target-options > button:disabled {
  opacity: 0.45;
  cursor: default;
}

.work-item-assignment-picker__target-options strong {
  grid-column: 2;
  font-size: var(--font-size-13);
}

.work-item-assignment-picker__target-options svg {
  grid-column: 1;
  grid-row: 1 / -1;
  width: var(--icon-lg);
  height: var(--icon-lg);
}

.work-item-assignment-picker__target-options span {
  grid-column: 2;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  line-height: 1.25;
}

.work-item-assignment-picker__section {
  min-width: 0;
  display: grid;
  gap: var(--space-3);
}

.work-item-assignment-picker__section :deep(.el-select),
.work-item-assignment-picker__section :deep(.el-input) {
  width: 100%;
  min-width: 0;
}

.work-item-assignment-picker__branch :deep(.el-input__inner) {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-11);
}

.work-item-assignment-picker__branch :deep(svg) {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--color-text-muted);
}

.work-item-assignment-picker__branch-warning {
  display: grid;
  grid-template-columns: var(--icon-sm) minmax(0, 1fr);
  align-items: flex-start;
  gap: var(--space-3);
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-11);
  line-height: 1.3;
}

.work-item-assignment-picker__branch-warning.is-hidden {
  visibility: hidden;
}

.work-item-assignment-picker__branch-warning svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  color: var(--color-warning);
}

.work-item-assignment-picker__error {
  margin: 0;
  color: var(--color-error);
  font-size: var(--font-size-12);
}

.work-item-assignment-picker footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  margin: 0 calc(-1 * var(--space-8));
  padding: var(--space-6) var(--space-8) 0;
  border-top: 1px solid var(--color-border);
}
</style>
