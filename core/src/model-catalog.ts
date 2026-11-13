import type { ProviderModelOption } from './contracts';

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
