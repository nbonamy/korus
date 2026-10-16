import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AppSnapshot, WorkItem, WorkSource } from '@workspace/core/contracts';
import type { WorkProviderToken } from '@workspace/core/work-integration-tokens';
import { WorkIntegrationManager } from '../manager';
import { MemoryWorkIntegrationTokenStore } from '../memory-token-store';
import type { GitHubCliWorkProviderDriver } from '../github-cli-driver';
import type { WorkProviderDeviceAuthorization, WorkProviderDeviceTokenResult, WorkProviderDriver } from '../types';

describe('WorkIntegrationManager', () => {
  it('blocks new access while a disconnect is still deleting its stored credential', async () => {
    const snapshot = createInitialSnapshot();
    const tokenStore = new MemoryWorkIntegrationTokenStore();
    await tokenStore.set({ provider: 'github', accessToken: 'old-access', tokenType: 'bearer', connectedAt: 'now' });
    const driver = fakeDriver();
    const manager = createManager({ driver, snapshot, tokenStore });
    await manager.hydrateConnections();
    let finishDelete!: () => void;
    const remove = tokenStore.delete.bind(tokenStore);
    vi.spyOn(tokenStore, 'delete').mockImplementationOnce(async provider => {
      await new Promise<void>(resolve => { finishDelete = resolve; });
      await remove(provider);
    });
    const disconnect = manager.disconnect('github');
    try {
      await vi.waitFor(() => expect(finishDelete).toBeTypeOf('function'));
      await manager.hydrateConnections();
      expect(await manager.githubConnected()).toBe(false);
      expect(manager.isHostedMcpConnected('github')).toBe(false);
      await expect(manager.listSources('github')).rejects.toThrow('not connected');
      expect(driver.listSources).not.toHaveBeenCalled();
    } finally {
      finishDelete();
      await disconnect;
      manager.close();
    }
    expect(snapshot.workBacklog.connections[0]).toMatchObject({ source: 'none', status: 'disconnected' });
  });

  it('requires a connected integration before branch browsing and rejects unsupported integrations', async () => {
    const snapshot = createInitialSnapshot(), tokenStore = new MemoryWorkIntegrationTokenStore();
    const driver = fakeDriver();
    driver.listBranches = vi.fn().mockResolvedValue([{ name: 'main', isDefault: true }]);
    const manager = createManager({ driver, snapshot, tokenStore });
    await expect(manager.listBranches('github', 'org/repo')).rejects.toThrow('not connected');
    expect(driver.listBranches).not.toHaveBeenCalled();
    const token = { provider: 'github' as const, accessToken: 'connected', tokenType: 'bearer', connectedAt: 'now' };
    await tokenStore.set(token);
    expect(await manager.listBranches('github', 'org/repo')).toStrictEqual([{ name: 'main', isDefault: true }]);
    expect(driver.listBranches).toHaveBeenCalledExactlyOnceWith(token, 'org/repo');
    delete driver.listBranches;
    await expect(manager.listBranches('github', 'org/repo')).rejects.toThrow('unavailable');
  });

  describe.each(['request', 'hydration'] as const)('obsolete token read during %s', operation => {
    it.each(['disconnect', 'replacement authorization'] as const)('preserves %s without refreshing the old account', async transition => {
      const snapshot = createInitialSnapshot();
      const tokenStore = new MemoryWorkIntegrationTokenStore();
      const oldToken: WorkProviderToken = {
        provider: 'github', accessToken: 'old-access', tokenType: 'bearer',
        refreshToken: 'old-refresh', expiresAt: '2000-01-01T00:00:00.000Z',
        connectedAt: '2000-01-01T00:00:00.000Z',
      };
      await tokenStore.set(oldToken);
      const driver = fakeDriver({ refreshedToken: { ...oldToken, accessToken: 'stale-refresh-result' } });
      const manager = createManager({ driver, snapshot, tokenStore });
      let finishRead!: (token: WorkProviderToken) => void;
      vi.spyOn(tokenStore, 'get').mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
      const pending = operation === 'request'
        ? manager.authorizationHeader('github')
        : manager.hydrateConnections();
      const settled = operation === 'request'
        ? expect(pending).rejects.toThrow('Authorization was cancelled.')
        : pending;

      if (transition === 'disconnect') {
        await manager.disconnect('github');
      } else {
        await manager.connect('github');
        await manager.pollAuthorization('github');
      }
      const currentToken = await tokenStore.get('github');
      const currentConnections = structuredClone(snapshot.workBacklog.connections);
      finishRead(oldToken);
      await settled;

      expect(driver.refreshToken).not.toHaveBeenCalled();
      expect(await tokenStore.get('github')).toStrictEqual(currentToken);
      expect(snapshot.workBacklog.connections).toStrictEqual(currentConnections);
      expect(currentToken?.accessToken ?? null).toBe(transition === 'disconnect' ? null : 'gho_secret');
    });
  });

  it('marks unconfigured providers without opening an OAuth page', async () => {
    const snapshot = createInitialSnapshot();
    const openExternal = vi.fn();
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const manager = createManager({
      driver: fakeDriver({ configured: false }),
      openExternal,
      saveSnapshot,
      snapshot,
    });

    const result = await manager.connect('github');

    expect(result.authorization).toBeUndefined();
    expect(openExternal).not.toHaveBeenCalled();
    expect(saveSnapshot).toHaveBeenCalledOnce();
    expect(snapshot.workBacklog.connections).toStrictEqual([{
      provider: 'github',
      source: 'api',
      status: 'notConfigured',
      detail: { key: 'workProvider.oauthNotConfigured', params: { provider: 'GitHub' } },
    }]);
  });

  it.each<[string, { configured?: boolean; startError?: Error }, unknown]>([
    ['OAuth is not configured', { configured: false }, { key: 'workProvider.oauthNotConfigured', params: { provider: 'GitHub' } }],
    ['authorization cannot start', { startError: new Error('offline') }, 'offline'],
  ])('keeps GitHub CLI access when direct connect fails because %s', async (_name, input, detail) => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{ provider: 'github', source: 'cli', status: 'connected', accountLabel: 'alice', connectedAt: 'then' }];
    const driver = fakeDriver({ configured: input.configured });
    if (input.startError) vi.mocked(driver.startAuthorization).mockRejectedValue(input.startError);
    const manager = new WorkIntegrationManager({
      drivers: [driver], githubCli: {} as GitHubCliWorkProviderDriver, getSnapshot: () => snapshot,
      saveSnapshot: vi.fn().mockResolvedValue(undefined), tokenStore: new MemoryWorkIntegrationTokenStore(),
    });

    await manager.connect('github');

    expect(snapshot.workBacklog.connections).toStrictEqual([{
      provider: 'github', source: 'cli', status: 'connected', accountLabel: 'alice', connectedAt: 'then', detail,
    }]);
    expect(await manager.githubConnected()).toBe(true);
  });

  it('starts and completes GitHub device authorization', async () => {
    const snapshot = createInitialSnapshot();
    const tokenStore = new MemoryWorkIntegrationTokenStore();
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const driver = fakeDriver({
      authorization: {
        provider: 'github',
        deviceCode: 'device-code',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        intervalSeconds: 5,
      },
      pollResult: {
        status: 'success',
        token: {
          accessToken: 'gho_secret',
          tokenType: 'bearer',
          scope: 'repo read:user',
        },
      },
    });
    const manager = createManager({ driver, openExternal, saveSnapshot, snapshot, tokenStore });

    const result = await manager.connect('github');
    expect(result.authorization).toStrictEqual({
      provider: 'github',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresAt: result.authorization?.expiresAt,
    });
    expect(openExternal).not.toHaveBeenCalled();
    expect(snapshot.workBacklog.connections[0]).toMatchObject({
      provider: 'github',
      status: 'connecting',
    });

    await manager.pollAuthorization('github');

    expect(snapshot.workBacklog.connections).toStrictEqual([{
      provider: 'github',
      source: 'api',
      status: 'connected',
      accountLabel: 'nbonamy',
      connectedAt: expect.any(String),
    }]);
    await expect(tokenStore.get('github')).resolves.toMatchObject({
      accessToken: 'gho_secret',
      accountLabel: 'nbonamy',
    });
  });

  it('hydrates connected provider state from copied tokens', async () => {
    const snapshot = createInitialSnapshot();
    const tokenStore = new MemoryWorkIntegrationTokenStore();
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    await tokenStore.set({
      provider: 'github',
      accessToken: 'gho_secret',
      tokenType: 'bearer',
      scope: 'repo read:user',
      accountLabel: 'nbonamy',
      connectedAt: '2026-06-14T10:00:00.000Z',
    });
    const manager = createManager({
      driver: fakeDriver({ configured: false }),
      snapshot,
      saveSnapshot,
      tokenStore,
    });

    await manager.hydrateConnections();

    expect(snapshot.workBacklog.connections).toStrictEqual([{
      provider: 'github',
      status: 'connected',
      accountLabel: 'nbonamy',
      connectedAt: '2026-06-14T10:00:00.000Z',
    }]);
    expect(saveSnapshot).toHaveBeenCalledOnce();
  });

  it('refreshes an expired credential before hydrating it as connected', async () => {
    const snapshot = createInitialSnapshot();
    const tokenStore = new MemoryWorkIntegrationTokenStore();
    await tokenStore.set({
      provider: 'github',
      accessToken: 'ghu_expired',
      tokenType: 'bearer',
      expiresAt: '2026-07-31T00:00:00.000Z',
      refreshToken: 'ghr_refresh_1',
      connectedAt: '2026-07-30T00:00:00.000Z',
    });
    const refreshedToken: WorkProviderToken = {
      provider: 'github',
      accessToken: 'ghu_fresh',
      tokenType: 'bearer',
      expiresAt: '2099-08-02T00:00:00.000Z',
      refreshToken: 'ghr_refresh_2',
      accountLabel: 'nbonamy',
      connectedAt: '2026-07-30T00:00:00.000Z',
    };
    const driver = fakeDriver({ refreshedToken });
    const manager = createManager({ driver, snapshot, tokenStore });

    await manager.hydrateConnections();

    expect(driver.refreshToken).toHaveBeenCalledOnce();
    expect(manager.isConnected('github')).toBe(true);
    expect(snapshot.workBacklog.connections).toStrictEqual([{
      provider: 'github',
      status: 'connected',
      accountLabel: 'nbonamy',
      connectedAt: '2026-07-30T00:00:00.000Z',
    }]);
    await expect(tokenStore.get('github')).resolves.toStrictEqual(refreshedToken);
  });

  it('does not hydrate an expired unrefreshable credential as connected', async () => {
    const snapshot = createInitialSnapshot();
    const tokenStore = new MemoryWorkIntegrationTokenStore();
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    await tokenStore.set({
      provider: 'github',
      accessToken: 'ghu_expired',
      tokenType: 'bearer',
      expiresAt: '2026-07-31T00:00:00.000Z',
      connectedAt: '2026-07-30T00:00:00.000Z',
    });
    const manager = createManager({ snapshot, saveSnapshot, tokenStore });

    await manager.hydrateConnections();

    expect(manager.isConnected('github')).toBe(false);
    expect(snapshot.workBacklog.connections).toStrictEqual([{
      provider: 'github',
      source: 'api',
      status: 'disconnected',
      detail: { key: 'workProvider.authorizationExpired', params: { provider: 'GitHub' } },
    }]);
    expect(saveSnapshot).toHaveBeenCalledOnce();
  });

  it('rotates one expired token for concurrent provider requests', async () => {
    const snapshot = createInitialSnapshot();
    const tokenStore = new MemoryWorkIntegrationTokenStore();
    await tokenStore.set({
      provider: 'github',
      accessToken: 'ghu_expired',
      tokenType: 'bearer',
      expiresAt: '2026-07-31T00:00:00.000Z',
      refreshToken: 'ghr_refresh_1',
      refreshTokenExpiresAt: '2027-01-01T00:00:00.000Z',
      accountLabel: 'nbonamy',
      connectedAt: '2026-07-30T00:00:00.000Z',
    });
    const refreshedToken: WorkProviderToken = {
      provider: 'github',
      accessToken: 'ghu_fresh',
      tokenType: 'bearer',
      expiresAt: '2026-08-02T00:00:00.000Z',
      refreshToken: 'ghr_refresh_2',
      refreshTokenExpiresAt: '2027-02-01T00:00:00.000Z',
      accountLabel: 'nbonamy',
      connectedAt: '2026-07-30T00:00:00.000Z',
    };
    const driver = fakeDriver({ refreshedToken });
    const manager = createManager({ driver, snapshot, tokenStore });

    await Promise.all([
      manager.listSources('github'),
      manager.listItems('github', 'nbonamy/agent-workspace'),
    ]);

    expect(driver.refreshToken).toHaveBeenCalledOnce();
    expect(driver.listSources).toHaveBeenCalledWith(refreshedToken);
    expect(driver.listItems).toHaveBeenCalledWith(refreshedToken, 'nbonamy/agent-workspace');
    await expect(tokenStore.get('github')).resolves.toStrictEqual(refreshedToken);
  });

  it('supplies backend-only authorization and can force rotation after a hosted MCP 401', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{
      provider: 'github',
      status: 'connected',
      connectedAt: '2026-07-30T00:00:00.000Z',
    }];
    const tokenStore = new MemoryWorkIntegrationTokenStore();
    await tokenStore.set({
      provider: 'github',
      accessToken: 'ghu_current',
      tokenType: 'bearer',
      expiresAt: '2099-08-02T00:00:00.000Z',
      refreshToken: 'ghr_refresh_1',
      connectedAt: '2026-07-30T00:00:00.000Z',
    });
    const refreshedToken: WorkProviderToken = {
      provider: 'github',
      accessToken: 'ghu_rotated',
      tokenType: 'bearer',
      expiresAt: '2099-08-03T00:00:00.000Z',
      refreshToken: 'ghr_refresh_2',
      connectedAt: '2026-07-30T00:00:00.000Z',
    };
    const driver = fakeDriver({ refreshedToken });
    const manager = createManager({ driver, snapshot, tokenStore });

    expect(manager.isConnected('github')).toBe(true);
    await expect(manager.authorizationHeader('github')).resolves.toBe('bearer ghu_current');
    await expect(manager.authorizationHeader('github', { forceRefresh: true })).resolves.toBe('bearer ghu_rotated');
    expect(driver.refreshToken).toHaveBeenCalledOnce();
    await expect(tokenStore.get('github')).resolves.toStrictEqual(refreshedToken);
  });

  it('requires reconnection when an expired legacy token has no refresh token', async () => {
    const snapshot = createInitialSnapshot();
    const tokenStore = new MemoryWorkIntegrationTokenStore();
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    await tokenStore.set({
      provider: 'github',
      accessToken: 'ghu_expired',
      tokenType: 'bearer',
      expiresAt: '2026-07-31T00:00:00.000Z',
      connectedAt: '2026-07-30T00:00:00.000Z',
    });
    const manager = createManager({ snapshot, saveSnapshot, tokenStore });

    await expect(manager.listSources('github')).rejects.toThrow('GitHub needs to be reconnected.');
    expect(snapshot.workBacklog.connections).toStrictEqual([{
      provider: 'github',
      source: 'api',
      status: 'disconnected',
      detail: { key: 'workProvider.authorizationExpired', params: { provider: 'GitHub' } },
    }]);
    expect(saveSnapshot).toHaveBeenCalledOnce();
  });

  it('marks pending GitHub authorization expired when polling', async () => {
    const snapshot = createInitialSnapshot();
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const manager = createManager({
      driver: fakeDriver({
        authorization: {
          provider: 'github',
          deviceCode: 'device-code',
          userCode: 'ABCD-1234',
          verificationUri: 'https://github.com/login/device',
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
          intervalSeconds: 5,
        },
      }),
      openExternal,
      saveSnapshot,
      snapshot,
    });

    await manager.connect('github');
    await manager.pollAuthorization('github');

    expect(openExternal).not.toHaveBeenCalled();
    expect(saveSnapshot).toHaveBeenCalledTimes(2);
    expect(snapshot.workBacklog.connections).toStrictEqual([{
      provider: 'github',
      source: 'api',
      status: 'error',
      detail: { key: 'workProvider.verificationExpired' },
    }]);
  });

  it('keeps pending authorization alive and records pending detail', async () => {
    const snapshot = createInitialSnapshot();
    const manager = createManager({
      driver: fakeDriver({
        pollResult: {
          status: 'pending',
        },
      }),
      snapshot,
    });

    await manager.connect('github');
    await manager.pollAuthorization('github');

    expect(snapshot.workBacklog.connections[0]).toMatchObject({
      provider: 'github',
      status: 'connecting',
      detail: { key: 'workProvider.authorizationPending', params: { provider: 'GitHub' } },
    });
  });

  it('lists repositories and issues through the connected provider driver', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{
      provider: 'github',
      status: 'connected',
      accountLabel: 'nbonamy',
    }];
    const tokenStore = new MemoryWorkIntegrationTokenStore();
    await tokenStore.set({
      provider: 'github',
      accessToken: 'gho_secret',
      tokenType: 'bearer',
      accountLabel: 'nbonamy',
      connectedAt: '2026-06-09T12:00:00.000Z',
    });
    const repository = workRepository();
    const item = workItem();
    const manager = createManager({
      driver: fakeDriver({ repositories: [repository], items: [item] }),
      snapshot,
      tokenStore,
    });

    await expect(manager.listSources('github')).resolves.toStrictEqual([repository]);
    await expect(manager.listItems('github', 'nbonamy/agent-workspace')).resolves.toStrictEqual([item]);
    await expect(manager.listGlobalItems('github', { assignment: 'viewer', cursor: '2' })).resolves.toStrictEqual({
      items: [item],
      totalItems: 1,
    });
  });

  it('persists GitHub backlog provider configuration', async () => {
    const snapshot = createInitialSnapshot();
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const manager = createManager({ snapshot, saveSnapshot });

    await manager.configureBacklog({
      provider: 'github',
      configuration: {
        sourceId: ' nbonamy/agent-workspace ',
        assigneeLogin: ' nbonamy ',
        tagName: ' bug ',
      },
    });

    expect(snapshot.workBacklog.providerConfigurations).toStrictEqual({
      github: {
        sourceId: 'nbonamy/agent-workspace',
        assigneeLogin: 'nbonamy',
        tagName: 'bug',
      },
    });
    expect(saveSnapshot).toHaveBeenCalledOnce();

    await manager.configureBacklog({
      provider: 'github',
      configuration: {
        sourceId: 'nbonamy/agent-workspace',
        assigneeLogin: null,
        tagName: null,
      },
    });

    expect(snapshot.workBacklog.providerConfigurations).toStrictEqual({
      github: {
        sourceId: 'nbonamy/agent-workspace',
      },
    });

    await manager.configureBacklog({
      provider: 'github',
      configuration: {
        sourceId: null,
        tagName: 'bug',
      },
    });

    expect(snapshot.workBacklog.providerConfigurations).toStrictEqual({});
  });

  it('disconnects providers and clears backlog configuration state', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{
      provider: 'github',
      status: 'connected',
      accountLabel: 'nbonamy',
    }];
    snapshot.workBacklog.providerConfigurations.github = {
      sourceId: 'nbonamy/agent-workspace',
      tagName: 'bug',
    };
    const tokenStore = new MemoryWorkIntegrationTokenStore();
    await tokenStore.set({
      provider: 'github',
      accessToken: 'gho_secret',
      tokenType: 'bearer',
      accountLabel: 'nbonamy',
      connectedAt: '2026-06-09T12:00:00.000Z',
    });
    const manager = createManager({ snapshot, tokenStore });

    await manager.disconnect('github');

    await expect(tokenStore.get('github')).resolves.toBeNull();
    expect(snapshot.workBacklog).toStrictEqual({
      connections: [{
        provider: 'github',
        source: 'none',
        status: 'disconnected',
      }],
      providerConfigurations: {},
      providerSettings: {},
      assignments: {},
    });
  });
});

function createManager(input: {
  driver?: WorkProviderDriver;
  openExternal?: (url: string) => Promise<unknown>;
  saveSnapshot?: () => Promise<void>;
  snapshot: AppSnapshot;
  tokenStore?: MemoryWorkIntegrationTokenStore;
}): WorkIntegrationManager {
  return new WorkIntegrationManager({
    drivers: [input.driver ?? fakeDriver()],
    getSnapshot: () => input.snapshot,
    saveSnapshot: input.saveSnapshot ?? vi.fn().mockResolvedValue(undefined),
    tokenStore: input.tokenStore ?? new MemoryWorkIntegrationTokenStore(),
  });
}

function fakeDriver(input: Partial<{
  authorization: WorkProviderDeviceAuthorization;
  configured: boolean;
  items: WorkItem[];
  pollResult: WorkProviderDeviceTokenResult;
  refreshedToken: WorkProviderToken;
  repositories: WorkSource[];
}> = {}): WorkProviderDriver {
  return {
    provider: 'github',
    configured: () => input.configured ?? true,
    startAuthorization: vi.fn().mockResolvedValue(input.authorization ?? {
      provider: 'github',
      deviceCode: 'device-code',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      intervalSeconds: 5,
    }),
    pollAuthorization: vi.fn().mockResolvedValue(input.pollResult ?? {
      status: 'success',
      token: {
        accessToken: 'gho_secret',
        tokenType: 'bearer',
      },
    }),
    ...(input.refreshedToken ? { refreshToken: vi.fn().mockResolvedValue(input.refreshedToken) } : {}),
    currentAccountLabel: vi.fn().mockResolvedValue('nbonamy'),
    listSources: vi.fn().mockResolvedValue(input.repositories ?? []),
    listGlobalItems: vi.fn().mockImplementation(() => Promise.resolve({
      items: input.items ?? [],
      totalItems: (input.items ?? []).length,
    })),
    listItems: vi.fn().mockResolvedValue(input.items ?? []),
  };
}

function workRepository(): WorkSource {
  return {
    provider: 'github',
    id: 'nbonamy/agent-workspace',
    owner: 'nbonamy',
    name: 'agent-workspace',
    fullName: 'nbonamy/agent-workspace',
    url: 'https://github.com/nbonamy/agent-workspace',
    isPrivate: true,
  };
}

function workItem(): WorkItem {
  return {
    provider: 'github',
    id: 'nbonamy/agent-workspace#12',
    sourceId: 'nbonamy/agent-workspace',
    sourceName: 'nbonamy/agent-workspace',
    number: 12,
    title: 'Fix cockpit drag target',
    url: 'https://github.com/nbonamy/agent-workspace/issues/12',
    state: 'open',
    labels: [],
    createdAt: '2026-06-09T12:00:00.000Z',
    updatedAt: '2026-06-09T12:30:00.000Z',
  };
}
