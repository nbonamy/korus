<template>
  <section class="cockpit-view" :aria-label="$t('surface.cockpitView.backlog')">
    <WorkspaceHeader class="cockpit-view__app-header" sidebar-collapsed>
      <h1 class="workspace-header__title">{{ $t('surface.cockpitView.backlog') }}</h1>
    </WorkspaceHeader>
    <div class="cockpit-view__body">
    <aside class="cockpit-view__navigation" :aria-label="$t('surface.cockpitView.backlogNavigation')">
      <nav>
        <BacklogSourceSelector class="cockpit-view__provider" size="small" full-width :provider="workProvider ?? 'github'" :providers="workProviders ?? []" :show-source="false" @select-provider="emit('select-work-provider', $event)" />
        <div class="cockpit-view__navigation-section">
          <strong class="app-section-label">{{ $t(!workProviderDefinition(workProvider ?? 'github').repositoryBacked ? 'backlogSource.sources' : 'surface.cockpitView.repositories') }}</strong>
          <AppMenuChip :label="repositorySortLabel" :ariaLabel="$t('dynamic.cockpit.sortRepositories', { sort: repositorySortDescription })" :items="repositorySortMenuItems" @select="selectRepositorySortMode($event as RepositorySortMode)" />
        </div>
        <label class="cockpit-view__repository-filter">
          <IconSearch aria-hidden="true" />
          <input
            v-model="repositoryFilter"
            type="search"
            :placeholder="$t(!workProviderDefinition(workProvider ?? 'github').repositoryBacked ? 'backlogSource.filterSources' : 'surface.cockpitView.filterRepositories')"
            :aria-label="$t(!workProviderDefinition(workProvider ?? 'github').repositoryBacked ? 'backlogSource.filterSources' : 'surface.cockpitView.filterRepositories')"
          />
        </label>
        <p v-if="favoritesSaveFailed" class="cockpit-view__favorites-error" role="alert">{{ $t('backlogFavorites.saveFailed') }}</p>
        <div v-if="workBacklog" class="cockpit-view__repositories">
          <p v-if="filteredRepositories.length === 0" class="cockpit-view__repositories-empty"> {{ $t('surface.cockpitView.noRepositoriesFound') }} </p>
          <h2 v-if="favoriteRepositories.length" class="cockpit-view__favorites-heading app-section-label">{{ $t('backlogFavorites.heading') }}</h2>
          <template v-for="(repository, index) in displayedRepositories" :key="repository.id">
            <h2 v-if="favoriteRepositories.length && index === favoriteRepositories.length" class="cockpit-view__favorites-heading app-section-label">{{ $t(!workProviderDefinition(workProvider ?? 'github').repositoryBacked ? 'backlogSource.sources' : 'surface.cockpitView.repositories') }}</h2>
            <div
              :data-repository-id="repository.id"
              :class="isFavorite(repository.id) ? favoriteReorder.dropTargetClass(repository.id) : {}"
              @dragover="isFavorite(repository.id) && favoriteReorder.onDragOver(repository.id, $event)"
              @dragleave="favoriteReorder.onDragLeave(repository.id, $event)"
              @drop.stop="isFavorite(repository.id) ? favoriteReorder.onDrop(repository.id, $event) : favoriteReorder.onDragEnd()"
            >
              <button
                v-if="isFavorite(repository.id)"
                class="cockpit-view__repository-reorder"
                type="button"
                v-bind="favoriteReorder.dragItemAttributes(repository.id)"
                :aria-label="$t('backlogFavorites.reorder', { repository: repositoryDisplayName(repository) })"
                :title="$t('backlogFavorites.dragHint')"
                @click.stop
                @dragstart.stop="favoriteReorder.onDragStart(repository.id, $event)"
                @dragend.stop="favoriteReorder.onDragEnd"
                @keydown.up.prevent.stop="moveFavorite(repository.id, -1, $event)"
                @keydown.down.prevent.stop="moveFavorite(repository.id, 1, $event)"
              >
                <IconGripVertical aria-hidden="true" />
              </button>
              <button
                type="button"
                :title="repositoryDisplayName(repository)"
                :aria-pressed="workBacklog.selectedRepositoryId === repository.id"
                @click="selectRepository(repository.id)"
              >
                <IconFolder class="cockpit-view__repository-folder" aria-hidden="true" />
                <span>{{ repositoryDisplayName(repository) }}</span>
              </button>
              <button
                class="cockpit-view__repository-favorite"
                type="button"
                :aria-label="$t(isFavorite(repository.id) ? 'backlogFavorites.remove' : 'backlogFavorites.add', { repository: repositoryDisplayName(repository) })"
                :title="$t(isFavorite(repository.id) ? 'backlogFavorites.remove' : 'backlogFavorites.add', { repository: repositoryDisplayName(repository) })"
                @click.stop="toggleFavorite(repository.id, $event)"
              >
                <component :is="isFavorite(repository.id) ? IconStarFilled : IconStar" aria-hidden="true" />
              </button>
              <a
                class="cockpit-view__repository-link"
                :href="repository.url"
                target="_blank"
                rel="noreferrer"
                :aria-label="$t(!workProviderDefinition(workProvider ?? 'github').repositoryBacked ? 'backlogSource.openSource' : 'dynamic.cockpit.openRepository', { repository: repositoryDisplayName(repository) })"
                :title="$t(!workProviderDefinition(workProvider ?? 'github').repositoryBacked ? 'backlogSource.openSource' : 'dynamic.cockpit.openRepository', { repository: repositoryDisplayName(repository) })"
                @click.stop
              >
                <ExternalLinkIcon aria-hidden="true" />
              </a>
            </div>
          </template>
        </div>

      </nav>
    </aside>

    <div class="cockpit-view__workspace">
      <header v-if="workBacklog" class="cockpit-view__header">
        <div class="cockpit-view__frame">
          <div class="cockpit-view__shortcuts" :aria-label="$t('backlogShortcuts.label')">
            <button
              v-for="shortcut in shortcuts"
              :key="shortcut.id"
              type="button"
              :aria-pressed="activeShortcut === shortcut.id"
              :aria-label="`${shortcut.title}: ${shortcut.subtitle}`"
              @click="selectShortcut(shortcut.id)"
            >
              <BacklogShortcutIcon :kind="shortcut.icon" />
              <span class="cockpit-view__shortcut-copy">
                <strong>{{ shortcut.title }}</strong>
                <span>{{ shortcut.subtitle }}</span>
              </span>
            </button>
          </div>
        </div>
      </header>

      <CockpitWorkInbox
        v-if="workBacklog"
        :key="`${workProvider}:${workBacklog.selectedRepositoryId}`"
        :agents="agents"
        :active-view="activeWorkView"
        :assignments="workBacklog.assignments"
        :connection="workBacklog.connection"
        :error="workBacklog.error"
        :global-scope="workBacklog.globalScope"
        :items="workBacklog.items"
        :page="workBacklog.page"
        :page-loading="workBacklog.pageLoading"
        :page-size="workBacklog.pageSize"
        :has-next-page="workBacklog.hasNextPage"
        :repositories="workBacklog.repositories"
        :repository-icons="repositoryIcons"
        :search-query="searchQuery"
        :selected-assignee-login="workBacklog.selectedAssigneeLogin ?? null"
        :selected-repository-id="workBacklog.selectedRepositoryId"
        :selected-tag-name="workBacklog.selectedTagName ?? null"
        :teams="teams"
        :remote-connections="remoteConnections"
        :default-team-id="defaultTeamId"
        :start-work-action="startWorkItemsAction"
        :list-source-repositories="listSourceRepositories"
        :status="workBacklog.status"
        v-model:kind-filter="kindFilter"
        :total-items="workBacklog.totalItems"
        @change-page="emit('change-work-items-page', $event)"
        @refresh="emit('refresh-work-items', $event)"
        @select-global-scope="emit('select-global-scope', $event)"
        @select-assignee="emit('select-work-assignee', $event)"
        @select-assigned-agent="selectAssignedAgent"
        @select-repository="emit('select-work-repository', $event)"
        @select-tag="emit('select-work-tag', $event)"
        @update-active-view="selectWorkView"
        @update-search-query="searchQuery = $event"
      />

      <div v-else class="cockpit-view__empty"> {{ $t('surface.cockpitView.connectAWorkProviderToBuildYourOperatorInbox') }} </div>
    </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { workProviderDefinition } from '@workspace/core/work-providers';
import { translate } from '../i18n';
import { computed, nextTick, ref, watch } from 'vue';
import { IconClockHour8, IconFolder, IconGripVertical, IconSearch, IconSortAZ, IconStar, IconStarFilled } from '@tabler/icons-vue';
import type { Agent, Team, WorkBacklogAssignment, WorkIntegrationConnection, WorkItem, WorkSource } from '@workspace/core/contracts';
import type { BacklogScope } from './use-cockpit-backlog';
import { useListReorderDrag } from '../shared/use-list-reorder-drag';
import { ExternalLinkIcon } from '../shared/icons/app-icons';
import BacklogShortcutIcon from './BacklogShortcutIcon.vue';
import CockpitWorkInbox from './CockpitWorkInbox.vue';
import BacklogSourceSelector from './BacklogSourceSelector.vue';
import AppMenuChip from '../shared/menu/AppMenuChip.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import WorkspaceHeader from '../shared/WorkspaceHeader.vue';
import type { StartWorkItemsInput } from './use-work-item-routing';

type CockpitWorkBacklog = {
  assignments: Record<string, WorkBacklogAssignment>;
  connection: WorkIntegrationConnection;
  error: string | null;
  globalScope: BacklogScope | null;
  items: WorkItem[];
  page?: number;
  pageLoading?: boolean;
  pageSize?: number;
  repositories: WorkSource[];
  selectedAssigneeLogin?: string | null;
  selectedRepositoryId: string | null;
  selectedTagName?: string | null;
  status: 'notLoaded' | 'loading' | 'loaded' | 'error';
  totalItems?: number;
  hasNextPage?: boolean;
};

type WorkItemAssignmentIntent = { item: WorkItem; teamId?: string };
type InboxView = 'all' | 'backlog' | 'wip' | 'focus';
type RepositorySortMode = 'recent' | 'alphabetical';

const props = defineProps<{
  workProvider?: import('@workspace/core/contracts').WorkProviderKind;
  workProviders?: import('@workspace/core/contracts').WorkProviderKind[];
  agents: Agent[];
  repositoryIcons?: Record<string, string>;
  repositoryFavorites?: readonly string[];
  saveRepositoryFavorites: (repositoryIds: string[]) => Promise<void>;
  teams: Team[];
  remoteConnections?: import('@workspace/core/contracts').RemoteConnection[];
  defaultTeamId?: string | null;
  listSourceRepositories?: (remoteConnectionId?: string) => Promise<import('@workspace/core/contracts').SourceRepository[]>;
  startWorkItemsAction: (input: StartWorkItemsInput) => Promise<void>;
  workBacklog?: CockpitWorkBacklog | null;
}>();

const repositoryIcons = computed(() => props.repositoryIcons ?? {});

const startWorkItemsAction = props.startWorkItemsAction;

const emit = defineEmits<{
  'select-work-provider': [provider: import('@workspace/core/contracts').WorkProviderKind];
  'assign-work-item-to-new-agent': [intent: WorkItemAssignmentIntent];
  'assign-work-item': [payload: { agentId: string; item: WorkItem }];
  'refresh-work-items': [repositoryId: string | null];
  'change-work-items-page': [page: number];
  'select-global-scope': [scope: BacklogScope];
  'select-work-repository': [repositoryId: string | null];
  'select-work-assignee': [assigneeLogin: string | null];
  'select-work-tag': [tagName: string | null];
  'select-agent': [payload: { agentId: string; teamId: string }];
}>();

const agentsById = computed(() => new Map(props.agents.map((agent) => [agent.id, agent])));
const searchQuery = ref('');
const repositoryFilter = ref('');
const pendingFavorites = ref<string[] | null>(null);
const favoritesSaveFailed = ref(false);
let favoritesSaveRevision = 0;
const favoriteIds = computed(() => pendingFavorites.value ?? props.repositoryFavorites ?? []);
watch(() => props.workProvider, () => {
  favoritesSaveRevision++;
  pendingFavorites.value = null;
  favoritesSaveFailed.value = false;
  favoriteReorder.onDragEnd();
});
const activeWorkView = ref<InboxView>('focus');
const kindFilter = ref<Array<'issue' | 'pullRequest'>>([]);
watch(() => `${props.workProvider}:${props.workBacklog?.selectedRepositoryId}`, () => {
  searchQuery.value = '';
  repositoryFilter.value = '';
  if (props.workBacklog?.selectedRepositoryId) kindFilter.value = [];
});
const repositorySortMode = ref<RepositorySortMode>('recent');
const repositorySortMenuItems = computed<AppMenuItem[]>(() => [
  { id: 'recent', type: 'radio', checked: repositorySortMode.value === 'recent', label: translate('surface.cockpitView.recentActivity'), icon: IconClockHour8 },
  { id: 'alphabetical', type: 'radio', checked: repositorySortMode.value === 'alphabetical', label: translate('surface.cockpitView.alphabetical'), icon: IconSortAZ },
]);
const repositorySortLabel = computed(() => repositorySortMode.value === 'recent' ? translate('surface.cockpitView.recent') : 'A–Z');
const repositorySortDescription = computed(() => repositorySortMode.value === 'recent' ? 'recent activity' : 'name');
const sortedRepositories = computed(() => [...(props.workBacklog?.repositories ?? [])].sort((left, right) => {
  if (repositorySortMode.value === 'alphabetical') {
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
  }
  const activity = repositoryActivityAt(right).localeCompare(repositoryActivityAt(left));
  return activity || (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '') || left.name.localeCompare(right.name);
}));
const filteredRepositories = computed(() => {
  const query = repositoryFilter.value.trim().toLocaleLowerCase();
  if (!query) return sortedRepositories.value;
  return sortedRepositories.value.filter((repository) => (
    `${repository.owner}/${repository.name}`.toLocaleLowerCase().includes(query)
  ));
});
const favoriteRepositories = computed(() => {
  const repositories = new Map(filteredRepositories.value.map(repository => [repository.id, repository]));
  return favoriteIds.value.flatMap(id => repositories.has(id) ? [repositories.get(id)!] : []);
});
const regularRepositories = computed(() => filteredRepositories.value.filter(repository => !favoriteRepositories.value.some(favorite => favorite.id === repository.id)));
const displayedRepositories = computed(() => [...favoriteRepositories.value, ...regularRepositories.value]);

function isFavorite(id: string): boolean { return favoriteIds.value.includes(id); }
const favoriteReorder = useListReorderDrag({
  itemIds: () => favoriteIds.value,
  onDrop: ({ draggedId, beforeId }) => reorderFavorite(draggedId, beforeId),
});

async function commitFavorites(ids: string[], control?: EventTarget | null): Promise<void> {
  const revision = ++favoritesSaveRevision;
  const hadFocus = control === document.activeElement;
  const restoreFocus = () => {
    if (revision === favoritesSaveRevision && hadFocus && control instanceof HTMLElement && control.isConnected
      && (document.activeElement === document.body || document.activeElement === control)) {
      control.focus({ preventScroll: true });
    }
  };
  pendingFavorites.value = ids;
  favoritesSaveFailed.value = false;
  void nextTick().then(restoreFocus);
  try {
    await props.saveRepositoryFavorites([...ids]);
  } catch {
    if (revision === favoritesSaveRevision) favoritesSaveFailed.value = true;
  } finally {
    await nextTick();
    if (revision === favoritesSaveRevision) {
      pendingFavorites.value = null;
      await nextTick();
      restoreFocus();
    }
  }
}

function toggleFavorite(id: string, event: MouseEvent): void {
  void commitFavorites(isFavorite(id) ? favoriteIds.value.filter(candidate => candidate !== id) : [...favoriteIds.value, id], event.detail === 0 ? event.currentTarget : undefined);
}

function reorderFavorite(id: string, beforeId: string | null): void {
  const next = favoriteIds.value.filter(candidate => candidate !== id);
  const index = beforeId === null ? next.length : next.indexOf(beforeId);
  next.splice(index < 0 ? next.length : index, 0, id);
  commitFavorites(next);
}

function moveFavorite(id: string, offset: -1 | 1, event: KeyboardEvent): void {
  const next = [...favoriteIds.value];
  const index = next.indexOf(id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= next.length) return;
  next.splice(index, 1);
  next.splice(target, 0, id);
  void commitFavorites(next, event.currentTarget);
}

const shortcuts = computed(() => [
  { id: 'myIssues' as const, title: translate('surface.cockpitWorkInbox.issues'), subtitle: translate('backlogShortcuts.assignedToMe'), icon: 'issue' as const },
  ...(workProviderDefinition(props.workProvider ?? 'github').pullRequests ? [
    { id: 'reviewRequests' as const, title: translate(props.workProvider === 'gitlab' ? 'gitlabBacklog.mergeRequests' : 'surface.cockpitWorkInbox.pullRequests'), subtitle: translate('backlogShortcuts.awaitingMyReview'), icon: 'review' as const },
    { id: 'myPullRequests' as const, title: translate(props.workProvider === 'gitlab' ? 'gitlabBacklog.mergeRequests' : 'surface.cockpitWorkInbox.pullRequests'), subtitle: translate('backlogShortcuts.createdByMe'), icon: 'pullRequest' as const },
    { id: 'ownedWork' as const, title: translate('backlogShortcuts.work'), subtitle: translate(props.workProvider === 'gitlab' ? 'backlogShortcuts.inMyProjects' : 'backlogShortcuts.inMyRepositories'), icon: 'repository' as const },
  ] : []),
  workProviderDefinition(props.workProvider ?? 'github').repositoryBacked
    ? { id: 'outsideWork' as const, title: translate('backlogShortcuts.work'), subtitle: translate(props.workProvider === 'gitlab' ? 'backlogShortcuts.outsideMyProjects' : 'backlogShortcuts.outsideMyRepositories'), icon: 'all' as const }
    : { id: 'all' as const, title: translate('backlogShortcuts.allWork'), subtitle: translate('backlogShortcuts.acrossSources'), icon: 'all' as const },
]);
const activeShortcut = computed(() => {
  const backlog = props.workBacklog;
  if (!backlog || backlog.selectedRepositoryId || backlog.selectedAssigneeLogin || backlog.selectedTagName || searchQuery.value || activeWorkView.value !== 'all') return null;
  const scope = backlog.globalScope;
  const kind = scope === 'myIssues' ? 'issue' : scope === 'myPullRequests' || scope === 'reviewRequests' ? 'pullRequest' : null;
  if (kind) return kindFilter.value.length === 1 && kindFilter.value[0] === kind ? scope : null;
  return kindFilter.value.length === 0 ? scope : null;
});
let pendingShortcut: BacklogScope | null = null;
watch(() => props.workBacklog?.globalScope, scope => {
  if (scope && scope === pendingShortcut) { applyShortcut(scope); pendingShortcut = null; }
});
function selectShortcut(scope: BacklogScope): void {
  pendingShortcut = scope;
  if (scope === props.workBacklog?.globalScope) applyShortcut(scope);
  emit('select-global-scope', scope);
}
function applyShortcut(scope: BacklogScope): void {
  activeWorkView.value = 'all';
  searchQuery.value = '';
  kindFilter.value = scope === 'myIssues' ? ['issue'] : scope === 'myPullRequests' || scope === 'reviewRequests' ? ['pullRequest'] : [];
}

function selectAssignedAgent(agentId: string): void {
  const agent = agentsById.value.get(agentId);
  if (agent?.teamId) emit('select-agent', { agentId, teamId: agent.teamId });
}

function selectRepository(repositoryId: string | null): void {
  emit('select-work-repository', repositoryId);
}

function selectRepositorySortMode(mode: RepositorySortMode): void {
  repositorySortMode.value = mode;
}

function repositoryActivityAt(repository: WorkSource): string {
  return repository.workItemsUpdatedAt ?? '';
}

function repositoryDisplayName(repository: WorkSource): string {
  return repository.provider === 'gitlab' ? repository.fullName : repository.name;
}

function selectWorkView(view: InboxView): void {
  activeWorkView.value = view;

}
</script>

<style scoped>
.cockpit-view {
  min-height: 0;
  flex: 1 1 auto;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  color: var(--color-text);
  background: var(--color-shell-main);
}

.cockpit-view__app-header {
  padding-inline: var(--space-20);
  font-size: var(--font-size-16);
}

.cockpit-view__body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.cockpit-view__navigation {
  user-select: none;
  width: 320px;
  min-height: 0;
  flex: 0 0 320px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: var(--space-8) var(--space-12) var(--space-16);
  border-right: 1px solid var(--color-border);
  background: var(--color-shell-sidebar);
}

.cockpit-view__provider {
  margin: 0 var(--space-6);
}

.cockpit-view__repository-filter {
  height: 30px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-6);
  margin: calc(-1 * var(--space-2)) var(--space-6) 0;
  padding: 0 var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}

.cockpit-view__repository-filter svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  color: var(--color-text-muted);
}

.cockpit-view__repository-filter input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  color: var(--color-text);
  background: transparent;
  font: inherit;
  font-size: var(--font-size-13);
  line-height: var(--line-height-20);
}

.cockpit-view__repository-filter:focus-within {
  border-color: color-mix(
    in srgb,
    var(--color-primary) 55%,
    var(--color-border)
  );
}

.cockpit-view__navigation nav {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.cockpit-view__navigation-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-6);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-20);
}

.cockpit-view__repositories {
  min-height: 0;
  flex: 1;
  display: grid;
  align-content: start;
  gap: var(--space-2);
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 0 var(--space-2);
  padding-bottom: var(--space-6);
}

.cockpit-view__repositories-empty {
  margin: var(--space-8) var(--space-6);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.cockpit-view__favorites-error {
  margin: var(--space-4) var(--space-8);
  color: var(--color-error);
  font-size: var(--font-size-12);
}

.cockpit-view__repositories > div {
  position: relative;
  min-width: 0;
  min-height: 36px;
  display: flex;
  align-items: center;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
}

.cockpit-view__repositories > div > button[aria-pressed] {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-6);
  overflow: hidden;
  border: 0;
  border-radius: var(--radius-md);
  padding: var(--space-4) var(--space-6);
  color: var(--color-text);
  background: transparent;
  font: inherit;
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-20);
  text-align: left;
  cursor: pointer;
}

.cockpit-view__repositories > div > button[aria-pressed] svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  color: var(--color-text-muted);
}

.cockpit-view__repositories > div > button[aria-pressed] span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cockpit-view__repositories > div:hover,
.cockpit-view__repositories > div:has(:focus-visible),
.cockpit-view__repositories > div:has(button[aria-pressed="true"]) {
  color: var(--color-text);
  background: var(--color-surface-low);
}

.cockpit-view__repositories > div:has(button[aria-pressed="true"]) {
  border-color: color-mix(in srgb, var(--color-primary) 35%, transparent);
  background: var(--color-primary-container);
}

.cockpit-view__repositories > div > button[aria-pressed="true"] {
  color: var(--color-primary);
  font-weight: var(--font-weight-semibold);
}

.cockpit-view__repositories > div > button[aria-pressed="true"] svg {
  color: var(--color-primary);
}

.cockpit-view__favorites-heading {
  margin: var(--space-6) var(--space-6) var(--space-2);
}

.cockpit-view__repository-reorder,
.cockpit-view__repository-favorite,
.cockpit-view__repository-link {
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  display: grid;
  place-items: center;
  margin-right: var(--space-3);
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  opacity: 0;
}

.cockpit-view__repository-reorder,
.cockpit-view__repository-favorite {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.cockpit-view__repository-reorder {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: calc(var(--space-6) + (var(--icon-sm) - 26px) / 2);
  margin-right: 0;
  transform: translateY(-50%);
  pointer-events: none;
  cursor: grab;
}
.cockpit-view__repository-reorder:active { cursor: grabbing; }

.cockpit-view__repositories > div:hover:has(.cockpit-view__repository-reorder) .cockpit-view__repository-folder,
.cockpit-view__repositories > div:has(.cockpit-view__repository-reorder):has(:focus-visible) .cockpit-view__repository-folder {
  opacity: 0;
}

.cockpit-view__repositories > div:hover .cockpit-view__repository-reorder,
.cockpit-view__repositories > div:has(:focus-visible) .cockpit-view__repository-reorder {
  pointer-events: auto;
}

.cockpit-view__repositories > div:hover .cockpit-view__repository-reorder,
.cockpit-view__repositories > div:has(:focus-visible) .cockpit-view__repository-reorder,
.cockpit-view__repositories > div:hover .cockpit-view__repository-favorite,
.cockpit-view__repositories > div:has(:focus-visible) .cockpit-view__repository-favorite,
.cockpit-view__repositories > div:hover .cockpit-view__repository-link,
.cockpit-view__repositories > div:has(:focus-visible) .cockpit-view__repository-link {
  opacity: 1;
}

.cockpit-view__repository-reorder:hover,
.cockpit-view__repository-reorder:focus-visible,
.cockpit-view__repository-favorite:hover,
.cockpit-view__repository-favorite:focus-visible,
.cockpit-view__repository-link:hover,
.cockpit-view__repository-link:focus-visible {
  color: var(--color-primary);
  background: var(--color-primary-container);
}

.cockpit-view__repositories > div button:focus-visible,
.cockpit-view__repository-link:focus-visible {
  outline: none;
}

.cockpit-view__repository-reorder svg,
.cockpit-view__repository-favorite svg,
.cockpit-view__repository-link svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.cockpit-view__repositories > div.list-reorder-drag--dragging { opacity: 0.45; }

.cockpit-view__repositories > div.list-reorder-drag--drop-before::before,
.cockpit-view__repositories > div.list-reorder-drag--drop-after::after {
  position: absolute;
  right: var(--space-6);
  left: var(--space-6);
  height: 2px;
  background: var(--color-primary);
  content: '';
}

.cockpit-view__repositories > div.list-reorder-drag--drop-before::before { top: -2px; }
.cockpit-view__repositories > div.list-reorder-drag--drop-after::after { bottom: -2px; }

.cockpit-view__workspace {
  min-width: 0;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cockpit-view__frame {
  width: min(100%, 1440px);
  margin: 0 auto;
}

.cockpit-view__header {
  box-sizing: border-box;
  display: flex;
  padding: var(--space-8) var(--space-16);
  border-bottom: 1px solid var(--color-border);
  -webkit-app-region: drag;
}

.cockpit-view__header .cockpit-view__frame {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.cockpit-view__empty {
  margin: auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.cockpit-view__shortcuts {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--space-6);
  padding-block: var(--space-4);
}

.cockpit-view__shortcuts button {
  min-height: 72px;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  border: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
  border-radius: var(--radius-xl);
  padding: var(--space-8);
  color: var(--color-text);
  background: var(--color-shell-main);
  font: inherit;
  font-size: var(--font-size-16);
  font-weight: var(--font-weight-medium);
  text-align: left;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.cockpit-view__shortcut-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.cockpit-view__shortcut-copy strong {
  font-size: var(--font-size-16);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-20);
}

.cockpit-view__shortcut-copy > span {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-regular);
  line-height: var(--line-height-16);
}

.cockpit-view__shortcuts button[aria-pressed="true"] .cockpit-view__shortcut-copy > span {
  color: var(--color-primary);
}

.cockpit-view__shortcuts button:hover {
  border-color: var(--color-border-strong);
  background: var(--color-surface-low);
}

.cockpit-view__shortcuts button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.cockpit-view__shortcuts button[aria-pressed="true"] {
  border-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 6%, var(--color-shell-main));
}

@media (max-width: 1200px) {
  .cockpit-view__shortcuts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cockpit-view__shortcuts:has(button:nth-child(5)) button:last-child { grid-column: 1 / -1; }
}

@media (max-width: 1050px) {
  .cockpit-view__navigation {
    width: 204px;
    flex-basis: 204px;
  }
}

@media (max-width: 820px) {
  .cockpit-view__navigation {
    display: none;
  }
}
</style>
