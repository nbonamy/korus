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
  afterEach(() => { vi.useRealTimers(); });

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

  it('does not rebuild a link that is already being rebuilt', async () => {
    const { link, internals, reserve } = linkWith([{}]);
    (internals as unknown as { reserving: boolean }).reserving = true;
    link.noteAdmission(false, closedConnection);
    await vi.advanceTimersByTimeAsync(10);
    expect(reserve).not.toHaveBeenCalled();
  });
});
