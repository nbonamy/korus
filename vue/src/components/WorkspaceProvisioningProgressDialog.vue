<template>
  <el-dialog
    class="app-dialog app-dialog--compact workspace-provisioning-progress-dialog"
    :model-value="operation !== null"
    :teleported="false"
    width="480px"
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="operationState === 'error'"
    destroy-on-close
    @update:model-value="onVisibilityChanged"
  >
    <StagedOperationProgress
      v-if="operation"
      :key="operationId"
      :state="operationState"
      :active-step="activeStep"
      :minimum-duration-ms="0"
      :eyebrow="eyebrow"
      :title="title"
      :complete-title="completeTitle"
      :error-title="errorTitle"
      :error-detail="errorDetail"
      :steps="steps"
      @complete="close"
    />
    <template v-if="operation" #footer>
      <div class="app-dialog__footer">
        <button v-if="operationState === 'error'" class="app-button app-button--tertiary" type="button" @click="close">
          {{ t('common.close') }}
        </button>
        <button v-else class="app-button app-button--secondary" type="button" :disabled="operationState !== 'running'" @click="runInBackground">
          {{ t('common.runInBackground') }}
        </button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BranchWorkProgress } from '@workspace/core/branch-current-work';
import type { AgentCreationProgress } from '@workspace/core/contracts';
import type { MissionImplementationStartProgress } from '@workspace/core/mission-execution';
import StagedOperationProgress, { type StagedOperationStep } from './StagedOperationProgress.vue';
import { missionRepositoryName } from './mission-implementation-model';
import { backendDisplayName } from '@workspace/core/backend-driver';

export type WorkspaceProvisioningOperation =
  | { mode: 'branchMove'; progress: BranchWorkProgress }
  | { mode: 'single'; progress: AgentCreationProgress }
  | { mode: 'batch'; progress: AgentCreationProgress[] }
  | {
      mode: 'multiple';
      id: string;
      state: 'running' | 'success' | 'error';
      repositories: string[];
      ticketCount: number;
      phase?: MissionImplementationStartProgress['phase'];
      error?: string;
    };

const props = defineProps<{ operation: WorkspaceProvisioningOperation | null }>();

const emit = defineEmits<{
  close: [id: string];
  background: [id: string];
}>();
const { t } = useI18n();
const progress = computed(() => props.operation?.mode === 'single' ? props.operation.progress : null);
const branchMove = computed(() => props.operation?.mode === 'branchMove' ? props.operation.progress : null);
const batch = computed(() => props.operation?.mode === 'batch' ? props.operation.progress : null);
// A batch keeps one stable key so entries joining or finishing do not restart the progress animation.
const operationId = computed(() => {
  if (props.operation?.mode === 'batch') return 'batch';
  return props.operation?.mode === 'single' || props.operation?.mode === 'branchMove' ? props.operation.progress.id : props.operation?.id;
});
const operationIds = computed(() => batch.value ? batch.value.map((entry) => entry.id) : operationId.value ? [operationId.value] : []);
const operationState = computed(() => {
  if (batch.value) {
    if (batch.value.some((entry) => entry.state === 'running')) return 'running';
    return batch.value.some((entry) => entry.state === 'error') ? 'error' : 'success';
  }
  return props.operation?.mode === 'single' || props.operation?.mode === 'branchMove'
    ? props.operation.progress.state
    : props.operation?.mode === 'multiple' ? props.operation.state : 'running';
});
const eyebrow = computed(() => branchMove.value ? t('branchWork.progressEyebrow') : props.operation?.mode === 'multiple'
  ? t('missions.implementationStartEyebrow')
  : t('agentCreationProgress.eyebrow'));
const title = computed(() => {
  if (branchMove.value) return t('branchWork.progressTitle');
  if (props.operation?.mode === 'multiple') return t('missions.implementationStartTitle');
  if (batch.value) return t('agentCreationProgress.creatingAgents', { count: batch.value.length });
  if (progress.value?.createProject) return t('agentCreationProgress.creatingProject', { repository: progress.value.repositoryName });
  return progress.value?.createWorktree
    ? t('agentCreationProgress.buildingIsolatedHome', { repository: progress.value.repositoryName })
    : t('agentCreationProgress.creatingAgent', { repository: progress.value?.repositoryName ?? '' });
});
const completeTitle = computed(() => branchMove.value ? t('branchWork.progressReady', { branch: branchMove.value.branchName }) : props.operation?.mode === 'multiple'
  ? t('missions.implementationStartComplete')
  : batch.value
    ? t('agentCreationProgress.agentsReady', { count: batch.value.length })
    : t('agentCreationProgress.ready', {
      agent: progress.value?.agentName ?? progress.value?.branchName ?? progress.value?.repositoryName ?? '',
    }));
const errorTitle = computed(() => branchMove.value ? t('branchWork.progressFailed') : props.operation?.mode === 'multiple'
  ? t('missions.implementationStartTitle')
  : t('agentCreationProgress.failed'));
const errorDetail = computed(() => branchMove.value ? branchMove.value.error : props.operation?.mode === 'multiple'
  ? props.operation.error
  : batch.value
    ? batch.value.find((entry) => entry.state === 'error')?.error
    : progress.value?.error);
const activeStep = computed(() => {
  if (branchMove.value) return ['creatingWorktree', 'movingChanges', 'creatingAgent', 'resettingSource'].indexOf(branchMove.value.phase);
  if (props.operation?.mode === 'multiple') {
    if (props.operation.phase === 'startingAgents') return 2;
    if (props.operation.phase === 'initializingWorkspaces') return 1;
    return 0;
  }
  if (batch.value) {
    const order = { creatingProject: 0, creatingWorktree: 0, initializingWorktree: 1, creatingAgent: 2, startingPrompt: 3 } as const;
    const running = batch.value.filter((entry) => entry.state === 'running');
    return Math.min(...(running.length ? running : batch.value).map((entry) => entry.phase ? order[entry.phase] : 0));
  }
  if (!progress.value?.phase) return undefined;
  if (!progress.value.createWorktree) {
    if (progress.value.phase === 'creatingProject') return 0;
    return progress.value.phase === 'startingPrompt' ? 2 : 1;
  }
  if (progress.value.phase === 'initializingWorktree') return 1;
  if (progress.value.phase === 'creatingAgent') return 2;
  if (progress.value.phase === 'startingPrompt') return 3;
  return 0;
});
const steps = computed<StagedOperationStep[]>(() => {
  if (branchMove.value) return [
    { title: t('branchWork.progressWorktree'), detail: branchMove.value.branchName },
    { title: t('branchWork.progressChanges'), detail: t('branchWork.progressChangesDetail') },
    { title: t('branchWork.progressAgent'), detail: t('branchWork.progressAgentDetail') },
    { title: t('branchWork.progressSource'), detail: t('branchWork.progressSourceDetail') },
  ];
  if (props.operation?.mode === 'multiple') return [
    {
      title: t('missions.implementationStartWorktrees'),
      detail: t('missions.implementationStartWorktreesDetail', { count: props.operation.repositories.length }),
    },
    {
      title: t('missions.implementationStartInitialize'),
      detail: props.operation.repositories.map(missionRepositoryName).join(', '),
    },
    {
      title: t('missions.implementationStartAgents'),
      detail: t('missions.implementationStartAgentsDetail', { count: props.operation.ticketCount }),
    },
  ];
  if (batch.value) return [
    {
      title: t('agentCreationProgress.createWorktrees'),
      detail: batch.value.map((entry) => entry.branchName ?? entry.repositoryName).join(', '),
    },
    {
      title: t('agentCreationProgress.initializeWorktree'),
      detail: batch.value.find((entry) => entry.initializationDetail)?.initializationDetail ?? t('agentCreationProgress.checkProjectSetup'),
    },
    {
      title: t('agentCreationProgress.startSessions'),
      detail: t('agentCreationProgress.sessionsDetail', { count: batch.value.length }),
    },
    {
      title: batch.value.some((entry) => entry.hasPrompt)
        ? t('agentCreationProgress.handOverInstructions')
        : t('agentCreationProgress.finishSetup'),
      detail: [...new Set(batch.value.map((entry) => entry.repositoryName))].join(', '),
    },
  ];
  const current = progress.value;
  if (!current) return [];
  const creationSteps: StagedOperationStep[] = [{
    title: current.createWorktree
      ? t('repositoryBacklog.createIsolatedWorktree')
      : current.createProject
        ? t('agentCreationProgress.createProjectFolder')
        : t('agentCreationProgress.useRepository'),
    detail: current.branchName ?? current.repositoryName,
  }];
  if (current.createWorktree) {
    creationSteps.push({
      title: t('agentCreationProgress.initializeWorktree'),
      detail: current.initializationDetail ?? t('agentCreationProgress.checkProjectSetup'),
    });
  }
  return [
    ...creationSteps,
    {
      title: t('repositoryBacklog.startAgentSession'),
      detail: t('agentCreationProgress.newSession', {
        backend: backendDisplayName(current.backend),
      }),
    },
    {
      title: current.hasPrompt
        ? t('agentCreationProgress.handOverInstructions')
        : t('agentCreationProgress.finishSetup'),
      detail: current.repositoryName,
    },
  ];
});

function runInBackground(): void {
  for (const id of operationIds.value) emit('background', id);
}

function close(): void {
  for (const id of operationIds.value) emit('close', id);
}

function onVisibilityChanged(visible: boolean): void {
  if (!visible && operationState.value === 'error') close();
}
</script>

<style scoped>
:global(.workspace-provisioning-progress-dialog .el-dialog__header) {
  display: none;
}

.app-dialog__footer {
  justify-content: flex-end;
}
</style>
