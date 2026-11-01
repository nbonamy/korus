import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkProviderKind } from '@workspace/core/contracts';
import type { WorkIntegrationTokenStore, WorkProviderToken } from '@workspace/core/work-integration-tokens';

type PersistedTokenFile = {
  tokens?: Partial<Record<WorkProviderKind, WorkProviderToken>>;
};

export class FileWorkIntegrationTokenStore implements WorkIntegrationTokenStore {
  private operationChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  canStoreTokens(): boolean {
    return true;
  }

  async get(provider: WorkProviderKind): Promise<WorkProviderToken | null> {
    await this.operationChain;
    const file = await this.readTokenFile();
    const token = file.tokens?.[provider];
    return token ? { ...token } : null;
  }

  set(token: WorkProviderToken): Promise<void> {
    return this.runExclusive(async () => {
      const file = await this.readTokenFile();
      file.tokens = {
        ...file.tokens,
        [token.provider]: { ...token },
      };
      await this.writeTokenFile(file);
    });
  }

  delete(provider: WorkProviderKind): Promise<void> {
    return this.runExclusive(async () => {
      const file = await this.readTokenFile();
      if (!file.tokens?.[provider]) return;
      delete file.tokens[provider];
      await this.writeTokenFile(file);
    });
  }

  private async readTokenFile(): Promise<PersistedTokenFile> {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      return isRecord(value) && isRecord(value.tokens)
        ? { tokens: tokensFromRecord(value.tokens) }
        : {};
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  private async writeTokenFile(file: PersistedTokenFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } finally {
      await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }

  private runExclusive(operation: () => Promise<void>): Promise<void> {
    const result = this.operationChain.then(operation);
    this.operationChain = result.catch(() => undefined);
    return result;
  }
}

function tokensFromRecord(value: Record<string, unknown>): PersistedTokenFile['tokens'] {
  const tokens: Partial<Record<WorkProviderKind, WorkProviderToken>> = {};
  for (const [provider, token] of Object.entries(value)) {
    if (isPersistedToken(token)) {
      tokens[provider as WorkProviderKind] = {
        ...token,
        provider: provider as WorkProviderKind,
      };
    }
  }
  return tokens;
}

function isPersistedToken(value: unknown): value is WorkProviderToken {
  return isRecord(value) &&
    typeof value.provider === 'string' &&
    typeof value.accessToken === 'string' &&
    typeof value.tokenType === 'string' &&
    typeof value.connectedAt === 'string' &&
    (value.scope === undefined || typeof value.scope === 'string') &&
    (value.expiresAt === undefined || typeof value.expiresAt === 'string') &&
    (value.refreshToken === undefined || typeof value.refreshToken === 'string') &&
    (value.refreshTokenExpiresAt === undefined || typeof value.refreshTokenExpiresAt === 'string') &&
    (value.accountLabel === undefined || typeof value.accountLabel === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error);
}
