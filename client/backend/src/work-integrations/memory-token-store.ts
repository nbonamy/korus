import type { WorkProviderKind } from '@workspace/core/contracts';
import type { WorkIntegrationTokenStore, WorkProviderToken } from '@workspace/core/work-integration-tokens';

export class MemoryWorkIntegrationTokenStore implements WorkIntegrationTokenStore {
  private readonly tokens = new Map<WorkProviderKind, WorkProviderToken>();

  constructor(private readonly available = true) {}

  canStoreTokens(): boolean {
    return this.available;
  }

  async get(provider: WorkProviderKind): Promise<WorkProviderToken | null> {
    const token = this.tokens.get(provider);
    return token ? { ...token } : null;
  }

  async set(token: WorkProviderToken): Promise<void> {
    if (!this.available) {
      throw new Error('Token storage is not available on this device.');
    }
    this.tokens.set(token.provider, { ...token });
  }

  async delete(provider: WorkProviderKind): Promise<void> {
    this.tokens.delete(provider);
  }
}
