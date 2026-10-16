import { ref } from 'vue';
import type {
  AppSnapshot,
  AutomationLocation,
  GlobalWorkItemQuery,
  WorkBacklogConfigurationInput,
  WorkItem,
  WorkItemPage,
  WorkItemQuery,
  WorkProviderAuthorization,
  WorkProviderKind,
  WorkSource,
} from '@workspace/core/contracts';
import { localizedText } from './i18n/errors';
import { translate } from './i18n';
import { isFirstRunOnboardingActive } from './onboarding-session';
import { appPlatformActions, appApi } from './platform-api';
import { useConfetti } from './shared/confetti/use-confetti';

type WorkProviderStateOptions = {
  adoptSnapshot: (snapshot: AppSnapshot) => void;
  getSnapshot: () => AppSnapshot;
};

const authorizationPollMs = 5_000;

/** Owns provider authorization, polling, repository catalogs, and backlog state. */
export function createWorkProviderState(options: WorkProviderStateOptions) {
  const authorization = ref<WorkProviderAuthorization | null>(null);
  const authorizations = ref<Partial<Record<WorkProviderKind, WorkProviderAuthorization>>>({});
  const repositoriesByProvider = ref<Partial<Record<WorkProviderKind, WorkSource[]>>>({});
  const itemsByRepository = ref<Record<string, WorkItem[]>>({});
  const assignedItemsByProvider = ref<Partial<Record<WorkProviderKind, WorkItem[]>>>({});
  const status = ref<'notLoaded' | 'loading' | 'loaded' | 'error'>('notLoaded');
  const error = ref<string | null>(null);
  const authorizationPollTimers = new Map<WorkProviderKind, ReturnType<typeof globalThis.setTimeout>>();
  const authorizationRevisions = new Map<WorkProviderKind, number>();
  const catalogRevisions = new Map<WorkProviderKind, number>();
  const itemRevisions = new Map<string, number>();

  async function connect(provider: WorkProviderKind): Promise<void> {
    if (!appApi?.connectWorkProvider) return;
    const revision = (authorizationRevisions.get(provider) ?? 0) + 1;
    authorizationRevisions.set(provider, revision);
    status.value = 'loading';
    error.value = null;
    try {
      const result = await appApi.connectWorkProvider(provider);
      if (revision !== authorizationRevisions.get(provider)) return;
      options.adoptSnapshot(result.snapshot);
      setAuthorization(provider, result.authorization ?? null);
      if (result.authorization) scheduleAuthorizationPoll(provider);
      else clearAuthorizationPoll(provider);
      const current = result.snapshot.workBacklog.connections.find(value => value.provider === provider);
      // A failed direct connect leaves GitHub CLI access connected and reports why in detail.
      const cliFallbackFailed = current?.source === 'cli' && current.status === 'connected' && !result.authorization && current.detail;
      if (current?.status === 'notConfigured' || current?.status === 'error' || cliFallbackFailed) {
        status.value = 'error';
        error.value = localizedText(current?.detail, translate);
        return;
      }
      if (result.authorization?.flow === 'browser') {
        await appPlatformActions.openExternal?.(result.authorization.verificationUri);
        if (revision !== authorizationRevisions.get(provider)) return;
      }
      status.value = 'loaded';
    } catch (cause) {
      if (revision !== authorizationRevisions.get(provider)) return;
      status.value = 'error';
      error.value = errorMessage(cause);
      throw cause;
    }
  }

  async function openAuthorization(provider: WorkProviderKind): Promise<void> {
    status.value = 'loading';
    error.value = null;
    try {
      const pending = authorizations.value[provider];
      if (pending?.provider === provider && appPlatformActions.openExternal) {
        await appPlatformActions.openExternal(pending.verificationUri);
      } else {
        throw new Error('Start authorization before opening the provider login page.');
      }
      scheduleAuthorizationPoll(provider);
      status.value = 'loaded';
    } catch (cause) {
      status.value = 'error';
      error.value = errorMessage(cause);
      throw cause;
    }
  }

  async function completeConnection(provider: WorkProviderKind): Promise<void> {
    if (appApi?.pollWorkProviderAuthorization) {
      await pollConnection(provider, { userInitiated: true });
    }
  }

  async function disconnect(provider: WorkProviderKind): Promise<void> {
    if (!appApi?.disconnectWorkProvider) return;
    const revision = (authorizationRevisions.get(provider) ?? 0) + 1;
    authorizationRevisions.set(provider, revision);
    catalogRevisions.set(provider, (catalogRevisions.get(provider) ?? 0) + 1);
    for (const [key, value] of itemRevisions) if (key.startsWith(`${provider}:`)) itemRevisions.set(key, value + 1);
    clearAuthorizationPoll(provider);
    const snapshot = await appApi.disconnectWorkProvider(provider);
    if (revision !== authorizationRevisions.get(provider)) return;
    options.adoptSnapshot(snapshot);
    setAuthorization(provider, null);
    repositoriesByProvider.value = { ...repositoriesByProvider.value, [provider]: [] };
    itemsByRepository.value = {};
    status.value = 'notLoaded';
    error.value = null;
  }

  async function loadRepositories(provider: WorkProviderKind, location?: AutomationLocation): Promise<WorkSource[]> {
    if (isRemoteAutomationLocation(location)) {
      return await appApi?.listWorkSources?.(provider, location) ?? [];
    }
    if (!appApi?.listWorkSources || connection(provider)?.status !== 'connected') {
      repositoriesByProvider.value = { ...repositoriesByProvider.value, [provider]: [] };
      status.value = 'notLoaded';
      return [];
    }

    status.value = 'loading';
    error.value = null;
    const revision = (catalogRevisions.get(provider) ?? 0) + 1;
    catalogRevisions.set(provider, revision);
    try {
      const repositories = await appApi.listWorkSources(provider);
      if (catalogRevisions.get(provider) !== revision) return [];
      repositoriesByProvider.value = { ...repositoriesByProvider.value, [provider]: repositories };
      status.value = 'loaded';
      const configuredId = options.getSnapshot().workBacklog.providerConfigurations[provider]?.sourceId ?? null;
      const selectedId = configuredId ?? repositories[0]?.id ?? null;
      if (selectedId && !configuredId) {
        await configure({
          provider,
          configuration: { sourceId: selectedId, assigneeLogin: null, tagName: null },
        });
      }
      if (selectedId) await loadItems(provider, selectedId);
      return repositories;
    } catch (cause) {
      if (catalogRevisions.get(provider) !== revision) return [];
      repositoriesByProvider.value = { ...repositoriesByProvider.value, [provider]: [] };
      status.value = 'error';
      error.value = errorMessage(cause);
      return [];
    }
  }

  async function configure(input: WorkBacklogConfigurationInput, location?: AutomationLocation): Promise<void> {
    if (!appApi?.configureWorkBacklog) return;
    const next = location
      ? await appApi.configureWorkBacklog(input, location)
      : await appApi.configureWorkBacklog(input);
    if (!isRemoteAutomationLocation(location)) options.adoptSnapshot(next);
  }

  async function loadItems(
    provider: WorkProviderKind,
    repositoryId: string,
    location?: AutomationLocation,
    query?: WorkItemQuery,
  ): Promise<WorkItem[] | undefined> {
    if (!appApi?.listWorkItems || !repositoryId) return [];
    if (isRemoteAutomationLocation(location)) {
      return appApi.listWorkItems(provider, repositoryId, location, query);
    }
    if (query) return appApi.listWorkItems(provider, repositoryId, undefined, query);

    const key = workItemsKey(provider, repositoryId);
    const revision = (itemRevisions.get(key) ?? 0) + 1;
    itemRevisions.set(key, revision);
    status.value = 'loading';
    error.value = null;
    try {
      const items = await appApi.listWorkItems(provider, repositoryId);
      if (itemRevisions.get(key) !== revision) return undefined;
      itemsByRepository.value = { ...itemsByRepository.value, [workItemsKey(provider, repositoryId)]: items };
      status.value = 'loaded';
      return items;
    } catch (cause) {
      if (itemRevisions.get(key) !== revision) return undefined;
      status.value = 'error';
      error.value = errorMessage(cause);
      return undefined;
    }
  }

  async function loadGlobalItems(
    provider: WorkProviderKind,
    location?: AutomationLocation,
    query?: GlobalWorkItemQuery,
  ): Promise<WorkItemPage> {
    if (!appApi?.listGlobalWorkItems) {
      return { items: [] };
    }
    return appApi.listGlobalWorkItems(provider, location, query);
  }

  async function loadAssignedItems(provider: WorkProviderKind, location?: AutomationLocation): Promise<WorkItem[]> {
    if (!appApi?.listAssignedWorkItems) return [];
    status.value = 'loading';
    error.value = null;
    try {
      const items = await appApi.listAssignedWorkItems(provider, location);
      assignedItemsByProvider.value = { ...assignedItemsByProvider.value, [provider]: items };
      status.value = 'loaded';
      return items;
    } catch (cause) {
      status.value = 'error';
      error.value = errorMessage(cause);
      throw cause;
    }
  }

  async function loadConnected(): Promise<void> {
    const providers = options.getSnapshot().workBacklog.connections
      .filter((candidate) => candidate.status === 'connected')
      .map((candidate) => candidate.provider);
    await Promise.all(providers.map(provider => loadRepositories(provider)));
  }

  async function pollConnection(provider: WorkProviderKind, pollOptions: { userInitiated?: boolean } = {}): Promise<void> {
    if (!appApi?.pollWorkProviderAuthorization) return;
    const revision = authorizationRevisions.get(provider);
    if (pollOptions.userInitiated) status.value = 'loading';
    error.value = null;
    try {
      const snapshot = await appApi.pollWorkProviderAuthorization(provider);
      if (revision !== authorizationRevisions.get(provider)) return;
      options.adoptSnapshot(snapshot);
      const current = connection(provider);
      if (current?.status === 'connected') {
        clearAuthorizationPoll(provider);
        setAuthorization(provider, null);
        if (!isFirstRunOnboardingActive()) useConfetti().celebrate();
        await loadRepositories(provider);
        return;
      }
      if (current?.status === 'connecting' && authorizations.value[provider]) {
        status.value = 'loaded';
        scheduleAuthorizationPoll(provider);
        return;
      }
      clearAuthorizationPoll(provider);
      setAuthorization(provider, null);
      status.value = current?.status === 'error' ? 'error' : 'loaded';
      error.value = current?.status === 'error' ? localizedText(current.detail, translate) : null;
    } catch (cause) {
      if (revision !== authorizationRevisions.get(provider)) return;
      clearAuthorizationPoll(provider);
      status.value = 'error';
      error.value = errorMessage(cause);
      if (pollOptions.userInitiated) throw cause;
    }
  }

  function scheduleAuthorizationPoll(provider: WorkProviderKind): void {
    clearAuthorizationPoll(provider);
    if (!authorizations.value[provider] || connection(provider)?.status !== 'connecting') return;
    const timer = globalThis.setTimeout(() => {
      authorizationPollTimers.delete(provider);
      void pollConnection(provider);
    }, authorizationPollMs);
    authorizationPollTimers.set(provider, timer);
  }

  function clearAuthorizationPoll(provider: WorkProviderKind): void {
    const timer = authorizationPollTimers.get(provider);
    if (timer === undefined) return;
    globalThis.clearTimeout(timer);
    authorizationPollTimers.delete(provider);
  }

  function connection(provider: WorkProviderKind) {
    return options.getSnapshot().workBacklog.connections.find((candidate) => candidate.provider === provider) ?? null;
  }

  function setAuthorization(provider: WorkProviderKind, pending: WorkProviderAuthorization | null): void {
    const next = { ...authorizations.value };
    if (pending) next[provider] = pending;
    else delete next[provider];
    authorizations.value = next;
    if (pending) authorization.value = pending;
    else if (authorization.value?.provider === provider) authorization.value = Object.values(next)[0] ?? null;
  }

  return {
    assignedItemsByProvider,
    authorization,
    authorizations,
    error,
    itemsByRepository,
    repositoriesByProvider,
    status,
    completeConnection,
    configure,
    connect,
    disconnect,
    loadAssignedItems,
    loadConnected,
    loadGlobalItems,
    loadItems,
    loadRepositories,
    openAuthorization,
  };
}

export function isRemoteAutomationLocation(
  location: AutomationLocation | undefined,
): location is Extract<AutomationLocation, { kind: 'remote' }> {
  return location?.kind === 'remote' && location.remoteConnectionId.trim().length > 0;
}

function workItemsKey(provider: WorkProviderKind, repositoryId: string): string {
  return `${provider}:${repositoryId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
