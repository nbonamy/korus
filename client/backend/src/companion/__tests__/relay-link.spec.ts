import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RelayLink } from '../relay-link';

vi.mock('../../log', () => ({ logMain: vi.fn(), warnMain: vi.fn() }));

type Internals = { node: unknown; relayPeerId: string; stopped: boolean; connected: boolean; options: unknown; reserve(): Promise<void>; check(node: unknown): Promise<void> };
const closedConnection = Object.assign(new Error('The connection muxer is "closed" and not "open"'), { name: 'ConnectionClosedError' });

/** A link whose node is a stub holding the connections given, so only the health policy is under test. */
function linkWith(connections: { status?: string; muxer?: { status?: string; ping?: () => Promise<unknown> } }[]) {
  const link = new RelayLink();
  const internals = link as unknown as Internals;
  const node = { getConnections: () => connections.map((connection) => ({ remotePeer: { toString: () => 'relay' }, status: 'open', ...connection })) };
  Object.assign(internals, { node, relayPeerId: 'relay', stopped: false, connected: true });
  const reserve = vi.spyOn(internals, 'reserve').mockResolvedValue();
  return { link, internals, node, reserve };
}

describe('relay link health', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('rebuilds the link at once when an admission finds the relay connection closed', async () => {
    const { link, internals, reserve } = linkWith([{}]);
    link.noteAdmission(false, closedConnection);
    expect(internals.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(reserve).toHaveBeenCalledOnce();
  });

  it('waits for three failed admissions before presuming a merely silent relay dead, and a good one restarts the count', async () => {
    const { link, reserve } = linkWith([{}]);
    link.noteAdmission(false, new Error('timeout')); link.noteAdmission(false, new Error('timeout'));
    link.noteAdmission(true);
    link.noteAdmission(false, new Error('timeout')); link.noteAdmission(false, new Error('timeout'));
    await vi.advanceTimersByTimeAsync(10);
    expect(reserve).not.toHaveBeenCalled();
    link.noteAdmission(false, new Error('timeout'));
    await vi.advanceTimersByTimeAsync(10);
    expect(reserve).toHaveBeenCalledOnce();
  });

  it('notices a connection whose muxer closed while it stayed listed, without waiting for an admission', async () => {
    const { internals, node, reserve } = linkWith([{ muxer: { status: 'closed' } }]);
    await internals.check(node);
    await vi.advanceTimersByTimeAsync(0);
    expect(reserve).toHaveBeenCalledOnce();
  });

  it('presumes an unanswering relay dead after two missed probes, and one answered probe clears the first miss', async () => {
    let answer = false;
    const { internals, node, reserve } = linkWith([{ muxer: { status: 'open', ping: () => answer ? Promise.resolve() : Promise.reject(new Error('no answer')) } }]);
    await internals.check(node);
    answer = true; await internals.check(node);
    answer = false; await internals.check(node);
    await vi.advanceTimersByTimeAsync(10);
    expect(reserve).not.toHaveBeenCalled();
    await internals.check(node);
    await vi.advanceTimersByTimeAsync(10);
    expect(reserve).toHaveBeenCalledOnce();
  });

  it('keeps a link whose relay answers a probe late, since yamux kills the connection on the pong of an abandoned ping', async () => {
    // Yamux semantics: a ping made while one is pending shares it; the pending ping's own caller forgets it when its
    // signal aborts; a pong nobody waits for any more closes the muxer.
    type Ping = { promise: Promise<void>; resolve(): void; reject(error: Error): void };
    const muxer = { status: 'open', pending: undefined as undefined | Ping,
      ping(options?: { signal?: AbortSignal }) {
        if (muxer.pending) return muxer.pending.promise;
        const ping = {} as Ping; ping.promise = new Promise<void>((resolve, reject) => { ping.resolve = resolve; ping.reject = reject; }); muxer.pending = ping;
        setTimeout(() => { if (muxer.pending === ping) { muxer.pending = undefined; ping.resolve(); } else muxer.status = 'closed'; }, 3_000);
        options?.signal?.addEventListener('abort', () => { if (muxer.pending === ping) muxer.pending = undefined; ping.reject(new Error('aborted')); });
        return ping.promise;
      } };
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => { const controller = new AbortController(); setTimeout(() => controller.abort(new Error('timeout')), ms); return controller.signal; });
    const { internals, node, reserve } = linkWith([{ muxer }]);
    // Probes run every 2 s and give up after 2 s, so the second one starts while the first ping still waits for its pong.
    const first = internals.check(node);
    await vi.advanceTimersByTimeAsync(2_000); await first;
    const second = internals.check(node);
    await vi.advanceTimersByTimeAsync(2_000); await second;
    expect(muxer.status).toBe('open');
    expect(reserve).not.toHaveBeenCalled();
  });

  it('does not rebuild a link that is already being rebuilt', async () => {
    const { link, internals, reserve } = linkWith([{}]);
    (internals as unknown as { reserving: boolean }).reserving = true;
    link.noteAdmission(false, closedConnection);
    await vi.advanceTimersByTimeAsync(10);
    expect(reserve).not.toHaveBeenCalled();
  });
});
