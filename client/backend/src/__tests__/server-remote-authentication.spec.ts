import { describe, expect, it, vi } from 'vitest';
import { AppBackendServer } from '../server';
import { createTestSnapshot, readyRemoteConnection } from './server-test-fixtures';
import { getLocalClaudeAuthentication } from '../claude/authentication';
import { ClaudeBackendDriver } from '../claude/claude-driver';
import { BackendDriverRpc } from '../driver-rpc';

vi.mock('../claude/authentication', () => ({ getLocalClaudeAuthentication: vi.fn() }));

describe('host-targeted Codex authentication', () => {
  it.each([
    ['codex/authentication/get', undefined, { account: null, requiresOpenaiAuth: true, login: { status: 'idle', error: null } }],
    ['codex/authentication/deviceCode/start', undefined, { loginId: 'remote-login', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD' }],
    ['codex/authentication/login/cancel', { loginId: 'remote-login' }, { account: null, requiresOpenaiAuth: true, login: { status: 'cancelled', error: null } }],
  ] as const)('routes %s to the selected host, never the local account', async (method, params, response) => {
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    const remoteClients = { request: vi.fn().mockResolvedValue(response) };
    const driverRpc = { handle: vi.fn(), onEvent: vi.fn(() => () => undefined) };
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot, remoteClients: remoteClients as never, driverRpc: driverRpc as never });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method, params: { remoteConnectionId: connection.id, ...params } })).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: response });
    expect(remoteClients.request).toHaveBeenCalledWith(connection, method, { ...params, _clientId: 'remote-controller' }, expect.any(Function));
    expect(driverRpc.handle).not.toHaveBeenCalled();
  });

  it('rejects an unknown remote instead of signing in locally', async () => {
    const driverRpc = { handle: vi.fn(), onEvent: vi.fn(() => () => undefined) };
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot: createTestSnapshot(), driverRpc: driverRpc as never });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'codex/authentication/deviceCode/start', params: { remoteConnectionId: 'missing' } })).resolves.toMatchObject({ error: { message: 'Remote connection not found: missing' } });
    expect(driverRpc.handle).not.toHaveBeenCalled();
  });

  it.each([
    ['codex/authentication/get', { remoteConnectionId: '' }],
    ['codex/authentication/deviceCode/start', { remoteConnectionId: 42 }],
    ['codex/authentication/login/cancel', { remoteConnectionId: 'wall-e' }],
    ['codex/authentication/login/cancel', { loginId: '' }],
  ])('rejects invalid targeting for %s', async (method, params) => {
    const driverRpc = { handle: vi.fn(), onEvent: vi.fn(() => () => undefined) };
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot: createTestSnapshot(), driverRpc: driverRpc as never });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method: method as string, params })).resolves.toMatchObject({ error: { code: -32602 } });
    expect(driverRpc.handle).not.toHaveBeenCalled();
  });
});

describe('host-targeted Claude authentication', () => {
  it('checks local authentication only when a connection is omitted', async () => {
    vi.mocked(getLocalClaudeAuthentication).mockResolvedValue({ loggedIn: true, configDirectory: '/tmp/claude-home' });
    const sshConnections = { getRemoteClaudeAuthentication: vi.fn() };
    const driverRpc = new BackendDriverRpc(new Map([['claude', new ClaudeBackendDriver()]]));
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot: createTestSnapshot(), sshConnections: sshConnections as never, driverRpc });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'claude/authentication/get' }))
      .resolves.toStrictEqual({ jsonrpc: '2.0', id: 1, result: { loggedIn: true, configDirectory: '/tmp/claude-home' } });
    expect(sshConnections.getRemoteClaudeAuthentication).not.toHaveBeenCalled();
    vi.mocked(getLocalClaudeAuthentication).mockClear();
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'claude/authentication/get', params: { connectionId: '' } }))
      .rejects.toThrow('Invalid connectionId');
    expect(getLocalClaudeAuthentication).not.toHaveBeenCalled();
  });
  it('checks the selected daemon and its configured Claude home, not the SSH default home', async () => {
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    const remoteClients = { request: vi.fn().mockResolvedValue({ loggedIn: true, configDirectory: '/remote/app/claude' }), close: vi.fn() };
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot, remoteClients: remoteClients as never });

    await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'claude/authentication/get', params: { connectionId: connection.id } }))
      .resolves.toEqual({ jsonrpc: '2.0', id: 1, result: { loggedIn: true, configDirectory: '/remote/app/claude' } });
    expect(remoteClients.request).toHaveBeenCalledWith(connection, 'claude/authentication/get', { _clientId: 'remote-controller' }, expect.any(Function));
  });

  it('rejects missing and offline connections before invoking SSH', async () => {
    const snapshot = createTestSnapshot();
    const connection = { ...readyRemoteConnection(), status: 'error' as const };
    snapshot.remoteConnections.connections = [connection];
    const sshConnections = { getRemoteClaudeAuthentication: vi.fn() };
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot, sshConnections: sshConnections as never });

    await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'claude/authentication/get', params: { connectionId: 'missing' } }))
      .resolves.toMatchObject({ error: { message: 'Remote connection not found: missing' } });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'claude/authentication/get', params: { connectionId: connection.id } }))
      .resolves.toMatchObject({ error: { message: 'Remote connection is not ready: devbox' } });
    expect(sshConnections.getRemoteClaudeAuthentication).not.toHaveBeenCalled();
  });
});
