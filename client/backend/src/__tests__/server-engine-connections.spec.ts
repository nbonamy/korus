import { describe, expect, it, vi } from 'vitest';
import { AppBackendServer } from '../server';
import { claudeAuthenticationDriver } from './support/scripted-driver';
import { createTestSnapshot, readyRemoteConnection } from './server-test-fixtures';
import { normalizeGeneralSettings } from '@workspace/core/settings';
import { defaultProviderCapabilities } from '@workspace/core/provider-capabilities';
import type { AgentProviderDriver } from '@workspace/core/provider-driver';
import { resolveProviderCoordinationPolicy } from '@workspace/core/provider-driver';
import { ProviderDriverRpc } from '../driver-rpc';

const claudeAuth = vi.hoisted(() => ({ check: vi.fn(), logout: vi.fn() }));


describe('connected engine admission', () => {
  it('refreshes changed local runtime capabilities for any provider while retaining status and detail', async () => {
    const snapshot = createTestSnapshot(); snapshot.general.celebrationsEnabled = false;
    const base = { teamId: 'team-test', folder: '/synthetic', status: { type: 'idle' as const }, createdAt: 'created', updatedAt: 'updated' };
    snapshot.agents = [
      { ...base, id: 'remote-claude', name: 'Remote Claude', provider: 'claude', remoteConnectionId: 'connection-devbox' },
      { ...base, id: 'local-claude', name: 'Local Claude', provider: 'claude' },
      { ...base, id: 'remote-only', name: 'Remote only', provider: 'antigravity', remoteConnectionId: 'connection-devbox' },
    ];
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    const capabilities = () => ({ ...defaultProviderCapabilities('claude'), codeReview: false, steerPrompt: snapshot.general.celebrationsEnabled });
    const runtime = { provider: 'claude' as const, status: 'error' as const, detail: 'Preserved status detail', capabilities: capabilities() };
    const remoteOnly = { provider: 'antigravity' as const, status: 'starting' as const, detail: 'Preserved remote-only runtime', capabilities: defaultProviderCapabilities('antigravity') };
    snapshot.providerRuntimes = [runtime, remoteOnly];
    const getCapabilities = vi.fn(capabilities), onEvent = vi.fn();
    const driver: AgentProviderDriver = { provider: 'claude', getCapabilities, getRuntimeStatus: () => ({ provider: 'claude', status: 'running' }), sendPrompt: vi.fn(), interrupt: vi.fn(), respondToAgentRequest: vi.fn(), onEvent: () => () => {}, close: async () => {} };
    const server = new AppBackendServer({ version: 'test', snapshot, onEvent, driverRpc: new ProviderDriverRpc(new Map([['claude', driver]])) });
    const update = (enabled: boolean) => server.handleMessage({ jsonrpc: '2.0', id: 'settings', method: 'settings/update', params: { input: { general: { celebrationsEnabled: enabled } } } });
    try {
      await update(true);
      expect(snapshot.providerRuntimes[0]).toStrictEqual({ ...runtime, capabilities: capabilities() });
      expect(snapshot.providerRuntimes[1]).toStrictEqual(remoteOnly);
      expect(getCapabilities).toHaveBeenLastCalledWith(snapshot.agents[1]);
      expect(onEvent.mock.calls.filter(([event]) => event.type === 'provider.statusChanged')).toHaveLength(1);
      await update(true);
      expect(onEvent.mock.calls.filter(([event]) => event.type === 'provider.statusChanged')).toHaveLength(1);
      await update(false);
      expect(snapshot.providerRuntimes[0]).toStrictEqual({ ...runtime, capabilities: capabilities() });
      expect(onEvent.mock.calls.filter(([event]) => event.type === 'provider.statusChanged')).toHaveLength(2);
      expect(driver.sendPrompt).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });
  it.each([false, true])('uses registered authentication policy rather than backend identity (declared=%s)', async declared => {
    const snapshot = createTestSnapshot(); snapshot.general.providerEnabled = { claude: false };
    let connected = true;
    const authenticate = vi.fn(async () => ({ kind: 'claude' as const, connected, state: { loggedIn: connected } }));
    const driver: AgentProviderDriver = {
      provider: 'claude',
      ...(declared ? { coordinationPolicy: { authentication: { actions: ['check', 'cancel', 'logout', 'login'] as const, refreshOnAdmission: true, enableOnSuccess: false } } } : {}),
      authenticate, getRuntimeStatus: () => ({ provider: 'claude', status: 'running' }), getCapabilities: () => defaultProviderCapabilities('claude'),
      sendPrompt: vi.fn(), interrupt: vi.fn(), respondToAgentRequest: vi.fn(), onEvent: () => () => {}, close: async () => {},
    };
    const rpc = new ProviderDriverRpc(new Map([['claude', driver]]));
    const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: rpc,
      providerSetup: { isChanging: () => false, list: () => [{ provider: 'claude', installed: true, homePath: '/synthetic/claude' }] } as never });
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 'auth', method: 'claude/authentication/get', params: {} });
      expect(snapshot.general.providerEnabled?.claude).toBe(!declared);
      if (declared) await server.handleMessage({ jsonrpc: '2.0', id: 'enable', method: 'provider/enabled/set', params: { provider: 'claude', enabled: true } });
      const checks = authenticate.mock.calls.length;
      await expect(Promise.all([server.requireConnectedEngine('claude'), server.requireConnectedEngine('claude')])).resolves.toStrictEqual(['claude', 'claude']);
      expect(authenticate).toHaveBeenCalledTimes(checks + (declared ? 1 : 0));
      connected = false;
      if (declared) await expect(server.requireConnectedEngine()).rejects.toThrow('Connect a coding engine');
      else await expect(server.requireConnectedEngine()).resolves.toBe('claude');
      connected = true;
      const beforeLogin = authenticate.mock.calls.length;
      const login = server.handleMessage({ jsonrpc: '2.0', id: 'login', method: 'provider/authenticate', params: { provider: 'claude', action: 'login' } });
      if (declared) {
        expect(await login).toMatchObject({ result: { kind: 'claude', connected: true } });
        expect(authenticate).toHaveBeenCalledTimes(beforeLogin + 1);
        expect(authenticate).toHaveBeenLastCalledWith({ action: 'login' });
      } else {
        await expect(login).rejects.toThrow('Unsupported native authentication action');
        expect(authenticate).toHaveBeenCalledTimes(beforeLogin);
        await expect(rpc.handle('driver/provider/authentication', { provider: 'claude', action: 'login' })).rejects.toThrow('Invalid authentication action');
      }
    } finally { await server.close(); }
  });
  it.each(['disconnect', 'disable', 'account'])('discards an in-flight quota response after provider %s', async change => {
    const snapshot = createTestSnapshot();
    snapshot.providerConnections = [{ provider: 'cursor', installed: true, connected: true, checking: false, enabled: true,
      authentication: { kind: 'cursor', connected: true, state: { loggedIn: true, homePath: '/cursor', account: { type: 'subscription', email: 'first@example.test' } } } }];
    let resolve!: (value: unknown) => void;
    const handle = vi.fn(() => new Promise(done => { resolve = done; }));
    const onEvent = vi.fn();
    const server = new AppBackendServer({ version: 'test', snapshot, onEvent,
      driverRpc: { handle, onEvent: () => () => {}, close: async () => {} } as never });
    try {
      const result = server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/usage/get', params: { provider: 'cursor' } });
      await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
      const provider = snapshot.providerConnections![0]!;
      if (change === 'disconnect') provider.connected = false;
      if (change === 'disable') provider.enabled = false;
      if (change === 'account' && provider.authentication?.kind === 'cursor') provider.authentication.state.account!.email = 'second@example.test';
      resolve({ supported: true, rateLimits: { limitId: 'cursor', primary: null, secondary: null, credits: null, individualLimit: null, planType: 'old-account-plan', limitName: null, rateLimitReachedType: null } });
      expect(await result).toMatchObject({ result: null });
      expect(snapshot.providerAccountRateLimits?.cursor).toBeUndefined();
      expect(onEvent.mock.calls.some(([event]) => event.type === 'account.rateLimitsUpdated')).toBe(false);
    } finally { await server.close(); }
  });
  it('observes and enables Cursor independently and rechecks a previously connected account', async () => {
    const snapshot = createTestSnapshot();
    snapshot.general.providerEnabled = { cursor: false };
    let connected = true;
    const handle = vi.fn(async () => ({ kind: 'cursor', connected, state: { loggedIn: connected, homePath: '/cursor' } }));
    const observedConnections: boolean[] = [];
    let recordConnections = false;
    const server = new AppBackendServer({ version: 'test', snapshot,
      onEvent: event => { if (recordConnections && event.type === 'snapshot.updated') observedConnections.push(event.payload.providerConnections?.find(provider => provider.provider === 'cursor')?.connected ?? false); },
      driverRpc: { handle, getCoordinationPolicy: () => resolveProviderCoordinationPolicy({ authentication: { refreshOnAdmission: true, enableOnSuccess: false } }), onEvent: () => () => {}, close: async () => {} } as never,
      providerSetup: { isChanging: () => false, list: () => [{ provider: 'cursor', installed: true, homePath: '/cursor' }] } as never,
    });
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/connections/get' });
      expect(snapshot.providerConnections?.[0]).toMatchObject({ installed: true, connected: true, enabled: false });
      expect(snapshot.general.providerEnabled?.cursor).toBe(false);
      await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'provider/enabled/set', params: { provider: 'cursor', enabled: true } });
      recordConnections = true;
      const checks = handle.mock.calls.length;
      await expect(Promise.all([server.requireConnectedEngine('cursor'), server.requireConnectedEngine('cursor')])).resolves.toStrictEqual(['cursor', 'cursor']);
      expect(observedConnections.length).toBeGreaterThan(0);
      expect(observedConnections.every(Boolean)).toBe(true);
      expect(handle).toHaveBeenCalledTimes(checks + 1);
      recordConnections = false;
      await server.handleMessage({ jsonrpc: '2.0', id: 'new-chat', method: 'agent/quickChat/create', params: { input: { teamId: 'team-test', selection: { provider: 'cursor' } } } });
      const agent = snapshot.agents[0]!;
      connected = false;
      const probes = handle.mock.calls.length;
      const saved = await server.handleMessage({ jsonrpc: '2.0', id: 'model-save', method: 'agent/update', params: { input: {
        id: agent.id, selection: { provider: 'cursor', model: 'native-model', reasoningEffort: null, serviceTier: null },
      } } });
      expect(saved).toMatchObject({ result: { agents: [expect.objectContaining({ provider: 'cursor', providerDefaults: expect.objectContaining({ model: 'native-model' }) })] } });
      expect(handle).toHaveBeenCalledTimes(probes);
      expect(snapshot.providerConnections?.[0]?.connected).toBe(true);
      // Saving a preference needs no provider work; actual work still checks fresh authentication.
      expect(await server.handleMessage({ jsonrpc: '2.0', id: 'send', method: 'agent/prompt/send', params: { agentId: agent.id, prompt: 'Hello' } }))
        .toMatchObject({ error: { message: expect.stringContaining('not connected') } });
      expect(agent.provider).toBe('cursor');
      await expect(server.requireConnectedEngine('cursor')).rejects.toThrow('not connected');
      expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: false, enabled: true });
      connected = true;
      await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'provider/connections/get' });
      expect(snapshot.providerConnections?.[0]?.connected).toBe(true);
      handle.mockRejectedValueOnce(new Error('probe transport failed'));
      await expect(server.requireConnectedEngine('cursor')).rejects.toThrow('Could not check');
      expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: true, checking: false });
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 4, method: 'provider/enabled/set', params: { provider: 'cursor', enabled: false } })).rejects.toThrow('last engine');
    } finally { await server.close(); }
  });

  it('admits connected Antigravity work and keeps authentication and disablement checks without a release gate', async () => {
    const snapshot = createTestSnapshot();
    let connected = false;
    const handle = vi.fn(async (_method, params) => params.provider === 'antigravity'
      ? { kind: 'antigravity', connected, state: { loggedIn: connected, homePath: '/acp' } }
      : { kind: 'codex', connected: true, state: { account: { type: 'apiKey' }, requiresOpenaiAuth: false, login: { status: 'idle', error: null } } });
    const server = new AppBackendServer({ version: 'test', snapshot,
      driverRpc: { handle, onEvent: () => () => {}, close: async () => {} } as never,
      providerSetup: { isChanging: () => false, list: () => [
        { provider: 'codex', installed: true, homePath: '/codex' },
        { provider: 'antigravity', installed: true, homePath: '/acp' },
      ] } as never,
    });
    try {
      await expect(server.requireConnectedEngine('antigravity')).rejects.toThrow('not connected');
      connected = true;
      const created = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'agent/quickChat/create', params: { input: { teamId: 'team-test', selection: { ...{ provider: 'antigravity' } } } } });
      expect(created).toMatchObject({ result: { agents: [expect.objectContaining({ provider: 'antigravity' })] } });
      const agent = snapshot.agents[0]!;
      snapshot.queuedPrompts = [{ id: 'queued', agentId: agent.id, text: 'Later', createdAt: '' }];
      await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'provider/enabled/set', params: { provider: 'antigravity', enabled: false } });
      expect(await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'agent/prompt/send', params: { agentId: agent.id, prompt: 'Work' } }))
        .toMatchObject({ error: { message: expect.stringContaining('disabled') } });
      expect(snapshot.agents).toEqual([agent]);
      expect(snapshot.queuedPrompts).toHaveLength(1);
      expect(snapshot.providerConnections?.find(provider => provider.provider === 'antigravity')).toMatchObject({ connected: true, enabled: false });
    } finally { await server.close(); }
  });

  it('retries an Antigravity login observation through the owning connection operation without changing enablement', async () => {
    const snapshot = createTestSnapshot();
    snapshot.general.providerEnabled = { antigravity: false };
    const handle = vi.fn().mockResolvedValueOnce({ kind: 'antigravity', connected: false, state: { loggedIn: false, homePath: '/acp' } })
      .mockResolvedValue({ kind: 'antigravity', connected: true, state: { loggedIn: true, homePath: '/acp' } });
    const server = new AppBackendServer({ version: 'test', snapshot,
      driverRpc: { handle, onEvent: () => () => {}, close: async () => {} } as never,
      providerSetup: { isChanging: () => false, list: () => [{ provider: 'antigravity', installed: true, homePath: '/acp' }] } as never,
    });
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/connections/get' });
      expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: false, enabled: false });
      await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'provider/connections/get' });
      expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: true, enabled: false });
      await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'provider/connections/get' });
      expect(handle).toHaveBeenCalledTimes(2);
      expect(snapshot.general.providerEnabled).toEqual({ antigravity: false });
    } finally { await server.close(); }
  });
  it('persists disablement without probing, interrupting a turn, or losing queued work; external auth changes are ignored', async () => {
    const snapshot = createTestSnapshot();
    const authenticate = claudeAuth.check.mockResolvedValue({ loggedIn: true });
    const driverRpc = { handle: vi.fn(async (_method, params) => params.provider === 'claude'
      ? claudeAuthenticationDriver(claudeAuth).authenticate!(params)
      : { kind: 'codex', connected: true, state: { account: { type: 'apiKey' }, requiresOpenaiAuth: false, login: { status: 'idle', error: null } } }), onEvent: vi.fn(() => () => undefined), close: vi.fn() };
    let saved = snapshot.general;
    const server = new AppBackendServer({
      version: 'test', snapshot, driverRpc: driverRpc as never,
      saveSnapshot: async value => { saved = structuredClone(value.general); },
      providerSetup: { isChanging: () => false, list: () => [{ provider: 'claude', installed: true, homePath: '/app/claude' }, { provider: 'codex', installed: true, homePath: '/app/codex' }] } as never,
    });
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'agent/quickChat/create', params: { input: { teamId: 'team-test' } } });
      const agent = snapshot.agents[0]!;
      expect(snapshot.providerConnections?.find(engine => engine.provider === 'codex')?.authentication)
        .toMatchObject({ kind: 'codex', connected: true, state: { account: { type: 'apiKey' }, login: { status: 'idle' } } });
      agent.status = { type: 'working', detail: 'Running' };
      snapshot.queuedPrompts = [{ id: 'queued', agentId: agent.id, text: 'Later', createdAt: '' }];
      authenticate.mockClear().mockResolvedValue({ loggedIn: false });
      driverRpc.handle.mockClear();
      await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'provider/connections/get' });
      expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: true, enabled: true });
      await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'provider/enabled/set', params: { provider: 'claude', enabled: false } });
      expect(normalizeGeneralSettings(saved).providerEnabled).toEqual({ claude: false });
      expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: true, enabled: false });
      const lastEngineMessage = 'Cannot disable the last engine. Enable another one first.';
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 31, method: 'provider/enabled/set', params: { provider: 'codex', enabled: false } })).rejects.toThrow(lastEngineMessage);
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 32, method: 'settings/update', params: { input: { general: { providerEnabled: { codex: false } } } } })).rejects.toThrow(lastEngineMessage);
      expect(snapshot.general.providerEnabled).toEqual({ claude: false });
      expect(snapshot.providerConnections?.find(engine => engine.provider === 'codex')).toMatchObject({ connected: true, enabled: true });
      expect(agent.status.type).toBe('working');
      expect(snapshot.queuedPrompts).toMatchObject([{ id: 'queued', text: 'Later' }]);
      expect(await server.handleMessage({ jsonrpc: '2.0', id: 4, method: 'agent/quickChat/create', params: { input: { teamId: 'team-test', selection: { ...{ provider: 'claude' } } } } }))
        .toMatchObject({ error: { message: expect.stringContaining('disabled') } });
      await server.handleMessage({ jsonrpc: '2.0', id: 5, method: 'provider/enabled/set', params: { provider: 'claude', enabled: true } });
      expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: true, enabled: true });
      expect(authenticate).not.toHaveBeenCalled();
      expect(driverRpc.handle).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });

  it('routes remote toggles to their owner without changing local engine preferences', async () => {
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    const providers = [{ provider: 'claude', installed: true, connected: true, enabled: false, checking: false }];
    const clients = { request: vi.fn().mockResolvedValue(providers), close: vi.fn() };
    const server = new AppBackendServer({ version: 'test', snapshot, remoteClients: clients as never });
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/enabled/set', params: { provider: 'claude', enabled: false, remoteConnectionId: connection.id } });
      expect(clients.request).toHaveBeenCalledWith(connection, 'provider/enabled/set', expect.objectContaining({ provider: 'claude', enabled: false }), expect.any(Function));
      expect(connection.providerConnections).toEqual(providers);
      expect(snapshot.general.providerEnabled).toBeUndefined();
    } finally { await server.close(); }
  });

  it('creates Claude-only quick chats, then blocks new work after logout without deleting chats or queues', async () => {
    const snapshot = createTestSnapshot();
    snapshot.providerConnections = [];
    const driverRpc = { handle: vi.fn((_method, params) => claudeAuthenticationDriver(claudeAuth).authenticate!(params)), onEvent: vi.fn(() => () => undefined), close: vi.fn() };
    const providerSetup = { isChanging: () => false, list: () => [
      { provider: 'codex', installed: false, homePath: '/absent' },
      { provider: 'claude', installed: true, homePath: '/app/claude' },
    ] };
    claudeAuth.check.mockResolvedValue({ loggedIn: true });
    const server = new AppBackendServer({ version: 'test', snapshot, providerSetup: providerSetup as never, driverRpc: driverRpc as never });
    try {
      const created = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'agent/quickChat/create', params: { input: { teamId: 'team-test' } } });
      expect(created).toMatchObject({ result: { agents: [expect.objectContaining({ provider: 'claude' })] } });
      expect(driverRpc.handle).toHaveBeenCalledExactlyOnceWith('driver/provider/authentication', { provider: 'claude', action: 'check' });
      const agent = snapshot.agents[0]!;
      snapshot.queuedPrompts = [{ id: 'queued', agentId: agent.id, text: 'Later', createdAt: '' }];
      claudeAuth.logout.mockRejectedValueOnce(new Error('Sign-out failed')).mockResolvedValue({ loggedIn: false });
      const disconnect = { jsonrpc: '2.0' as const, id: 2, method: 'provider/disconnect', params: { provider: 'claude' } };
      await expect(server.handleMessage(disconnect)).resolves.toMatchObject({ error: { message: 'Sign-out failed' } });
      expect(snapshot.providerConnections?.find(engine => engine.provider === 'claude')?.connected).toBe(true);
      await expect(server.handleMessage(disconnect)).resolves.toMatchObject({ result: { kind: 'claude', connected: false } });
      expect(driverRpc.handle).toHaveBeenLastCalledWith('driver/provider/authentication', { provider: 'claude', action: 'logout' });
      expect(snapshot.general.providerEnabled?.claude).not.toBe(false);
      claudeAuth.check.mockResolvedValue({ loggedIn: false });
      const rejected = await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'agent/prompt/send', params: { agentId: agent.id, prompt: 'New work' } });
      expect(rejected).toMatchObject({ error: { message: expect.stringContaining('not connected') } });
      expect(snapshot.agents).toHaveLength(1);
      expect(snapshot.agents[0]?.provider).toBe('claude');
      expect(snapshot.queuedPrompts).toMatchObject([{ id: 'queued', text: 'Later' }]);
    } finally { await server.close(); }
  });

  it.each(['codex', 'claude'])('signs out remote %s only on its owning host', async provider => {
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    const localConnections = structuredClone(snapshot.providerConnections);
    const result = { kind: provider, connected: false, state: {} };
    const clients = { request: vi.fn().mockResolvedValue(result), close: vi.fn() };
    const server = new AppBackendServer({ version: 'test', snapshot, remoteClients: clients as never });
    try {
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/disconnect', params: { provider: provider, remoteConnectionId: connection.id } }))
        .resolves.toMatchObject({ result });
      expect(clients.request).toHaveBeenCalledWith(connection, 'provider/disconnect', expect.objectContaining({ provider: provider }), expect.any(Function));
      expect(snapshot.providerConnections).toEqual(localConnections);
    } finally { await server.close(); }
  });

  it('does not infer Codex for a remote that lacks the connection contract', async () => {
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    const clients = { request: vi.fn().mockResolvedValue({ installed: true }), close: vi.fn() };
    const server = new AppBackendServer({ version: 'test', snapshot, remoteClients: clients as never });
    try {
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/connections/get', params: { remoteConnectionId: connection.id } }))
        .rejects.toThrow('Update the remote runtime');
      expect(connection.providerConnections).toBeUndefined();
      expect(snapshot.providerConnections).toEqual(createTestSnapshot().providerConnections);
    } finally { await server.close(); }
  });
});
