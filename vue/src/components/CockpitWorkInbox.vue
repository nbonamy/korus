<template>
  <main class="cockpit-inbox">
    <div class="cockpit-inbox__toolbar">
      <nav class="cockpit-inbox__views" :aria-label="$t('surface.cockpitWorkInbox.cockpitViews')">
        <button
          v-for="option in viewOptions"
          :key="option.id"
          type="button"
          :aria-pressed="activeView === option.id"
          @click="selectView(option.id)"
        >
          <span class="cockpit-inbox__view-label">{{ option.label }}</span>
          <span class="cockpit-inbox__view-count">{{ option.count }}</span>
        </button>
      </nav>

      <div class="cockpit-inbox__actions">
        <el-select
          v-if="workProviderDefinition(connection.provider).pullRequests"
          v-model="kindFilter"
          class="cockpit-inbox__kind-filter"
          multiple
          collapse-tags
          :placeholder="$t('surface.cockpitWorkInbox.allTypes')"
          :aria-label="$t('surface.cockpitWorkInbox.itemType')"
        >
          <el-option :label="$t('surface.cockpitWorkInbox.issues')" value="issue" />
          <el-option :label="$t(connection.provider === 'gitlab' ? 'gitlabBacklog.mergeRequests' : 'surface.cockpitWorkInbox.pullRequests')" value="pullRequest" />
        </el-select>
        <el-input
          v-if="searchOpen"
          ref="searchInput"
          :model-value="effectiveSearchQuery"
          class="cockpit-inbox__search-input"
          clearable
          :placeholder="$t('surface.cockpitWorkInbox.searchWork')"
          :aria-label="$t('surface.cockpitWorkInbox.searchWork')"
          @update:model-value="updateSearchQuery"
          @blur="closeSearchWhenEmpty"
        />
        <button
          v-else
          class="cockpit-inbox__icon-button"
          type="button"
          :aria-label="$t('surface.cockpitWorkInbox.searchWork')"
          @click="openSearch"
        >
          <IconSearch aria-hidden="true" />
        </button>

        <el-popover placement="bottom-end" trigger="click" :width="360" popper-class="app-popover cockpit-inbox__filters-popover">
          <template #reference>
            <button class="cockpit-inbox__filter-button" type="button">
              <IconFilter aria-hidden="true" /> {{ $t('surface.cockpitWorkInbox.filters') }} <span v-if="activeFilterCount">{{ activeFilterCount }}</span>
            </button>
          </template>
          <div class="cockpit-inbox__filters" :aria-label="$t('surface.cockpitWorkInbox.workFilters')">
            <label> {{ $t('surface.cockpitWorkInbox.repository') }} <el-select :model-value="selectedRepositoryId" clearable filterable :placeholder="$t('surface.cockpitWorkInbox.allRepositories')" :aria-label="$t('surface.cockpitWorkInbox.repositoryFilter')" @update:model-value="selectRepository">
                <el-option v-for="repository in sortedRepositories" :key="repository.id" :label="repository.fullName" :value="repository.id" />
              </el-select>
            </label>
            <label> {{ $t('surface.cockpitWorkInbox.label') }} <el-select :model-value="selectedTagName" clearable filterable :placeholder="$t('surface.cockpitWorkInbox.allLabels')" :aria-label="$t('surface.cockpitWorkInbox.labelFilter')" @update:model-value="selectTag">
                <el-option v-for="tag in tagOptions" :key="tag" :label="tag" :value="tag" />
              </el-select>
            </label>
            <label> {{ $t('surface.cockpitWorkInbox.assignee') }} <el-select :model-value="assigneeSelection" clearable filterable :placeholder="$t('surface.cockpitWorkInbox.allAssignees')" :aria-label="$t('surface.cockpitWorkInbox.assigneeFilter')" @update:model-value="selectAssignee">
                <el-option v-if="!selectedRepositoryId" :label="$t('surface.cockpitWorkInbox.assignedToMe')" :value="assignedToMeValue" />
                <el-option v-for="assignee in assigneeOptions" :key="assignee" :label="assignee" :value="assignee" />
              </el-select>
            </label>
            <span class="cockpit-inbox__provider"><component :is="workProviderIcon(connection.provider)" aria-hidden="true" /> {{ providerLabel }}</span>
          </div>
        </el-popover>

        <el-button class="cockpit-inbox__start-work" type="primary" :icon="PlayerPlayIcon" :disabled="startingWork || selectedItems.length === 0" @click="openStartWorkDialog()"> {{ $t('surface.cockpitWorkInbox.startWork') }} </el-button>
        <button class="cockpit-inbox__refresh" type="button" :disabled="status === 'loading'" :aria-label="$t('surface.cockpitWorkInbox.refreshWorkItems')" @click="emit('refresh', selectedRepositoryId)">
          <RefreshIcon aria-hidden="true" />
        </button>
      </div>
    </div>

    <section v-if="scopePromptVisible" class="cockpit-inbox__scope" aria-labelledby="cockpit-global-scope-title">
      <div>
        <span>{{ $t('surface.cockpitWorkInbox.globalBacklog') }}</span>
        <h2 id="cockpit-global-scope-title">{{ $t('surface.cockpitWorkInbox.chooseWhatAppShouldLoad') }}</h2>
        <p> {{ $t('surface.cockpitWorkInbox.aBacklogAcrossEveryRepositoryCanContainALotOfWorkAndCons') }} </p>
      </div>
      <div class="cockpit-inbox__scope-actions">
        <el-button type="primary" @click="emit('select-global-scope', 'assignedToMe')"> {{ $t('surface.cockpitWorkInbox.showItemsAssignedToMe') }} </el-button>
        <el-button plain @click="emit('select-global-scope', 'all')"> {{ $t('surface.cockpitWorkInbox.loadEverything') }} </el-button>
      </div>
    </section>
    <p v-else-if="status === 'loading' && items.length === 0" class="cockpit-inbox__state">{{ $t('surface.cockpitWorkInbox.loadingWorkItems') }}</p>
    <p v-else-if="error && items.length === 0" class="cockpit-inbox__state cockpit-inbox__state--error">{{ error }}</p>
    <p v-else-if="rows.length === 0" class="cockpit-inbox__state">{{ emptyMessage }}</p>

    <div v-else class="cockpit-inbox__list">
      <section v-for="group in groupedRows" :key="group.id" class="cockpit-inbox__group" :data-priority="group.id">
        <header>
          <span class="cockpit-inbox__group-marker" aria-hidden="true">
            <IconAlertCircle v-if="group.id === 'attention'" />
            <IconChevronDown v-else-if="group.id === 'review' || group.id === 'ready'" />
            <IconCircleFilled v-else />
          </span>
          <strong>{{ group.label }}</strong>
          <span>{{ group.rows.length }}</span>
          <button v-if="activeView !== 'all'" type="button" @click="selectView('all')">{{ $t('surface.cockpitWorkInbox.showAll') }}</button>
        </header>

        <div class="cockpit-inbox__rows">
          <article
            v-for="row in group.rows"
            :key="row.item.id"
            class="cockpit-inbox__row"
            :data-priority="row.priority"
            tabindex="0"
            @click="selectRow(row)"
            @keydown.enter="selectRow(row)"
          >
            <el-checkbox
              class="cockpit-inbox__selection"
              :model-value="selectedItemIds.has(row.item.id)"
              :disabled="Boolean(row.assignment)"
              :aria-label="row.assignment ? $t('backlogSource.assignedItem', { identifier: workItemDisplayIdentifier(row.item) }) : $t('backlogSource.selectItem', { identifier: workItemDisplayIdentifier(row.item) })"
              @click.stop
              @change="toggleSelection(row)"
            />
            <span class="cockpit-inbox__repository">{{ repositoryName(row.item) }}</span>
            <span class="cockpit-inbox__number">
              {{ row.item.kind === 'pullRequest' ? $t(connection.provider === 'gitlab' ? 'gitlabBacklog.mr' : 'surface.cockpitWorkInbox.pR') : '' }} {{ workItemDisplayIdentifier(row.item) }}
            </span>
            <strong class="cockpit-inbox__title">{{ row.item.title }}</strong>

            <div class="cockpit-inbox__context">
              <template v-if="row.agent">
                <AgentAvatar
                  v-if="repositoryIconForAgent(row.agent, repositoryIcons)"
                  :avatar="repositoryIconForAgent(row.agent, repositoryIcons)"
                  :name="agentDisplayName(row.agent)"
                  size="sm"
                />
                <span>{{ agentDisplayName(row.agent) }}</span>
              </template>
              <template v-else>
                <span v-for="label in row.item.labels.slice(0, 2)" :key="label.name" class="cockpit-inbox__label">{{ label.name }}</span>
              </template>
            </div>

            <span v-if="row.item.branchName" class="cockpit-inbox__branch">
              <GitBranchIcon aria-hidden="true" />
              {{ row.item.branchName }}
            </span>
            <span v-else class="cockpit-inbox__branch" />

            <span class="cockpit-inbox__status" :data-status="row.status">{{ row.assignment ? row.statusLabel : row.item.nativeState ?? row.statusLabel }}</span>
            <span class="cockpit-inbox__elapsed">{{ elapsed(row.activityAt) }}</span>

            <div class="cockpit-inbox__row-actions">
              <el-tooltip :content="row.assignment ? $t('surface.cockpitWorkInbox.viewAgent') : $t('backlogSource.viewItem', { identifier: workItemDisplayIdentifier(row.item) })" placement="top" :show-after="300">
                <button
                  class="cockpit-inbox__row-action"
                  type="button"
                  :aria-label="row.assignment ? $t('backlogSource.viewAgent', { identifier: workItemDisplayIdentifier(row.item) }) : $t('backlogSource.viewItem', { identifier: workItemDisplayIdentifier(row.item) })"
                  @click.stop="viewRow(row)"
                >
                  <EyeIcon aria-hidden="true" />
                </button>
              </el-tooltip>
              <el-tooltip v-if="!row.assignment" :content="startItemLabel(row.item)" placement="top" :show-after="300">
                <button class="cockpit-inbox__row-action" type="button" :aria-label="startItemLabel(row.item)" @click.stop="openStartWorkDialog(row.item)">
                  <PlayerPlayIcon aria-hidden="true" />
                </button>
              </el-tooltip>
              <AppMenuButton
                :ariaLabel="$t('surface.cockpitWorkInbox.moreActions', { identifier: workItemDisplayIdentifier(row.item) })"
                :items="rowMenuItems(row.item)"
                @select="openSource(row.item)"
              >
                <template #trigger="{ attrs }">
                  <button
                    v-bind="attrs"
                    class="cockpit-inbox__row-action"
                    type="button"
                    :aria-label="$t('surface.cockpitWorkInbox.moreActions', { identifier: workItemDisplayIdentifier(row.item) })"
                  >
                    <DotsVerticalIcon aria-hidden="true" />
                  </button>
                </template>
              </AppMenuButton>
            </div>
          </article>
        </div>
      </section>
    </div>

    <footer
      v-if="!selectedRepositoryId && globalScope && (items.length > 0 || hasNextPage || page > 1)"
      class="cockpit-inbox__pagination"
      :aria-label="$t('surface.cockpitWorkInbox.workItemPagination')"
    >
      <span v-if="totalItems !== undefined">{{ totalItems }} {{ totalItems === 1 ? 'item' : 'items' }} {{ $t('surface.cockpitWorkInbox.total') }}</span>
      <span v-if="error" class="cockpit-inbox__pagination-error" role="alert">{{ error }}</span>
      <div class="cockpit-inbox__page-controls">
        <button
          class="cockpit-inbox__icon-button"
          type="button"
          :disabled="pageLoading || page <= 1"
          :aria-label="$t('surface.cockpitWorkInbox.previousPage')"
          @click="emit('change-page', page - 1)"
        >
          <IconChevronLeft aria-hidden="true" />
        </button>
        <span>{{ $t('surface.cockpitWorkInbox.page') }} {{ page }}</span>
        <button
          class="cockpit-inbox__icon-button"
          type="button"
          :disabled="pageLoading || !hasNextPage"
          :aria-label="$t('surface.cockpitWorkInbox.nextPage')"
          @click="emit('change-page', page + 1)"
        >
          <IconChevronRight aria-hidden="true" />
        </button>
      </div>
    </footer>

    <el-dialog :model-value="Boolean(detailItem)" class="app-dialog cockpit-inbox__detail-dialog" width="760px" align-center @update:model-value="detailItem = null">
      <WorkItemDetail v-if="detailItem" :item="detailItem" />
    </el-dialog>
    <el-dialog
      class="app-dialog cockpit-inbox__start-dialog"
      :model-value="startWorkDialogOpen && !startingWork"
      :teleported="false"
      width="520px"
      :show-close="false"
      destroy-on-close
      @update:model-value="closeStartWorkDialog"
    >
      <template #header>
        <div class="app-form-dialog__header">
          <h2 class="app-dialog__title">{{ $t('surface.cockpitWorkInbox.startWork') }}</h2>
        </div>
      </template>

      <div class="cockpit-inbox__start-body">
        <p> {{ $t('surface.cockpitWorkInbox.launch') }} <strong>{{ launchItems.length }} {{ launchItems.length === 1 ? 'agent' : 'agents' }}</strong>{{ $t('surface.cockpitWorkInbox.eachAgentWillWorkInADedicatedWorktree') }} </p>
        <label> {{ $t('surface.cockpitWorkInbox.team') }} <el-select v-model="selectedTeamId" :disabled="startingWork" :aria-label="$t('surface.cockpitWorkInbox.teamForNewAgents')">
            <el-option v-for="team in teams" :key="team.id" :label="team.name" :value="team.id" />
          </el-select>
        </label>
        <label v-if="readyHosts.length">{{ $t('remoteTarget.machine') }}
          <el-select v-model="selectedHost" :disabled="startingWork" :aria-label="$t('remoteTarget.machine')">
            <template #prefix><component :is="remoteConnectionId ? NetworkIcon : DeviceImacIcon" class="cockpit-inbox__host-icon" aria-hidden="true" /></template>
            <el-option value="local" :label="$t('remoteTarget.thisComputer')" />
            <el-option v-for="host in readyHosts" :key="host.id" :value="host.id" :label="host.name" />
          </el-select>
        </label>
        <p v-if="startWorkError" class="cockpit-inbox__start-error" role="alert">{{ startWorkError }}</p>
        <label v-if="!workProviderDefinition(connection.provider).repositoryBacked">
          {{ $t('backlogSource.codeRepository') }}
          <el-select v-model="selectedCodeRepositoryPath" :loading="codeRepositoriesLoading" :disabled="startingWork" :aria-label="$t('backlogSource.codeRepository')" :placeholder="$t('backlogSource.chooseCodeRepository')">
            <el-option v-for="repository in codeRepositories" :key="repository.path" :label="repository.name" :value="repository.path" />
          </el-select>
        </label>
        <label>{{ $t('repositoryBacklog.session') }}
          <BackendModelSelector v-model:selection="selectedSelection" :remote-connection-id="remoteConnectionId" :disabled="startingWork" />
        </label>
      </div>

      <template #footer>
        <div class="app-dialog__footer">
          <button class="app-button app-button--tertiary" type="button" :disabled="startingWork" @click="closeStartWorkDialog(false)">{{ $t('surface.cockpitWorkInbox.cancel') }}</button>
          <button class="app-button app-button--secondary" type="button" :disabled="startingWork || !selectedTeamId || !selectedBackend" @click="startSelectedWork(secondaryLaunchAction)">{{ $t(`repositoryBacklog.${secondaryLaunchAction}`) }}</button>
          <button class="app-button app-button--primary" type="button" :disabled="startingWork || !selectedTeamId || !selectedBackend" @click="startSelectedWork(primaryLaunchAction)">{{ $t(`repositoryBacklog.${primaryLaunchAction}`) }}</button>
        </div>
      </template>
    </el-dialog>
  </main>
</template>

<script setup lang="ts">
import { useExecutionSelection } from '../execution-selection';
import type { BacklogScope } from './use-cockpit-backlog';
import { workProviderIcon } from './work-provider-icons';
import { workItemDisplayIdentifier } from '@workspace/core/work-item-prompts';
import { workProviderDefinition } from '@workspace/core/work-providers';
import { translate } from '../i18n';
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { IconAlertCircle, IconChevronDown, IconChevronLeft, IconChevronRight, IconCircleFilled, IconFilter, IconSearch } from '@tabler/icons-vue';
import type { Agent, RemoteConnection, Team, WorkBacklogAssignment, WorkIntegrationConnection, WorkItem, WorkSource } from '@workspace/core/contracts';
import { agentDisplayName } from '@workspace/core/agent-display';
import { workItemAssignmentKey } from '@workspace/core/work-assignments';
import { repositoryIconForAgent } from '@workspace/core/workspace-sidebar';
import { DeviceImacIcon, NetworkIcon, DotsVerticalIcon, ExternalLinkIcon, EyeIcon, GitBranchIcon, PlayerPlayIcon, PlusCircleIcon, RefreshIcon } from '../shared/icons/app-icons';
import WorkItemDetail from './WorkItemDetail.vue';
import AgentAvatar from './AgentAvatar.vue';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import BackendModelSelector from './BackendModelSelector.vue';
import type { StartWorkItemsInput } from './use-work-item-routing';

type InboxView = 'all' | 'backlog' | 'wip' | 'focus';
type SummaryFilter = 'inProgress' | 'blocked' | 'readyForReview';
type Priority = 'attention' | 'review' | 'progress' | 'ready';
type InboxRow = { activityAt: string; agent: Agent | null; assignment: WorkBacklogAssignment | null; item: WorkItem; priority: Priority; status: string; statusLabel: string };

const props = withDefaults(defineProps<{
  agents: Agent[];
  activeView?: InboxView;
  assignments: Record<string, WorkBacklogAssignment>;
  connection: WorkIntegrationConnection;
  error: string | null;
  globalScope?: BacklogScope | null;
  items: WorkItem[];
  page?: number;
  pageLoading?: boolean;
  pageSize?: number;
  repositories: WorkSource[];
  repositoryIcons?: Record<string, string>;
  searchQuery?: string;
  selectedAssigneeLogin?: string | null;
  selectedRepositoryId: string | null;
  selectedTagName?: string | null;
  status: 'notLoaded' | 'loading' | 'loaded' | 'error';
  statusFilter?: SummaryFilter | null;
  teams: Team[];
  remoteConnections?: RemoteConnection[];
  totalItems?: number;
  hasNextPage?: boolean;
  defaultTeamId?: string | null;
  listSourceRepositories?: (remoteConnectionId?: string) => Promise<import('@workspace/core/contracts').SourceRepository[]>;
  startWorkAction: (input: StartWorkItemsInput) => Promise<void>;
}>(), { activeView: 'focus', defaultTeamId: null, globalScope: null, page: 1, pageLoading: false, pageSize: 50, repositoryIcons: () => ({}), searchQuery: '', selectedAssigneeLogin: null, selectedTagName: null, statusFilter: null });

const emit = defineEmits<{
  refresh: [repositoryId: string | null];
  'change-page': [page: number];
  'select-global-scope': [scope: 'assignedToMe' | 'all'];
  'select-assigned-agent': [agentId: string];
  'select-assignee': [login: string | null];
  'select-repository': [repositoryId: string | null];
  'select-tag': [tag: string | null];
  'update-search-query': [query: string];
  'update-active-view': [view: InboxView];
}>();

const searchOpen = ref(false);
const searchInput = ref<{ focus: () => void } | null>(null);
const { selection: selectedSelection, backend: selectedBackend, model: selectedModel, reasoningEffort: selectedEffort, serviceTier: selectedTier } = useExecutionSelection();
const selectedItemIds = ref(new Set<string>());
const startWorkDialogOpen = ref(false);
const detailItem = ref<WorkItem | null>(null);
const startingWork = ref(false);
const startWorkError = ref<string | null>(null);
const selectedTeamId = ref('');
const selectedHost = ref('local');
const readyHosts = computed(() => props.remoteConnections?.filter(connection => connection.status === 'ready') ?? []);
const remoteConnectionId = computed(() => selectedHost.value === 'local' ? undefined : selectedHost.value);
watch(readyHosts, hosts => {
  if (remoteConnectionId.value && !hosts.some(host => host.id === remoteConnectionId.value)) selectedHost.value = 'local';
});
const singleLaunchItem = ref<WorkItem | null>(null);
const launchItems = computed(() => singleLaunchItem.value ? [singleLaunchItem.value] : selectedItems.value);
const codeRepositories = ref<import('@workspace/core/contracts').SourceRepository[]>([]);
const selectedCodeRepositoryPath = ref('');
const codeRepositoriesLoading = ref(false);
let contextRevision = 0;
onScopeDispose(() => { ++contextRevision; });
watch([startWorkDialogOpen, selectedTeamId, remoteConnectionId], async () => {
  const revision = ++contextRevision;
  codeRepositories.value = [];
  selectedCodeRepositoryPath.value = '';
  if (!startWorkDialogOpen.value || workProviderDefinition(props.connection.provider).repositoryBacked) return;
  codeRepositoriesLoading.value = true;
  try {
    const repositories = await (remoteConnectionId.value ? props.listSourceRepositories?.(remoteConnectionId.value) : props.listSourceRepositories?.()) ?? [];
    if (revision === contextRevision) codeRepositories.value = repositories;
  } catch (error) {
    if (revision === contextRevision) startWorkError.value = error instanceof Error ? error.message : String(error);
  } finally { if (revision === contextRevision) codeRepositoriesLoading.value = false; }
});
const localActiveView = ref<InboxView>(props.activeView);
const activeView = computed(() => localActiveView.value);
const effectiveSearchQuery = ref(props.searchQuery);
watch(() => props.activeView, (view) => { localActiveView.value = view; });
watch(() => props.searchQuery, (query) => { effectiveSearchQuery.value = query; });
const agentsById = computed(() => new Map(props.agents.map((agent) => [agent.id, agent])));
const sortedRepositories = computed(() => [...props.repositories].sort((a, b) => a.fullName.localeCompare(b.fullName)));
const providerLabel = computed(() => workProviderDefinition(props.connection.provider).label);
const repositoryIcons = computed(() => props.repositoryIcons);
const tagOptions = computed(() => [...new Set(props.items.flatMap((item) => item.labels.map((label) => label.name)))].sort());
const assigneeOptions = computed(() => [...new Set(props.items.flatMap((item) => item.assignees ?? []))].sort());
// The global feed defaults to "assigned to me"; surface it as the active assignee filter.
const assignedToMeValue = '@me';
const assigneeSelection = computed(() => props.selectedAssigneeLogin
  ?? (!props.selectedRepositoryId && (props.globalScope === 'assignedToMe' || props.globalScope === 'myIssues') ? assignedToMeValue : null));
const activeFilterCount = computed(() => [props.selectedRepositoryId, props.selectedTagName, assigneeSelection.value].filter(Boolean).length);
const scopePromptVisible = computed(() => (
  !props.selectedRepositoryId && !props.globalScope && (activeView.value === 'all' || activeView.value === 'backlog')
));
const allRows = computed<InboxRow[]>(() => props.items.filter((item) => item.state === 'open').map(toRow));
// Empty means every type; the control only exists for providers that have pull requests.
const kindFilter = defineModel<Array<'issue' | 'pullRequest'>>('kindFilter', { default: () => [] });
const activeKindFilter = computed(() => workProviderDefinition(props.connection.provider).pullRequests ? kindFilter.value : []);
const filteredRows = computed(() => {
  const query = effectiveSearchQuery.value.trim().toLocaleLowerCase();
  return allRows.value.filter((row) => {
    if (props.statusFilter && row.assignment?.status !== props.statusFilter) return false;
    if (props.selectedRepositoryId && row.item.sourceId !== props.selectedRepositoryId) return false;
    if (props.selectedTagName && !row.item.labels.some((label) => label.name === props.selectedTagName)) return false;
    if (props.selectedAssigneeLogin && !(row.item.assignees ?? []).includes(props.selectedAssigneeLogin)) return false;
    if (activeKindFilter.value.length && !activeKindFilter.value.includes(row.item.kind === 'pullRequest' ? 'pullRequest' : 'issue')) return false;
    if (query && !`${row.item.sourceName} ${row.item.identifier ?? row.item.number} ${row.item.title}`.toLocaleLowerCase().includes(query)) return false;
    return true;
  });
});
const rows = computed(() => filteredRows.value.filter((row) => {
  if (activeView.value === 'backlog') return !row.assignment;
  if (activeView.value === 'wip') return isActiveAssignment(row.assignment);
  if (activeView.value === 'focus') return isActiveAssignment(row.assignment) && (row.priority === 'attention' || row.priority === 'review');
  return true;
}));
// Tab counts share the rendered page and filters; the provider total stays in pagination.
const totalAssignmentCount = computed(() => filteredRows.value.filter((row) => isActiveAssignment(row.assignment)).length);
const totalFocusCount = computed(() => filteredRows.value.filter((row) => isActiveAssignment(row.assignment) && (row.priority === 'attention' || row.priority === 'review')).length);
const totalBacklogCount = computed(() => filteredRows.value.filter((row) => !row.assignment).length);
const viewContextKey = computed(() => `${props.connection.provider}:${props.selectedRepositoryId ?? `global:${props.globalScope ?? 'unselected'}`}`);
watch(viewContextKey, () => { ++contextRevision; detailItem.value = null; startWorkDialogOpen.value = false; selectedItemIds.value = new Set(); }, { flush: 'sync' });
const priorityOrder: Priority[] = ['attention', 'review', 'progress', 'ready'];
const groupedRows = computed(() => priorityOrder.map((priority) => ({
  id: priority,
  label: priorityLabel(priority),
  rows: rows.value.filter((row) => row.priority === priority).sort((a, b) => b.activityAt.localeCompare(a.activityAt)),
})).filter((group) => group.rows.length > 0));
const viewOptions = computed(() => [
  { id: 'all' as const, label: translate('surface.cockpitWorkInbox.all'), count: filteredRows.value.length },
  { id: 'backlog' as const, label: translate('surface.cockpitWorkInbox.backlog'), count: totalBacklogCount.value },
  { id: 'wip' as const, label: translate('surface.cockpitWorkInbox.wIP'), count: totalAssignmentCount.value },
  { id: 'focus' as const, label: translate('surface.cockpitWorkInbox.focus'), count: totalFocusCount.value },
]);
const selectedItems = computed(() => rows.value
  .filter((row) => !row.assignment && selectedItemIds.value.has(row.item.id))
  .map((row) => row.item));
const emptyMessage = computed(() => activeView.value === 'focus' ? translate('surface.cockpitWorkInbox.nothingNeedsYourAttention') : `No work in ${viewOptions.value.find((view) => view.id === activeView.value)?.label ?? 'this view'}.`);

let activeViewInitialized = props.activeView !== 'focus';
let pendingViewContext: string | null = viewContextKey.value;
let pendingViewContextLoadingObserved = props.status === 'loading';

watch(viewContextKey, (context) => {
  pendingViewContext = context;
  pendingViewContextLoadingObserved = props.status === 'loading';
});

watch([viewContextKey, () => props.status, totalFocusCount, totalAssignmentCount], ([context, status]) => {
  if (pendingViewContext === context && status === 'loading') {
    pendingViewContextLoadingObserved = true;
    return;
  }
  if (status !== 'loaded') return;

  if (!activeViewInitialized || (pendingViewContext === context && pendingViewContextLoadingObserved)) {
    activeViewInitialized = true;
    pendingViewContext = null;
    pendingViewContextLoadingObserved = false;
    applyActiveView(props.activeView === 'all' ? 'all' : preferredActiveView());
    return;
  }

  if (activeView.value === 'focus' && totalFocusCount.value === 0) {
    applyActiveView(totalAssignmentCount.value > 0 ? 'wip' : 'backlog');
  } else if (activeView.value === 'wip' && totalAssignmentCount.value === 0) {
    applyActiveView('backlog');
  }
}, { immediate: true });

function preferredActiveView(): InboxView {
  if (totalFocusCount.value > 0) return 'focus';
  if (totalAssignmentCount.value > 0) return 'wip';
  return 'backlog';
}

function isActiveAssignment(assignment: WorkBacklogAssignment | null): assignment is WorkBacklogAssignment {
  return Boolean(assignment && assignment.status !== 'completed');
}

function applyActiveView(view: InboxView): void {
  if (localActiveView.value === view) return;
  localActiveView.value = view;
  emit('update-active-view', view);
}

function toRow(item: WorkItem): InboxRow {
  const persistedAssignment = props.assignments[workItemAssignmentKey(item)] ?? null;
  const assignment = isActiveAssignment(persistedAssignment) ? persistedAssignment : null;
  const agent = assignment ? agentsById.value.get(assignment.agentId) ?? null : null;
  const priority = rowPriority(assignment, agent);
  const status = assignment?.status ?? 'ready';
  return { item, assignment, agent, priority, status, statusLabel: statusLabel(assignment, agent), activityAt: assignment?.updatedAt ?? assignment?.completedAt ?? assignment?.assignedAt ?? item.updatedAt };
}

function rowPriority(assignment: WorkBacklogAssignment | null, agent: Agent | null): Priority {
  if (assignment?.status === 'blocked' || agent?.status.type === 'awaitingInput' || agent?.status.type === 'error') return 'attention';
  if (assignment?.status === 'readyForReview') return 'review';
  return assignment ? 'progress' : 'ready';
}

function statusLabel(assignment: WorkBacklogAssignment | null, agent: Agent | null): string {
  if (agent?.status.type === 'awaitingInput') return translate('surface.cockpitWorkInbox.needsInput');
  if (agent?.status.type === 'error') return translate('surface.cockpitWorkInbox.failed');
  if (assignment?.status === 'blocked') return translate('surface.cockpitWorkInbox.blocked');
  if (assignment?.status === 'readyForReview') return translate('surface.cockpitWorkInbox.readyForReview');
  if (assignment?.status === 'completed') return translate('surface.cockpitWorkInbox.completed');
  return assignment ? agent?.statusText || translate('dynamic.misc.inProgress') : translate('surface.cockpitWorkInbox.ready');
}

function priorityLabel(priority: Priority): string {
  return {
    attention: translate('surface.cockpitWorkInbox.needsAttention'),
    review: translate('surface.cockpitWorkInbox.readyForReview'),
    progress: translate('dynamic.misc.inProgress'),
    ready: translate('surface.cockpitWorkInbox.ready'),
  }[priority];
}

function repositoryName(item: WorkItem): string {
  return item.sourceName.split('/').at(-1) ?? item.sourceName;
}

function elapsed(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

watch(rows, (visibleRows) => {
  const selectableIds = new Set(visibleRows.filter((row) => !row.assignment).map((row) => row.item.id));
  const next = new Set([...selectedItemIds.value].filter((id) => selectableIds.has(id)));
  if (next.size !== selectedItemIds.value.size) selectedItemIds.value = next;
});

watch(() => props.defaultTeamId, () => {
  if (!startWorkDialogOpen.value) selectedTeamId.value = defaultTeamId();
});

function defaultTeamId(): string {
  return props.teams.some((team) => team.id === props.defaultTeamId)
    ? props.defaultTeamId ?? ''
    : props.teams[0]?.id ?? '';
}

function toggleSelection(row: InboxRow): void {
  if (row.assignment) return;
  const next = new Set(selectedItemIds.value);
  if (next.has(row.item.id)) next.delete(row.item.id);
  else next.add(row.item.id);
  selectedItemIds.value = next;
}

function isOwnPullRequest(item: WorkItem): boolean {
  return item.kind === 'pullRequest' && Boolean(props.connection.accountLabel && item.authorName)
    && item.authorName!.toLowerCase() === props.connection.accountLabel!.toLowerCase();
}
function startItemLabel(item: WorkItem): string {
  return translate(isOwnPullRequest(item) ? 'backlogSource.checkFeedbackItem' : 'backlogSource.startItem', { identifier: workItemDisplayIdentifier(item) });
}
const launchPullRequestsOnly = computed(() => launchItems.value.length > 0 && launchItems.value.every(item => item.kind === 'pullRequest'));
const primaryLaunchAction = computed(() => launchPullRequestsOnly.value
  ? launchItems.value.every(isOwnPullRequest) ? 'checkFeedback' : 'review' : 'fix');
const secondaryLaunchAction = computed(() => launchPullRequestsOnly.value ? 'addressFeedback' : 'investigate');

function openStartWorkDialog(item?: WorkItem): void {
  if (startingWork.value) return;
  singleLaunchItem.value = item?.id ? item : null;
  if (launchItems.value.length === 0) return;
  selectedTeamId.value = defaultTeamId();
  selectedHost.value = 'local';
  startWorkError.value = null;
  startWorkDialogOpen.value = true;
}

function closeStartWorkDialog(visible = false): void {
  if (!visible && !startingWork.value) startWorkDialogOpen.value = false;
}

async function startSelectedWork(action: StartWorkItemsInput['action']): Promise<void> {
  const items = [...launchItems.value];
  if (!selectedTeamId.value || !selectedBackend.value || items.length === 0) return;
  const repository = codeRepositories.value.find(repository => repository.path === selectedCodeRepositoryPath.value);
  if (!workProviderDefinition(props.connection.provider).repositoryBacked && !repository) {
    startWorkError.value = translate('backlogSource.chooseCodeRepository');
    return;
  }
  const revision = contextRevision;
  startingWork.value = true;
  startWorkError.value = null;
  try {
    await props.startWorkAction({ action, items, teamId: selectedTeamId.value, selection: selectedSelection.value,
      ...(remoteConnectionId.value ? { remoteConnectionId: remoteConnectionId.value } : {}),
      ...(repository ? { repository, isCurrent: () => revision === contextRevision } : {}) });
    if (revision !== contextRevision) return;
    selectedItemIds.value = new Set([...selectedItemIds.value].filter(id => !items.some(item => item.id === id)));
    startWorkDialogOpen.value = false;
  } catch (error) {
    if (revision !== contextRevision) return;
    startWorkError.value = error instanceof Error ? error.message : String(error);
  } finally {
    startingWork.value = false;
  }
}
function selectView(view: InboxView): void {
  localActiveView.value = view;
  emit('update-active-view', view);
}
async function openSearch(): Promise<void> {
  searchOpen.value = true;
  await nextTick();
  searchInput.value?.focus();
}
function rowMenuItems(item: WorkItem): AppMenuItem[] {
  return [{
    id: 'external',
    type: 'action',
    label: translate('backlogSource.viewInProvider', { provider: providerLabel.value }),
    icon: ExternalLinkIcon,
  }];
}
function closeSearchWhenEmpty(): void {
  if (!effectiveSearchQuery.value.trim()) searchOpen.value = false;
}
function updateSearchQuery(value: unknown): void {
  const query = typeof value === 'string' ? value : '';
  effectiveSearchQuery.value = query;
  emit('update-search-query', query);
}
function selectRow(row: InboxRow): void {
  if (row.agent) emit('select-assigned-agent', row.agent.id);
  else toggleSelection(row);
}
function viewRow(row: InboxRow): void {
  if (row.agent) emit('select-assigned-agent', row.agent.id);
  else detailItem.value = row.item;
}
function openSource(item: WorkItem): void { window.open(item.url, '_blank', 'noreferrer'); }
function normalized(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function selectRepository(value: unknown): void { emit('select-repository', normalized(value)); }
function selectTag(value: unknown): void { emit('select-tag', normalized(value)); }
function selectAssignee(value: unknown): void {
  if (value === assignedToMeValue) emit('select-global-scope', 'assignedToMe');
  else emit('select-assignee', normalized(value));
}
</script>

<style scoped>
:global(.cockpit-inbox__detail-dialog.el-dialog) {
  max-width: calc(100vw - 32px);
  padding: 0;
  height: 85vh;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  margin: auto;
}

/* The ticket header stays pinned while only the description scrolls. */
:global(.cockpit-inbox__detail-dialog.el-dialog .el-dialog__header) {
  height: 0;
  padding: 0;
}

:global(.cockpit-inbox__detail-dialog.el-dialog .el-dialog__headerbtn) {
  z-index: 1;
  /* Centered on the title row rather than on Element's default 54px square. */
  top: var(--space-8);
  right: var(--space-8);
  width: 22px;
  height: 22px;
}

:global(.cockpit-inbox__detail-dialog.el-dialog .el-dialog__body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  border-radius: var(--radius-xl);
}

:global(.cockpit-inbox__detail-dialog .work-item-detail) {
  flex: 1;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 0;
  padding: 0;
}

:global(.cockpit-inbox__detail-dialog .work-item-detail__title) {
  align-items: center;
}

:global(.cockpit-inbox__detail-dialog .work-item-detail__state) {
  background: var(--color-surface-lowest);
}

:global(.cockpit-inbox__detail-dialog .work-item-detail__header) {
  padding: var(--space-8) var(--space-24) var(--space-6) var(--space-12);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-low);
}

:global(.cockpit-inbox__detail-dialog .work-item-detail .work-item-detail__body) {
  min-height: 0;
  padding: var(--space-8) var(--space-12);
  overflow-y: auto;
}

.cockpit-inbox {
  position: relative;
  min-width: 0;
  min-height: 0;
  container-type: inline-size;
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}

.cockpit-inbox__toolbar {
  width: min(100%, 1440px);
  height: 54px;
  min-height: 54px;
  flex: 0 0 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  margin: 0 auto;
  padding: 0 var(--space-16);
}

.cockpit-inbox__views,
.cockpit-inbox__actions {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.cockpit-inbox__views button {
  height: 34px;
  display: inline-flex;
  align-items: center;
  gap: var(--space-6);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  padding: 0 var(--space-8);
  color: var(--color-text-muted);
  background: transparent;
  font: inherit;
  font-size: var(--font-size-15);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-20);
  cursor: pointer;
}

.cockpit-inbox__views button[aria-pressed="true"] {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-container);
  font-weight: var(--font-weight-semibold);
}

.cockpit-inbox__view-label,
.cockpit-inbox__view-count {
  height: var(--line-height-20);
  display: inline-flex;
  align-items: center;
  line-height: var(--line-height-20);
}

.cockpit-inbox__view-count {
  color: var(--color-text-muted);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-regular);
  font-variant-numeric: tabular-nums;
}

.cockpit-inbox__actions button {
  white-space: nowrap;
}

.cockpit-inbox__actions svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.cockpit-inbox__icon-button,
.cockpit-inbox__filter-button,
.cockpit-inbox__refresh {
  min-width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: var(--color-surface);
  cursor: pointer;
}

.cockpit-inbox__kind-filter {
  width: 140px;
}

.cockpit-inbox__filter-button {
  padding: 0 var(--space-6);
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-medium);
}

.cockpit-inbox__filter-button span {
  min-width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  color: var(--color-on-primary);
  background: var(--color-primary);
  font-size: var(--font-size-10);
  line-height: 16px;
}

.cockpit-inbox__start-work {
  height: 34px;
  margin: 0;
  border-radius: var(--radius-md);
  padding: 0 var(--space-6);
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-medium);
}

.cockpit-inbox__search-input {
  width: 220px;
}

.cockpit-inbox__filters {
  display: grid;
  gap: var(--space-8);
  padding: var(--space-6);
}

.cockpit-inbox__filters label {
  display: grid;
  gap: var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-medium);
}

.cockpit-inbox__provider {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-top: var(--space-2);
  padding-top: var(--space-6);
  border-top: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.cockpit-inbox__provider svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.cockpit-inbox::before {
  content: "";
  position: absolute;
  z-index: 0;
  top: 53px;
  right: 0;
  left: 0;
  border-top: 1px solid var(--color-border);
}

.cockpit-inbox__scope {
  width: min(calc(100% - (2 * var(--space-32))), 760px);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: var(--space-20);
  margin: clamp(56px, 10vh, 112px) auto 0;
  padding: var(--space-20);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-sm);
}

.cockpit-inbox__scope span {
  color: var(--color-primary);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-16);
}

.cockpit-inbox__scope h2 {
  margin: var(--space-4) 0 var(--space-6);
  color: var(--color-text);
  font-size: var(--font-size-20);
  font-weight: var(--font-weight-bold);
  line-height: var(--line-height-24);
  letter-spacing: -0.015em;
}

.cockpit-inbox__scope p {
  max-width: 500px;
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-20);
}

.cockpit-inbox__scope-actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-6);
}

.cockpit-inbox__scope-actions :deep(.el-button) {
  min-width: 190px;
  margin: 0;
}

.cockpit-inbox__list {
  width: min(100%, 1440px);
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
  margin: 0 auto;
  padding: var(--space-4) var(--space-16) var(--space-16);
}

.cockpit-inbox__group {
  margin-top: var(--space-6);
}

.cockpit-inbox__group > header {
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-20);
}

.cockpit-inbox__group > header strong {
  color: var(--color-text);
  font-size: var(--font-size-16);
  font-weight: var(--font-weight-bold);
  line-height: var(--line-height-22);
  letter-spacing: -0.01em;
}

.cockpit-inbox__group > header button {
  margin-left: auto;
  border: 0;
  color: var(--color-primary);
  background: transparent;
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}

.cockpit-inbox__group-marker {
  width: var(--icon-sm);
  height: var(--icon-sm);
  display: grid;
  place-items: center;
  color: var(--color-success);
}

.cockpit-inbox__group-marker svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.cockpit-inbox__group[data-priority="attention"] .cockpit-inbox__group-marker {
  color: var(--color-warning);
}

.cockpit-inbox__group[data-priority="review"] .cockpit-inbox__group-marker {
  color: var(--color-primary);
}

.cockpit-inbox__rows {
  overflow: visible;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-lowest);
}

.cockpit-inbox__group[data-priority="attention"] .cockpit-inbox__rows {
  border-color: var(--color-warning-container);
}

.cockpit-inbox__row {
  position: relative;
  min-height: 42px;
  display: grid;
  grid-template-columns:
    28px minmax(0, 1.1fr) 64px minmax(0, 2fr) minmax(0, 1fr)
    minmax(0, 1fr) minmax(0, 0.65fr) 54px max-content;
  gap: var(--space-6);
  align-items: center;
  padding: 0 var(--space-8);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
  cursor: pointer;
}

.cockpit-inbox__selection {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
}

.cockpit-inbox__selection :deep(.el-checkbox__label) {
  display: none;
}

.cockpit-inbox__row + .cockpit-inbox__row {
  border-top: 1px solid var(--color-border);
}

.cockpit-inbox__row:hover,
.cockpit-inbox__row:focus-visible {
  background: var(--color-surface-low);
  outline: none;
}

.cockpit-inbox__repository,
.cockpit-inbox__number,
.cockpit-inbox__context,
.cockpit-inbox__branch,
.cockpit-inbox__status,
.cockpit-inbox__elapsed {
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: inherit;
  line-height: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cockpit-inbox__repository {
  color: var(--color-text);
  font-weight: var(--font-weight-semibold);
}

.cockpit-inbox__number {
  font-weight: var(--font-weight-medium);
  text-align: left;
}

.cockpit-inbox__title {
  overflow: hidden;
  color: var(--color-text);
  font-weight: var(--font-weight-semibold);
  font-size: inherit;
  line-height: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cockpit-inbox__context,
.cockpit-inbox__branch {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  font-weight: var(--font-weight-medium);
}

.cockpit-inbox__label {
  overflow: hidden;
  padding: 1px var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-low);
  font-size: inherit;
  line-height: inherit;
  text-overflow: ellipsis;
}

.cockpit-inbox__branch svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
}

.cockpit-inbox__status[data-status="inProgress"] {
  color: var(--color-primary);
  font-weight: var(--font-weight-medium);
}

.cockpit-inbox__status[data-status="blocked"] {
  color: var(--color-warning);
  font-weight: var(--font-weight-medium);
}

.cockpit-inbox__status[data-status="readyForReview"] {
  color: var(--color-primary);
  font-weight: var(--font-weight-medium);
}

.cockpit-inbox__elapsed {
  text-align: right;
}

.cockpit-inbox__row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-4);
  padding-left: var(--space-2);
}

.cockpit-inbox__row-action {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: transparent;
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}

.cockpit-inbox__row-action svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.cockpit-inbox__row-action:hover {
  color: var(--color-text);
  background: var(--color-surface-low);
}

.cockpit-inbox__row-action:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.cockpit-inbox__state {
  margin: auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
}

.cockpit-inbox__state--error {
  color: var(--color-error);
}

.cockpit-inbox__pagination {
  width: min(100%, 1440px);
  min-height: 52px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-12);
  margin: 0 auto;
  border-top: 1px solid var(--color-border);
  padding: var(--space-8) var(--space-16);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
}

.cockpit-inbox__pagination-error {
  color: var(--color-error);
}

.cockpit-inbox__page-controls {
  display: inline-flex;
  align-items: center;
  gap: var(--space-8);
}

.cockpit-inbox__page-controls button:disabled {
  opacity: 0.4;
  cursor: default;
}

.cockpit-inbox__page-controls svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.cockpit-inbox__start-body {
  display: grid;
  gap: var(--space-8);
}

.cockpit-inbox__start-body p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
  line-height: var(--line-height-20);
}

.cockpit-inbox__start-body strong {
  color: var(--color-text);
}

.cockpit-inbox__start-body label {
  display: grid;
  gap: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-semibold);
}

.cockpit-inbox__start-error {
  color: var(--color-error) !important;
}

.cockpit-inbox__host-icon {
  width: 16px;
  height: 16px;
}

@container (max-width: 1250px) {
  .cockpit-inbox__row {
    grid-template-columns:
      28px minmax(0, 1fr) 58px minmax(0, 1.5fr) minmax(0, 1fr)
      90px max-content;
  }
  .cockpit-inbox__branch,
  .cockpit-inbox__elapsed {
    display: none;
  }
}

@container (max-width: 780px) {
  .cockpit-inbox__toolbar {
    height: auto;
    flex-basis: auto;
    align-items: flex-start;
    flex-direction: column;
    padding: var(--space-6) var(--space-16);
  }
  .cockpit-inbox__actions {
    width: 100%;
    flex-wrap: wrap;
  }
  .cockpit-inbox__actions .el-button {
    margin-left: auto;
  }
  .cockpit-inbox__row {
    grid-template-columns:
      28px minmax(0, 1fr) 50px minmax(0, 2fr)
      max-content;
  }
  .cockpit-inbox__context,
  .cockpit-inbox__status {
    display: none;
  }
}
</style>
