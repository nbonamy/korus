import { inject, type InjectionKey } from 'vue';
import type { HarnessProvider, ProviderModelOption } from '@workspace/core/contracts';
import { appApi } from '../platform-api';

type ProviderModelCatalog = {
  /** Without an agent id the catalog is the host's own: the local one, or that remote connection's. */
  listModels: (agentId: string | null, provider: HarnessProvider, remoteConnectionId?: string) => Promise<ProviderModelOption[]>;
};

export const providerModelCatalogKey: InjectionKey<ProviderModelCatalog> = Symbol('backendModelCatalog');

/** Model catalogs are read through an agent because its host decides which models exist. */
export function useProviderModelCatalog(): ProviderModelCatalog {
  return inject(providerModelCatalogKey, {
    listModels: async (agentId, provider, remoteConnectionId) => await appApi?.listProviderModels(agentId, provider, remoteConnectionId) ?? [],
  });
}

const cacheKey = 'app:modelCatalog';

type CatalogCache = Record<string, ProviderModelOption[]>;

function readCache(): CatalogCache {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(cacheKey) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as CatalogCache : {};
  } catch { return {}; }
}

/** The last catalog seen for a provider on a host, so pickers can open populated while a refresh runs. */
export function cachedModels(host: string, provider: HarnessProvider): ProviderModelOption[] | undefined {
  const models = readCache()[`${host}:${provider}`];
  return Array.isArray(models) ? models : undefined;
}

export function cacheModels(host: string, provider: HarnessProvider, models: ProviderModelOption[]): void {
  try { localStorage.setItem(cacheKey, JSON.stringify({ ...readCache(), [`${host}:${provider}`]: models })); } catch { /* The live catalog still works without a cache. */ }
}

/**
 * What a picker should list, and the model to preselect. A provider may list an alias row for its
 * default ("Default (recommended)") that only points at another row; that row is hidden in favor of
 * the model it resolves to, so the default is always shown by its real name.
 */
export function presentCatalog(catalog: ProviderModelOption[]): { models: ProviderModelOption[]; fallback?: ProviderModelOption; alias?: ProviderModelOption } {
  const alias = catalog.find(option => option.isDefault);
  const resolved = alias?.providerMetadata?.resolvedModel;
  const target = typeof resolved === 'string'
    ? catalog.find(option => option !== alias && (option.model === resolved || option.providerMetadata?.resolvedModel === resolved))
    : undefined;
  if (alias && target) return { models: catalog.filter(option => option !== alias), fallback: target, alias };
  return { models: catalog, fallback: alias ?? catalog[0] };
}

export function defaultReasoningEffort(option: ProviderModelOption | undefined): string {
  return option?.defaultReasoningEffort || option?.supportedReasoningEfforts?.[0]?.reasoningEffort || '';
}
