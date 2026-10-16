<template>
  <el-dialog
    class="app-dialog agent-close-dialog"
    :model-value="visible"
    :teleported="false"
    width="520px"
    :show-close="false"
    destroy-on-close
    @update:model-value="onVisibilityChanged"
  >
    <template #header>
      <div class="app-form-dialog__header agent-close-dialog__header">
        <h2 class="app-dialog__title">{{ $t('surface.agentCloseDialog.close') }} {{ agent?.name }}?</h2>
      </div>
    </template>

    <div class="agent-close-dialog__body">
      <p> {{ $t('surface.agentCloseDialog.thisAgentIsUsingTheLinkedWorktree') }} <strong>{{ workflow?.branch }}</strong>.
      </p>
      <p> {{ $t('surface.agentCloseDialog.deletingTheWorktreeAlsoDeletesItsLocalBranchKeepingItLea') }} </p>
      <label v-if="hasChanges" class="agent-close-dialog__discard">
        <el-switch v-model="discardChanges" size="small" :disabled="busy" :aria-label="$t('surface.agentCloseDialog.discardChanges')" />
        <span>{{ $t('surface.agentCloseDialog.discardChanges') }}</span>
      </label>
      <label v-if="remoteBranch" class="agent-close-dialog__remote">
        <el-switch v-model="deleteRemoteBranch" size="small" :disabled="busy" />
        <span>{{ $t('surface.agentCloseDialog.alsoDelete') }} {{ remoteBranch }}</span>
      </label>
      <p v-if="error" class="agent-close-dialog__error" role="alert">{{ error }}</p>
    </div>

    <template #footer>
      <div class="app-dialog__footer">
        <button class="app-button app-button--tertiary" type="button" :disabled="busy" @click="emit('close')"> {{ $t('surface.agentCloseDialog.cancel') }} </button>
        <button class="app-button app-button--secondary" type="button" :disabled="busy" @click="emit('keep-worktree')"> {{ $t('surface.agentCloseDialog.keepWorktree') }} </button>
        <button class="app-button app-button--primary" type="button" :aria-busy="busy" :disabled="busy || (hasChanges && !discardChanges)" @click="deleteWorktree"> {{ $t('surface.agentCloseDialog.deleteWorktree') }} </button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Agent, AgentGitWorkflow } from '@workspace/core/contracts';
import { matchingBranchUpstream } from '@workspace/core/git-remote';

const props = withDefaults(defineProps<{
  agent?: Agent | null;
  busy?: boolean;
  error?: string | null;
  visible: boolean;
  workflow?: AgentGitWorkflow | null;
}>(), {
  agent: null,
  busy: false,
  error: null,
  workflow: null,
});

const emit = defineEmits<{
  close: [];
  'delete-worktree': [deleteRemoteBranch: boolean, discardChanges: boolean];
  'keep-worktree': [];
}>();

const deleteRemoteBranch = ref(false);
const discardChanges = ref(false);
const hasChanges = computed(() => (props.workflow?.files.length ?? 0) > 0);
const remoteBranch = computed(() => matchingBranchUpstream(props.workflow?.branch, props.workflow?.upstream, props.workflow?.baseBranch));

watch(() => props.visible, (visible) => {
  if (visible) {
    deleteRemoteBranch.value = false;
    discardChanges.value = false;
  }
});

function deleteWorktree(): void {
  if (props.busy || (hasChanges.value && !discardChanges.value)) return;
  emit('delete-worktree', Boolean(remoteBranch.value) && deleteRemoteBranch.value, hasChanges.value && discardChanges.value);
}

function onVisibilityChanged(visible: boolean): void {
  if (!visible && !props.busy) emit('close');
}
</script>

<style scoped>
.agent-close-dialog__body {
  display: grid;
  gap: var(--space-6);
  padding-bottom: var(--space-4);
}

.agent-close-dialog__body p {
  margin: 0;
  color: var(--color-text-muted);
}

.agent-close-dialog__body strong {
  color: var(--color-text);
}

.agent-close-dialog__remote,
.agent-close-dialog__discard {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-height: 34px;
  color: var(--color-text);
}

.agent-close-dialog__error {
  color: var(--color-error) !important;
}

.agent-close-dialog__discard :deep(.el-switch) {
  flex-shrink: 0;
}
</style>
