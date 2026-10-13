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
      :eyebrow="eyebrow"
      :title="title"
      :complete-title="completeTitle"
      :error-title="errorTitle"
      :error-detail="errorDetail"
      :steps="steps"
      @complete="close"
    />
    <template v-if="operationState === 'error'" #footer>
      <div class="app-dialog__footer">
        <button class="app-button app-button--tertiary" type="button" @click="close">
          {{ t('common.close') }}
        </button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AgentCreationProgress } from '@workspace/core/contracts';
import type { MissionImplementationStartProgress } from '@workspace/core/mission-execution';
import StagedOperationProgress, { type StagedOperationStep } from './StagedOperationProgress.vue';
import { missionRepositoryName } from './mission-implementation-model';
import { backendDisplayName } from '@workspace/core/backend-driver';

export type WorkspaceProvisioningOperation =
  | { mode: 'single'; progress: AgentCreationProgress }
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
}>();
const { t } = useI18n();
const progress = computed(() => props.operation?.mode === 'single' ? props.operation.progress : null);
const operationId = computed(() => props.operation?.mode === 'single' ? props.operation.progress.id : props.operation?.id);
const operationState = computed(() => props.operation?.mode === 'single'
  ? props.operation.progress.state
  : props.operation?.state ?? 'running');
const eyebrow = computed(() => props.operation?.mode === 'multiple'
  ? t('missions.implementationStartEyebrow')
  : t('agentCreationProgress.eyebrow'));
const title = computed(() => {
  if (props.operation?.mode === 'multiple') return t('missions.implementationStartTitle');
  if (progress.value?.createProject) return t('agentCreationProgress.creatingProject', { repository: progress.value.repositoryName });
  return progress.value?.createWorktree
    ? t('agentCreationProgress.buildingIsolatedHome', { repository: progress.value.repositoryName })
    : t('agentCreationProgress.creatingAgent', { repository: progress.value?.repositoryName ?? '' });
});
const completeTitle = computed(() => props.operation?.mode === 'multiple'
  ? t('missions.implementationStartComplete')
  : t('agentCreationProgress.ready', {
      agent: progress.value?.agentName ?? progress.value?.branchName ?? progress.value?.repositoryName ?? '',
    }));
const errorTitle = computed(() => props.operation?.mode === 'multiple'
  ? t('missions.implementationStartTitle')
  : t('agentCreationProgress.failed'));
const errorDetail = computed(() => props.operation?.mode === 'multiple'
  ? props.operation.error
  : progress.value?.error);
const activeStep = computed(() => {
  if (props.operation?.mode === 'multiple') {
    if (props.operation.phase === 'startingAgents') return 2;
    if (props.operation.phase === 'initializingWorkspaces') return 1;
    return 0;
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

function close(): void {
  if (operationId.value) emit('close', operationId.value);
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
