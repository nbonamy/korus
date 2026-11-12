import { describe, expect, it, vi } from 'vitest';
import { AppBackendServer } from '../server';
import { createTestSnapshot, readyRemoteConnection } from './server-test-fixtures';
import { claudeAuthenticationDriver } from './support/scripted-driver';
import { ProviderDriverRpc } from '../driver-rpc';
import { resolveProviderCoordinationPolicy } from '@workspace/core/provider-driver';

const claudeAuth = vi.hoisted(() => ({ check: vi.fn(), logout: vi.fn() }));


describe('host-targeted Codex authentication', () => {
  const signedOut = { account: null, requiresOpenaiAuth: true, login: { status: 'idle', error: null } };
  it.each([
    [{ action: 'check' }, { kind: 'codex', connected: false, state: signedOut }],
    [{ action: 'login', method: 'deviceCode' }, { kind: 'codex', connected: false, state: { ...signedOut, login: { status: 'pending', error: null } }, login: { method: 'deviceCode', id: 'remote-login', url: 'https://auth.openai.com/codex/device', code: 'ABCD' } }],
    [{ action: 'cancel', loginId: 'remote-login' }, { kind: 'codex', connected: false, state: { ...signedOut, login: { status: 'cancelled', error: null } } }],
  ] as const)('routes %o to the selected host, never the local account', async (params, response) => {
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    const remoteClients = { request: vi.fn().mockResolvedValue(response) };
    const driverRpc = { handle: vi.fn(), onEvent: vi.fn(() => () => undefined) };
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot, remoteClients: remoteClients as never, driverRpc: driverRpc as never });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/authenticate', params: { provider: 'codex', remoteConnectionId: connection.id, ...params } })).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: response });
    expect(remoteClients.request).toHaveBeenCalledWith(connection, 'provider/authenticate', { provider: 'codex', ...params, _clientId: 'remote-controller' }, expect.any(Function));
    expect(driverRpc.handle).not.toHaveBeenCalled();
  });

  it('rejects an unknown remote instead of signing in locally', async () => {
    const driverRpc = { handle: vi.fn(), onEvent: vi.fn(() => () => undefined) };
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot: createTestSnapshot(), driverRpc: driverRpc as never });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/authenticate', params: { provider: 'codex', action: 'login', method: 'deviceCode', remoteConnectionId: 'missing' } })).resolves.toMatchObject({ error: { message: 'Remote connection not found: missing' } });
    expect(driverRpc.handle).not.toHaveBeenCalled();
  });

  it.each([
    [{ action: 'check', remoteConnectionId: '' }],
    [{ action: 'login', method: 'deviceCode', remoteConnectionId: 42 }],
    [{ action: 'cancel', remoteConnectionId: 'wall-e' }],
    [{ action: 'cancel', loginId: '' }],
  ])('rejects invalid targeting for %o', async (params) => {
    const driverRpc = { handle: vi.fn(), onEvent: vi.fn(() => () => undefined) };
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot: createTestSnapshot(), driverRpc: driverRpc as never });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/authenticate', params: { provider: 'codex', ...params } })).resolves.toMatchObject({ error: { code: -32602 } });
    expect(driverRpc.handle).not.toHaveBeenCalled();
  });

  it('starts a local login with the requested method and records the result', async () => {
    const snapshot = createTestSnapshot();
    const pending = { kind: 'codex', connected: false, state: { ...signedOut, login: { status: 'pending', error: null } }, login: { method: 'browser', id: 'login-1', url: 'https://auth.openai.com/oauth' } };
    const getCoordinationPolicy = () => resolveProviderCoordinationPolicy({ authentication: { actions: ['check', 'cancel', 'logout', 'login'] } });
    const driverRpc = { handle: vi.fn().mockResolvedValue(pending), onEvent: vi.fn(() => () => undefined), getCoordinationPolicy };
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot, driverRpc: driverRpc as never });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/authenticate', params: { provider: 'codex', action: 'login', method: 'browser' } })).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: pending });
    expect(driverRpc.handle).toHaveBeenCalledExactlyOnceWith('driver/provider/authentication', { provider: 'codex', action: 'login', method: 'browser' });
  });

  it('rejects unknown actions and methods before reaching the driver', async () => {
    const driverRpc = { handle: vi.fn(), onEvent: vi.fn(() => () => undefined) };
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot: createTestSnapshot(), driverRpc: driverRpc as never });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/authenticate', params: { provider: 'codex', action: 'refresh' } })).rejects.toThrow('Unsupported native authentication action');
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'provider/authenticate', params: { provider: 'codex', action: 'login', method: 'sms' } })).rejects.toThrow('Unsupported authentication method');
    expect(driverRpc.handle).not.toHaveBeenCalled();
  });
});

describe('host-targeted Claude authentication', () => {
  it('checks local authentication only when a connection is omitted', async () => {
    claudeAuth.check.mockResolvedValue({ loggedIn: true, configDirectory: '/tmp/claude-home' });
    const sshConnections = { getRemoteClaudeAuthentication: vi.fn() };
    const driverRpc = new ProviderDriverRpc(new Map([['claude', claudeAuthenticationDriver(claudeAuth)]]));
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot: createTestSnapshot(), sshConnections: sshConnections as never, driverRpc });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/authenticate', params: { provider: 'claude', action: 'check' } }))
      .resolves.toStrictEqual({ jsonrpc: '2.0', id: 1, result: { kind: 'claude', connected: true, account: null, state: { loggedIn: true, configDirectory: '/tmp/claude-home' } } });
    expect(sshConnections.getRemoteClaudeAuthentication).not.toHaveBeenCalled();
    claudeAuth.check.mockClear();
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'provider/authenticate', params: { provider: 'claude', action: 'check', remoteConnectionId: '' } }))
      .resolves.toMatchObject({ error: { code: -32602, message: 'remoteConnectionId must be a non-empty string.' } });
    expect(claudeAuth.check).not.toHaveBeenCalled();
  });
  it('checks the selected daemon and its configured Claude home, not the SSH default home', async () => {
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    const remote = { kind: 'claude', connected: true, state: { loggedIn: true, configDirectory: '/remote/app/claude' } };
    const remoteClients = { request: vi.fn().mockResolvedValue(remote), close: vi.fn() };
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot, remoteClients: remoteClients as never });

    await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/authenticate', params: { provider: 'claude', action: 'check', remoteConnectionId: connection.id } }))
      .resolves.toEqual({ jsonrpc: '2.0', id: 1, result: remote });
    expect(remoteClients.request).toHaveBeenCalledWith(connection, 'provider/authenticate', { provider: 'claude', action: 'check', _clientId: 'remote-controller' }, expect.any(Function));
  });

  it('rejects missing and offline connections before invoking SSH', async () => {
    const snapshot = createTestSnapshot();
    const connection = { ...readyRemoteConnection(), status: 'error' as const };
    snapshot.remoteConnections.connections = [connection];
    const sshConnections = { getRemoteClaudeAuthentication: vi.fn() };
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot, sshConnections: sshConnections as never });

    await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/authenticate', params: { provider: 'claude', action: 'check', remoteConnectionId: 'missing' } }))
      .resolves.toMatchObject({ error: { message: 'Remote connection not found: missing' } });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'provider/authenticate', params: { provider: 'claude', action: 'check', remoteConnectionId: connection.id } }))
      .resolves.toMatchObject({ error: { message: 'Remote connection is not ready: devbox' } });
    expect(sshConnections.getRemoteClaudeAuthentication).not.toHaveBeenCalled();
  });
});
