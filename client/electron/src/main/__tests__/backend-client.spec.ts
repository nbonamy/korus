import { beforeEach, describe, expect, it, vi } from 'vitest';

const ports = vi.hoisted(() => {
  const client = () => ({
    start: vi.fn(), health: vi.fn(), request: vi.fn(), close: vi.fn(),
    onEvent: vi.fn(), onConnectionState: vi.fn(),
  });
  return { socket: client(), process: client(), mode: 'auto', command: null as object | null };
});
vi.mock('../backend-socket-client', () => ({ AppBackendSocketClient: class { constructor() { return ports.socket; } } }));
vi.mock('../backend-process-client', () => ({ AppBackendProcessClient: class { constructor() { return ports.process; } } }));
vi.mock('../runtime-config', () => ({
  runtimeDaemonBackendMode: () => ports.mode, runtimeDaemonCommand: () => ports.command,
  runtimeDaemonSocketPath: () => '/test/daemon.sock', runtimeDaemonWatchFile: () => undefined,
}));
vi.mock('../client-request-handlers', () => ({ createRuntimeClientRequestHandlers: () => ({}) }));
import { createRuntimeAppBackendClient } from '../backend-client';

beforeEach(() => {
  vi.resetAllMocks();
  ports.mode = 'auto';
  ports.command = { command: 'node', args: ['/test/daemon.mjs'], env: {} };
  for (const port of [ports.socket, ports.process]) {
    port.start.mockResolvedValue(undefined);
    port.close.mockResolvedValue(undefined);
    port.health.mockResolvedValue({ ok: true, name: 'daemon', version: 'test', pid: 123 });
  }
});

describe('runtime backend selection', () => {
  it('uses a healthy daemon, routes requests and subscriptions, and reselects after close', async () => {
    const client = createRuntimeAppBackendClient()!;
    expect(() => client.request('snapshot/get')).toThrow('not connected');
    await client.start();
    ports.socket.request.mockResolvedValue({ snapshot: 'daemon' });
    expect(await client.request('snapshot/get', { client: 'desktop' })).toStrictEqual({ snapshot: 'daemon' });
    expect(ports.socket.request).toHaveBeenCalledWith('snapshot/get', { client: 'desktop' });
    const event = vi.fn();
    const connection = vi.fn();
    const unsubscribe = vi.fn();
    ports.socket.onEvent.mockReturnValue(unsubscribe);
    ports.socket.onConnectionState.mockReturnValue(unsubscribe);
    client.onEvent(event)();
    client.onConnectionState!(connection)();
    expect(ports.socket.onEvent).toHaveBeenCalledWith(event);
    expect(ports.socket.onConnectionState).toHaveBeenCalledWith(connection);
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(await client.health()).toMatchObject({ ok: true });
    await client.start();
    expect(ports.process.start).not.toHaveBeenCalled();
    await client.close();
    expect(ports.socket.close).toHaveBeenCalledOnce();
    ports.socket.start.mockRejectedValue(new Error('daemon stopped'));
    await client.start();
    expect(ports.process.start).toHaveBeenCalledOnce();
    await client.close();
    expect(ports.process.close).toHaveBeenCalledOnce();
  });

  it('cleans up a connected but unhealthy daemon before falling back to the bundled process', async () => {
    ports.socket.health.mockRejectedValue(new Error('wrong protocol'));
    const client = createRuntimeAppBackendClient()!;
    await client.start();
    expect(ports.socket.close.mock.invocationCallOrder[0]).toBeLessThan(ports.process.start.mock.invocationCallOrder[0]!);
    ports.process.request.mockResolvedValue('bundled');
    expect(await client.request('snapshot/get')).toBe('bundled');
    await client.close();
  });

  it('propagates a bundled startup failure and allows a later fresh attempt', async () => {
    ports.socket.start.mockRejectedValue(new Error('no daemon'));
    ports.process.start.mockRejectedValueOnce(new Error('spawn failed'));
    const client = createRuntimeAppBackendClient()!;
    await expect(client.start()).rejects.toThrow('spawn failed');
    expect(() => client.request('snapshot/get')).toThrow('not connected');
    await client.start();
    expect(ports.socket.start).toHaveBeenCalledTimes(2);
    expect(ports.process.start).toHaveBeenCalledTimes(2);
    await client.close();
  });

  it('honors explicit existing and bundled modes and handles absent bundled runtimes', async () => {
    ports.mode = 'existing';
    await createRuntimeAppBackendClient()!.start();
    expect(ports.socket.start).toHaveBeenCalledOnce();
    expect(ports.process.start).not.toHaveBeenCalled();
    ports.mode = 'bundled';
    await createRuntimeAppBackendClient()!.start();
    expect(ports.process.start).toHaveBeenCalledOnce();
    ports.command = null;
    expect(createRuntimeAppBackendClient()).toBeNull();
    ports.mode = 'auto';
    await createRuntimeAppBackendClient()!.start();
    expect(ports.socket.start).toHaveBeenCalledTimes(2);
  });
});
