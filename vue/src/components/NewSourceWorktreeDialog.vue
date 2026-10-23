<template>
  <FormDialog
    class="new-source-worktree-dialog"
    :model-value="visible && !creationState"
    :title="$t('surface.newSourceWorktreeDialog.newWorktree')"
    @update:model-value="onVisibilityChanged"
  >
    <form class="app-form-dialog" @submit.prevent="create()">
      <WorktreeReusePrompt
        v-if="existingWorktree"
        :branch="existingWorktree.name"
        :path="existingWorktree.path"
      />
      <template v-else>
        <FormField
          v-if="orderedBranches.length || branchesLoading"
          :label="$t('surface.newSourceWorktreeDialog.startFrom')"
          label-for="new-source-worktree-base-branch"
        >
          <div class="app-form-dialog__control">
            <el-select
              id="new-source-worktree-base-branch"
              v-model="baseBranch"
              class="new-source-worktree-dialog__base-select"
              :aria-label="$t('surface.newSourceWorktreeDialog.startFrom')"
              :disabled="branchesLoading"
              :loading="branchesLoading"
              :placeholder="$t('surface.newSourceWorktreeDialog.chooseBaseBranch')"
            >
              <el-option
                v-for="branch in orderedBranches"
                :key="branch.name"
                :label="branch.name"
                :value="branch.name"
              />
            </el-select>
          </div>
        </FormField>

        <FormField
          :label="$t('surface.newSourceWorktreeDialog.branch')"
          label-for="new-source-worktree-branch"
        >
          <div class="app-form-dialog__control app-form-dialog__input-control">
            <input
              id="new-source-worktree-branch"
              v-model="branchName"
              class="app-form-dialog__text-input new-source-worktree-dialog__branch-input"
              type="text"
              :placeholder="$t('repositories.worktree.branchPlaceholder')"
            />
          </div>
        </FormField>

        <FormField
          v-if="allowDestinationOverride"
          :label="$t('surface.newSourceWorktreeDialog.folder')"
          label-for="new-source-worktree-folder"
        >
          <div class="app-form-dialog__control app-form-dialog__input-control new-source-worktree-dialog__folder-control">
            <input
              id="new-source-worktree-folder"
              class="app-form-dialog__text-input new-source-worktree-dialog__folder-input"
              type="text"
              readonly
              :value="destinationPath"
              :placeholder="$t('surface.newSourceWorktreeDialog.enterABranchName')"
            />
            <button
              class="new-source-worktree-dialog__folder-picker"
              type="button"
              :aria-label="$t('surface.newSourceWorktreeDialog.chooseWorktreeFolder')"
              :title="$t('surface.newSourceWorktreeDialog.chooseWorktreeFolder')"
              :disabled="!repo"
              @click="chooseDestination"
            >
              <FolderIcon aria-hidden="true" />
            </button>
          </div>
        </FormField>

      </template>
    </form>

    <template #footer>
      <button class="app-button app-button--tertiary" type="button" @click="backOrClose">
        {{ existingWorktree ? $t('common.back') : $t('surface.newSourceWorktreeDialog.cancel') }}
      </button>
      <button
        class="app-button app-button--primary"
        type="button"
        :aria-busy="creating"
        :disabled="creating || (!existingWorktree && !canCreate)"
        @click="create(Boolean(existingWorktree))"
      > {{ existingWorktree ? $t('worktreeReuse.action') : $t('surface.newSourceWorktreeDialog.create') }} </button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { AgentCreationProgress, CreateSourceWorktreeInput, SourceBranch, SourceRepository, SourceWorktree } from '@workspace/core/contracts';
import { FolderIcon } from '../shared/icons/app-icons';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';
import { isProvisioningBackgrounded, publishProvisioningOperation } from './provisioning-operations';
import WorktreeReusePrompt from './WorktreeReusePrompt.vue';
import { useBackendChoices, useNewAgentBackend } from './backend-selection';
const backendChoices = useBackendChoices();
const backend = defineModel<import('@workspace/core/contracts').AgentBackend>('backend');
useNewAgentBackend(backend, backendChoices);

const props = withDefaults(defineProps<{
  allowDestinationOverride?: boolean;
  branches?: SourceBranch[];
  branchesLoading?: boolean;
  chooseDestination: (defaultPath: string) => Promise<string | null>;
  createWorktree: (input: CreateSourceWorktreeInput) => Promise<SourceWorktree>;
  repo: SourceRepository | null;
  suggestDestination: (input: Pick<CreateSourceWorktreeInput, 'branchName' | 'repoPath'>) => Promise<string>;
  visible: boolean;
}>(), {
  allowDestinationOverride: true,
  branches: () => [],
  branchesLoading: false,
  repo: null,
});

const emit = defineEmits<{
  close: [];
  created: [worktree: SourceWorktree];
}>();
const branchName = ref('');
const baseBranch = ref('');
const customDestinationPath = ref('');
const suggestedDestinationPath = ref('');
const creating = ref(false);
const creationState = ref<'running' | 'success' | 'error' | null>(null);
const createdWorktree = ref<SourceWorktree | null>(null);
const pendingBranchName = ref('');
const creationError = ref('');
const existingWorktree = ref<SourceWorktree | null>(null);
let suggestionRequestId = 0;

const orderedBranches = computed(() => [...props.branches].sort((left, right) => (
  Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name)
)));
const canCreate = computed(() => Boolean(
  props.repo
  && backend.value && backendChoices.value.includes(backend.value)
  && branchName.value.trim()
  && (!orderedBranches.value.length || baseBranch.value)
  && !props.branchesLoading
  && !creating.value,
));
const destinationPath = computed(() => customDestinationPath.value || suggestedDestinationPath.value);
const creationProgress = computed<AgentCreationProgress | null>(() => {
  if (!props.visible || !creationState.value || !props.repo || !backend.value) return null;
  return {
    id: 'manual-worktree-creation',
    state: creationState.value,
    backend: backend.value,
    repositoryName: props.repo.name,
    createWorktree: true,
    branchName: pendingBranchName.value,
    hasPrompt: false,
    ...(creationError.value ? { error: creationError.value } : {}),
  };
});

watch(creationProgress, (progress) => {
  publishProvisioningOperation('newWorktree', progress ? { mode: 'single', progress } : null, { onClose: completeCreation });
}, { immediate: true });
onBeforeUnmount(() => publishProvisioningOperation('newWorktree', null));

watch(() => props.visible, (visible) => {
  if (visible) {
    branchName.value = '';
    baseBranch.value = orderedBranches.value[0]?.name ?? '';
    customDestinationPath.value = '';
    suggestedDestinationPath.value = '';
    creationState.value = null;
    createdWorktree.value = null;
    pendingBranchName.value = '';
    creationError.value = '';
    existingWorktree.value = null;
    creating.value = false;
  }
});

watch(orderedBranches, (branches) => {
  if (!props.visible) return;
  if (!branches.some((branch) => branch.name === baseBranch.value)) {
    baseBranch.value = branches[0]?.name ?? '';
  }
}, { immediate: true });

watch([
  () => props.repo?.path ?? '',
  branchName,
], () => {
  void refreshSuggestedDestinationPath();
}, { immediate: true });

async function chooseDestination(): Promise<void> {
  if (!props.repo) {
    return;
  }

  const defaultPath = destinationPath.value || await props.suggestDestination({
    repoPath: props.repo.path,
    branchName: branchName.value,
  });
  const selected = await props.chooseDestination(defaultPath);
  if (selected) {
    customDestinationPath.value = selected;
  }
}

async function create(reuseExisting = false): Promise<void> {
  if (!props.repo || !canCreate.value) {
    return;
  }

  const existingBranch = orderedBranches.value.find((branch) => (
    branch.name === branchName.value.trim() && branch.worktreePath
  ));
  if (existingBranch?.worktreePath && !reuseExisting) {
    existingWorktree.value = { name: existingBranch.name, path: existingBranch.worktreePath };
    return;
  }

  creating.value = true;
  pendingBranchName.value = branchName.value.trim();
  if (!reuseExisting) {
    creationState.value = 'running';
  }
  try {
    const worktree = await props.createWorktree({
      repoPath: props.repo.path,
      branchName: branchName.value,
      ...(reuseExisting
        ? { reuseExisting: true }
        : {
            ...(baseBranch.value ? { baseBranch: baseBranch.value } : {}),
            ...(customDestinationPath.value ? { destinationPath: customDestinationPath.value } : {}),
          }),
    });
    if (reuseExisting) {
      emit('created', worktree);
      close();
    } else {
      createdWorktree.value = worktree;
      creationState.value = 'success';
      // A backgrounded creation has no dialog left to finish it.
      if (isProvisioningBackgrounded('manual-worktree-creation')) completeCreation();
    }
  } catch (error) {
    creationState.value = 'error';
    creationError.value = error instanceof Error ? error.message : String(error);
  } finally {
    creating.value = false;
  }
}

function onVisibilityChanged(visible: boolean): void {
  if (!visible && creationState.value !== 'running' && creationState.value !== 'success') {
    close();
  }
}

function completeCreation(): void {
  if (createdWorktree.value) emit('created', createdWorktree.value);
  close();
}

function backOrClose(): void {
  if (existingWorktree.value) {
    existingWorktree.value = null;
    return;
  }
  close();
}

function close(): void {
  emit('close');
}

async function refreshSuggestedDestinationPath(): Promise<void> {
  const repo = props.repo;
  const requestId = ++suggestionRequestId;
  if (!repo || !branchName.value.trim()) {
    suggestedDestinationPath.value = '';
    return;
  }

  try {
    const suggestedPath = await props.suggestDestination({
      repoPath: repo.path,
      branchName: branchName.value,
    });
    if (requestId === suggestionRequestId) {
      suggestedDestinationPath.value = suggestedPath;
    }
  } catch {
    if (requestId === suggestionRequestId) {
      suggestedDestinationPath.value = '';
    }
  }
}
</script>

<style scoped>
.new-source-worktree-dialog__base-select {
  width: 100%;
}

.new-source-worktree-dialog__folder-control {
  display: flex;
  align-items: center;
  padding-right: var(--space-2);
}

.new-source-worktree-dialog__folder-input {
  min-width: 0;
  color: var(--color-text-muted);
}

.new-source-worktree-dialog__folder-picker {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--space-16);
  height: var(--space-16);
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.new-source-worktree-dialog__folder-picker:hover:not(:disabled),
.new-source-worktree-dialog__folder-picker:focus-visible {
  color: var(--color-text);
  background: var(--color-surface);
}

.new-source-worktree-dialog__folder-picker:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.new-source-worktree-dialog__folder-picker svg {
  width: var(--icon-md);
  height: var(--icon-md);
}
</style>
