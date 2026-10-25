<template>
  <section class="repository-backlog" :aria-label="$t('surface.repositoryBacklogPanel.repositoryBacklog')">
    <BacklogSourceSelector size="small" :provider="backlog.provider.value" :providers="backlog.providers.value" :sources="backlog.sources.value" :source-id="backlog.sourceId.value" :show-source="!workProviderDefinition(backlog.provider.value).repositoryBacked" @select-provider="backlog.selectProvider" @select-source="backlog.selectSource" />
    <header class="repository-backlog__repository">
      <div>
        <component :is="workProviderIcon(backlog.provider.value)" aria-hidden="true" />
        <strong>{{ repositoryName }}</strong>
      </div>
      <span v-if="branch" class="repository-backlog__branch-pill">
        <IconGitBranch aria-hidden="true" />
        {{ branch }}
      </span>
      <button
        type="button"
        :aria-label="t('repositoryBacklog.refresh')"
        :disabled="status === 'loading'"
        @click="backlog.refresh()"
      >
        <IconRefresh :class="{ 'repository-backlog__spin': status === 'loading' }" aria-hidden="true" />
      </button>
    </header>

    <div class="repository-backlog__toolbar">
      <div class="repository-backlog__segments" role="radiogroup" :aria-label="$t('surface.repositoryBacklogPanel.workItemType')">
        <button
          type="button"
          role="radio"
          :aria-checked="kindFilter === 'issue'"
          :class="{ 'repository-backlog__segment--active': kindFilter === 'issue' }"
          @click="kindFilter = 'issue'"
        >
          <IconCircleDot aria-hidden="true" />
          {{ t('repositoryBacklog.issues') }}
        </button>
        <button
          v-if="workProviderDefinition(backlog.provider.value).pullRequests"
          type="button"
          role="radio"
          :aria-checked="kindFilter === 'pullRequest'"
          :class="{ 'repository-backlog__segment--active': kindFilter === 'pullRequest' }"
          @click="kindFilter = 'pullRequest'"
        >
          <IconGitPullRequest aria-hidden="true" />
          {{ t(backlog.provider.value === 'gitlab' ? 'gitlabBacklog.mergeRequests' : 'repositoryBacklog.pullRequests') }}
        </button>
      </div>

      <div class="repository-backlog__toolbar-actions">
        <button
          class="repository-backlog__toolbar-button"
          type="button"
          :aria-label="t('repositoryBacklog.search')"
          :aria-expanded="searchVisible"
          @click="toggleSearch"
        >
          <IconSearch aria-hidden="true" />
        </button>

        <el-popover
          v-model:visible="filtersVisible"
          placement="bottom-end"
          trigger="click"
          :width="280"
          popper-class="app-popover repository-backlog__filters-popover"
        >
          <template #reference>
            <button
              class="repository-backlog__toolbar-button"
              type="button"
              :aria-label="t('repositoryBacklog.filters')"
              :aria-expanded="filtersVisible"
            >
              <IconFilter aria-hidden="true" />
              <span v-if="activeFilterCount" class="repository-backlog__filter-count">{{ activeFilterCount }}</span>
            </button>
          </template>
          <div class="repository-backlog__filter-menu">
            <header>
              <div>
                <strong>{{ t('repositoryBacklog.filters') }}</strong>
                <span>{{ repositoryName }}</span>
              </div>
              <button type="button" @click="clearFilters">{{ t('repositoryBacklog.clearFilters') }}</button>
            </header>

            <div class="repository-backlog__filter-fields">
              <label>
                <span>{{ t('repositoryBacklog.state') }}</span>
                <el-select v-model="stateFilter" size="small" :aria-label="$t('surface.repositoryBacklogPanel.workItemState')">
                  <el-option :label="t('repositoryBacklog.open')" value="open" />
                  <el-option :label="t('repositoryBacklog.closed')" value="closed" />
                  <el-option :label="t('repositoryBacklog.allStates')" value="all" />
                </el-select>
              </label>
              <label>
                <span>{{ t('repositoryBacklog.assignee') }}</span>
                <el-select v-model="assigneeFilter" size="small" :aria-label="$t('surface.repositoryBacklogPanel.workItemAssignee')">
                  <el-option :label="t('repositoryBacklog.anyone')" value="all" />
                  <el-option :label="t('repositoryBacklog.assignedToMe')" value="me" />
                  <el-option :label="t('repositoryBacklog.unassigned')" value="unassigned" />
                </el-select>
              </label>
              <label>
                <span>{{ t('repositoryBacklog.label') }}</span>
                <el-select
                  v-model="labelFilter"
                  size="small"
                  :placeholder="t('repositoryBacklog.allLabels')"
                  :aria-label="$t('surface.repositoryBacklogPanel.workItemLabel')"
                >
                  <el-option :label="t('repositoryBacklog.allLabels')" value="" />
                  <el-option v-for="label in labelOptions" :key="label" :label="label" :value="label" />
                </el-select>
              </label>
            </div>

            <footer>
              <span v-if="defaultsSaved">{{ t('repositoryBacklog.defaultsSaved') }}</span>
              <button class="app-button app-button--tertiary" type="button" @click="saveFilterDefaults">
                <IconDeviceFloppy aria-hidden="true" />
                {{ t('repositoryBacklog.saveDefaults') }}
              </button>
            </footer>
          </div>
        </el-popover>
      </div>

      <div v-if="searchVisible" class="repository-backlog__search">
        <IconSearch aria-hidden="true" />
        <input
          ref="searchInput"
          v-model="searchQuery"
          type="search"
          :placeholder="kindFilter === 'issue' ? t('repositoryBacklog.searchIssues') : t(backlog.provider.value === 'gitlab' ? 'gitlabBacklog.searchMergeRequests' : 'repositoryBacklog.searchPullRequests')"
          :aria-label="$t('surface.repositoryBacklogPanel.searchRepositoryWork')"
          @keydown.esc="closeSearch"
        >
        <button type="button" :aria-label="t('repositoryBacklog.closeSearch')" @click="closeSearch">
          <IconX aria-hidden="true" />
        </button>
      </div>
    </div>

    <div v-if="status === 'loading' && items.length === 0" class="repository-backlog__state">
      <span class="repository-backlog__loader" aria-hidden="true" />
      {{ t('repositoryBacklog.loading') }}
    </div>

    <div v-else-if="error" class="repository-backlog__state repository-backlog__state--error">
      <IconAlertCircle aria-hidden="true" />
      <span>{{ error }}</span>
      <button type="button" @click="backlog.refresh()">{{ t('repositoryBacklog.retry') }}</button>
    </div>

    <div v-else-if="filteredItems.length === 0" class="repository-backlog__state">
      {{ t('repositoryBacklog.empty') }}
    </div>

    <div v-else class="repository-backlog__list">
      <section v-for="group in assignmentGroups" :key="group.status" class="repository-backlog__group" :data-status="group.status">
        <h3>{{ group.label }} <span>{{ group.items.length }}</span></h3>
        <RepositoryItemRow
          v-for="item in group.items"
          :key="item.id"
          :item="item"
          :assignment="assignmentFor(item)"
          :active="openItemId === item.id"
          @activate="showAssignmentAgent(assignmentFor(item))"
          @open="openItem(item, $event)"
        />
      </section>

      <section v-if="unassignedItems.length" class="repository-backlog__group">
        <h3>{{ stateFilter === 'closed' ? t('repositoryBacklog.closed') : t('repositoryBacklog.open') }} <span>{{ unassignedItems.length }}</span></h3>
        <RepositoryItemRow
          v-for="item in unassignedItems"
          :key="item.id"
          :item="item"
          :assignment="null"
          :active="openItemId === item.id"
          @open="openItem(item, $event)"
        />
      </section>

      <p class="repository-backlog__result-count">
        {{ t('repositoryBacklog.showing', {
          visible: filteredItems.length,
          total: kindItems.length,
          kind: kindFilter === 'issue' ? t('repositoryBacklog.issues').toLocaleLowerCase() : t(backlog.provider.value === 'gitlab' ? 'gitlabBacklog.mergeRequests' : 'repositoryBacklog.pullRequests').toLocaleLowerCase(),
        }) }}
      </p>
    </div>

    <el-popover
      v-if="selectedItem"
      :visible="startWorkVisible"
      virtual-triggering
      :virtual-ref="virtualReference"
      trigger="click"
      placement="bottom-end"
      :width="selectedAssignment ? 220 : 340"
      :teleported="true"
      popper-class="app-popover repository-backlog__start-popover"
      @update:visible="setStartWorkVisible"
    >
      <div
        class="repository-backlog__start-work"
        :class="{ 'repository-backlog__start-work--menu': selectedAssignment }"
      >
        <WorkItemDetail :item="selectedItem" />
        <template v-if="selectedAssignment">
          <AppMenu
            class="app-menu--embedded repository-backlog__assignment-menu"
            :ariaLabel="$t('surface.repositoryBacklogPanel.workItemAssignmentActions')"
            :items="assignmentMenuItems"
            @select="selectAssignmentMenuItem"
          />
        </template>
        <template v-else-if="operationState === 'idle' || operationState === 'error'">
          <header>
            <strong>{{ t('repositoryBacklog.startWork', { identifier: workItemDisplayIdentifier(selectedItem) }) }}</strong>
            <button type="button" :aria-label="$t('surface.repositoryBacklogPanel.close')" @click="closeStartWork"><IconX aria-hidden="true" /></button>
          </header>

          <WorkItemAssignmentPicker
            :item="selectedItem"
            :branch-name="branchName"
            :sessions="currentSessionOptions"
            :error="operationError"
            @custom="prefillCustomPrompt"
            @submit="startWork"
          />
        </template>

        <div v-else class="repository-backlog__operation-state" :data-state="operationState">
          <span v-if="operationState === 'running'" class="repository-backlog__operation-spinner" aria-hidden="true" />
          <IconCircleCheck v-else aria-hidden="true" />
          <strong>{{ operationState === 'running' ? t('repositoryBacklog.starting') : t('repositoryBacklog.started') }}</strong>
          <span>{{ operationWorkspaceLabel }}</span>
        </div>
      </div>
    </el-popover>

    <el-dialog
      class="app-dialog repository-backlog__clear-dialog"
      :model-value="pendingClearAssignment !== null"
      :teleported="false"
      width="440px"
      :show-close="false"
      destroy-on-close
      @update:model-value="onClearDialogVisibilityChanged"
    >
      <template #header>
        <div class="app-form-dialog__header">
          <h2 class="app-dialog__title">{{ t('repositoryBacklog.clearAssignmentTitle') }}</h2>
        </div>
      </template>
      <p class="repository-backlog__clear-copy">
        {{ t('repositoryBacklog.clearAssignmentPrompt', { name: pendingClearAssignment?.agent.name ?? '' }) }}
      </p>
      <template #footer>
        <div class="app-dialog__footer">
          <button class="app-button app-button--tertiary" type="button" @click="confirmClearAssignment(false)">
            {{ t('repositoryBacklog.keepAgent') }}
          </button>
          <button class="app-button app-button--primary" type="button" @click="confirmClearAssignment(true)">
            {{ t('repositoryBacklog.closeAgent') }}
          </button>
        </div>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { workProviderDefinition } from '@workspace/core/work-providers';
import { workItemBranchName, workItemDisplayIdentifier } from '@workspace/core/work-item-prompts';
import { computed, h, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  IconAlertCircle,
  IconCircleCheck,
  IconCircleDot,
  IconDeviceFloppy,
  IconDots,
  IconFilter,
  IconGitBranch,
  IconGitPullRequest,
  IconRefresh,
  IconRobotFace,
  IconSearch,
  IconX,
} from '@tabler/icons-vue';
import { workProviderIcon } from './work-provider-icons';
import type { Agent, WorkBacklogAssignment, WorkItem } from '@workspace/core/contracts';
import { agentDisplayName } from '@workspace/core/agent-display';
import { workItemAssignmentKey } from '@workspace/core/work-assignments';
import AppMenu from '../shared/menu/AppMenu.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import type { RepositoryWorkStartInput } from './right-workspace';
import WorkItemAssignmentPicker from './WorkItemAssignmentPicker.vue';
import type { WorkItemAssignmentSelection, WorkItemAssignmentSession } from './WorkItemAssignmentPicker.vue';
import BacklogSourceSelector from './BacklogSourceSelector.vue';
import WorkItemDetail from './WorkItemDetail.vue';
import { useWorkSourceBacklog } from './use-work-source-backlog';

defineOptions({ name: 'RepositoryBacklogPanel' });

const props = defineProps<{
  location?: import('@workspace/core/contracts').AutomationLocation;
  agent: Agent;
  agents: readonly Agent[];
  assignments: Record<string, WorkBacklogAssignment>;
  branch?: string;
  repositoryId: string;
  clearAssignmentAction?: (item: WorkItem) => void;
  closeAgentAction?: (agentId: string) => void;
  showAgentAction?: (agentId: string) => void;
  startWorkAction: (input: RepositoryWorkStartInput) => Promise<void>;
  visible: boolean;
}>();


const { t } = useI18n();
const backlog = useWorkSourceBacklog({
  location: () => props.location,
  query: { kind: 'all', state: 'all' },
  preferredSourceId: () => props.repositoryId,
  preferredProvider: () => props.repositoryId.startsWith('gitlab.com/') ? 'gitlab' : undefined,
  restrictToRepository: () => true,
  enabled: () => props.visible,
});
const { items, status, error } = backlog;
const kindFilter = ref<'issue' | 'pullRequest'>('issue');
const stateFilter = ref<'open' | 'closed' | 'all'>('open');
const assigneeFilter = ref<'all' | 'me' | 'unassigned'>('all');
const labelFilter = ref('');
const searchQuery = ref('');
const searchVisible = ref(false);
const searchInput = ref<HTMLInputElement | null>(null);
const filtersVisible = ref(false);
const defaultsSaved = ref(false);
const selectedItem = ref<WorkItem | null>(null);
let selectionRevision = 0;
watch([selectedItem, () => props.visible, () => JSON.stringify(props.location)], () => { ++selectionRevision; }, { flush: 'sync' });
const openItemId = ref<string | null>(null);
const startWorkVisible = ref(false);
const branchName = ref('');
const operationState = ref<'idle' | 'running' | 'success' | 'error'>('idle');
const operationError = ref<string | null>(null);
const pendingClearAssignment = ref<{ agent: Agent; item: WorkItem } | null>(null);
const virtualReference = ref({ getBoundingClientRect: () => new DOMRect() });

const currentSessionOptions = computed<WorkItemAssignmentSession[]>(() => [{
  agentId: props.agent.id,
  branch: props.branch ?? '',
  label: props.branch ? `${agentDisplayName(props.agent)} · ${props.branch}` : agentDisplayName(props.agent),
}]);
const operationWorkspaceLabel = computed(() => branchName.value || props.branch || t('repositoryBacklog.currentWorkspace'));

const repositoryName = computed(() => backlog.sources.value.find(source => source.id === backlog.sourceId.value)?.fullName ?? backlog.sourceId.value ?? '');
const labelOptions = computed(() => [...new Set(items.value.flatMap((item) => item.labels.map((label) => label.name)))].sort());
const activeFilterCount = computed(() => Number(stateFilter.value !== 'open') + Number(assigneeFilter.value !== 'all') + Number(Boolean(labelFilter.value)));
const kindItems = computed(() => items.value.filter((item) => (item.kind ?? 'issue') === kindFilter.value));
const filteredItems = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  return items.value
    .filter((item) => (item.kind ?? 'issue') === kindFilter.value)
    .filter((item) => stateFilter.value === 'all' || item.state === stateFilter.value)
    .filter((item) => assigneeFilter.value === 'all'
      || (assigneeFilter.value === 'me' && item.assignedToViewer)
      || (assigneeFilter.value === 'unassigned' && (item.assignees?.length ?? 0) === 0))
    .filter((item) => !labelFilter.value || item.labels.some((label) => label.name === labelFilter.value))
    .filter((item) => !query || `${item.identifier ?? item.number} ${item.title} ${item.authorName ?? ''}`.toLocaleLowerCase().includes(query))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
});
const assignmentGroups = computed(() => ([
  { status: 'blocked', label: t('repositoryBacklog.blocked'), items: assignedItems('blocked') },
  { status: 'readyForReview', label: t('repositoryBacklog.readyForReview'), items: assignedItems('readyForReview') },
  { status: 'inProgress', label: t('repositoryBacklog.inProgress'), items: assignedItems('inProgress') },
  { status: 'completed', label: t('repositoryBacklog.completed'), items: assignedItems('completed') },
] as const).filter((group) => group.items.length > 0));
const unassignedItems = computed(() => filteredItems.value.filter((item) => !assignmentFor(item)));
const selectedAssignment = computed(() => selectedItem.value ? assignmentFor(selectedItem.value) : null);
const assignmentMenuItems = computed<AppMenuItem[]>(() => {
  const assignment = selectedAssignment.value;
  if (!assignment) return [];
  return [
    {
      id: 'show-agent',
      type: 'action',
      label: assignment.agentId === props.agent.id
        ? t('repositoryBacklog.assignedToCurrentAgent')
        : t('repositoryBacklog.showAgent'),
      icon: IconRobotFace,
      disabled: assignment.agentId === props.agent.id,
    },
    {
      id: 'clear-assignment',
      type: 'action',
      label: t('repositoryBacklog.clearAssignment'),
      icon: IconX,
    },
  ];
});

watch(() => props.visible, (visible) => {
  if (!visible) {
    closeStartWork();
    closeSearch();
    filtersVisible.value = false;
  }
});

watch(labelOptions, (labels) => {
  if (labels.length > 0 && labelFilter.value && !labels.includes(labelFilter.value)) {
    labelFilter.value = '';
  }
});

watch(() => props.repositoryId, () => {
  closeStartWork();
  loadFilterDefaults();
}, { immediate: true });

watch([backlog.provider, backlog.sourceId, () => JSON.stringify(props.location)], () => {
  pendingClearAssignment.value = null;
  closeStartWork();
  closeSearch();
  clearFilters();
  kindFilter.value = 'issue';
  loadFilterDefaults();
});

watch([stateFilter, assigneeFilter, labelFilter], () => {
  defaultsSaved.value = false;
});

const RepositoryItemRow = (rowProps: { item: WorkItem; assignment: WorkBacklogAssignment | null; active: boolean }, context: { emit: (event: 'open' | 'activate', element?: HTMLElement) => void }) => {
  const item = rowProps.item;
  const label = item.labels[0];
  const assignmentNote = rowProps.assignment?.note?.trim();
  return h('article', {
    class: [
      'repository-backlog__item',
      rowProps.active ? 'repository-backlog__item--active' : '',
      rowProps.assignment ? 'repository-backlog__item--assigned' : '',
      assignmentNote ? 'repository-backlog__item--commented' : '',
    ],
    onClick: rowProps.assignment ? () => context.emit('activate') : undefined,
  }, [
    h(item.kind === 'pullRequest' ? IconGitPullRequest : IconCircleDot, { class: 'repository-backlog__item-kind', 'aria-hidden': 'true' }),
    h('div', { class: 'repository-backlog__item-copy' }, [
      h('a', {
        class: 'repository-backlog__item-title',
        href: item.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        onClick: (event: MouseEvent) => event.stopPropagation(),
      }, [h('span', workItemDisplayIdentifier(item)), h('strong', item.title)]),
      assignmentNote
        ? h('p', { class: 'repository-backlog__assignment-note' }, assignmentNote)
        : h('div', { class: 'repository-backlog__item-meta' }, [
          h('span', { class: `repository-backlog__state-dot repository-backlog__state-dot--${item.state}` }),
          h('span', item.nativeState ?? (item.state === 'open' ? t('repositoryBacklog.open') : t('repositoryBacklog.closed'))),
          label ? h('span', { class: 'repository-backlog__label', style: labelStyle(label.color) }, label.name) : null,
        ]),
    ]),
    h('span', { class: 'repository-backlog__item-time' }, relativeTime(item.updatedAt)),
    h('button', {
      class: 'repository-backlog__item-actions',
      type: 'button',
      'aria-label': `${t('repositoryBacklog.actions')} ${workItemDisplayIdentifier(item)}`,
      onClick: (event: MouseEvent) => {
        event.stopPropagation();
        context.emit('open', event.currentTarget as HTMLElement);
      },
    }, [h(IconDots, { 'aria-hidden': 'true' })]),
  ]);
};

async function toggleSearch(): Promise<void> {
  if (searchVisible.value) {
    closeSearch();
    return;
  }
  searchVisible.value = true;
  await nextTick();
  searchInput.value?.focus();
}

function closeSearch(): void {
  searchQuery.value = '';
  searchVisible.value = false;
}

function clearFilters(): void {
  stateFilter.value = 'open';
  assigneeFilter.value = 'all';
  labelFilter.value = '';
}

function saveFilterDefaults(): void {
  try {
    window.localStorage.setItem(filterDefaultsKey(), JSON.stringify({
      state: stateFilter.value,
      assignee: assigneeFilter.value,
      label: labelFilter.value,
    }));
    defaultsSaved.value = true;
  } catch {
    defaultsSaved.value = false;
  }
}

function loadFilterDefaults(): void {
  const defaults = readFilterDefaults();
  stateFilter.value = defaults.state;
  assigneeFilter.value = defaults.assignee;
  labelFilter.value = defaults.label;
  defaultsSaved.value = false;
}

function readFilterDefaults(): {
  state: 'open' | 'closed' | 'all';
  assignee: 'all' | 'me' | 'unassigned';
  label: string;
} {
  try {
    const stored = window.localStorage.getItem(filterDefaultsKey());
    if (!stored) return { state: 'open', assignee: 'all', label: '' };
    const value = JSON.parse(stored) as Record<string, unknown>;
    return {
      state: value.state === 'closed' || value.state === 'all' ? value.state : 'open',
      assignee: value.assignee === 'unassigned' || value.assignee === 'me' ? value.assignee : 'all',
      label: typeof value.label === 'string' && value.label.length <= 100 && (labelOptions.value.length === 0 || labelOptions.value.includes(value.label)) ? value.label : '',
    };
  } catch {
    return { state: 'open', assignee: 'all', label: '' };
  }
}

function filterDefaultsKey(): string {
  return `repositoryBacklogFilters:${backlog.provider.value}:${JSON.stringify(props.location)}:${backlog.sourceId.value}`;
}

function openItem(item: WorkItem, element?: HTMLElement): void {
  if (!items.value.some(candidate => candidate.id === item.id)) return;
  const reference = element ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  if (reference) virtualReference.value = reference;
  selectedItem.value = item;
  openItemId.value = item.id;
  startWorkVisible.value = true;
  branchName.value = item.kind === 'pullRequest' ? item.branchName?.trim() || suggestedBranch(item) : suggestedBranch(item);
  operationState.value = 'idle';
  operationError.value = null;
}

function assignmentFor(item: WorkItem): WorkBacklogAssignment | null {
  return props.assignments[workItemAssignmentKey(item)] ?? null;
}

function assignedItems(status: WorkBacklogAssignment['status']): WorkItem[] {
  return filteredItems.value.filter((item) => assignmentFor(item)?.status === status);
}

function selectAssignmentMenuItem(itemId: string): void {
  if (itemId === 'show-agent') {
    showAssignmentAgent(selectedAssignment.value);
  } else if (itemId === 'clear-assignment') {
    clearSelectedAssignment();
  }
}

function showAssignmentAgent(assignment: WorkBacklogAssignment | null): void {
  if (!assignment || assignment.agentId === props.agent.id) return;
  props.showAgentAction?.(assignment.agentId);
  closeStartWork();
}

function clearSelectedAssignment(): void {
  const item = selectedItem.value;
  if (!item) return;
  const assignment = assignmentFor(item);
  const assignedAgent = props.agents.find((agent) => agent.id === assignment?.agentId);
  if (assignedAgent) {
    pendingClearAssignment.value = { agent: assignedAgent, item };
    closeStartWork();
    return;
  }
  props.clearAssignmentAction?.(item);
  closeStartWork();
}

function confirmClearAssignment(closeAgent: boolean): void {
  const pending = pendingClearAssignment.value;
  if (!pending) return;
  pendingClearAssignment.value = null;
  if (closeAgent && props.closeAgentAction) {
    props.closeAgentAction(pending.agent.id);
  } else {
    props.clearAssignmentAction?.(pending.item);
  }
}

function onClearDialogVisibilityChanged(visible: boolean): void {
  if (!visible) pendingClearAssignment.value = null;
}

function closeStartWork(): void {
  startWorkVisible.value = false;
  selectedItem.value = null;
  openItemId.value = null;
}

function setStartWorkVisible(visible: boolean): void {
  if (visible) {
    startWorkVisible.value = true;
    return;
  }
  closeStartWork();
}

function prefillCustomPrompt(selection: Omit<WorkItemAssignmentSelection, 'action'>): void {
  const item = selectedItem.value;
  if (!item) return;
  void startWork({ ...selection, action: 'custom' });
}

async function startWork(selection: Omit<WorkItemAssignmentSelection, 'action'> & { action: RepositoryWorkStartInput['action'] }): Promise<void> {
  const item = selectedItem.value;
  if (!item || selection.item.id !== item.id || operationState.value === 'running') return;
  const source = backlog.sourceId.value;
  const provider = backlog.provider.value;
  const revision = selectionRevision;
  const isCurrent = () => revision === selectionRevision && props.visible && selectedItem.value?.id === item.id && backlog.sourceId.value === source && backlog.provider.value === provider;
  operationState.value = 'running';
  operationError.value = null;
  try {
    const input: RepositoryWorkStartInput = selection.destination === 'new'
      ? { action: selection.action, item, target: 'duplicate', backend: selection.backend, ...(selection.model ? { model: selection.model } : {}), ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}), workspace: { kind: 'worktree', branchName: branchName.value.trim() } }
      : { action: selection.action, item, target: 'current', workspace: { kind: 'current' } };
    await props.startWorkAction({ ...input, isCurrent });
    if (!isCurrent()) return;
    operationState.value = 'success';
    globalThis.setTimeout(() => { if (isCurrent()) closeStartWork(); }, 1_200);
  } catch (error) {
    if (!isCurrent()) return;
    operationState.value = 'error';
    operationError.value = error instanceof Error ? error.message : String(error);
  }
}

function suggestedBranch(item: WorkItem): string {
  return workItemBranchName(item);
}

function relativeTime(value: string): string {
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1_000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
  if (elapsedSeconds < 3_600) return `${Math.floor(elapsedSeconds / 60)}m`;
  if (elapsedSeconds < 86_400) return `${Math.floor(elapsedSeconds / 3_600)}h`;
  return `${Math.floor(elapsedSeconds / 86_400)}d`;
}

function labelStyle(color?: string): Record<string, string> {
  if (!color || !/^[0-9a-f]{6}$/iu.test(color)) return {};
  const normalizedColor = `#${color.toLocaleLowerCase()}`;
  return {
    '--repository-label-color': normalizedColor,
    '--repository-label-text-color': readableLabelTextColor(color),
  };
}

function readableLabelTextColor(color: string): string {
  const rgb = [0, 2, 4].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  if (relativeLuminance(rgb) <= 0.35) return `#${color.toLocaleLowerCase()}`;

  for (let percentage = 99; percentage >= 0; percentage -= 1) {
    const darkened = rgb.map((channel) => Math.round(channel * percentage / 100));
    if (relativeLuminance(darkened) <= 0.18) {
      return `#${darkened.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return '#000000';
}

function relativeLuminance(rgb: number[]): number {
  const [red = 0, green = 0, blue = 0] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
</script>

<style scoped>
.repository-backlog {
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  color: var(--color-text);
  background: var(--color-surface-low);
}

.repository-backlog__repository {
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: 0 var(--space-6);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-lowest);
}

.repository-backlog__repository > div {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.repository-backlog__repository svg {
  width: var(--icon-md);
  height: var(--icon-md);
}

.repository-backlog__repository strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repository-backlog__branch-pill {
  min-width: 0;
  height: 26px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: var(--color-surface-lowest);
  font-size: var(--font-size-12);
}

.repository-backlog__repository .repository-backlog__branch-pill svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
}

.repository-backlog__repository > button {
  width: 28px;
  height: 28px;
  margin-left: auto;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.repository-backlog__repository > button:hover {
  color: var(--color-text);
  background: var(--color-surface-low);
}

.repository-backlog__toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-lowest);
}

.repository-backlog__segments {
  justify-self: start;
  display: flex;
  padding: 2px;
  border-radius: var(--radius-lg);
  background: var(--color-surface-low);
}

.repository-backlog__segments button {
  height: 26px;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-6);
  border: 0;
  border-radius: calc(var(--radius-lg) - 2px);
  color: var(--color-text-muted);
  background: transparent;
  font: inherit;
  font-size: var(--font-size-12);
  cursor: pointer;
}

.repository-backlog__segments button svg {
  width: 14px;
  height: 14px;
}

.repository-backlog__segments .repository-backlog__segment--active {
  color: var(--color-text);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-sm);
}

.repository-backlog__search {
  grid-column: 1 / -1;
  min-width: 0;
  height: 30px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
}

.repository-backlog__search svg {
  flex: 0 0 auto;
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.repository-backlog__search input {
  min-width: 0;
  flex: 1 1 auto;
  border: 0;
  outline: 0;
  color: var(--color-text);
  background: transparent;
  font: inherit;
  font-size: var(--font-size-12);
}

.repository-backlog__search button {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.repository-backlog__toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.repository-backlog__toolbar-button {
  position: relative;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
  background: transparent;
  font: inherit;
  font-size: var(--font-size-12);
  cursor: pointer;
}

.repository-backlog__toolbar-button:hover,
.repository-backlog__toolbar-button[aria-expanded="true"] {
  color: var(--color-text);
  background: var(--color-surface-low);
}

.repository-backlog__toolbar-button svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.repository-backlog__filter-count {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  padding: 0 3px;
  border: 2px solid var(--color-shell-main);
  border-radius: var(--radius-full);
  color: var(--color-primary);
  background: var(--color-primary-container);
  font-size: var(--font-size-11);
}

.repository-backlog__filter-menu {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-3);
}

.repository-backlog__filter-menu > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.repository-backlog__filter-menu > header > div {
  min-width: 0;
  display: grid;
  gap: 1px;
}

.repository-backlog__filter-menu > header strong {
  font-size: var(--font-size-13);
}

.repository-backlog__filter-menu > header span {
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-11);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repository-backlog__filter-menu > header > button {
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  color: var(--color-primary);
  background: transparent;
  font: inherit;
  font-size: var(--font-size-11);
  cursor: pointer;
}

.repository-backlog__filter-fields {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-surface-low);
}

.repository-backlog__filter-fields label {
  display: grid;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-11);
}

.repository-backlog__filter-fields :deep(.el-select) {
  width: 100%;
}

.repository-backlog__filter-menu > footer {
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
}

.repository-backlog__filter-menu > footer > span {
  margin-right: auto;
  color: var(--color-success);
  font-size: var(--font-size-11);
}

.repository-backlog__filter-menu > footer .app-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-size-11);
}

.repository-backlog__filter-menu > footer svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.repository-backlog__list {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  padding: var(--space-3) var(--space-6) var(--space-6);
}

.repository-backlog__group + .repository-backlog__group {
  margin-top: var(--space-4);
}

.repository-backlog__group h3 {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-3) var(--space-1);
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-semibold);
}

.repository-backlog__group h3 span {
  min-width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-full);
  color: var(--color-on-primary-container);
  background: var(--color-primary-container);
  font-size: var(--font-size-11);
  font-weight: var(--font-weight-regular);
}

.repository-backlog__group[data-status="blocked"] h3 {
  color: var(--color-error);
}

.repository-backlog__group[data-status="readyForReview"] h3 {
  color: var(--color-primary);
}

.repository-backlog__group[data-status="completed"] h3 {
  color: var(--color-text-muted);
}

:deep(.repository-backlog__item) {
  min-width: 0;
  display: grid;
  grid-template-columns: var(--icon-md) minmax(0, 1fr) auto 28px;
  align-items: center;
  gap: var(--space-3);
  min-height: 54px;
  padding: var(--space-3) var(--space-4);
  border: 1px solid color-mix(in srgb, var(--color-border) 78%, transparent);
  border-radius: var(--radius-md);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-sm);
}

:deep(.repository-backlog__item + .repository-backlog__item) {
  margin-top: var(--space-2);
}

:deep(.repository-backlog__item--assigned) {
  cursor: pointer;
}

:deep(.repository-backlog__item:hover),
:deep(.repository-backlog__item--active) {
  border-color: var(--color-border-strong);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-md);
}

:deep(.repository-backlog__item--active) {
  border-color: var(--color-primary);
  background: color-mix(
    in srgb,
    var(--color-primary-container) 38%,
    var(--color-surface-lowest)
  );
}

:deep(.repository-backlog__item-kind) {
  width: var(--icon-md);
  height: var(--icon-md);
  align-self: start;
  margin-top: 2px;
  color: var(--color-text-muted);
}

:deep(.repository-backlog__item-copy) {
  min-width: 0;
  display: grid;
  gap: 2px;
}

:deep(.repository-backlog__item-title) {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  color: inherit;
  text-decoration: none;
}

:deep(.repository-backlog__item-title:hover strong) {
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}

:deep(.repository-backlog__item-title span) {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

:deep(.repository-backlog__item-title strong) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-semibold);
}

:deep(.repository-backlog__item-meta) {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-11);
}

:deep(.repository-backlog__assignment-note) {
  min-width: 0;
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  white-space: normal;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--color-error);
  font-size: var(--font-size-11);
  line-height: 1.35;
}

:deep(.repository-backlog__state-dot) {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  background: var(--color-outline);
}

:deep(.repository-backlog__state-dot--open) {
  background: var(--color-success);
}

:deep(.repository-backlog__label) {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px var(--space-3);
  border: 1px solid
    var(
      --repository-label-text-color,
      var(--repository-label-color, var(--color-text-muted))
    );
  border-radius: var(--radius-full);
  color: var(
    --repository-label-text-color,
    var(--repository-label-color, var(--color-text-muted))
  );
  background: color-mix(
    in srgb,
    var(--repository-label-color, var(--color-outline)) 15%,
    transparent
  );
}

:global(html.dark) :deep(.repository-backlog__label) {
  border-color: var(--repository-label-color, var(--color-text-muted));
  color: var(--repository-label-color, var(--color-text-muted));
}

:deep(.repository-backlog__item-time) {
  color: var(--color-text-muted);
  font-size: var(--font-size-11);
  font-variant-numeric: tabular-nums;
}

:deep(.repository-backlog__item-actions) {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.repository-backlog__result-count {
  margin: var(--space-4) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-11);
}

:deep(.repository-backlog__item-actions:hover) {
  color: var(--color-text);
  background: var(--color-surface-high);
}

:deep(.repository-backlog__item-actions svg) {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.repository-backlog__state {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  padding: var(--space-10);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
}

.repository-backlog__state--error {
  color: var(--color-error);
}

.repository-backlog__state button {
  border: 0;
  color: var(--color-primary);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.repository-backlog__clear-copy {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-14);
  line-height: var(--line-height-20);
}

.repository-backlog__loader,
.repository-backlog__operation-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: var(--radius-full);
  animation: repository-backlog-spin 800ms linear infinite;
}

.repository-backlog__start-work {
  position: relative;
  display: grid;
  gap: var(--space-4);
  padding: var(--space-3);
}

.repository-backlog__start-work--menu {
  gap: 0;
  padding: 0;
}

.repository-backlog__start-work > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.repository-backlog__start-work > header > button {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.repository-backlog__start-work > header > button svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.repository-backlog__operation-state {
  min-height: 190px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: var(--space-4);
  text-align: center;
}

.repository-backlog__operation-state svg {
  width: 32px;
  height: 32px;
  color: var(--color-success);
}

.repository-backlog__operation-state > span:last-child {
  color: var(--color-text-muted);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-11);
}

.repository-backlog__spin {
  animation: repository-backlog-spin 800ms linear infinite;
}

@keyframes repository-backlog-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 720px) {
  .repository-backlog__toolbar {
    grid-template-columns: 1fr auto;
  }
}
</style>
