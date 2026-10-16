import { inject, type InjectionKey } from 'vue';
import type { AgentBackend, BackendModelOption } from '@workspace/core/contracts';
import { appApi } from '../platform-api';

type BackendModelCatalog = {
  listModels: (agentId: string, backend: AgentBackend) => Promise<BackendModelOption[]>;
};

export const backendModelCatalogKey: InjectionKey<BackendModelCatalog> = Symbol('backendModelCatalog');

/** Model catalogs are read through an agent because its host decides which models exist. */
export function useBackendModelCatalog(): BackendModelCatalog {
  return inject(backendModelCatalogKey, {
    listModels: async (agentId, backend) => await appApi?.listBackendModels(agentId, backend) ?? [],
  });
}

const cacheKey = 'app:modelCatalog';

type CatalogCache = Record<string, BackendModelOption[]>;

function readCache(): CatalogCache {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(cacheKey) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as CatalogCache : {};
  } catch { return {}; }
}

/** The last catalog seen for a provider on a host, so pickers can open populated while a refresh runs. */
export function cachedModels(host: string, backend: AgentBackend): BackendModelOption[] | undefined {
  const models = readCache()[`${host}:${backend}`];
  return Array.isArray(models) ? models : undefined;
}

export function cacheModels(host: string, backend: AgentBackend, models: BackendModelOption[]): void {
  try { localStorage.setItem(cacheKey, JSON.stringify({ ...readCache(), [`${host}:${backend}`]: models })); } catch { /* The live catalog still works without a cache. */ }
}

/**
 * What a picker should list, and the model to preselect. A provider may list an alias row for its
 * default ("Default (recommended)") that only points at another row; that row is hidden in favor of
 * the model it resolves to, so the default is always shown by its real name.
 */
export function presentCatalog(catalog: BackendModelOption[]): { models: BackendModelOption[]; fallback?: BackendModelOption; alias?: BackendModelOption } {
  const alias = catalog.find(option => option.isDefault);
  const resolved = alias?.providerMetadata?.resolvedModel;
  const target = typeof resolved === 'string'
    ? catalog.find(option => option !== alias && (option.model === resolved || option.providerMetadata?.resolvedModel === resolved))
    : undefined;
  if (alias && target) return { models: catalog.filter(option => option !== alias), fallback: target, alias };
  return { models: catalog, fallback: alias ?? catalog[0] };
}

export function defaultReasoningEffort(option: BackendModelOption | undefined): string {
  return option?.defaultReasoningEffort || option?.supportedReasoningEfforts?.[0]?.reasoningEffort || '';
}
