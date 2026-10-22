import { afterEach, describe, expect, it, vi } from 'vitest';
import { acknowledgeDiagnostics, connectionDiagnostic, connectionError, connectionLogger, pendingDiagnostics, setConnectionDiagnosticSink } from '../connection-diagnostics';

afterEach(() => setConnectionDiagnosticSink(undefined));
describe('local connection diagnostics', () => {
  it('keeps a bounded outbox of the newest records until the laptop acknowledges them', () => {
    acknowledgeDiagnostics(Number.MAX_SAFE_INTEGER);
    for (let index = 0; index < 350; index++) connectionDiagnostic('test.event', { sequence: index });
    const batch = pendingDiagnostics(100);
    expect(batch).toHaveLength(100);
    expect(batch[0]).toMatchObject({ event: 'test.event', sequence: 50 });
    acknowledgeDiagnostics(batch.length);
    expect(pendingDiagnostics(500)).toHaveLength(200);
    expect(pendingDiagnostics(1)[0]).toMatchObject({ sequence: 150 });
    acknowledgeDiagnostics(Number.MAX_SAFE_INTEGER);
    expect(pendingDiagnostics(10)).toStrictEqual([]);
  });
  it('distinguishes socket closure from heartbeat abort without recording transport contents', () => {
    const sink = vi.fn(); setConnectionDiagnosticSink(sink);
    const socket = connectionLogger.forComponent('libp2p:websockets:connection').newScope('outbound:socket-id');
    socket('closed - code %d, reason "%s", wasClean %s', 1001, 'private remote reason', true);
    const monitor = connectionLogger.forComponent('libp2p:connection-monitor');
    monitor.error('error during heartbeat - %e', Object.assign(new Error('private address'), { name: 'TimeoutError' }));
    monitor.error('aborting connection due to ping failure');
    socket.trace('received payload %s', 'private message');
    socket.error('unknown error %s', 'private token');
    connectionLogger.forComponent('other').error('aborting connection due to ping failure');
    expect(sink.mock.calls.map(([record]) => record)).toStrictEqual([
      { event: 'transport.socket-close', at: expect.any(String), closeCode: 1001, wasClean: true },
      { event: 'transport.heartbeat-error', at: expect.any(String), errorName: 'TimeoutError', errorCode: undefined },
      { event: 'transport.heartbeat-abort', at: expect.any(String) },
    ]);
    expect(JSON.stringify(sink.mock.calls)).not.toContain('private');
  });
  it('records safe error classifications without exception messages or causes', () => {
    const sink = vi.fn(); setConnectionDiagnosticSink(sink);
    const error = Object.assign(new Error('secret request payload', { cause: 'secret token' }), { code: 'ERR_STREAM_RESET' });
    connectionDiagnostic('updates.receive-error', { streamId: 'stream', ...connectionError(error) });
    expect(sink).toHaveBeenCalledExactlyOnceWith({ event: 'updates.receive-error', at: expect.any(String), streamId: 'stream', errorName: 'Error', errorCode: 'ERR_STREAM_RESET' });
    expect(JSON.stringify(sink.mock.calls)).not.toContain('secret');
    expect(connectionError({ code: 'unsafe error message with token' })).toStrictEqual({ errorName: undefined, errorCode: undefined });
    expect(connectionError(Object.assign(new Error('failed to connect via relay with status NO_RESERVATION'), { name: 'InvalidMessageError' })))
      .toStrictEqual({ errorName: 'InvalidMessageError', errorCode: 'RELAY_NO_RESERVATION' });
  });
  it('keeps diagnostics best effort when the native sink fails', async () => {
    setConnectionDiagnosticSink(() => { throw new Error('Full disk'); });
    expect(() => connectionDiagnostic('session.connect')).not.toThrow();
    setConnectionDiagnosticSink(async () => { throw new Error('Native bridge unavailable'); });
    connectionDiagnostic('session.connect');
    await Promise.resolve(); await Promise.resolve();
  });
});
