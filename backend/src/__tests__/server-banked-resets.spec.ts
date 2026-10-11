import { describe, expect, it, vi } from 'vitest';
import { AppBackendServer } from '../server';
import { createTestSnapshot, readyRemoteConnection } from './server-test-fixtures';

const result = { status: 'ready', summary: { availableCount: '9007199254740993', credits: null, detailCount: null } };
const message = (remoteConnectionId?: string) => ({ jsonrpc: '2.0' as const, id: 1, method: 'provider/codex/bankedResets/get', params: { remoteConnectionId } });
describe('banked reset owning-host reads', () => {
  it('reads from the local driver without persisting account details and rejects invalid driver payloads', async () => {
    const snapshot = createTestSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const original = structuredClone(snapshot);
    const handle = vi.fn().mockResolvedValue(result);
    const saveSnapshot = vi.fn();
    const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot, driverRpc: { handle, onEvent: () => () => {}, close: vi.fn() } as never });
    try {
      expect(await server.handleMessage(message())).toMatchObject({ result });
      expect(handle).toHaveBeenCalledExactlyOnceWith('driver/codex/bankedResets/get', {});
      expect(snapshot).toStrictEqual(original); expect(saveSnapshot).not.toHaveBeenCalled();
      handle.mockResolvedValueOnce({ status: 'ready', summary: { availableCount: 1, credits: [] } });
      await expect(server.handleMessage(message())).rejects.toThrow('Update the backend');
      handle.mockRejectedValueOnce(new Error('Read failed'));
      await expect(server.handleMessage(message())).rejects.toThrow('Read failed');
    } finally { await server.close(); }
  });

  it.each([
    [undefined, 'unsupported'],
    [{ backend: 'codex', installed: true, connected: false, checking: false }, 'signedOut'],
    [{ backend: 'codex', installed: true, connected: true, enabled: false, checking: false }, 'unsupported'],
  ])('does not start a provider for unavailable local state %j', async (provider, status) => {
    const snapshot = createTestSnapshot(); snapshot.providerConnections = provider ? [provider as never] : [];
    const handle = vi.fn(); const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: { handle, onEvent: () => () => {}, close: vi.fn() } as never });
    try { expect(await server.handleMessage(message())).toMatchObject({ result: { status } }); expect(handle).not.toHaveBeenCalled(); }
    finally { await server.close(); }
  });

  it('reads from the explicit remote owner and fails rather than falling back to local data', async () => {
    const snapshot = createTestSnapshot(); const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    const request = vi.fn().mockResolvedValue(result); const handle = vi.fn();
    const server = new AppBackendServer({ version: 'test', snapshot, remoteClients: { request, close: vi.fn() } as never, driverRpc: { handle, onEvent: () => () => {}, close: vi.fn() } as never });
    try {
      expect(await server.handleMessage(message(connection.id))).toMatchObject({ result });
      expect(request).toHaveBeenCalledWith(connection, 'provider/codex/bankedResets/get', { _clientId: 'remote-controller' }, expect.any(Function));
      request.mockResolvedValueOnce({ credits: [] });
      await expect(server.handleMessage(message(connection.id))).rejects.toThrow('Update the remote');
      request.mockRejectedValueOnce(new Error('Disconnected'));
      await expect(server.handleMessage(message(connection.id))).rejects.toThrow('Disconnected');
      expect(handle).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });
});
