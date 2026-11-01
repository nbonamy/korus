<template>
  <FormDialog :model-value="!progress.length" :title="$t('surface.newSourceWorktreeDialog.newWorktree')" @update:model-value="onVisibilityChanged">
    <form class="app-form-dialog" @submit.prevent="create">
      <FormField :label="$t('features.repositories')" label-for="feature-worktree-repositories">
        <el-select
          id="feature-worktree-repositories"
          v-model="selected"
          class="feature-worktree-dialog__repositories"
          multiple
          :disabled="creating || worktrees.size > 0"
          :aria-label="$t('features.repositories')"
        >
          <el-option v-for="repository in repositories" :key="repositoryKey(repository)" :label="repository.repositoryName" :value="repositoryKey(repository)" />
        </el-select>
      </FormField>
      <FormField :label="$t('features.branch')" label-for="feature-worktree-branch">
        <div class="app-form-dialog__control app-form-dialog__input-control">
          <input
            id="feature-worktree-branch"
            v-model="branch"
            class="app-form-dialog__text-input"
            type="text"
            :disabled="creating || worktrees.size > 0"
            :placeholder="$t('repositories.worktree.branchPlaceholder')"
          />
        </div>
      </FormField>
      <p v-for="failure in failures" :key="failure.key" class="feature-worktree-dialog__error" role="alert">
        {{ failure.name }}: {{ failure.message }}
      </p>
    </form>
    <template #footer>
      <button class="app-button app-button--tertiary" type="button" :disabled="creating" @click="emit('close')">{{ $t('common.cancel') }}</button>
      <button class="app-button app-button--primary" type="button" :disabled="creating || !selected.length || !branch.trim()" :aria-busy="creating" @click="create">
        {{ failures.length ? $t('features.retry') : $t('surface.newSourceWorktreeDialog.create') }}
      </button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Agent, AgentBackend, AgentCreationProgress, CreateAgentInput, CreateSourceWorktreeInput, SourceBranch, SourceWorktree } from '@workspace/core/contracts';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';
import type { SidebarRepositoryTarget } from './agent-sidebar-contracts';
import { isProvisioningBackgrounded, publishProvisioningOperation } from './provisioning-operations';

const props = defineProps<{
  repositories: SidebarRepositoryTarget[];
  teamId: string;
  createAgent: (input: CreateAgentInput, navigation?: { select?: boolean }) => Promise<Agent | null | void>;
  createWorktree: (input: CreateSourceWorktreeInput) => Promise<SourceWorktree>;
  listBranches: (path: string, remoteConnectionId?: string) => Promise<SourceBranch[]>;
  backendForHost: (remoteConnectionId?: string) => AgentBackend | undefined;
}>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const repositoryKey = (repository: SidebarRepositoryTarget) => repository.remoteConnectionId
  ? `${repository.remoteConnectionId}:${repository.repositoryRoot}`
  : repository.repositoryRoot;
const selected = ref(props.repositories.map(repositoryKey));
const branch = ref('');
const creating = ref(false);
const completed = ref(new Set<string>());
const worktrees = ref(new Map<string, string>());
const failures = ref<Array<{ key: string; name: string; message: string }>>([]);
const progress = ref<AgentCreationProgress[]>([]);
watch(progress, entries => publishProvisioningOperation('featureWorktree',
  entries.length ? { mode: 'batch', progress: entries } : null, { onClose: closeProgress }), { immediate: true });
onBeforeUnmount(() => publishProvisioningOperation('featureWorktree', null));

function closeProgress(): void {
  if (creating.value) return;
  if (failures.value.length) progress.value = [];
  else emit('close');
}

function updateProgress(key: string, change: Partial<AgentCreationProgress>): void {
  progress.value = progress.value.map(entry => entry.id === key ? { ...entry, ...change } : entry);
}

async function create(): Promise<void> {
  if (creating.value || !selected.value.length || !branch.value.trim()) return;
  creating.value = true;
  failures.value = [];
  progress.value = props.repositories.filter(repository => selected.value.includes(repositoryKey(repository)) && !completed.value.has(repositoryKey(repository)))
    .map(repository => ({
      id: repositoryKey(repository), repositoryName: repository.repositoryName,
      backend: props.backendForHost(repository.remoteConnectionId) ?? 'codex',
      state: 'running', createWorktree: true, branchName: branch.value.trim(), hasPrompt: false,
      phase: worktrees.value.has(repositoryKey(repository)) ? 'creatingAgent' : 'creatingWorktree',
    }));
  try {
    for (const repository of props.repositories) {
      const key = repositoryKey(repository);
      if (!selected.value.includes(key) || completed.value.has(key)) continue;
      try {
        const backend = props.backendForHost(repository.remoteConnectionId);
        if (!backend) throw new Error(t('features.noBackend'));
        let folder = worktrees.value.get(key);
        if (!folder) {
          const branches = await props.listBranches(repository.repositoryRoot, repository.remoteConnectionId);
          const baseBranch = branches.find(item => item.isDefault)?.name;
          if (!baseBranch) throw new Error(t('features.defaultBranchUnavailable'));
          const worktree = await props.createWorktree({
            repoPath: repository.repositoryRoot,
            branchName: branch.value.trim(),
            baseBranch,
            requireNewBranch: true,
            ...(repository.remoteConnectionId ? { remoteConnectionId: repository.remoteConnectionId } : {}),
          });
          folder = worktree.path;
          worktrees.value.set(key, folder);
        }
        updateProgress(key, { phase: 'creatingAgent' });
        const result = await props.createAgent({
          name: null,
          folder,
          sourceRepositoryName: repository.repositoryName,
          teamId: props.teamId,
          ...(repository.remoteConnectionId ? { remoteConnectionId: repository.remoteConnectionId } : {}),
          selection: { backend },
        }, { select: false });
        if (result === null) throw new Error(t('features.creationFailed'));
        completed.value.add(key);
        updateProgress(key, { state: 'success', ...(result ? { agentId: result.id } : {}) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.value.push({ key, name: repository.repositoryName, message });
        updateProgress(key, { state: 'error', error: message });
      }
    }
    if (!failures.value.length && progress.value.every(entry => isProvisioningBackgrounded(entry.id))) emit('close');
  } finally {
    creating.value = false;
  }
}

function onVisibilityChanged(visible: boolean): void {
  if (!visible && !creating.value) emit('close');
}
</script>

<style scoped>
.feature-worktree-dialog__repositories {
  width: 100%;
}

.feature-worktree-dialog__error {
  margin: 0;
  color: var(--color-error);
}
</style>
