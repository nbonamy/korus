import type { SourceBranch, AgentGitPullRequest, AppSnapshot, GlobalWorkItemQuery, WorkBacklogConfigurationInput, WorkIntegrationConnection, WorkItem, WorkItemKind, WorkItemPage, WorkItemQuery, WorkProviderAuthorization, WorkProviderConnectResult, WorkProviderKind, WorkSource } from '@workspace/core/contracts';
import type { WorkIntegrationTokenStore, WorkProviderToken } from '@workspace/core/work-integration-tokens';
import { WorkProviderCliAuthenticationError, type WorkProviderCliDriver, type WorkProviderCredential, type WorkItemDetail, type WorkProviderDeviceAuthorization, type WorkProviderDriver } from './types';
import { workProviderDefinition } from '@workspace/core/work-providers';

type WorkIntegrationManagerOptions = {
  drivers: WorkProviderDriver[];
  githubCli?: WorkProviderCliDriver;
  gitlabCli?: WorkProviderCliDriver;
  getSnapshot: () => AppSnapshot;
  saveSnapshot: () => Promise<void>;
  tokenStore: WorkIntegrationTokenStore;
};

type PendingAuthorization = WorkProviderDeviceAuthorization & {
  lastPollAt: number | null;
};

export class WorkIntegrationManager {
  private readonly drivers = new Map<WorkProviderKind, WorkProviderDriver>();
  private readonly pendingAuthorizations = new Map<WorkProviderKind, PendingAuthorization>();
  private readonly tokenRefreshes = new Map<WorkProviderKind, Promise<WorkProviderToken>>();
  private readonly generations = new Map<WorkProviderKind, number>();
  private readonly tokenWrites = new Map<WorkProviderKind, Promise<void>>();
  private readonly connects = new Map<WorkProviderKind, Promise<WorkProviderConnectResult>>();
  private readonly polls = new Map<WorkProviderKind, Promise<AppSnapshot>>();
  private readonly authorizationFallbacks = new Map<WorkProviderKind, WorkIntegrationConnection>();
  private readonly disconnects = new Map<WorkProviderKind, number>();

  constructor(private readonly options: WorkIntegrationManagerOptions) {
    for (const driver of options.drivers) {
      this.drivers.set(driver.provider, driver);
    }
  }

  close(): void {
    for (const provider of this.drivers.keys()) this.invalidate(provider);
  }

  async hydrateConnections(): Promise<void> {
    let changed = false;
    const providers = new Set<WorkProviderKind>([
      ...Array.from(this.drivers.keys()),
      ...this.snapshot().workBacklog.connections.map((connection) => connection.provider),
    ]);

    for (const provider of providers) {
      if (this.disconnects.has(provider)) continue;
      const generation = this.generation(provider);
      const driver = this.driver(provider);
      const connection = this.snapshot().workBacklog.connections.find((candidate) => candidate.provider === provider);
      const storedToken = connection?.source === 'none' ? null : await this.options.tokenStore.get(provider);
      if (this.generation(provider) !== generation) continue;
      if (storedToken) {
        this.authorizationFallbacks.delete(provider);
        let token = storedToken;
        if (tokenNeedsRefresh(token)) {
          try {
            token = await this.refreshConnectedToken(provider, token, generation);
          } catch {
            if (this.generation(provider) !== generation) continue;
            await this.markReconnectRequired(provider, generation);
            continue;
          }
        }
        if (this.generation(provider) !== generation) continue;
        changed = this.setConnection({
          provider,
          ...(connection?.source ? directConnectionSource(provider) : {}),
          status: 'connected',
          ...(token.accountLabel ? { accountLabel: token.accountLabel } : {}),
          connectedAt: token.connectedAt,
        }) || changed;
        continue;
      }

      if (this.generation(provider) !== generation) continue;

      if (this.authorizationFallbacks.has(provider)) continue;
      const cliDriver = this.cliDriver(provider);
      if (cliDriver && connection?.source !== 'api'
        && (connection?.source === 'cli' || !connection?.accountLabel && !connection?.connectedAt)) {
        const cli = await cliDriver.detectConnection();
        if (this.generation(provider) !== generation) continue;
        if (cli) {
          if (connection?.source === 'cli' && connection.accountLabel && connection.accountLabel !== cli.accountLabel) {
            changed = this.setConnection({ ...connection, status: 'error', detail: `${providerLabel(provider)} CLI authentication changed. Reconnect in Settings to use the new account.` }) || changed;
            continue;
          }
          changed = this.setConnection({ provider, source: 'cli', status: 'connected', accountLabel: cli.accountLabel,
            connectedAt: connection?.source === 'cli' && connection.accountLabel === cli.accountLabel ? connection.connectedAt ?? cli.connectedAt : cli.connectedAt }) || changed;
          continue;
        }
        if (connection?.source === 'cli') {
          changed = this.setConnection({ ...connection, status: 'disconnected', detail: `${providerLabel(provider)} CLI is unavailable. Check CLI installation and authentication, then retry.` }) || changed;
          continue;
        }
      }

      if (!driver.configured()) {
        changed = this.setConnection({
          provider,
          status: 'notConfigured',
          detail: this.configurationDetail(provider),
        }) || changed;
        continue;
      }

      if (!connection) {
        continue;
      }

      if (connection.status !== 'connected') {
        changed = this.setConnection({
          ...connection,
          status: connection.status === 'notConfigured' || (connection.status === 'connecting' && !this.pendingAuthorizations.has(provider)) ? 'disconnected' : connection.status,
          detail: provider !== 'linear' && connection.status === 'connecting' && !this.pendingAuthorizations.has(provider)
            ? { key: 'workProvider.authorizationExpired', params: { provider: providerLabel(provider) } }
            : connection.status === 'notConfigured' ? undefined : connection.detail,
        }) || changed;
        continue;
      }

      changed = this.setConnection({
        provider,
        status: 'disconnected',
        detail: `${providerLabel(provider)} needs to be reconnected.`,
      }) || changed;
    }

    if (changed) {
      await this.options.saveSnapshot();
    }
  }

  async findPullRequest(repositoryId: string, branch: string): Promise<AgentGitPullRequest | null> {
    const provider = repositoryId.startsWith('gitlab.com/') ? 'gitlab' : 'github';
    const token = await this.connectedCredential(provider);
    const driver = this.driver(provider, token);
    if (!driver.findPullRequest) throw new Error('Request lookup is unavailable.');
    return driver.findPullRequest(token, repositoryId, branch);
  }

  async getPullRequest(repositoryId: string, number: number): Promise<AgentGitPullRequest | null> {
    const provider = repositoryId.startsWith('gitlab.com/') ? 'gitlab' : 'github';
    const token = await this.connectedCredential(provider);
    const driver = this.driver(provider, token);
    if (!driver.getPullRequest) throw new Error('Request lookup is unavailable.');
    return driver.getPullRequest(token, repositoryId, number);
  }

  async createPullRequest(repositoryId: string, input: { branch: string; title: string; body: string }): Promise<AgentGitPullRequest> {
    const provider = repositoryId.startsWith('gitlab.com/') ? 'gitlab' : 'github';
    const token = await this.connectedCredential(provider);
    const driver = this.driver(provider, token);
    if (!driver.createPullRequest) throw new Error(`${providerLabel(provider)} request creation is unavailable.`);
    return driver.createPullRequest(token, repositoryId, input);
  }

  async getItemDetail(repositoryId: string, kind: WorkItemKind, iid: number): Promise<WorkItemDetail> {
    const token = await this.connectedCredential('gitlab');
    const driver = this.driver('gitlab', token);
    if (!driver.getItemDetail) throw new Error('Item lookup is unavailable.');
    return driver.getItemDetail(token, repositoryId, kind, iid);
  }

  async addItemNote(repositoryId: string, kind: WorkItemKind, iid: number, body: string): Promise<{ id: string; url: string }> {
    const token = await this.connectedCredential('gitlab');
    const driver = this.driver('gitlab', token);
    if (!driver.addItemNote) throw new Error('Commenting is unavailable.');
    return driver.addItemNote(token, repositoryId, kind, iid, body);
  }

  async repositoryConnected(repositoryId: string): Promise<boolean> {
    const provider = repositoryId.startsWith('gitlab.com/') ? 'gitlab' : 'github';
    if (this.connection(provider)?.source === 'none') return false;
    return this.connection(provider)?.source === 'cli' && this.isConnected(provider) || Boolean(await this.options.tokenStore.get(provider));
  }

  async githubConnected(): Promise<boolean> {
    if (this.connection('github')?.source === 'none') return false;
    return this.connection('github')?.source === 'cli' && this.isConnected('github') || Boolean(await this.options.tokenStore.get('github'));
  }

  isConnected(provider: WorkProviderKind): boolean {
    return this.snapshot().workBacklog.connections.some(
      (connection) => connection.provider === provider && connection.status === 'connected',
    );
  }

  isHostedMcpConnected(provider: WorkProviderKind): boolean {
    return this.isConnected(provider) && this.connection(provider)?.source !== 'cli';
  }

  async authorizationHeader(
    provider: WorkProviderKind,
    options: { forceRefresh?: boolean } = {},
  ): Promise<string> {
    if (this.connection(provider)?.source === 'cli') throw new Error(`${providerLabel(provider)} API authorization is not connected.`);
    const token = await this.connectedToken(provider, options.forceRefresh === true);
    return `${token.tokenType || 'Bearer'} ${token.accessToken}`;
  }

  async connect(provider: WorkProviderKind): Promise<WorkProviderConnectResult> {
    if (provider === 'linear') return this.startConnection(provider);
    const existing = this.connects.get(provider);
    if (existing) return existing;
    const operation = this.startConnection(provider).finally(() => {
      if (this.connects.get(provider) === operation) this.connects.delete(provider);
    });
    this.connects.set(provider, operation);
    return operation;
  }

  private async startConnection(provider: WorkProviderKind): Promise<WorkProviderConnectResult> {
    // A refreshed renderer retrieves public instructions for the same grant.
    // Device codes and credentials remain owned by this manager.
    if (provider !== 'linear' && this.pendingAuthorizations.has(provider)) {
      const pending = await this.activePendingAuthorization(provider);
      return { snapshot: this.snapshot(), ...(pending ? { authorization: publicAuthorization(pending) } : {}) };
    }
    const driver = this.driver(provider);
    const previous = this.connection(provider);
    const cliFallback = this.cliDriver(provider) && previous?.source === 'cli' && previous.status === 'connected' ? previous : null;
    // A failed direct connect must not cost the user working CLI access.
    const fail = (connection: Pick<WorkIntegrationConnection, 'status' | 'detail'>) => this.setAuthorizationFailure(provider, { provider, ...directConnectionSource(provider), ...connection });
    const generation = this.invalidate(provider);
    if (cliFallback) this.authorizationFallbacks.set(provider, cliFallback);
    this.setConnection({ provider, ...directConnectionSource(provider), status: 'connecting' });
    await this.writeToken(provider, () => this.options.tokenStore.delete(provider));
    if (this.generation(provider) !== generation) return { snapshot: this.snapshot() };
    if (!await this.options.tokenStore.canStoreTokens()) {
      fail({ status: 'error', detail: { key: 'workProvider.tokenStorageUnavailable' } });
      await this.options.saveSnapshot();
      return { snapshot: this.snapshot() };
    }

    if (!driver.configured()) {
      fail({ status: 'notConfigured', detail: this.configurationDetail(provider) });
      await this.options.saveSnapshot();
      return { snapshot: this.snapshot() };
    }

    let authorization: WorkProviderDeviceAuthorization;
    try {
      authorization = await driver.startAuthorization();
    } catch (error) {
      if (this.generation(provider) !== generation) return { snapshot: this.snapshot() };
      fail({ status: 'error', detail: error instanceof Error ? error.message : 'Could not start authorization.' });
      await this.options.saveSnapshot();
      return { snapshot: this.snapshot() };
    }
    if (this.generation(provider) !== generation) return { snapshot: this.snapshot() };
    this.pendingAuthorizations.set(provider, {
      ...authorization,
      lastPollAt: null,
    });
    this.setConnection({
      provider,
      ...directConnectionSource(provider),
      status: 'connecting',
      detail: authorization.flow === 'browser'
        ? { key: 'workProvider.authorizationPending', params: { provider: providerLabel(provider) } }
        : { key: 'workProvider.enterCode', params: { code: authorization.userCode ?? '', provider: providerLabel(provider) } },
    });
    await this.options.saveSnapshot();

    return {
      snapshot: this.snapshot(),
      authorization: publicAuthorization(authorization),
    };
  }

  async pollAuthorization(provider: WorkProviderKind): Promise<AppSnapshot> {
    const existing = this.polls.get(provider);
    if (existing) return existing;
    const operation = this.pollPendingAuthorization(provider).finally(() => {
      if (this.polls.get(provider) === operation) this.polls.delete(provider);
    });
    this.polls.set(provider, operation);
    return operation;
  }

  private async pollPendingAuthorization(provider: WorkProviderKind): Promise<AppSnapshot> {
    const generation = this.generation(provider);
    const pending = await this.activePendingAuthorization(provider);
    if (!pending) {
      return this.snapshot();
    }

    const now = Date.now();
    const waitMs = pending.lastPollAt === null ? 0 : Math.max(pending.intervalSeconds * 1000 - (now - pending.lastPollAt), 0);
    if (waitMs > 0) {
      this.setConnection({
        provider,
        ...directConnectionSource(provider),
        status: 'connecting',
        detail: { key: 'workProvider.authorizationWaiting', params: { seconds: Math.ceil(waitMs / 1000) } },
      });
      await this.options.saveSnapshot();
      return this.snapshot();
    }

    pending.lastPollAt = now;
    const result = await this.driver(provider).pollAuthorization(pending.deviceCode);
    if (this.generation(provider) !== generation || this.pendingAuthorizations.get(provider) !== pending) return this.snapshot();
    if (!await this.activePendingAuthorization(provider)) return this.snapshot();
    if (result.status === 'pending') {
      if (result.intervalSeconds) {
        pending.intervalSeconds = result.intervalSeconds;
      }
      this.setConnection({
        provider,
        ...directConnectionSource(provider),
        status: 'connecting',
        detail: { key: 'workProvider.authorizationPending', params: { provider: providerLabel(provider) } },
      });
      await this.options.saveSnapshot();
      return this.snapshot();
    }

    if (result.status === 'error') {
      this.pendingAuthorizations.delete(provider);
      this.driver(provider).cancelAuthorization?.();
      this.setAuthorizationFailure(provider, {
        provider,
        ...directConnectionSource(provider),
        status: result.code === 'not_configured' ? 'notConfigured' : 'error',
        detail: workProviderAuthorizationError(result.code, providerLabel(provider)),
      });
      await this.options.saveSnapshot();
      return this.snapshot();
    }

    const token: WorkProviderToken = {
      provider,
      ...result.token,
      connectedAt: new Date().toISOString(),
    };
    let accountLabel: string;
    try {
      accountLabel = await this.driver(provider).currentAccountLabel(token);
      if (this.generation(provider) !== generation || !await this.activePendingAuthorization(provider)) return this.snapshot();
      await this.writeToken(provider, async () => {
        if (this.generation(provider) === generation) await this.options.tokenStore.set({ ...token, accountLabel });
      });
    } catch {
      if (this.generation(provider) !== generation) return this.snapshot();
      this.pendingAuthorizations.delete(provider);
      this.driver(provider).cancelAuthorization?.();
      this.setAuthorizationFailure(provider, { provider, ...directConnectionSource(provider), status: 'error', detail: workProviderAuthorizationError('unavailable', providerLabel(provider)) });
      await this.options.saveSnapshot();
      return this.snapshot();
    }
    if (this.generation(provider) !== generation) return this.snapshot();
    this.pendingAuthorizations.delete(provider);
    this.authorizationFallbacks.delete(provider);
    this.driver(provider).cancelAuthorization?.();
    this.setConnection({
      provider,
      ...directConnectionSource(provider),
      status: 'connected',
      accountLabel,
      connectedAt: token.connectedAt,
    });
    await this.options.saveSnapshot();

    return this.snapshot();
  }

  async disconnect(provider: WorkProviderKind): Promise<AppSnapshot> {
    const fallback = this.authorizationFallbacks.get(provider);
    const previous = this.connection(provider);
    const expectedCli = fallback ?? (previous?.source === 'cli' && previous.status === 'connected' ? previous : undefined);
    const generation = this.invalidate(provider);
    this.disconnects.set(provider, generation);
    try {
      const source = provider === 'github' || provider === 'gitlab' ? { source: 'none' as const } : {};
      this.setConnection({ provider, ...source, status: 'disconnected' });
      await this.writeToken(provider, () => this.options.tokenStore.delete(provider));
      if (this.generation(provider) !== generation) return this.snapshot();
      delete this.snapshot().workBacklog.providerConfigurations[provider];
      const cli = await this.cliDriver(provider)?.detectConnection();
      if (this.generation(provider) !== generation) return this.snapshot();
      if (cli && expectedCli?.accountLabel && expectedCli.accountLabel !== cli.accountLabel) {
        this.setConnection({ ...expectedCli, status: 'error', detail: `${providerLabel(provider)} CLI authentication changed. Reconnect in Settings to use the new account.` });
      } else if (cli) {
        this.setConnection({ provider, source: 'cli', status: 'connected', accountLabel: cli.accountLabel, connectedAt: cli.connectedAt });
      } else {
        this.setConnection({ provider, ...source, status: this.driver(provider).configured() ? 'disconnected' : 'notConfigured' });
      }
      await this.options.saveSnapshot();
      return this.snapshot();
    } finally {
      if (this.disconnects.get(provider) === generation) this.disconnects.delete(provider);
    }
  }

  async listBranches(provider: WorkProviderKind, repositoryId: string): Promise<SourceBranch[]> {
    return this.withCredential(provider, (driver, credential) => {
      if (!driver.listBranches) throw new Error('Branch browsing is unavailable for this integration.');
      return driver.listBranches(credential, repositoryId);
    });
  }

  async listSources(provider: WorkProviderKind): Promise<WorkSource[]> {
    return this.withCredential(provider, (driver, credential) => driver.listSources(credential));
  }

  async configureBacklog(input: WorkBacklogConfigurationInput): Promise<AppSnapshot> {
    {
      const sourceId = normalizedOptionalString(input.configuration.sourceId);
      if (sourceId) {
        const assigneeLogin = normalizedOptionalString(input.configuration.assigneeLogin);
        const tagName = normalizedOptionalString(input.configuration.tagName);
        this.snapshot().workBacklog.providerConfigurations[input.provider] = {
          sourceId,
          ...(assigneeLogin ? { assigneeLogin } : {}),
          ...(tagName ? { tagName } : {}),
        };
      } else {
        delete this.snapshot().workBacklog.providerConfigurations[input.provider];
      }
    }
    await this.options.saveSnapshot();
    return this.snapshot();
  }

  async listItems(provider: WorkProviderKind, repositoryId: string, query?: WorkItemQuery): Promise<WorkItem[]> {
    return this.withCredential(provider, (driver, credential) => query ? driver.listItems(credential, repositoryId, query) : driver.listItems(credential, repositoryId));
  }

  async listGlobalItems(provider: WorkProviderKind, query?: GlobalWorkItemQuery): Promise<WorkItemPage> {
    return this.withCredential(provider, (driver, credential) => query ? driver.listGlobalItems(credential, query) : driver.listGlobalItems(credential));
  }

  async listAssignedItems(provider: WorkProviderKind): Promise<WorkItem[]> {
    return this.withCredential(provider, (driver, credential) => {
      if (!driver.listAssignedItems) throw new Error(`${providerLabel(provider)} cannot list assigned work across repositories.`);
      return driver.listAssignedItems(credential);
    });
  }

  private async activePendingAuthorization(provider: WorkProviderKind): Promise<PendingAuthorization | null> {
    const pending = this.pendingAuthorizations.get(provider);
    if (!pending) return null;
    if (Date.parse(pending.expiresAt) > Date.now()) return pending;

    this.pendingAuthorizations.delete(provider);
    this.driver(provider).cancelAuthorization?.();
    this.setAuthorizationFailure(provider, {
      provider,
      status: 'error',
      detail: { key: 'workProvider.verificationExpired' },
    });
    await this.options.saveSnapshot();
    return null;
  }

  private connection(provider: WorkProviderKind): WorkIntegrationConnection | undefined {
    return this.snapshot().workBacklog.connections.find(connection => connection.provider === provider);
  }

  private async connectedCredential(provider: WorkProviderKind): Promise<WorkProviderCredential> {
    const connection = this.connection(provider);
    const fallback = this.authorizationFallbacks.get(provider);
    const active = connection?.status === 'connecting' && fallback ? fallback : connection;
    if (this.cliDriver(provider) && active?.source === 'cli' && active.status === 'connected' && active.accountLabel) {
      return { kind: 'cli', provider: provider as 'github' | 'gitlab', accountLabel: active.accountLabel, connectedAt: active.connectedAt ?? '' };
    }
    if (connection?.source === 'cli') throw new Error(`${providerLabel(provider)} CLI needs to be reconnected in Settings.`);
    return this.connectedToken(provider);
  }

  private async connectedToken(provider: WorkProviderKind, forceRefresh = false): Promise<WorkProviderToken> {
    if (this.connection(provider)?.source === 'none') throw new Error(`${providerLabel(provider)} is not connected.`);
    const generation = this.generation(provider);
    const token = await this.options.tokenStore.get(provider);
    if (this.generation(provider) !== generation) throw new Error('Authorization was cancelled.');
    if (!token) {
      this.setConnection({
        provider,
        status: this.driver(provider).configured() ? 'disconnected' : 'notConfigured',
        detail: { key: 'workProvider.needsConnection', params: { provider: providerLabel(provider) } },
      });
      await this.options.saveSnapshot();
      throw new Error(`${providerLabel(provider)} is not connected.`);
    }

    if (!forceRefresh && !tokenNeedsRefresh(token)) return token;

    try {
      return await this.refreshConnectedToken(provider, token, generation);
    } catch (error) {
      if (this.generation(provider) === generation) await this.markReconnectRequired(provider, generation);
      throw error;
    }
  }

  private async refreshConnectedToken(
    provider: WorkProviderKind,
    token: WorkProviderToken,
    generation: number,
  ): Promise<WorkProviderToken> {
    if (this.generation(provider) !== generation) throw new Error('Authorization was cancelled.');
    const existingRefresh = this.tokenRefreshes.get(provider);
    if (existingRefresh) return existingRefresh;

    const driver = this.driver(provider);
    // A delayed token read can arrive after the shared refresh has completed.
    // Re-read inside the shared operation before consuming a rotating refresh token.
    const refresh = Promise.resolve().then(async () => {
      const current = await this.options.tokenStore.get(provider);
      if (this.generation(provider) !== generation) throw new Error('Authorization was cancelled.');
      if (current && (current.accessToken !== token.accessToken || current.refreshToken !== token.refreshToken)) return current;
      if (!driver.refreshToken || !token.refreshToken || refreshTokenExpired(token)) {
        throw new Error(`${providerLabel(provider)} needs to be reconnected.`);
      }
      return driver.refreshToken(token);
    })
      .then(async (refreshedToken) => {
        await this.writeToken(provider, async () => {
          if (this.generation(provider) !== generation) throw new Error('Authorization was cancelled.');
          await this.options.tokenStore.set(refreshedToken);
        });
        if (this.generation(provider) !== generation) throw new Error('Authorization was cancelled.');
        return refreshedToken;
      })
      .finally(() => {
        if (this.tokenRefreshes.get(provider) === refresh) {
          this.tokenRefreshes.delete(provider);
        }
      });
    this.tokenRefreshes.set(provider, refresh);
    return refresh;
  }

  private async markReconnectRequired(provider: WorkProviderKind, generation = this.generation(provider)): Promise<void> {
    await this.writeToken(provider, async () => {
      if (this.generation(provider) === generation) await this.options.tokenStore.delete(provider);
    });
    if (this.generation(provider) !== generation) return;
    this.setConnection({
      provider,
      ...directConnectionSource(provider),
      status: 'disconnected',
      detail: { key: 'workProvider.authorizationExpired', params: { provider: providerLabel(provider) } },
    });
    await this.options.saveSnapshot();
  }

  private generation(provider: WorkProviderKind): number {
    return this.generations.get(provider) ?? 0;
  }

  private invalidate(provider: WorkProviderKind): number {
    this.connects.delete(provider);
    const generation = this.generation(provider) + 1;
    this.generations.set(provider, generation);
    this.pendingAuthorizations.delete(provider);
    this.authorizationFallbacks.delete(provider);
    this.tokenRefreshes.delete(provider);
    this.polls.delete(provider);
    this.driver(provider).cancelAuthorization?.();
    return generation;
  }

  private writeToken(provider: WorkProviderKind, write: () => Promise<void>): Promise<void> {
    const operation = (this.tokenWrites.get(provider) ?? Promise.resolve()).then(write);
    this.tokenWrites.set(provider, operation.catch(() => undefined));
    return operation;
  }

  private setAuthorizationFailure(provider: WorkProviderKind, connection: WorkIntegrationConnection): void {
    const fallback = this.authorizationFallbacks.get(provider);
    this.authorizationFallbacks.delete(provider);
    this.setConnection(fallback ? { ...fallback, detail: connection.detail } : connection);
  }

  private async withCredential<T>(provider: WorkProviderKind, operation: (driver: WorkProviderDriver, credential: WorkProviderCredential) => Promise<T>): Promise<T> {
    const generation = this.generation(provider);
    const credential = await this.connectedCredential(provider);
    try { return await operation(this.driver(provider, credential), credential); }
    catch (error) {
      if (error instanceof WorkProviderCliAuthenticationError && generation === this.generation(provider)) {
        const connection = this.connection(provider);
        if (connection) this.setConnection({ ...connection, status: 'error', detail: error.message });
        await this.options.saveSnapshot();
      }
      throw error;
    }
  }

  private configurationDetail(provider: WorkProviderKind): WorkIntegrationConnection['detail'] {
    return workProviderDefinition(provider).configurationDetail;
  }

  private driver(provider: WorkProviderKind, credential?: WorkProviderCredential): WorkProviderDriver {
    if (credential && 'kind' in credential) {
      const cli = this.cliDriver(provider);
      if (cli) return cli;
    }
    const driver = this.drivers.get(provider);
    if (!driver) {
      throw new Error(`Unsupported work provider: ${provider}`);
    }
    return driver;
  }

  private cliDriver(provider: WorkProviderKind): WorkProviderCliDriver | undefined {
    return provider === 'github' ? this.options.githubCli : provider === 'gitlab' ? this.options.gitlabCli : undefined;
  }

  private snapshot(): AppSnapshot {
    return this.options.getSnapshot();
  }

  private setConnection(connection: WorkIntegrationConnection): boolean {
    const fallback = this.authorizationFallbacks.get(connection.provider);
    // Retain the usable CLI identity across a restart during direct authorization.
    if (connection.status === 'connecting' && fallback) connection = { ...fallback, ...connection, source: 'cli', accountLabel: fallback.accountLabel, connectedAt: fallback.connectedAt };
    const snapshot = this.snapshot();
    const index = snapshot.workBacklog.connections.findIndex((candidate) => candidate.provider === connection.provider);
    if (index === -1) {
      snapshot.workBacklog.connections.push(connection);
      return true;
    }

    const previous = snapshot.workBacklog.connections[index];
    // Status refreshes must not erase an explicit source or disconnect preference.
    if (connection.source === undefined && previous?.source) connection = { ...connection, source: previous.source };
    if (previous && JSON.stringify(previous) === JSON.stringify(connection)) {
      return false;
    }

    snapshot.workBacklog.connections[index] = connection;
    return true;
  }
}

const TOKEN_REFRESH_SKEW_MS = 60_000;

function tokenNeedsRefresh(token: WorkProviderToken): boolean {
  if (!token.expiresAt) return false;
  const expiresAt = Date.parse(token.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now() + TOKEN_REFRESH_SKEW_MS;
}

function refreshTokenExpired(token: WorkProviderToken): boolean {
  if (!token.refreshTokenExpiresAt) return false;
  const expiresAt = Date.parse(token.refreshTokenExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function normalizedOptionalString(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : null;
}

function publicAuthorization(authorization: WorkProviderDeviceAuthorization): WorkProviderAuthorization {
  return {
    provider: authorization.provider,
    ...(authorization.flow ? { flow: authorization.flow } : {}),
    ...(authorization.userCode ? { userCode: authorization.userCode } : {}),
    verificationUri: authorization.verificationUri,
    expiresAt: authorization.expiresAt,
  };
}

function directConnectionSource(provider: WorkProviderKind): { source?: 'api' } {
  return provider === 'github' || provider === 'gitlab' ? { source: 'api' } : {};
}

function providerLabel(provider: WorkProviderKind): string {
  return workProviderDefinition(provider).label;
}

function workProviderAuthorizationError(
  code: 'access_denied' | 'expired' | 'not_configured' | 'unavailable',
  provider: string,
): { key: string; params?: Record<string, string | number> } {
  if (code === 'access_denied') return { key: 'workProvider.authorizationCancelled', params: { provider } };
  if (code === 'expired') return { key: 'workProvider.verificationExpired' };
  if (code === 'not_configured') return { key: 'workProvider.oauthNotConfigured', params: { provider } };
  return { key: 'workProvider.authorizationUnavailable', params: { provider } };
}
