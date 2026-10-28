import { describe, expect, it, vi } from 'vitest';
import { AppBackendServer } from '../server';
import { getLocalClaudeAuthentication, logoutLocalClaude } from '../claude/authentication';
import { ClaudeBackendDriver } from '../claude/claude-driver';
import { createTestSnapshot, readyRemoteConnection } from './server-test-fixtures';
import { normalizeGeneralSettings } from '@workspace/core/settings';

vi.mock('../claude/authentication', () => ({ getLocalClaudeAuthentication: vi.fn(), logoutLocalClaude: vi.fn() }));

describe('connected engine admission', () => {
  it('admits connected Antigravity work and keeps authentication and disablement checks without a release gate', async () => {
    const snapshot = createTestSnapshot();
    let connected = false;
    const handle = vi.fn(async (_method, params) => params.backend === 'antigravity'
      ? { kind: 'antigravity', connected, state: { loggedIn: connected, homePath: '/acp' } }
      : { kind: 'codex', connected: true, state: { account: { type: 'apiKey' }, requiresOpenaiAuth: false, login: { status: 'idle', error: null } } });
    const server = new AppBackendServer({ version: 'test', snapshot,
      driverRpc: { handle, onEvent: () => () => {}, close: async () => {} } as never,
      providerSetup: { isChanging: () => false, list: () => [
        { backend: 'codex', installed: true, homePath: '/codex' },
        { backend: 'antigravity', installed: true, homePath: '/acp' },
      ] } as never,
    });
    try {
      await expect(server.requireConnectedEngine('antigravity')).rejects.toThrow('not connected');
      connected = true;
      const created = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'agent/quickChat/create', params: { input: { teamId: 'team-test', selection: { ...{ backend: 'antigravity' } } } } });
      expect(created).toMatchObject({ result: { agents: [expect.objectContaining({ backend: 'antigravity' })] } });
      const agent = snapshot.agents[0]!;
      snapshot.queuedPrompts = [{ id: 'queued', agentId: agent.id, text: 'Later', createdAt: '' }];
      await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'provider/enabled/set', params: { backend: 'antigravity', enabled: false } });
      expect(await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'agent/prompt/send', params: { agentId: agent.id, prompt: 'Work' } }))
        .toMatchObject({ error: { message: expect.stringContaining('disabled') } });
      expect(snapshot.agents).toEqual([agent]);
      expect(snapshot.queuedPrompts).toHaveLength(1);
      expect(snapshot.providerConnections?.find(provider => provider.backend === 'antigravity')).toMatchObject({ connected: true, enabled: false });
    } finally { await server.close(); }
  });

  it('retries an Antigravity login observation through the owning connection operation without changing enablement', async () => {
    const snapshot = createTestSnapshot();
    snapshot.general.providerEnabled = { antigravity: false };
    const handle = vi.fn().mockResolvedValueOnce({ kind: 'antigravity', connected: false, state: { loggedIn: false, homePath: '/acp' } })
      .mockResolvedValue({ kind: 'antigravity', connected: true, state: { loggedIn: true, homePath: '/acp' } });
    const server = new AppBackendServer({ version: 'test', snapshot,
      driverRpc: { handle, onEvent: () => () => {}, close: async () => {} } as never,
      providerSetup: { isChanging: () => false, list: () => [{ backend: 'antigravity', installed: true, homePath: '/acp' }] } as never,
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
    const authenticate = vi.mocked(getLocalClaudeAuthentication).mockResolvedValue({ loggedIn: true });
    const driverRpc = { handle: vi.fn(async (_method, params) => params.backend === 'claude'
      ? new ClaudeBackendDriver().authenticate(params)
      : { kind: 'codex', connected: true, state: { account: { type: 'apiKey' }, requiresOpenaiAuth: false, login: { status: 'idle', error: null } } }), onEvent: vi.fn(() => () => undefined), close: vi.fn() };
    let saved = snapshot.general;
    const server = new AppBackendServer({
      version: 'test', snapshot, driverRpc: driverRpc as never,
      saveSnapshot: async value => { saved = structuredClone(value.general); },
      providerSetup: { isChanging: () => false, list: () => [{ backend: 'claude', installed: true, homePath: '/app/claude' }, { backend: 'codex', installed: true, homePath: '/app/codex' }] } as never,
    });
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'agent/quickChat/create', params: { input: { teamId: 'team-test' } } });
      const agent = snapshot.agents[0]!;
      expect(snapshot.providerConnections?.find(engine => engine.backend === 'codex')?.authentication)
        .toMatchObject({ kind: 'codex', connected: true, state: { account: { type: 'apiKey' }, login: { status: 'idle' } } });
      agent.status = { type: 'working', detail: 'Running' };
      snapshot.queuedPrompts = [{ id: 'queued', agentId: agent.id, text: 'Later', createdAt: '' }];
      authenticate.mockClear().mockResolvedValue({ loggedIn: false });
      driverRpc.handle.mockClear();
      await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'provider/connections/get' });
      expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: true, enabled: true });
      await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'provider/enabled/set', params: { backend: 'claude', enabled: false } });
      expect(normalizeGeneralSettings(saved).providerEnabled).toEqual({ claude: false });
      expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: true, enabled: false });
      const lastEngineMessage = 'Cannot disable the last engine. Enable another one first.';
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 31, method: 'provider/enabled/set', params: { backend: 'codex', enabled: false } })).rejects.toThrow(lastEngineMessage);
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 32, method: 'settings/update', params: { input: { general: { providerEnabled: { codex: false } } } } })).rejects.toThrow(lastEngineMessage);
      expect(snapshot.general.providerEnabled).toEqual({ claude: false });
      expect(snapshot.providerConnections?.find(engine => engine.backend === 'codex')).toMatchObject({ connected: true, enabled: true });
      expect(agent.status.type).toBe('working');
      expect(snapshot.queuedPrompts).toMatchObject([{ id: 'queued', text: 'Later' }]);
      expect(await server.handleMessage({ jsonrpc: '2.0', id: 4, method: 'agent/quickChat/create', params: { input: { teamId: 'team-test', selection: { ...{ backend: 'claude' } } } } }))
        .toMatchObject({ error: { message: expect.stringContaining('disabled') } });
      await server.handleMessage({ jsonrpc: '2.0', id: 5, method: 'provider/enabled/set', params: { backend: 'claude', enabled: true } });
      expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: true, enabled: true });
      expect(authenticate).not.toHaveBeenCalled();
      expect(driverRpc.handle).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });

  it('routes remote toggles to their owner without changing local engine preferences', async () => {
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    const providers = [{ backend: 'claude', installed: true, connected: true, enabled: false, checking: false }];
    const clients = { request: vi.fn().mockResolvedValue(providers), close: vi.fn() };
    const server = new AppBackendServer({ version: 'test', snapshot, remoteClients: clients as never });
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/enabled/set', params: { backend: 'claude', enabled: false, remoteConnectionId: connection.id } });
      expect(clients.request).toHaveBeenCalledWith(connection, 'provider/enabled/set', expect.objectContaining({ backend: 'claude', enabled: false }), expect.any(Function));
      expect(connection.providerConnections).toEqual(providers);
      expect(snapshot.general.providerEnabled).toBeUndefined();
    } finally { await server.close(); }
  });

  it('creates Claude-only quick chats, then blocks new work after logout without deleting chats or queues', async () => {
    const snapshot = createTestSnapshot();
    snapshot.providerConnections = [];
    const driverRpc = { handle: vi.fn((_method, params) => new ClaudeBackendDriver().authenticate(params)), onEvent: vi.fn(() => () => undefined), close: vi.fn() };
    const providerSetup = { isChanging: () => false, list: () => [
      { backend: 'codex', installed: false, homePath: '/absent' },
      { backend: 'claude', installed: true, homePath: '/app/claude' },
    ] };
    vi.mocked(getLocalClaudeAuthentication).mockResolvedValue({ loggedIn: true });
    const server = new AppBackendServer({ version: 'test', snapshot, providerSetup: providerSetup as never, driverRpc: driverRpc as never });
    try {
      const created = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'agent/quickChat/create', params: { input: { teamId: 'team-test' } } });
      expect(created).toMatchObject({ result: { agents: [expect.objectContaining({ backend: 'claude' })] } });
      expect(driverRpc.handle).toHaveBeenCalledExactlyOnceWith('driver/provider/authentication', { backend: 'claude', action: 'check' });
      const agent = snapshot.agents[0]!;
      snapshot.queuedPrompts = [{ id: 'queued', agentId: agent.id, text: 'Later', createdAt: '' }];
      vi.mocked(logoutLocalClaude).mockRejectedValueOnce(new Error('Sign-out failed')).mockResolvedValue({ loggedIn: false });
      const disconnect = { jsonrpc: '2.0' as const, id: 2, method: 'provider/disconnect', params: { backend: 'claude' } };
      await expect(server.handleMessage(disconnect)).resolves.toMatchObject({ error: { message: 'Sign-out failed' } });
      expect(snapshot.providerConnections?.find(engine => engine.backend === 'claude')?.connected).toBe(true);
      await expect(server.handleMessage(disconnect)).resolves.toMatchObject({ result: { kind: 'claude', connected: false } });
      expect(driverRpc.handle).toHaveBeenLastCalledWith('driver/provider/authentication', { backend: 'claude', action: 'logout' });
      expect(snapshot.general.providerEnabled?.claude).not.toBe(false);
      vi.mocked(getLocalClaudeAuthentication).mockResolvedValue({ loggedIn: false });
      const rejected = await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'agent/prompt/send', params: { agentId: agent.id, prompt: 'New work' } });
      expect(rejected).toMatchObject({ error: { message: expect.stringContaining('not connected') } });
      expect(snapshot.agents).toHaveLength(1);
      expect(snapshot.agents[0]?.backend).toBe('claude');
      expect(snapshot.queuedPrompts).toMatchObject([{ id: 'queued', text: 'Later' }]);
    } finally { await server.close(); }
  });

  it.each(['codex', 'claude'])('signs out remote %s only on its owning host', async backend => {
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    const localConnections = structuredClone(snapshot.providerConnections);
    const result = { kind: backend, connected: false, state: {} };
    const clients = { request: vi.fn().mockResolvedValue(result), close: vi.fn() };
    const server = new AppBackendServer({ version: 'test', snapshot, remoteClients: clients as never });
    try {
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/disconnect', params: { backend, remoteConnectionId: connection.id } }))
        .resolves.toMatchObject({ result });
      expect(clients.request).toHaveBeenCalledWith(connection, 'provider/disconnect', expect.objectContaining({ backend }), expect.any(Function));
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
