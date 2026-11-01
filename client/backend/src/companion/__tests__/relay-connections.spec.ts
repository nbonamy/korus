import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RelayConnections } from '../relay-connections';

type Stub = { id: string; remotePeer: { toString(): string }; status: string; timeline: { open: number }; abort: ReturnType<typeof vi.fn>; muxer: { ping(): Promise<unknown> } };

/** A relay node reduced to its connections and their open and close events. */
function relayWith() {
  const connections: Stub[] = [];
  const listeners = new Map<string, (event: { detail: Stub }) => void>();
  const node = {
    getConnections: (peer?: { toString(): string }) => connections.filter((connection) => !peer || connection.remotePeer.toString() === peer.toString()),
    addEventListener: (type: string, listener: (event: { detail: Stub }) => void) => { listeners.set(type, listener); },
  };
  const log = vi.fn();
  const watch = new RelayConnections(node as never, (peer) => peer === 'laptop' ? 'laptop' : 'device', log);
  let next = 0;
  const open = (peer: string, pongMs: number | null) => {
    const connection: Stub = { id: `c${next++}`, remotePeer: { toString: () => peer }, status: 'open', timeline: { open: Date.now() }, abort: vi.fn(),
      muxer: { ping: () => new Promise((resolve) => { if (pongMs !== null) setTimeout(resolve, pongMs); }) } };
    connections.push(connection);
    listeners.get('connection:open')?.({ detail: connection });
    return connection;
  };
  const close = (connection: Stub) => { connections.splice(connections.indexOf(connection), 1); listeners.get('connection:close')?.({ detail: connection }); };
  return { watch, open, close, log };
}

describe('relay connections', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('waits out a slow answer instead of cutting the connection', async () => {
    const { watch, open } = relayWith();
    watch.start();
    const laptop = open('laptop', 20_000);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(laptop.abort).not.toHaveBeenCalled();
    watch.stop();
  });

  it('cuts a connection that has not answered for thirty seconds, once, and says why', async () => {
    const { watch, open, log } = relayWith();
    watch.start();
    const laptop = open('laptop', null);
    await vi.advanceTimersByTimeAsync(39_999);
    expect(laptop.abort).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_001);
    expect(laptop.abort).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('relay connection cut', expect.objectContaining({ role: 'laptop', reason: 'unresponsive', silentMs: 30_000 }));
    watch.stop();
  });

  it('cuts the older connection when a peer reconnects, so phones are routed over the new one', () => {
    const { watch, open, log } = relayWith();
    watch.start();
    const stale = open('laptop', null);
    const phone = open('phone', 10);
    const fresh = open('laptop', 10);
    expect(stale.abort).toHaveBeenCalledOnce();
    expect(fresh.abort).not.toHaveBeenCalled();
    expect(phone.abort).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('relay connection cut', expect.objectContaining({ role: 'laptop', reason: 'superseded' }));
    watch.stop();
  });

  it('logs every close with the role, how long the connection lived and who ended it', async () => {
    const { watch, open, close, log } = relayWith();
    watch.start();
    const phone = open('phone', 10);
    await vi.advanceTimersByTimeAsync(5_000);
    close(phone);
    expect(log).toHaveBeenCalledWith('relay connection closed', { role: 'device', aliveMs: 5_000, reason: 'remote' });
    const laptop = open('laptop', 10);
    open('laptop', 10);
    close(laptop);
    expect(log).toHaveBeenLastCalledWith('relay connection closed', { role: 'laptop', aliveMs: 0, reason: 'superseded' });
    watch.stop();
  });
});
