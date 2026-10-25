import type { AutomationLocation, WorkItem, WorkItemQuery, WorkProviderKind, WorkSource } from '@workspace/core/contracts';
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { useBacklogConnections, useBacklogProviders } from './backlog-providers';
import { appApi } from '../platform-api';
import { AsyncCatalogCache } from '../async-catalog-cache';
import { workProviderDefinition } from '@workspace/core/work-providers';

/** All providers share browsing, cache ownership and stale-response protection. */
export function useWorkSourceBacklog(options: {
  location: () => AutomationLocation | undefined;
  query: WorkItemQuery;
  preferredProvider?: () => WorkProviderKind | undefined;
  preferredSourceId?: () => string | null;
  restrictToRepository?: () => boolean;
  acceptsSource?: (source: WorkSource) => boolean;
  enabled?: () => boolean;
}) {
  const { location, preferredSourceId = () => null, restrictToRepository = () => false, acceptsSource = () => true, enabled = () => true } = options;
  const { provider, providers } = useBacklogProviders(useBacklogConnections(location));
  const sources = ref<WorkSource[]>([]);
  const sourceId = ref<string | null>(null);
  const items = ref<WorkItem[]>([]);
  const status = ref<'notLoaded' | 'loading' | 'loaded' | 'error'>('notLoaded');
  const error = ref<string | null>(null);
  const catalogs = new AsyncCatalogCache<string, WorkSource>();
  const issueCatalogs = new AsyncCatalogCache<string, WorkItem>();
  const locationKey = computed(() => JSON.stringify(location() ?? { kind: 'local' }));
  let revision = 0;
  onScopeDispose(() => { ++revision; });
  watch([() => options.preferredProvider?.(), () => providers.value.join(',')], ([preferred]) => {
    if (preferred && providers.value.includes(preferred as WorkProviderKind)) provider.value = preferred as WorkProviderKind;
  }, { immediate: true });
  const preferredRepositorySource = computed(() => workProviderDefinition(provider.value).repositoryBacked ? preferredSourceId() : null);
  watch([provider, locationKey, preferredRepositorySource, restrictToRepository, enabled, () => providers.value.length > 0], () => { void loadProvider(); }, { immediate: true });

  async function selectProvider(next: WorkProviderKind): Promise<void> {
    provider.value = next;
    await nextTick();
  }

  async function loadProvider(): Promise<void> {
    const request = ++revision;
    sourceId.value = null;
    sources.value = [];
    items.value = [];
    error.value = null;
    status.value = 'notLoaded';
    const selectedProvider = provider.value;
    if (!enabled() || !providers.value.includes(selectedProvider)) return;
    status.value = 'loading';
    const entry = catalogs.load(`${selectedProvider}:${locationKey.value}`, request, async () => {
      if (!appApi?.listWorkSources) throw new Error('Backlog browsing is unavailable.');
      return appApi.listWorkSources(selectedProvider, location());
    });
    await entry.promise;
    if (request !== revision) return;
    const preferred = preferredSourceId();
    const repositoryBound = restrictToRepository() && workProviderDefinition(selectedProvider).repositoryBacked;
    sources.value = entry.value.filter(source => acceptsSource(source) && (!repositoryBound || source.id === preferred));
    status.value = entry.status;
    error.value = entry.error;
    const initialSource = workProviderDefinition(selectedProvider).repositoryBacked && sources.value.some(source => source.id === preferred) ? preferred : null;
    if (entry.status === 'loaded') await selectSource(initialSource || sources.value[0]?.id || null);
  }

  async function selectSource(id: string | null): Promise<void> {
    if (id && !sources.value.some(source => source.id === id)) return;
    const request = ++revision;
    sourceId.value = id;
    items.value = [];
    error.value = null;
    status.value = id ? 'loading' : 'loaded';
    const selectedProvider = provider.value;
    if (!enabled() || !id || !providers.value.includes(selectedProvider)) return;
    const entry = issueCatalogs.load(`${selectedProvider}:${locationKey.value}:${id}`, request, async () => {
      if (!appApi?.listWorkItems) throw new Error('Backlog browsing is unavailable.');
      return appApi.listWorkItems(selectedProvider, id, location(), options.query);
    });
    await entry.promise;
    if (request !== revision) return;
    items.value = entry.value;
    status.value = entry.status;
    error.value = entry.error;
  }
  return { provider, providers, sources, sourceId, items, status, error, selectProvider, selectSource,
    refresh: () => sourceId.value ? selectSource(sourceId.value) : loadProvider() };
}
