import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Stream } from '@libp2p/interface';
import { CompanionFrameDecoder, encodeCompanionFrame } from '@workspace/core/companion-protocol';
import { createCompanionStream } from '../companion-stream';
import { setConnectionDiagnosticSink, type ConnectionDiagnostic } from '../connection-diagnostics';
function fixture() {
  const queued: Uint8Array[] = []; let wake = () => {}; let ended = false;
  const calls: { id: string; method: string; args: unknown }[] = [];
  const source = { send: vi.fn((bytes: Uint8Array) => { calls.push(new CompanionFrameDecoder().push(bytes)[0] as never); return true; }),
    abort: vi.fn(() => { ended = true; wake(); }), async *[Symbol.asyncIterator]() {
      while (!ended) { while (queued.length) yield queued.shift()!; if (!ended) await new Promise<void>((resolve) => { wake = resolve; }); }
    } } as unknown as Stream;
  const update = vi.fn(); const disconnected = vi.fn();
  const stream = createCompanionStream(async () => source, update, disconnected);
  const bytes = (value: Uint8Array) => { queued.push(value); wake(); };
  return { stream, source, update, disconnected, calls, bytes, push: (value: unknown) => bytes(encodeCompanionFrame(value)) };
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); setConnectionDiagnosticSink(undefined); });
describe('mobile update channel', () => {
  it('matches concurrent replies, decodes fragmented notifications and rejects a lost sequence', async () => {
    const f = fixture();
    try {
      const first = f.stream.request('snapshot.get', {}); const second = f.stream.request('conversation.subscribe', {});
      await tick();
      f.push({ v: 1, id: f.calls[1]!.id, result: 'second' }); f.push({ v: 1, id: f.calls[0]!.id, result: 'first' });
      expect(await Promise.all([first, second])).toStrictEqual(['first', 'second']);
      const update = { type: 'workspace', workspace: { teams: [], agents: [] } };
      const encoded = encodeCompanionFrame({ v: 1, seq: 1, update });
      f.bytes(encoded.subarray(0, 7)); f.bytes(encoded.subarray(7)); await tick();
      expect(f.update).toHaveBeenCalledExactlyOnceWith(update);
      f.push({ v: 1, seq: 3, update }); await tick();
      expect(f.disconnected).toHaveBeenCalledOnce(); expect(f.update).toHaveBeenCalledOnce();
      await expect(f.stream.request('snapshot.get', {})).rejects.toThrow('Disconnected');
    } finally { f.stream.close(); }
  });
  it('rejects an operation without dropping a healthy stream, but a malformed reply rejects pending reads', async () => {
    const f = fixture();
    try {
      const request = f.stream.request('conversation.subscribe', {}); const rejected = expect(request).rejects.toThrow('denied');
      await tick(); f.push({ v: 1, id: f.calls[0]!.id, error: 'Denied' }); await rejected;
      expect(f.disconnected).not.toHaveBeenCalled();
      const next = f.stream.request('snapshot.get', {}); const lost = expect(next).rejects.toThrow('Disconnected');
      await tick(); f.push({ v: 1, id: f.calls[1]!.id }); await lost;
      expect(f.disconnected).toHaveBeenCalledOnce();
    } finally { f.stream.close(); }
  });
  it('uses only heartbeat traffic when idle and disconnects if the laptop stops replying', async () => {
    vi.useFakeTimers(); const f = fixture();
    const records: ConnectionDiagnostic[] = []; setConnectionDiagnosticSink(record => { records.push(record); });
    try {
      const initial = f.stream.request('snapshot.get', {}); await tick();
      f.push({ v: 1, id: f.calls[0]!.id, result: {} }); await initial;
      await vi.advanceTimersByTimeAsync(15_000);
      expect(f.calls.map((call) => call.method)).toStrictEqual(['snapshot.get', 'ping']);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(f.disconnected).toHaveBeenCalledOnce(); expect(f.source.abort).toHaveBeenCalledOnce();
      expect(records.find(record => record.event === 'updates.request-timeout')).toMatchObject({
        method: 'ping', pending: expect.any(Number), oldestMethod: 'ping', oldestAgeMs: 15_000, idleMs: 30_000, sequence: 0,
      });
      expect(records.find(record => record.event === 'updates.disconnect')).toMatchObject({ reason: 'heartbeat-timeout' });
    } finally { f.stream.close(); }
  });
  it('closes a late dial when the app is suspended before connecting', async () => {
    const f = fixture(); let resolve!: (stream: Stream) => void;
    const disconnected = vi.fn();
    const stream = createCompanionStream(() => new Promise((done) => { resolve = done; }), vi.fn(), disconnected);
    const pending = stream.request('snapshot.get', {}); const rejected = expect(pending).rejects.toThrow('Disconnected');
    stream.close(); resolve(f.source); await rejected;
    expect(f.source.abort).toHaveBeenCalledOnce(); expect(disconnected).not.toHaveBeenCalled(); f.stream.close();
  });
  it('pauses heartbeat deadlines in background and restores liveness checks on return', async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      const initial = f.stream.request('snapshot.get', {}); await tick();
      f.push({ v: 1, id: f.calls[0]!.id, result: {} }); await initial;
      await vi.advanceTimersByTimeAsync(15_000);
      const pendingHeartbeat = f.calls.at(-1)!;
      await f.stream.setActive(false);
      const calls = f.calls.length;
      await vi.advanceTimersByTimeAsync(299_999);
      expect(f.calls).toHaveLength(calls); expect(f.disconnected).not.toHaveBeenCalled();
      const foreground = f.stream.setActive(true); await tick();
      f.push({ v: 1, id: pendingHeartbeat.id, result: {} });
      f.push({ v: 1, id: f.calls.at(-1)!.id, result: {} }); await foreground;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(f.disconnected).toHaveBeenCalledOnce();
    } finally { f.stream.close(); }
  });
  it('keeps a healthy stream after a fifteen-second app switch and bounds a stale return probe', async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      const initial = f.stream.request('snapshot.get', {}); await tick();
      f.push({ v: 1, id: f.calls[0]!.id, result: {} }); await initial;
      await f.stream.setActive(false);
      await vi.advanceTimersByTimeAsync(15_000);
      const healthy = f.stream.setActive(true); await tick();
      f.push({ v: 1, id: f.calls.at(-1)!.id, result: {} }); await healthy;
      expect(f.disconnected).not.toHaveBeenCalled();
      await f.stream.setActive(false);
      await vi.advanceTimersByTimeAsync(15_000);
      const stale = f.stream.setActive(true); const rejected = expect(stale).rejects.toThrow('Disconnected');
      await vi.advanceTimersByTimeAsync(2_000);
      expect(f.disconnected).toHaveBeenCalledExactlyOnceWith('resume-timeout');
      await rejected;
    } finally { f.stream.close(); }
  });
  it('times out only a slow request, ignores its late reply and keeps the stream', async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      const initial = f.stream.request('snapshot.get', {}); await tick();
      f.push({ v: 1, id: f.calls[0]!.id, result: {} }); await initial;
      const slow = f.stream.request('usage.get', {}); const timedOut = expect(slow).rejects.toThrow('timed out');
      await tick(); const slowId = f.calls.at(-1)!.id;
      await vi.advanceTimersByTimeAsync(14_999); f.push({ v: 1, seq: 1, update: { type: 'workspace', workspace: { teams: [], agents: [] } } });
      await vi.advanceTimersByTimeAsync(1); await timedOut;
      expect(f.disconnected).not.toHaveBeenCalled();
      f.push({ v: 1, id: slowId, result: { late: true } }); await tick();
      expect(f.disconnected).not.toHaveBeenCalled(); expect(f.source.abort).not.toHaveBeenCalled();
      const next = f.stream.request('snapshot.get', {}); await tick();
      f.push({ v: 1, id: f.calls.at(-1)!.id, result: 'ok' });
      expect(await next).toBe('ok');
    } finally { f.stream.close(); }
  });
  it('extends a heartbeat deadline while other authenticated traffic proves the laptop is alive', async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      const initial = f.stream.request('snapshot.get', {}); await tick();
      f.push({ v: 1, id: f.calls[0]!.id, result: {} }); await initial;
      await vi.advanceTimersByTimeAsync(15_000);
      expect(f.calls.at(-1)!.method).toBe('ping');
      await vi.advanceTimersByTimeAsync(10_000); f.push({ v: 1, seq: 1, update: { type: 'workspace', workspace: { teams: [], agents: [] } } });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(f.disconnected).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(f.disconnected).toHaveBeenCalledOnce();
    } finally { f.stream.close(); }
  });
  it('does not extend the return probe for traffic that arrives while it waits', async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      const initial = f.stream.request('snapshot.get', {}); await tick();
      f.push({ v: 1, id: f.calls[0]!.id, result: {} }); await initial;
      await f.stream.setActive(false);
      await vi.advanceTimersByTimeAsync(15_000);
      const returning = f.stream.setActive(true); const rejected = expect(returning).rejects.toThrow('Disconnected');
      await vi.advanceTimersByTimeAsync(1_000);
      f.push({ v: 1, seq: 1, update: { type: 'workspace', workspace: { teams: [], agents: [] } } });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(f.disconnected).toHaveBeenCalledExactlyOnceWith('resume-timeout');
      await rejected;
    } finally { f.stream.close(); }
  });
  it('keeps one heartbeat in flight while an extended one is still waiting', async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      const initial = f.stream.request('snapshot.get', {}); await tick();
      f.push({ v: 1, id: f.calls[0]!.id, result: {} }); await initial;
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.advanceTimersByTimeAsync(10_000); f.push({ v: 1, seq: 1, update: { type: 'workspace', workspace: { teams: [], agents: [] } } });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(f.calls.filter(call => call.method === 'ping')).toHaveLength(1);
      expect(f.disconnected).not.toHaveBeenCalled();
    } finally { f.stream.close(); }
  });
  it('gives a conversation catch-up longer than an ordinary request before timing it out alone', async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      const initial = f.stream.request('snapshot.get', {}); await tick();
      f.push({ v: 1, id: f.calls[0]!.id, result: {} }); await initial;
      let outcome = 'pending';
      void f.stream.request('conversation.synchronize', {}).then(() => { outcome = 'replied'; }, (error: Error) => { outcome = error.message; });
      await tick();
      const answered = new Set<string>();
      for (let second = 0; second < 59; second++) {
        await vi.advanceTimersByTimeAsync(1_000);
        for (const call of f.calls) if (call.method === 'ping' && !answered.has(call.id)) { answered.add(call.id); f.push({ v: 1, id: call.id, result: {} }); }
      }
      expect(outcome).toBe('pending');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(outcome).toBe('Request timed out.');
      expect(f.disconnected).not.toHaveBeenCalled();
    } finally { f.stream.close(); }
  });
  it('refuses malformed provider frames before they reach conversation replicas', async () => {
    const f = fixture();
    try {
      const pending = f.stream.request('snapshot.get', {}); const rejected = expect(pending).rejects.toThrow('Disconnected');
      await tick(); f.push({ v: 1, seq: 1, update: { type: 'conversation', frame: { type: 'codex.conversationEventReceived', payload: {} } } });
      await rejected; expect(f.update).not.toHaveBeenCalled();
    } finally { f.stream.close(); }
  });
});
