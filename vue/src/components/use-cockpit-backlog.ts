import type {
  AppSnapshot,
  GlobalWorkItemQuery,
  WorkBacklogConfigurationInput,
  WorkItem,
  WorkItemPage,
  WorkSource,
  WorkProviderKind,
} from '@workspace/core/contracts';
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useBacklogProviders } from './backlog-providers';
import { isWorkProviderKind, workProviderDefinition } from '@workspace/core/work-providers';

type CockpitBacklogConfiguration = {
  assigneeLogin: string | null;
  sourceId: string | null;
  tagName: string | null;
};
type GlobalScope = 'assignedToMe' | 'all';
type GlobalFeed = {
  error: string | null;
  page: number;
  pages: Record<number, WorkItem[]>;
  cursors: Record<number, string>;
  pageSize: number;
  pendingPage: number | null;
  status: 'notLoaded' | 'loading' | 'loaded' | 'error';
  totalItems?: number;
};

const globalPageSize = 25;

export function useCockpitBacklog(options: {
  configure: (input: WorkBacklogConfigurationInput) => Promise<void>;
  confirmLoadAll: () => Promise<boolean>;
  getSnapshot: () => AppSnapshot;
  getWorkBacklogError: (provider: WorkProviderKind) => string | null;
  getWorkBacklogStatus: (provider: WorkProviderKind) => 'notLoaded' | 'loading' | 'loaded' | 'error';
  getWorkItemsByRepository: () => Record<string, WorkItem[]>;
  getWorkRepositories: (provider: WorkProviderKind) => WorkSource[];
  loadGlobalWorkItems: (query: GlobalWorkItemQuery, provider: WorkProviderKind) => Promise<WorkItemPage>;
  loadWorkItems: (sourceId: string, provider: WorkProviderKind) => Promise<void>;
  loadWorkRepositories: (provider: WorkProviderKind) => Promise<void>;
}) {
  const { provider, providers } = useBacklogProviders(() => options.getSnapshot().workBacklog.connections, rememberedProvider());
  let initialized = false;
  let contextRevision = 0;
  const pendingConfiguration = ref<CockpitBacklogConfiguration | null>(null);
  const globalScope = ref<GlobalScope | null>(null);
  const feeds = reactive<Record<GlobalScope, GlobalFeed>>({
    assignedToMe: emptyFeed(),
    all: emptyFeed(),
  });

  const savedConfiguration = computed<CockpitBacklogConfiguration>(() => {
    const configuration = options.getSnapshot().workBacklog.providerConfigurations[provider.value] ?? {};
    return normalize({
      sourceId: configuration.sourceId ?? null,
      assigneeLogin: configuration.assigneeLogin ?? null,
      tagName: configuration.tagName ?? null,
    });
  });
  const effectiveConfiguration = computed(() => pendingConfiguration.value ?? savedConfiguration.value);
  const workBacklog = computed(() => {
    const snapshot = options.getSnapshot();
    const connection = snapshot.workBacklog.connections.find((candidate) => candidate.provider === provider.value);
    if (!connection || connection.status !== 'connected') return null;
    const configuration = effectiveConfiguration.value;
    const selectedRepositoryId = configuration.sourceId;
    const feed = globalScope.value ? feeds[globalScope.value] : null;
    const items = selectedRepositoryId
      ? options.getWorkItemsByRepository()[`${provider.value}:${selectedRepositoryId}`] ?? []
      : feed?.pages[feed.page] ?? [];
    return {
      assignments: snapshot.workBacklog.assignments,
      connection,
      globalScope: globalScope.value,
      page: feed?.page ?? 1,
      pageSize: feed?.pageSize ?? items.length,
      hasNextPage: Boolean(feed?.cursors[feed.page + 1]),
      pageLoading: feed?.pendingPage !== null,
      repositories: options.getWorkRepositories(provider.value),
      selectedAssigneeLogin: configuration.assigneeLogin,
      selectedRepositoryId,
      selectedTagName: configuration.tagName,
      items,
      status: selectedRepositoryId ? options.getWorkBacklogStatus(provider.value) : feed?.status ?? options.getWorkBacklogStatus(provider.value),
      error: feed ? feed.error : options.getWorkBacklogError(provider.value),
      totalItems: feed ? feed.totalItems : items.length,
    };
  });

  watch(savedConfiguration, (configuration) => {
    if (pendingConfiguration.value && sameConfiguration(pendingConfiguration.value, configuration)) {
      pendingConfiguration.value = null;
    }
  });

  async function initialize(): Promise<void> {
    initialized = true;
    if (!providers.value.includes(provider.value)) return;
    const revision = contextRevision;
    globalScope.value = null;
    if (options.getWorkRepositories(provider.value).length === 0) {
      await options.loadWorkRepositories(provider.value);
      await nextTick();
    }
    if (revision !== contextRevision) return;
    const saved = savedConfiguration.value;
    const rememberedSource = readRememberedSource(provider.value);
    if (rememberedSource && saved.sourceId === rememberedSource && options.getWorkRepositories(provider.value).some(source => source.id === rememberedSource)) {
      pendingConfiguration.value = null;
      await options.loadWorkItems(rememberedSource, provider.value);
      return;
    }
    const firstSource = options.getWorkRepositories(provider.value)[0];
    if (workProviderDefinition(provider.value).initialView === 'source' && firstSource) {
      await selectRepository(firstSource.id);
      return;
    }
    pendingConfiguration.value = { sourceId: null, assigneeLogin: null, tagName: null };
    const scope = rememberedGlobalScope(provider.value) === 'all' ? 'all' : 'assignedToMe';
    globalScope.value = scope;
    await ensureGlobalItems(scope);
  }

  async function selectRepository(sourceId: string | null): Promise<void> {
    const selectedProvider = provider.value;
    const revision = ++contextRevision;
    feeds.all = emptyFeed();
    feeds.assignedToMe = emptyFeed();
    globalScope.value = sourceId ? null : 'assignedToMe';
    rememberSource(selectedProvider, sourceId);
    await configure({ sourceId, assigneeLogin: null, tagName: null });
    if (revision !== contextRevision) return;
    if (sourceId) await options.loadWorkItems(sourceId, selectedProvider);
    else await ensureGlobalItems('assignedToMe');
  }

  async function selectAssignee(assigneeLogin: string | null): Promise<void> {
    if (globalScope.value === 'assignedToMe' && !assigneeLogin) {
      globalScope.value = 'all';
      await ensureGlobalItems('all');
    }
    await configure({
      sourceId: workBacklog.value?.selectedRepositoryId ?? null,
      assigneeLogin,
      tagName: workBacklog.value?.selectedTagName ?? null,
    });
  }

  async function selectTag(tagName: string | null): Promise<void> {
    await configure({
      sourceId: workBacklog.value?.selectedRepositoryId ?? null,
      assigneeLogin: workBacklog.value?.selectedAssigneeLogin ?? null,
      tagName,
    });
  }

  async function refresh(sourceId: string | null): Promise<void> {
    if (options.getWorkRepositories(provider.value).length === 0) await options.loadWorkRepositories(provider.value);
    if (sourceId) await options.loadWorkItems(sourceId, provider.value);
    else if (globalScope.value) await loadGlobalItems(globalScope.value, 1, true);
  }

  async function selectGlobalScope(scope: GlobalScope): Promise<void> {
    const revision = contextRevision;
    if (scope === 'all' && !await options.confirmLoadAll()) return;
    if (revision !== contextRevision) return;
    rememberSource(provider.value, null);
    await configure({ sourceId: null, assigneeLogin: null, tagName: null });
    if (revision !== contextRevision) return;
    globalScope.value = scope;
    if (scope === 'all') rememberGlobalScope(provider.value);
    await ensureGlobalItems(scope);
  }

  async function changePage(page: number): Promise<void> {
    const scope = globalScope.value;
    if (!scope) return;
    const feed = feeds[scope];
    if (!Number.isInteger(page) || page < 1 || page === feed.page || (page > 1 && !feed.cursors[page])) return;
    await loadGlobalItems(scope, page);
  }

  async function configure(configuration: CockpitBacklogConfiguration): Promise<void> {
    const normalized = normalize(configuration);
    pendingConfiguration.value = normalized;
    try {
      await options.configure({ provider: provider.value, configuration: normalized });
    } catch (error) {
      if (pendingConfiguration.value && sameConfiguration(pendingConfiguration.value, normalized)) {
        pendingConfiguration.value = null;
      }
      throw error;
    }
  }

  async function ensureGlobalItems(scope: GlobalScope): Promise<void> {
    if (feeds[scope].status === 'notLoaded') await loadGlobalItems(scope, 1);
  }

  async function loadGlobalItems(scope: GlobalScope, page: number, force = false): Promise<void> {
    const feed = feeds[scope];
    if (feed.pendingPage !== null) return;
    if (!force && feed.pages[page]) {
      feed.page = page;
      feed.error = null;
      return;
    }
    feed.pendingPage = page;
    if (force) {
      feed.pages = {};
      feed.cursors = {};
      feed.totalItems = undefined;
    }
    if (Object.keys(feed.pages).length === 0) feed.status = 'loading';
    feed.error = null;
    const revision = contextRevision;
    try {
      const result = await options.loadGlobalWorkItems({
        assignment: scope === 'assignedToMe' ? 'viewer' : 'all',
        state: 'open',
        ...(page > 1 ? { cursor: feed.cursors[page] } : {}),
        pageSize: globalPageSize,
      }, provider.value);
      if (revision !== contextRevision) return;
      feed.pages[page] = result.items;
      feed.page = page;
      if (result.nextCursor) feed.cursors[page + 1] = result.nextCursor;
      else delete feed.cursors[page + 1];
      feed.totalItems = result.totalItems;
      feed.status = 'loaded';
    } catch (error) {
      if (revision !== contextRevision) return;
      feed.error = error instanceof Error ? error.message : String(error);
      if (Object.keys(feed.pages).length === 0) feed.status = 'error';
    } finally {
      feed.pendingPage = null;
    }
  }

  watch([provider, () => providers.value.length > 0], async () => {
      ++contextRevision;
      try { window.localStorage.setItem('cockpitBacklogProvider', provider.value); } catch { /* Optional renderer preference. */ }
      pendingConfiguration.value = null;
      feeds.all = emptyFeed();
      feeds.assignedToMe = emptyFeed();
      if (initialized) await initialize();
  });

  return {
    provider,
    providers,
    async selectProvider(next: WorkProviderKind): Promise<void> {
      provider.value = next;
      await nextTick();
    },
    changePage,
    initialize,
    refresh,
    selectAssignee,
    selectGlobalScope,
    selectRepository,
    selectTag,
    workBacklog,
  };
}

function emptyFeed(): GlobalFeed {
  return {
    error: null,
    page: 1,
    pages: {},
    cursors: {},
    pageSize: globalPageSize,
    pendingPage: null,
    status: 'notLoaded',
  };
}

function normalize(configuration: CockpitBacklogConfiguration): CockpitBacklogConfiguration {
  return {
    sourceId: normalizedOptionalString(configuration.sourceId),
    assigneeLogin: normalizedOptionalString(configuration.assigneeLogin),
    tagName: normalizedOptionalString(configuration.tagName),
  };
}

function sameConfiguration(left: CockpitBacklogConfiguration, right: CockpitBacklogConfiguration): boolean {
  return left.sourceId === right.sourceId &&
    left.assigneeLogin === right.assigneeLogin &&
    left.tagName === right.tagName;
}

function normalizedOptionalString(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function rememberedProvider(): WorkProviderKind {
  try {
    const saved = window.localStorage.getItem('cockpitBacklogProvider');
    return isWorkProviderKind(saved) ? saved : 'github';
  } catch { return 'github'; }
}

function rememberedGlobalScope(provider: WorkProviderKind): 'all' | null {
  try {
    return window.localStorage.getItem(`cockpitGlobalScope:${provider}`) === 'all' ? 'all' : null;
  } catch {
    return null;
  }
}

function rememberGlobalScope(provider: WorkProviderKind): void {
  try {
    window.localStorage.setItem(`cockpitGlobalScope:${provider}`, 'all');
  } catch {
    // Persistence can be unavailable in hardened renderer contexts.
  }
}

function readRememberedSource(provider: WorkProviderKind): string | null {
  try { return window.localStorage.getItem(`cockpitBacklogSource:${provider}`); } catch { return null; }
}
function rememberSource(provider: WorkProviderKind, id: string | null): void {
  try {
    if (id) window.localStorage.setItem(`cockpitBacklogSource:${provider}`, id);
    else window.localStorage.removeItem(`cockpitBacklogSource:${provider}`);
  } catch { /* Optional renderer preference. */ }
}
