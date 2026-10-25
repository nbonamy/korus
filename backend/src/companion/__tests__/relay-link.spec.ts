import { describe, expect, it, vi } from 'vitest';
import { RelayLink } from '../relay-link';

vi.mock('../../log', () => ({ logMain: vi.fn(), warnMain: vi.fn() }));

/** A link whose node is a stub holding one relay connection, so only the admission policy is under test. */
function linkWithRelayConnection() {
  const abort = vi.fn();
  const link = new RelayLink();
  (link as unknown as { node: unknown; relayPeerId: string }).node = { getConnections: () => [{ remotePeer: { toString: () => 'relay' }, abort }, { remotePeer: { toString: () => 'phone' }, abort: vi.fn() }] };
  (link as unknown as { relayPeerId: string }).relayPeerId = 'relay';
  return { link, abort };
}
const closedConnection = Object.assign(new Error('The connection muxer is "closed" and not "open"'), { name: 'ConnectionClosedError' });

describe('relay link health', () => {
  it('replaces a relay connection that says it is closed on the first failed admission', () => {
    const { link, abort } = linkWithRelayConnection();
    link.noteAdmission(false, closedConnection);
    expect(abort).toHaveBeenCalledOnce();
  });

  it('waits for three failures before presuming a merely silent relay dead, and a good admission restarts the count', () => {
    const { link, abort } = linkWithRelayConnection();
    link.noteAdmission(false, new Error('timeout')); link.noteAdmission(false, new Error('timeout'));
    link.noteAdmission(true);
    link.noteAdmission(false, new Error('timeout')); link.noteAdmission(false, new Error('timeout'));
    expect(abort).not.toHaveBeenCalled();
    link.noteAdmission(false, new Error('timeout'));
    expect(abort).toHaveBeenCalledOnce();
  });
});
