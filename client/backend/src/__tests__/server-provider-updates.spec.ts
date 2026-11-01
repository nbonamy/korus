import { describe, expect, it, vi } from 'vitest';
import { AppBackendServer } from '../server';
import { ProviderUpdates } from '../provider-updates';
import { createTestSnapshot, readyRemoteConnection } from './server-test-fixtures';

describe('provider update ownership', () => {
  it('validates consent on the backend and refuses new admissions during an upgrade', async () => {
    let finish!: () => void;
    const installation = { executable: '/bin/claude', version: '1.0.0', latestVersion: '1.1.0', method: 'native' as const, identity: 'claude', command: { file: '/bin/claude', args: ['update'] } };
    const upgrade = vi.fn(() => new Promise<void>(resolve => { finish = () => { installation.version = '1.1.0'; resolve(); }; }));
    const updates = new ProviderUpdates({ inspect: async () => installation, upgrade, busy: () => false, withStoppedProvider: async (_backend, work) => work() });
    const server = new AppBackendServer({ version: 'test', snapshot: createTestSnapshot(), providerUpdates: updates });
    try {
      const result = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/update/get', params: { backend: 'claude' } });
      expect(result).toMatchObject({ result: { status: 'available' } });
      const state = await updates.get('claude');
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'provider/update/set', params: { backend: 'claude', input: { action: 'upgrade', token: state.token } } })).rejects.toThrow('confirm');
      expect(upgrade).not.toHaveBeenCalled();
      await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'provider/update/set', params: { backend: 'claude', input: { action: 'upgrade', confirmed: true, token: state.token } } });
      await expect(server.requireConnectedEngine('claude')).rejects.toThrow('upgrade');
      await vi.waitFor(() => expect(upgrade).toHaveBeenCalledOnce());
      finish();
      await updates.settle();
      expect(await updates.get('claude')).toMatchObject({ status: 'current' });
    } finally { finish?.(); await server.close(); }
  });

  it('forwards remote upgrades to their owner without probing or updating the local installation', async () => {
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    const state = { backend: 'codex', status: 'waiting', method: 'npm', canUpgrade: true, busy: true };
    const clients = { request: vi.fn().mockResolvedValue(state), close: vi.fn() };
    const inspect = vi.fn();
    const upgrade = vi.fn();
    const updates = new ProviderUpdates({ inspect, upgrade, busy: () => false, withStoppedProvider: vi.fn() });
    const server = new AppBackendServer({ version: 'test', snapshot, providerUpdates: updates, remoteClients: clients as never });
    try {
      const input = { action: 'upgrade', confirmed: true, token: 'remote-observation' };
      expect(await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/update/set', params: { backend: 'codex', input, remoteConnectionId: connection.id } })).toMatchObject({ result: state });
      expect(clients.request).toHaveBeenCalledWith(connection, 'provider/update/set', { backend: 'codex', input, _clientId: 'remote-controller' }, expect.any(Function));
      expect(inspect).not.toHaveBeenCalled();
      expect(upgrade).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });
});
