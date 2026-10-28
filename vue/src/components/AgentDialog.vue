<template>
  <FormDialog
    class="agent-dialog"
    :model-value="visible"
    :title="title"
    :compact="isEditing"
    :width="isEditing ? '420px' : undefined"
    @update:model-value="onVisibilityChanged"
  >
    <form class="app-form-dialog" @submit.prevent="submit">
      <FormField
        v-if="!isEditing"
        :label="$t('surface.agentDialog.repository')"
        label-for="agent-dialog-repository"
      >
        <div class="app-form-dialog__control">
          <el-select
            id="agent-dialog-repository"
            v-model="repositoryControlValue"
            :disabled="choosingFolder"
            @update:model-value="selectRepositoryControl"
          >
            <el-option
              class="agent-dialog__source-custom-option"
              :label="customFolderOptionLabel"
              :value="customFolderOptionValue"
            />
            <el-option
              v-for="repository in sourceRepositories"
              :key="repository.path"
              :label="repository.name"
              :value="repository.path"
            />
          </el-select>
        </div>
      </FormField>

      <FormField
        v-if="!isEditing && showSourceWorktreeControl"
        :label="$t('surface.agentDialog.workIn')"
        label-for="agent-dialog-worktree"
      >
        <div class="app-form-dialog__control">
          <el-select
            id="agent-dialog-worktree"
            v-model="selectedSourceWorktreePath"
            :disabled="Boolean(initialNewWorktreeBranchName.trim())"
            @update:model-value="selectWorktreeControl"
          >
            <el-option
              v-for="worktree in selectedSourceWorktrees"
              :key="worktree.path"
              :label="worktree.name"
              :value="worktree.path"
            />
            <el-option
              class="agent-dialog__source-custom-option"
              :label="$t('surface.agentDialog.newWorktree')"
              :value="newWorktreeOptionValue"
            />
          </el-select>
        </div>
      </FormField>

      <FormField
        v-if="!isEditing && showTeamSelector"
        :label="$t('surface.agentDialog.team')"
        label-for="agent-dialog-team"
      >
        <div class="agent-dialog__stacked-controls">
          <div class="app-form-dialog__control">
            <el-select id="agent-dialog-team" v-model="clientNavigationSelectTeamion">
              <el-option
                v-for="team in teams"
                :key="team.id"
                :label="team.name"
                :value="team.id"
              />
              <el-option
                :label="$t('surface.agentDialog.newTeam')"
                :value="newTeamOptionId"
              />
            </el-select>
          </div>
          <div
            v-if="clientNavigationSelectTeamion === newTeamOptionId"
            class="app-form-dialog__control app-form-dialog__input-control"
          >
            <input
              id="agent-dialog-new-team"
              v-model="newTeamName"
              class="app-form-dialog__text-input"
              type="text"
              :aria-label="$t('surface.agentDialog.newTeamName')"
              :placeholder="$t('surface.agentDialog.enterTeamName')"
            />
          </div>
        </div>
      </FormField>

      <ClearableTextInput
        v-if="isEditing"
        id="agent-dialog-name"
        v-model="name"
        subtle
        autofocus
        select-on-mount
        :disabled="submitting"
        :aria-label="$t('surface.agentDialog.agentName')"
        :placeholder="namePlaceholder"
      />
      <FormField
        v-else
        :label="$t('surface.agentDialog.name')"
        label-for="agent-dialog-name"
      >
        <ClearableTextInput
          id="agent-dialog-name"
          v-model="name"
          :disabled="submitting"
          :aria-label="$t('surface.agentDialog.agentName')"
          :placeholder="namePlaceholder"
        />
      </FormField>

      <el-alert
        v-if="errorMessage"
        :title="errorMessage"
        type="error"
        :closable="false"
        show-icon
      />
    </form>

    <NewSourceWorktreeDialog
      v-model:backend="backend"
      :choose-destination="chooseSourceWorktreeDestination"
      :create-worktree="createSourceWorktree"
      :repo="selectedSourceRepository"
      :suggest-destination="suggestSourceWorktreePath"
      :visible="newSourceWorktreeDialogVisible"
      @close="newSourceWorktreeDialogVisible = false"
      @created="selectCreatedSourceWorktree"
    />

    <RemoteFolderPickerDialog
      :initial-path="folder"
      :list-source-folders="listRemoteFolders"
      :remote-connection-id="selectedRemoteConnectionId"
      :visible="remoteFolderDialogVisible"
      @close="remoteFolderDialogVisible = false"
      @select="selectRemoteFolder"
    />

    <template v-if="!isEditing && backendChoices.length !== 1" #footer-left>
      <BackendSelector id="agent-dialog-backend" v-model="backend" :remote-connection-id="selectedRemoteConnectionId" :disabled="submitting" />
    </template>
    <template #footer>
      <button class="app-button app-button--tertiary" type="button" @click="close">{{ $t('surface.agentDialog.cancel') }}</button>
      <button
        class="app-button app-button--primary"
        type="button"
        :aria-busy="submitting"
        :disabled="submitting || !canSave"
        @click="submit"
      >
        {{ submitLabel }}
      </button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { translate } from '../i18n';
import { computed, ref, watch } from 'vue';
import { agentDisplayName } from '@workspace/core/agent-display';
import type { Agent, AgentBackend, CreateAgentInput, CreateSourceWorktreeInput, SourceFolderListing, SourceFolderListInput, SourceRepository, SourceWorktree, Team, UpdateAgentInput } from '@workspace/core/contracts';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';
import ClearableTextInput from '../shared/form/ClearableTextInput.vue';
import BackendSelector from './BackendSelector.vue';
import { useBackendChoices, useNewAgentBackend } from './backend-selection';
import NewSourceWorktreeDialog from './NewSourceWorktreeDialog.vue';
import RemoteFolderPickerDialog from './RemoteFolderPickerDialog.vue';

export type AgentDialogCreateInput = CreateAgentInput & {
  newTeamName?: string;
  teamId?: string;
};

const props = withDefaults(defineProps<{
  agent: Agent | null;
  chooseAgentFolder: () => Promise<string | null>;
  listSourceFolders?: (input?: SourceFolderListInput) => Promise<SourceFolderListing>;
  listSourceRepositories?: (remoteConnectionId?: string) => Promise<SourceRepository[]>;
  listSourceWorktrees?: (repoPath: string, remoteConnectionId?: string) => Promise<SourceWorktree[]>;
  suggestSourceWorktreePath?: (input: Pick<CreateSourceWorktreeInput, 'branchName' | 'repoPath' | 'remoteConnectionId'>) => Promise<string>;
  chooseSourceWorktreeDestination?: (defaultPath: string) => Promise<string | null>;
  createAgent: (input: AgentDialogCreateInput) => Promise<Agent | null | void>;
  createSourceWorktree?: (input: CreateSourceWorktreeInput) => Promise<SourceWorktree>;
  initialAgentName?: string;
  initialNewTeamName?: string;
  initialNewWorktreeBranchName?: string;
  initialSourceRepositoryName?: string | null;
  initialTeamId?: string | null;
  mode: 'create' | 'edit';
  remoteConnectionId?: string;
  showTeamField?: boolean;
  sourceFolderPath?: string;
  sourceRecentRepoNames?: string[];
  sourceRepositories?: SourceRepository[];
  teams?: Team[];
  updateAgent: (input: UpdateAgentInput) => Promise<void>;
  visible: boolean;
}>(), {
  initialAgentName: '',
  initialNewTeamName: '',
  initialNewWorktreeBranchName: '',
  initialSourceRepositoryName: null,
  initialTeamId: null,
  remoteConnectionId: '',
  showTeamField: false,
  sourceFolderPath: '',
  sourceRecentRepoNames: () => [],
  sourceRepositories: () => [],
  teams: () => [],
});

const emit = defineEmits<{
  close: [];
}>();

const name = ref('');
const folder = ref('');
const backend = ref<AgentBackend>();
const clientNavigationSelectTeamion = ref('');
const newTeamName = ref('');
const errorMessage = ref<string | null>(null);
const choosingFolder = ref(false);
const submitting = ref(false);
const newTeamOptionId = '__new_team__';
const customFolderOptionValue = '__custom_folder__';
const newWorktreeOptionValue = '__new_worktree__';
const pendingInitialWorktreeOptionValue = '__pending_initial_worktree__';
const selectedSourceRepositoryPath = ref('');
const selectedSourceWorktreePath = ref('');
const repositoryControlValue = ref(customFolderOptionValue);
const createdSourceWorktree = ref<SourceWorktree | null>(null);
const listedSourceWorktrees = ref<SourceWorktree[]>([]);
const listedSourceWorktreesRepoPath = ref('');
const newSourceWorktreeDialogVisible = ref(false);
const remoteSourceRepositories = ref<SourceRepository[]>([]);
const remoteSourceRepositoriesConnectionId = ref('');
const loadingRemoteSourceRepositories = ref(false);
const remoteFolderDialogVisible = ref(false);

const isEditing = computed(() => props.mode === 'edit');
const folderName = computed(() => folder.value.split(/[\\/]/).filter(Boolean).at(-1) ?? '');
const title = computed(() => isEditing.value ? translate('surface.agentDialog.editAgent') : translate('surface.agentDialog.newAgent'));
const submitLabel = computed(() => isEditing.value ? translate('surface.agentDialog.save') : translate('surface.agentDialog.createAgent'));
const teams = computed(() => props.teams);
const showTeamSelector = computed(() => props.showTeamField && !isEditing.value);
const selectedTeam = computed(() => teams.value.find((team) => team.id === clientNavigationSelectTeamion.value) ?? null);
const selectedRemoteConnectionId = computed(() => props.remoteConnectionId?.trim() ?? '');
const backendChoices = useBackendChoices(() => selectedRemoteConnectionId.value);
useNewAgentBackend(backend, backendChoices);
const sourceRepositories = computed(() => {
  if (!selectedRemoteConnectionId.value) {
    return props.sourceRepositories ?? [];
  }
  return remoteSourceRepositoriesConnectionId.value === selectedRemoteConnectionId.value
    ? remoteSourceRepositories.value
    : [];
});
const selectedSourceRepository = computed(() => sourceRepositories.value.find((repository) => repository.path === selectedSourceRepositoryPath.value) ?? null);
const selectedSourceWorktrees = computed(() => {
  const worktrees = listedSourceWorktreesRepoPath.value === selectedSourceRepositoryPath.value
    ? listedSourceWorktrees.value
    : selectedSourceRepository.value?.worktrees ?? [];
  const pendingBranch = props.initialNewWorktreeBranchName.trim();
  const pendingWorktree = pendingBranch
    ? [{ name: `${pendingBranch} (new worktree)`, path: pendingInitialWorktreeOptionValue }]
    : [];
  const created = createdSourceWorktree.value;
  if (!created || worktrees.some((worktree) => worktree.path === created.path)) {
    return [...pendingWorktree, ...worktrees];
  }
  return [...pendingWorktree, ...worktrees, created];
});
const showSourceWorktreeControl = computed(() => selectedSourceRepository.value !== null);
const selectedSourceWorktree = computed(() => selectedSourceWorktrees.value.find((worktree) => worktree.path === selectedSourceWorktreePath.value) ?? null);
const namePlaceholder = computed(() => {
  if (isEditing.value && props.agent) {
    return agentDisplayName({ ...props.agent, name: null });
  }

  const repository = selectedSourceRepository.value;
  const worktree = selectedSourceWorktree.value;
  if (repository && worktree) {
    const branch = worktree.path === pendingInitialWorktreeOptionValue
      ? props.initialNewWorktreeBranchName.trim()
      : worktree.name;
    return agentDisplayName({
      name: null,
      folder: worktree.path,
      workspace: {
        kind: 'git',
        folder: worktree.path,
        repositoryName: repository.name,
        repositoryRoot: repository.path,
        branch: branch || null,
        isLinkedWorktree: worktree.path !== repository.path,
        primaryWorktreeRoot: repository.path,
        updatedAt: '',
      },
    });
  }

  return folderName.value || translate('surface.agentDialog.nameThisAgent');
});
const customFolderOptionLabel = computed(() => folder.value && !selectedSourceRepository.value ? translate('surface.agentDialog.customFolder') : translate('surface.agentDialog.chooseFolder'));
const teamCanSave = computed(() => (
  !showTeamSelector.value ||
  (clientNavigationSelectTeamion.value === newTeamOptionId ? newTeamName.value.trim().length > 0 : clientNavigationSelectTeamion.value.trim().length > 0)
));
const canSave = computed(() => (
  !submitting.value &&
  (isEditing.value || (
    Boolean(backend.value && backendChoices.value.includes(backend.value)) &&
    folder.value.trim().length > 0 &&
    teamCanSave.value
  ))
));

watch([
  () => props.visible,
  () => props.mode,
  () => props.agent?.id,
  () => props.initialAgentName,
  () => props.initialNewTeamName,
  () => props.initialNewWorktreeBranchName,
  () => props.initialSourceRepositoryName,
  () => props.initialTeamId,
  () => props.teams.length,
], () => {
  if (props.visible) {
    resetForm();
  }
}, { immediate: true });

watch(selectedRemoteConnectionId, async (connectionId, previousConnectionId) => {
  if (!props.visible || isEditing.value || connectionId === previousConnectionId) {
    return;
  }
  await resetSourceSelectionForConnection();
});

async function chooseFolder(): Promise<void> {
  if (selectedRemoteConnectionId.value) {
    await openRemoteFolderDialog();
    return;
  }

  errorMessage.value = null;
  choosingFolder.value = true;
  try {
    const selectedFolder = await props.chooseAgentFolder();
    if (!selectedFolder) {
      syncRepositoryControlValue();
      return;
    }

    selectedSourceRepositoryPath.value = '';
    selectedSourceWorktreePath.value = '';
    repositoryControlValue.value = customFolderOptionValue;
    folder.value = selectedFolder;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    choosingFolder.value = false;
  }
}

async function openRemoteFolderDialog(): Promise<void> {
  remoteFolderDialogVisible.value = true;
}

function listRemoteFolders(input?: SourceFolderListInput): Promise<SourceFolderListing> {
  return props.listSourceFolders?.(input) ?? Promise.resolve({ path: '', parentPath: null, entries: [] });
}

function selectRemoteFolder(path: string): void {
  const selectedFolder = path.trim();
  if (!selectedFolder) {
    return;
  }

  selectedSourceRepositoryPath.value = '';
  selectedSourceWorktreePath.value = '';
  repositoryControlValue.value = customFolderOptionValue;
  folder.value = selectedFolder;
}

async function selectRepositoryControl(value: string): Promise<void> {
  if (value === customFolderOptionValue) {
    await chooseFolder();
    return;
  }

  await selectSourceRepository(value);
}

async function resetSourceSelectionForConnection(): Promise<void> {
  selectedSourceRepositoryPath.value = '';
  selectedSourceWorktreePath.value = '';
  repositoryControlValue.value = customFolderOptionValue;
  folder.value = '';
  createdSourceWorktree.value = null;
  listedSourceWorktrees.value = [];
  listedSourceWorktreesRepoPath.value = '';

  if (selectedRemoteConnectionId.value) {
    await loadRemoteSourceRepositories(selectedRemoteConnectionId.value);
  }

  const preferredRepositoryPath = preferredSourceRepositoryPath();
  if (preferredRepositoryPath) {
    await selectSourceRepository(preferredRepositoryPath);
  }
}

async function loadRemoteSourceRepositories(connectionId: string): Promise<void> {
  if (!props.listSourceRepositories) {
    remoteSourceRepositories.value = [];
    remoteSourceRepositoriesConnectionId.value = connectionId;
    return;
  }

  loadingRemoteSourceRepositories.value = true;
  errorMessage.value = null;
  try {
    remoteSourceRepositories.value = await props.listSourceRepositories(connectionId);
    remoteSourceRepositoriesConnectionId.value = connectionId;
  } catch (error) {
    remoteSourceRepositories.value = [];
    remoteSourceRepositoriesConnectionId.value = connectionId;
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loadingRemoteSourceRepositories.value = false;
  }
}

async function selectSourceRepository(repoPath: string): Promise<void> {
  selectedSourceRepositoryPath.value = repoPath;
  repositoryControlValue.value = repoPath;
  createdSourceWorktree.value = null;
  listedSourceWorktrees.value = [];
  listedSourceWorktreesRepoPath.value = '';
  const worktree = selectedSourceRepository.value?.worktrees[0];
  if (worktree) {
    selectSourceWorktree(worktree.path);
  } else {
    selectedSourceWorktreePath.value = '';
    folder.value = '';
  }
  await loadSelectedSourceWorktrees(repoPath);
}

async function loadSelectedSourceWorktrees(repoPath: string): Promise<void> {
  if (!props.listSourceWorktrees) {
    return;
  }

  try {
    const worktrees = selectedRemoteConnectionId.value
      ? await props.listSourceWorktrees(repoPath, selectedRemoteConnectionId.value)
      : await props.listSourceWorktrees(repoPath);
    if (selectedSourceRepositoryPath.value !== repoPath) {
      return;
    }
    listedSourceWorktrees.value = worktrees;
    listedSourceWorktreesRepoPath.value = repoPath;
    if (!worktrees.some((worktree) => worktree.path === selectedSourceWorktreePath.value)) {
      const firstWorktree = worktrees[0];
      if (firstWorktree) {
        selectSourceWorktree(firstWorktree.path);
      } else {
        selectedSourceWorktreePath.value = '';
        folder.value = '';
      }
    }
  } catch {
    listedSourceWorktrees.value = [];
    listedSourceWorktreesRepoPath.value = '';
  }
}

function selectWorktreeControl(value: string): void {
  if (value === newWorktreeOptionValue) {
    selectedSourceWorktreePath.value = selectedSourceWorktrees.value.find((worktree) => worktree.path === folder.value)?.path ?? '';
    openNewSourceWorktreeDialog();
    return;
  }

  selectSourceWorktree(value);
}

function selectSourceWorktree(worktreePath: string): void {
  selectedSourceWorktreePath.value = worktreePath;
  folder.value = worktreePath;
}

function openNewSourceWorktreeDialog(): void {
  newSourceWorktreeDialogVisible.value = true;
}

function suggestSourceWorktreePath(input: Pick<CreateSourceWorktreeInput, 'branchName' | 'repoPath'>): Promise<string> {
  return props.suggestSourceWorktreePath?.({
    ...input,
    ...(selectedRemoteConnectionId.value ? { remoteConnectionId: selectedRemoteConnectionId.value } : {}),
  }) ?? Promise.resolve('');
}

function chooseSourceWorktreeDestination(defaultPath: string): Promise<string | null> {
  return props.chooseSourceWorktreeDestination?.(defaultPath) ?? Promise.resolve(null);
}

async function createSourceWorktree(input: CreateSourceWorktreeInput): Promise<SourceWorktree> {
  if (!props.createSourceWorktree) {
    throw new Error(translate('surface.agentDialog.sourceWorktreeCreationIsNotAvailable'));
  }

  return props.createSourceWorktree({
    repoPath: input.repoPath,
    branchName: input.branchName,
    ...(input.baseBranch ? { baseBranch: input.baseBranch } : {}),
    destinationPath: input.destinationPath,
    ...(selectedRemoteConnectionId.value ? { remoteConnectionId: selectedRemoteConnectionId.value } : {}),
  });
}

function selectCreatedSourceWorktree(worktree: SourceWorktree): void {
  createdSourceWorktree.value = worktree;
  selectedSourceWorktreePath.value = worktree.path;
  selectSourceWorktree(worktree.path);
}

async function submit(): Promise<void> {
  if (!canSave.value) {
    return;
  }

  submitting.value = true;
  errorMessage.value = null;
  try {
    if (isEditing.value) {
      if (!props.agent) {
        throw new Error(translate('surface.agentDialog.noAgentSelectedForEditing'));
      }

      await props.updateAgent({
        id: props.agent.id,
        name: name.value.trim() || null,
      });
    } else {
      await ensureInitialWorktree();
      const createInput: AgentDialogCreateInput = {
        name: name.value.trim() || null,
        folder: folder.value,
        backend: backend.value,
        ...(selectedRemoteConnectionId.value ? { remoteConnectionId: selectedRemoteConnectionId.value } : {}),
      };
      if (showTeamSelector.value) {
        if (clientNavigationSelectTeamion.value === newTeamOptionId) {
          createInput.newTeamName = newTeamName.value;
        } else {
          createInput.teamId = clientNavigationSelectTeamion.value;
        }
      }
      const repository = selectedSourceRepository.value;
      if (repository && selectedSourceWorktreePath.value) {
        createInput.sourceRepositoryName = repository.name;
      }

      await props.createAgent(createInput);
    }
    close();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    submitting.value = false;
  }
}

function onVisibilityChanged(nextVisible: boolean): void {
  if (!nextVisible) {
    close();
  }
}

function close(): void {
  errorMessage.value = null;
  emit('close');
}

function resetForm(): void {
  errorMessage.value = null;
  submitting.value = false;
  choosingFolder.value = false;
  if (isEditing.value && props.agent) {
    name.value = props.agent.name ?? '';
    return;
  }

  name.value = props.initialAgentName.trim();
  folder.value = '';
  backend.value = backendChoices.value[0];
  clientNavigationSelectTeamion.value = initialTeamSelection();
  newTeamName.value = props.initialNewTeamName;
  selectedSourceRepositoryPath.value = '';
  selectedSourceWorktreePath.value = '';
  repositoryControlValue.value = customFolderOptionValue;
  createdSourceWorktree.value = null;
  listedSourceWorktrees.value = [];
  listedSourceWorktreesRepoPath.value = '';
  remoteSourceRepositories.value = [];
  remoteSourceRepositoriesConnectionId.value = '';
  loadingRemoteSourceRepositories.value = false;
  remoteFolderDialogVisible.value = false;
  newSourceWorktreeDialogVisible.value = false;
  void resetSourceSelectionForConnection().then(() => {
    if (
      props.visible &&
      !isEditing.value &&
      selectedSourceRepository.value &&
      props.initialNewWorktreeBranchName.trim()
    ) {
      selectedSourceWorktreePath.value = pendingInitialWorktreeOptionValue;
    }
  });
}

async function ensureInitialWorktree(): Promise<void> {
  const branchName = props.initialNewWorktreeBranchName.trim();
  const repository = selectedSourceRepository.value;
  if (!branchName || !repository || createdSourceWorktree.value) {
    return;
  }
  if (!props.createSourceWorktree) {
    throw new Error(translate('surface.agentDialog.sourceWorktreeCreationIsNotAvailable'));
  }

  const worktree = await props.createSourceWorktree({
    repoPath: repository.path,
    branchName,
    ...(selectedRemoteConnectionId.value ? { remoteConnectionId: selectedRemoteConnectionId.value } : {}),
  });
  selectCreatedSourceWorktree(worktree);
}

function preferredSourceRepositoryPath(): string {
  const requestedRepository = props.initialSourceRepositoryName?.trim();
  if (requestedRepository) {
    const requested = sourceRepositories.value.find((repository) => repository.name === requestedRepository);
    if (requested) return requested.path;
  }
  const recent = props.sourceRecentRepoNames ?? [];
  const recentRepository = sourceRepositories.value.find((repository) => recent.includes(repository.name));
  return recentRepository?.path ?? sourceRepositories.value[0]?.path ?? '';
}

function initialTeamSelection(): string {
  if (!showTeamSelector.value) {
    return '';
  }

  if (props.initialTeamId && teams.value.some((team) => team.id === props.initialTeamId)) {
    return props.initialTeamId;
  }

  return teams.value[0]?.id ?? newTeamOptionId;
}

function syncRepositoryControlValue(): void {
  repositoryControlValue.value = selectedSourceRepositoryPath.value || customFolderOptionValue;
}

</script>

<style scoped>
.agent-dialog__stacked-controls {
  display: grid;
  gap: var(--space-3);
}

.agent-dialog__source-custom-option {
  color: var(--color-text);
}
</style>
