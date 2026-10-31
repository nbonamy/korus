<template>
  <el-dialog
    class="app-dialog app-dialog--compact repository-session-source-dialog"
    :class="{ 'repository-session-source-dialog--assignment': selectedWorkItem, 'repository-session-source-dialog--issue-picker': purpose === 'missionIssue' }"
    :model-value="visible"
    :teleported="false"
    :align-center="Boolean(selectedWorkItem)"
    :style="{ width: '720px' }"
    destroy-on-close
    @update:model-value="onVisibilityChanged"
  >
    <template #header>
      <div v-if="!selectedWorkItem" class="repository-session-source-dialog__search-row">
        <SearchIcon aria-hidden="true" />
        <input
          ref="searchInput"
          v-model="query"
          :placeholder="searchPlaceholder"
          :aria-label="t(purpose === 'missionIssue' ? 'repositories.sessionSource.searchIssues' : 'repositories.sessionSource.search')"
          autocomplete="off"
          spellcheck="false"
        >
      </div>
      <div v-else class="repository-session-source-dialog__assignment-header">
        <button type="button" :aria-label="t('common.back')" @click="selectedWorkItem = null">
          <ArrowLeftIcon aria-hidden="true" />
        </button>
        <strong>{{ t('repositoryBacklog.startWork', { identifier: workItemDisplayIdentifier(selectedWorkItem) }) }}</strong>
      </div>
    </template>

    <div v-if="!selectedWorkItem && purpose === 'session'" class="repository-session-source-dialog__toolbar">
      <div class="repository-session-source-dialog__toolbar-start">
        <el-tabs v-model="tab" class="repository-session-source-dialog__tabs" :aria-label="t('repositories.sessionSource.type')">
          <el-tab-pane v-for="option in tabs" :key="option.id" :name="option.id" :label="option.label" />
        </el-tabs>
        <BacklogSourceSelector
          v-if="tab === 'issues' && backlog.providers.value.length"
          chip
          size="small"
          :provider="backlog.provider.value"
          :providers="backlog.providers.value"
          :sources="backlog.sources.value"
          :source-id="backlog.sourceId.value"
          :show-source="!workProviderDefinition(backlog.provider.value).repositoryBacked"
          @select-provider="backlog.selectProvider"
          @select-source="selectSource"
        />
      </div>
      <span class="repository-session-source-dialog__repository"><RepositoryIcon aria-hidden="true" />{{ repositoryName }}</span>
    </div>

    <BacklogSourceSelector
      v-if="!selectedWorkItem && purpose === 'missionIssue' && backlog.providers.value.length"
      class="repository-session-source-dialog__sources"
      size="small"
      :provider="backlog.provider.value"
      :providers="backlog.providers.value"
      :sources="backlog.sources.value"
      :source-id="backlog.sourceId.value"
      show-source
      @select-provider="backlog.selectProvider"
      @select-source="selectSource"
    />

    <section class="repository-session-source-dialog__results" aria-live="polite">
      <p v-if="purpose === 'missionIssue' && error" class="repository-session-source-dialog__state repository-session-source-dialog__state--error" role="alert">{{ error }}</p>
      <template v-if="selectedWorkItem">
        <p v-if="!workProviderDefinition(selectedWorkItem.provider).repositoryBacked">{{ t('backlogSource.codeRepository') }}: {{ repositoryName }}</p>
        <WorkItemAssignmentPicker
          v-model:backend="backend"
          :item="selectedWorkItem"
          :branch-name="assignmentBranchName"
          :existing-worktree-path="assignmentExistingWorktreePath"
          :model-agent-id="modelAgentId"
          :remote-connection-id="hostId"
          :sessions="sessions"
          @custom="customWorkItem"
          @submit="startWorkItem"
        >
          <WorkItemDetail :item="selectedWorkItem" />
        </WorkItemAssignmentPicker>
      </template>
      <p v-else-if="effectiveLoading" class="repository-session-source-dialog__state">{{ t('repositories.sessionSource.loading') }}</p>
      <p v-else-if="tab === 'issues' && backlog.error.value" role="alert">{{ backlog.error.value }} <button type="button" @click="backlog.refresh">{{ t('backlogSource.retry') }}</button></p>
      <p v-else-if="purpose === 'session' && tab !== 'issues' && error" class="repository-session-source-dialog__state repository-session-source-dialog__state--error">{{ error }}</p>
      <p v-else-if="purpose === 'missionIssue' && backlog.sources.value.length === 0" class="repository-session-source-dialog__state">{{ t('repositories.sessionSource.noRepositories') }}</p>
      <p v-else-if="purpose === 'missionIssue' && !backlog.sourceId.value" class="repository-session-source-dialog__state">{{ t('repositories.sessionSource.chooseRepositoryToSeeIssues') }}</p>
      <template v-else-if="tab === 'branches' && purpose === 'session'">
        <h3>{{ t('repositories.sessionSource.recentBranches') }}</h3>
        <button v-for="branch in filteredBranches" :key="branch.name" class="repository-session-source-dialog__result" type="button" @click="emit('select-branch', branch)">
          <GitBranchIcon
            class="repository-session-source-dialog__result-icon repository-session-source-dialog__result-icon--branch"
            :class="{
              'repository-session-source-dialog__result-icon--default': branch.isDefault,
              'repository-session-source-dialog__result-icon--worktree': branch.worktreePath && !branch.isDefault,
            }"
            aria-hidden="true"
          />
          <span class="repository-session-source-dialog__result-copy">
            <strong>{{ branch.name }}</strong>
            <small v-if="branch.isDefault">{{ t('repositories.sessionSource.default') }}</small>
          </span>
          <span v-if="branch.worktreePath" class="repository-session-source-dialog__badge">{{ t('repositories.sessionSource.checkedOut') }}</span>
          <ArrowRightIcon class="repository-session-source-dialog__arrow" aria-hidden="true" />
        </button>
        <p v-if="filteredBranches.length === 0" class="repository-session-source-dialog__state">{{ t('repositories.sessionSource.noBranches') }}</p>
      </template>
      <template v-else>
        <h3>{{ tab === 'pullRequests' ? t(backlog.provider.value === 'gitlab' ? 'gitlabBacklog.recentMergeRequests' : 'repositories.sessionSource.recentPullRequests') : t('repositories.sessionSource.recentIssues') }}</h3>
        <button v-for="item in filteredWorkItems" :key="item.id" class="repository-session-source-dialog__result" type="button" @click="selectWorkItem(item)">
          <GitPullRequestIcon v-if="item.kind === 'pullRequest'" class="repository-session-source-dialog__result-icon" aria-hidden="true" />
          <IssueIcon v-else class="repository-session-source-dialog__result-icon" aria-hidden="true" />
          <span class="repository-session-source-dialog__result-copy">
            <small>{{ workItemDisplayIdentifier(item) }}</small>
            <strong>{{ item.title }}</strong>
          </span>
          <ArrowRightIcon class="repository-session-source-dialog__arrow" aria-hidden="true" />
        </button>
        <p v-if="filteredWorkItems.length === 0" class="repository-session-source-dialog__state">{{ tab === 'pullRequests' ? t(backlog.provider.value === 'gitlab' ? 'gitlabBacklog.noMergeRequests' : 'repositories.sessionSource.noPullRequests') : t('repositories.sessionSource.noIssues') }}</p>
      </template>
    </section>

    <template v-if="showHostFooter" #footer>
      <div class="repository-session-source-dialog__footer">
        <HostSelector
          class="repository-session-source-dialog__host"
          size="small"
          :model-value="hostId ?? 'local'"
          :hosts="hosts"
          :disabled="hostBusy"
          @update:model-value="emit('change-host', $event === 'local' ? undefined : $event)"
        />
        <span
          v-if="hostHint"
          class="repository-session-source-dialog__host-hint"
          :class="{ 'repository-session-source-dialog__host-hint--warning': hostCheckout?.state === 'missing' }"
        >{{ hostHint }}</span>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { workProviderDefinition, workProviderForRepositoryId } from '@workspace/core/work-providers';
import { workItemBranchName, workItemDisplayIdentifier } from '@workspace/core/work-item-prompts';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  IconArrowLeft as ArrowLeftIcon,
  IconCircleDot as IssueIcon,
  IconGitPullRequest as GitPullRequestIcon,
  IconSearch as SearchIcon,
} from '@tabler/icons-vue';
import type { RemoteConnection, SourceBranch, WorkItem, WorkSource } from '@workspace/core/contracts';
import BacklogSourceSelector from './BacklogSourceSelector.vue';
import WorkItemDetail from './WorkItemDetail.vue';
import { useWorkSourceBacklog } from './use-work-source-backlog';
import { ArrowRightIcon, GitBranchIcon, GitForkIcon as RepositoryIcon } from '../shared/icons/app-icons';
import HostSelector from './HostSelector.vue';
import type { RemoteCheckout } from './use-remote-target';
import WorkItemAssignmentPicker from './WorkItemAssignmentPicker.vue';
import { useBackendChoices, useNewAgentBackend } from './backend-selection';
const backend = defineModel<import('@workspace/core/contracts').AgentBackend>('backend');
import type { WorkItemAssignmentSelection, WorkItemAssignmentSession } from './WorkItemAssignmentPicker.vue';

type SourceTab = 'branches' | 'pullRequests' | 'issues';

const props = withDefaults(defineProps<{
  location?: import('@workspace/core/contracts').AutomationLocation;
  modelAgentId?: string;
  branches?: SourceBranch[];
  error?: string | null;
  loading?: boolean;
  repositoryName: string;
  purpose?: 'session' | 'missionIssue';
  repositories?: WorkSource[];
  sourceFilter?: (source: WorkSource) => boolean;
  selectedRepositoryId?: string | null;
  sessions?: WorkItemAssignmentSession[];
  visible: boolean;
  workItems?: WorkItem[];
  /** Ready remote machines; the host footer appears only when there is a choice. */
  hosts?: RemoteConnection[];
  hostId?: string;
  hostCheckout?: RemoteCheckout | null;
  hostBusy?: boolean;
}>(), {
  hosts: () => [],
  hostCheckout: null,
  hostBusy: false,
  branches: () => [],
  modelAgentId: '',
  error: null,
  loading: false,
  sessions: () => [],
  workItems: () => [],
  purpose: 'session',
  repositories: () => [],
  selectedRepositoryId: null,
});

const emit = defineEmits<{
  close: [];
  'custom-work-item': [selection: Omit<WorkItemAssignmentSelection, 'action'>];
  'change-host': [hostId: string | undefined];
  'select-branch': [branch: SourceBranch];
  'select-repository': [repositoryId: string];
  'select-work-item': [item: WorkItem];
  'start-work-item': [selection: WorkItemAssignmentSelection];
}>();

useNewAgentBackend(backend, useBackendChoices(() => props.hostId), () => props.visible);

const { t } = useI18n();
const backlog = useWorkSourceBacklog({
  location: () => props.location,
  query: { kind: 'issue', state: 'open' },
  preferredSourceId: () => props.selectedRepositoryId,
  preferredProvider: () => workProviderForRepositoryId(props.selectedRepositoryId) === 'gitlab' ? 'gitlab' : undefined,
  originProvider: () => props.purpose === 'session' ? workProviderForRepositoryId(props.selectedRepositoryId) : undefined,
  restrictToRepository: () => props.purpose === 'session',
  acceptsSource: source => props.sourceFilter?.(source) ?? true,
  enabled: () => props.visible,
});
const effectiveLoading = computed(() => tab.value === 'issues' ? backlog.status.value === 'loading' : props.loading);
function selectSource(id: string | null): void {
  selectedWorkItem.value = null;
  query.value = '';
  void backlog.selectSource(id);
}

const searchInput = ref<HTMLInputElement | null>(null);
const query = ref('');
const selectedWorkItem = ref<WorkItem | null>(null);
let selectionRevision = 0;
watch([selectedWorkItem, () => props.visible, () => JSON.stringify(props.location)], () => { ++selectionRevision; }, { flush: 'sync' });
watch([backlog.provider, () => backlog.providers.value.length > 0], () => {
  selectedWorkItem.value = null;
  query.value = '';
});
const tab = ref<SourceTab>(props.purpose === 'missionIssue' ? 'issues' : 'branches');
const tabs = computed<ReadonlyArray<{ id: SourceTab; label: string }>>(() => [
  { id: 'branches', label: t('repositories.sessionSource.branches') },
  { id: 'pullRequests', label: t(backlog.provider.value === 'gitlab' ? 'gitlabBacklog.mergeRequests' : 'repositories.sessionSource.pullRequests') },
  { id: 'issues', label: t('repositories.sessionSource.issues') },
]);
const searchPlaceholder = computed(() => tab.value === 'branches'
  ? t('repositories.sessionSource.searchBranch')
  : t('repositories.sessionSource.searchWork'));
const showHostFooter = computed(() => props.purpose === 'session' && !selectedWorkItem.value && props.hosts.length > 0);
const hostHint = computed(() => {
  if (props.hostBusy) return t('remoteTarget.cloning');
  const checkout = props.hostCheckout;
  if (!checkout || checkout.state === 'cloned') return '';
  if (checkout.state === 'checking') return t('remoteTarget.checking');
  if (checkout.state === 'missing') return t('remoteTarget.willClone');
  if (checkout.state === 'noOrigin') return t('remoteTarget.noOrigin');
  return checkout.message;
});
const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase());
const filteredBranches = computed(() => props.branches.filter((branch) => branch.name.toLocaleLowerCase().includes(normalizedQuery.value)));
const filteredWorkItems = computed(() => (tab.value === 'issues' ? backlog.items.value : props.workItems).filter((item) => {
  if (props.purpose === 'missionIssue' && item.kind === 'pullRequest') return false;
  if (tab.value === 'pullRequests' && item.kind !== 'pullRequest') return false;
  if (tab.value === 'issues' && item.kind === 'pullRequest') return false;
  const haystack = `${item.identifier ?? item.number} ${item.title} ${item.authorName ?? ''} ${item.url}`.toLocaleLowerCase();
  return haystack.includes(normalizedQuery.value);
}));
const assignmentBranchName = computed(() => {
  const item = selectedWorkItem.value;
  if (!item) return '';
  return workItemBranchName(item);
});
const assignmentExistingWorktreePath = computed(() => (
  props.branches.find((branch) => branch.name === assignmentBranchName.value)?.worktreePath ?? ''
));
watch(() => props.visible, async (visible) => {
  if (!visible) return;
  query.value = '';
  tab.value = props.purpose === 'missionIssue' ? 'issues' : 'branches';
  selectedWorkItem.value = null;
  await nextTick();
  searchInput.value?.focus();
});

watch(() => `${JSON.stringify(props.location)}:${props.selectedRepositoryId}:${props.repositoryName}`, () => {
  selectedWorkItem.value = null;
  query.value = '';
});

function onVisibilityChanged(visible: boolean): void {
  if (!visible) emit('close');
}

function selectWorkItem(item: WorkItem): void {
  if (!filteredWorkItems.value.some(candidate => candidate.id === item.id)) return;
  if (props.purpose === 'missionIssue') emit('select-work-item', item);
  if (props.purpose === 'session') selectedWorkItem.value = item;
}

function startWorkItem(selection: WorkItemAssignmentSelection): void {
  if (selection.item.id !== selectedWorkItem.value?.id || !props.visible) return;
  emit('start-work-item', { ...selection, isCurrent: selectionGuard(selection.item) });
}

function selectionGuard(item: WorkItem): () => boolean {
  const provider = backlog.provider.value;
  const source = backlog.sourceId.value;
  const revision = selectionRevision;
  return () => revision === selectionRevision && props.visible && selectedWorkItem.value?.id === item.id && backlog.provider.value === provider && backlog.sourceId.value === source;
}

function customWorkItem(selection: Omit<WorkItemAssignmentSelection, 'action'>): void {
  if (selection.item.id !== selectedWorkItem.value?.id || !props.visible) return;
  emit('custom-work-item', { ...selection, isCurrent: selectionGuard(selection.item) });
}
</script>

<style scoped>
:global(.repository-session-source-dialog.el-dialog) {
  overflow: hidden;
}

.repository-session-source-dialog__search-row {
  display: grid;
  grid-template-columns: var(--icon-md) minmax(0, 1fr);
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-8);
}

.repository-session-source-dialog__search-row svg {
  width: var(--icon-md);
  height: var(--icon-md);
  color: var(--color-text-muted);
}

.repository-session-source-dialog__search-row input {
  min-width: 0;
  padding: 0;
  border: 0;
  outline: 0;
  color: var(--color-text);
  background: transparent;
  font: inherit;
}

/* Keep the search clear of the close button in every picker mode. */
:global(.repository-session-source-dialog.app-dialog--compact .el-dialog__header) {
  padding-right: 48px;
}

.repository-session-source-dialog__sources {
  padding: var(--space-6) var(--space-8);
  border-bottom: 1px solid var(--color-border);
}

.repository-session-source-dialog__sources :deep(.el-select .el-select__wrapper) {
  height: 28px;
  min-height: 28px;
  padding-block: 0;
}

.repository-session-source-dialog__assignment-header {
  min-height: 54px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-6);
}

.repository-session-source-dialog__assignment-header button {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.repository-session-source-dialog__assignment-header button:hover {
  color: var(--color-text);
  background: var(--color-surface-base);
}

.repository-session-source-dialog__assignment-header button:disabled {
  opacity: 0.4;
  pointer-events: none;
}

.repository-session-source-dialog__assignment-header svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.repository-session-source-dialog__assignment-header strong {
  font-size: var(--font-size-14);
}

.repository-session-source-dialog__footer {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.repository-session-source-dialog__host {
  width: 180px;
}

.repository-session-source-dialog__host-hint {
  margin-left: auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.repository-session-source-dialog__host-hint--warning {
  color: var(--color-warning);
}

.repository-session-source-dialog__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
  padding: var(--space-3) var(--space-8);
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
}

.repository-session-source-dialog__toolbar-start {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.repository-session-source-dialog__toolbar-start :deep(.backlog-source-selector) {
  /* The chip is taller than the field beside it; centre both instead of top-aligning the field. */
  align-items: center;
}

.repository-session-source-dialog__tabs :deep(.el-tabs__nav-wrap) {
  margin-bottom: 0;
}

.repository-session-source-dialog__toolbar-start :deep(.backlog-source-selector__source) {
  /* An explicit width: inside a shrink-to-fit row the select would otherwise collapse to its chevron. */
  width: 220px;
  flex: 0 1 220px;
}

.repository-session-source-dialog__tabs {
  min-width: 0;
}

.repository-session-source-dialog__tabs :deep(.el-tabs__header) {
  margin: 0;
}

.repository-session-source-dialog__tabs :deep(.el-tabs__nav-wrap::after),
.repository-session-source-dialog__tabs :deep(.el-tabs__active-bar),
.repository-session-source-dialog__tabs :deep(.el-tabs__content) {
  display: none;
}

.repository-session-source-dialog__tabs :deep(.el-tabs__item) {
  height: auto;
  padding: var(--space-3) var(--space-6);
  border: 0;
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
  background: transparent;
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}

.repository-session-source-dialog__tabs
  :deep(.el-tabs__item.is-top:nth-child(2)) {
  padding-left: var(--space-6);
}

.repository-session-source-dialog__tabs
  :deep(.el-tabs__item.is-top:last-child) {
  padding-right: var(--space-6);
}

.repository-session-source-dialog__tabs :deep(.el-tabs__item.is-active) {
  color: var(--color-text);
  background: var(--color-surface-base);
}

.repository-session-source-dialog__repository {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repository-session-source-dialog__repository svg {
  width: var(--icon-md);
  height: var(--icon-md);
}

.repository-session-source-dialog__results {
  min-height: 260px;
  max-height: min(52vh, 520px);
  overflow-y: auto;
  padding: var(--space-8);
}

.repository-session-source-dialog--assignment
  .repository-session-source-dialog__results {
  min-height: 0;
  /* Header plus content stay inside the window so the overlay never scrolls the dialog. */
  max-height: min(calc(100vh - 160px), 880px);
  padding: var(--space-3) var(--space-8) var(--space-8);
}

.repository-session-source-dialog__results h3 {
  margin: 0 0 var(--space-4);
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-semibold);
}

.repository-session-source-dialog__result {
  width: 100%;
  min-height: 38px;
  display: grid;
  grid-template-columns: var(--icon-md) minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-6);
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.repository-session-source-dialog__result:hover,
.repository-session-source-dialog__result:focus-visible {
  outline: 0;
  background: var(--color-surface-base);
}

.repository-session-source-dialog__result-copy {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}

.repository-session-source-dialog__result-copy strong {
  min-width: 0;
  overflow: hidden;
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repository-session-source-dialog__result-icon,
.repository-session-source-dialog__arrow {
  width: var(--icon-md);
  height: var(--icon-md);
  color: var(--color-text-muted);
}

.repository-session-source-dialog__result-icon--branch {
  color: var(--color-success);
}

.repository-session-source-dialog__result-icon--default {
  color: var(--color-primary);
}

.repository-session-source-dialog__result-icon--worktree {
  color: var(--color-warning);
}

.repository-session-source-dialog__result-copy small {
  flex: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.repository-session-source-dialog__badge {
  justify-self: end;
  padding: 1px var(--space-3);
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
  background: var(--color-surface-base);
  font-size: var(--font-size-11);
  white-space: nowrap;
}

.repository-session-source-dialog__arrow {
  grid-column: -2 / -1;
  margin-left: auto;
}

.repository-session-source-dialog__state {
  margin: var(--space-20) 0;
  color: var(--color-text-muted);
  text-align: center;
}

.repository-session-source-dialog__state--error {
  color: var(--color-error);
}
</style>
