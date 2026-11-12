import type { HarnessProvider, ProviderDefaults } from './contracts';

/** Stored defaults with a permission choice applied: the same field for every harness. */
export function providerDefaultsWithPermission(defaults: ProviderDefaults | undefined, provider: HarnessProvider, permission: string): ProviderDefaults {
  return { ...(defaults?.kind === provider ? defaults : {}), kind: provider, permission } as ProviderDefaults;
}
