<template>
  <FormDialog :model-value="!progress.length" :title="agentMode ? $t('features.newAgent') : $t('surface.newSourceWorktreeDialog.newWorktree')" @update:model-value="onVisibilityChanged">
    <form class="app-form-dialog" @submit.prevent="create">
      <FormField :label="agentMode ? $t('features.repository') : $t('features.repositories')" label-for="feature-worktree-repositories">
        <el-select
          id="feature-worktree-repositories"
          v-model="repositorySelection"
          class="feature-worktree-dialog__repositories"
          :multiple="!agentMode"
          :disabled="creating || worktrees.size > 0"
          :aria-label="agentMode ? $t('features.repository') : $t('features.repositories')"
        >
          <el-option v-for="repository in repositories" :key="repositoryKey(repository)" :label="repository.repositoryName" :value="repositoryKey(repository)" />
        </el-select>
      </FormField>
      <FormField v-if="agentMode && !fixedBranch" :label="$t('features.branchSelect')" label-for="feature-worktree-branch-choice">
        <el-select
          id="feature-worktree-branch-choice"
          v-model="branchChoice"
          class="feature-worktree-dialog__repositories"
          :loading="branchesLoading"
          :disabled="creating || worktrees.size > 0"
          :aria-label="$t('features.branchSelect')"
        >
          <el-option :label="$t('features.branch')" :value="NEW_BRANCH" />
          <el-option v-for="item in branchOptions" :key="item.name" :label="item.name" :value="item.name" />
        </el-select>
      </FormField>
      <FormField v-if="!agentMode || fixedBranch || branchChoice === NEW_BRANCH" :label="agentMode ? $t('features.branchName') : $t('features.branch')" label-for="feature-worktree-branch">
        <div class="app-form-dialog__control app-form-dialog__input-control">
          <input
            id="feature-worktree-branch"
            v-model="branch"
            class="app-form-dialog__text-input"
            type="text"
            :disabled="creating || worktrees.size > 0"
            :readonly="Boolean(fixedBranch)"
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
      <button class="app-button app-button--primary" type="button" :disabled="!canCreate" :aria-busy="creating" @click="create">
        {{ failures.length ? $t('features.retry') : $t('surface.newSourceWorktreeDialog.create') }}
      </button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Agent, HarnessProvider, AgentCreationProgress, CreateAgentInput, CreateSourceWorktreeInput, SourceBranch, SourceWorktree } from '@workspace/core/contracts';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';
import type { SidebarRepositoryTarget } from './agent-sidebar-contracts';
import { isProvisioningBackgrounded, publishProvisioningOperation } from './provisioning-operations';
import { defaultHarnessProvider } from '@workspace/core/provider-capabilities';

const props = withDefaults(defineProps<{
  /** `agent` starts one agent on a new or existing branch of one repository; `worktree` makes a feature worktree across repositories. */
  mode?: 'worktree' | 'agent';
  /** In agent mode, the branch is the feature's and cannot be changed; a repository without it gets it. */
  fixedBranch?: string;
  repositories: SidebarRepositoryTarget[];
  teamId: string;
  createAgent: (input: CreateAgentInput, navigation?: { select?: boolean }) => Promise<Agent | null | void>;
  createWorktree: (input: CreateSourceWorktreeInput) => Promise<SourceWorktree>;
  listBranches: (path: string, remoteConnectionId?: string) => Promise<SourceBranch[]>;
  providerForHost: (remoteConnectionId?: string) => HarnessProvider | undefined;
}>(), { mode: 'worktree' });
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const repositoryKey = (repository: SidebarRepositoryTarget) => repository.remoteConnectionId
  ? `${repository.remoteConnectionId}:${repository.repositoryRoot}`
  : repository.repositoryRoot;
const NEW_BRANCH = '__new_branch__';
const agentMode = computed(() => props.mode === 'agent');
const selected = ref(agentMode.value ? props.repositories.slice(0, 1).map(repositoryKey) : props.repositories.map(repositoryKey));
const repositorySelection = computed<string | string[]>({
  get: () => agentMode.value ? selected.value[0] ?? '' : selected.value,
  set: value => { selected.value = Array.isArray(value) ? value : value ? [value] : []; },
});
const branchChoice = ref(NEW_BRANCH);
const branches = ref<SourceBranch[]>([]);
const branchesLoading = ref(false);
const branchOptions = computed(() => [...branches.value].sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name)));
let branchLoad = 0;
watch(() => agentMode.value ? selected.value[0] : undefined, async key => {
  const repository = props.repositories.find(item => repositoryKey(item) === key);
  const load = ++branchLoad;
  branchChoice.value = NEW_BRANCH;
  branches.value = [];
  if (!repository) return;
  branchesLoading.value = true;
  try {
    const loaded = await props.listBranches(repository.repositoryRoot, repository.remoteConnectionId);
    if (load === branchLoad) {
      branches.value = loaded;
      if (!props.fixedBranch) branchChoice.value = loaded.find(item => item.isDefault)?.name ?? NEW_BRANCH;
    }
  } catch { /* A new branch can still be created; the failure surfaces when creating. */ }
  finally { if (load === branchLoad) branchesLoading.value = false; }
}, { immediate: true });
const existingBranch = () => agentMode.value && branchChoice.value !== NEW_BRANCH ? branchChoice.value : null;
const canCreate = computed(() => !creating.value && !branchesLoading.value && selected.value.length > 0 && (agentMode.value && branchChoice.value !== NEW_BRANCH || Boolean(branch.value.trim())));
const branch = ref(props.fixedBranch ?? '');
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
  if (!canCreate.value) return;
  const existing = existingBranch();
  creating.value = true;
  failures.value = [];
  progress.value = props.repositories.filter(repository => selected.value.includes(repositoryKey(repository)) && !completed.value.has(repositoryKey(repository)))
    .map(repository => ({
      id: repositoryKey(repository), repositoryName: repository.repositoryName,
      provider: props.providerForHost(repository.remoteConnectionId) ?? defaultHarnessProvider,
      state: 'running', hasPrompt: false,
      createWorktree: !existing || !branches.value.find(item => item.name === existing)?.worktreePath,
      branchName: existing ?? branch.value.trim(),
      phase: worktrees.value.has(repositoryKey(repository)) || (existing && branches.value.find(item => item.name === existing)?.worktreePath) ? 'creatingAgent' : 'creatingWorktree',
    }));
  try {
    for (const repository of props.repositories) {
      const key = repositoryKey(repository);
      if (!selected.value.includes(key) || completed.value.has(key)) continue;
      try {
        const provider = props.providerForHost(repository.remoteConnectionId);
        if (!provider) throw new Error(t('features.noProvider'));
        let folder = worktrees.value.get(key);
        if (!folder) {
          const available = await props.listBranches(repository.repositoryRoot, repository.remoteConnectionId);
          const remote = repository.remoteConnectionId ? { remoteConnectionId: repository.remoteConnectionId } : {};
          // In agent mode a typed name that already exists is that branch: its worktree, or one made for it.
          const known = existing ?? (agentMode.value ? available.find(item => item.name === branch.value.trim())?.name : undefined);
          const inPlace = known ? available.find(item => item.name === known)?.worktreePath : undefined;
          if (inPlace) folder = inPlace;
          else {
            const baseBranch = available.find(item => item.isDefault)?.name;
            if (!known && !baseBranch) throw new Error(t('features.defaultBranchUnavailable'));
            const worktree = await props.createWorktree(known
              ? { repoPath: repository.repositoryRoot, branchName: known, reuseExisting: true, ...remote }
              : { repoPath: repository.repositoryRoot, branchName: branch.value.trim(), baseBranch, requireNewBranch: true, ...remote });
            folder = worktree.path;
          }
          worktrees.value.set(key, folder);
        }
        updateProgress(key, { phase: 'creatingAgent' });
        const result = await props.createAgent({
          name: null,
          folder,
          sourceRepositoryName: repository.repositoryName,
          teamId: props.teamId,
          ...(repository.remoteConnectionId ? { remoteConnectionId: repository.remoteConnectionId } : {}),
          selection: { provider },
        }, { select: agentMode.value });
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
