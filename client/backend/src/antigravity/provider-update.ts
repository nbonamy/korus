import type { ProviderUpdateAdapter } from '../provider-update-adapter';

export function createAntigravityUpdateAdapter(): ProviderUpdateAdapter {
  return {
    async inspect() { throw new Error('Antigravity updates are managed externally.'); },
    async upgrade() { throw new Error('Manual provider upgrade required.'); },
  };
}
