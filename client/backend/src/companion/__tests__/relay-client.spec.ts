import { describe, expect, it, vi } from 'vitest';
import { CompanionFrameDecoder, encodeCompanionFrame } from '@workspace/core/companion-protocol';
import { RelayClient } from '../relay-client';
import type { RelayLink } from '../relay-link';
import type { CompanionGateway } from '../gateway';

vi.mock('../../log', () => ({ logMain: vi.fn(), warnMain: vi.fn() }));
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A relay stream whose answer the test controls. */
function relayStream(answer: () => Promise<unknown>) {
  const sent: any[] = [];
  const stream = { maxReadBufferLength: 0, inactivityTimeout: 0, send: (bytes: Uint8Array) => { sent.push(...new CompanionFrameDecoder().push(bytes)); return true; },
    close: async () => {}, abort: vi.fn(),
    async *[Symbol.asyncIterator]() { yield encodeCompanionFrame(await answer()); } };
  return { stream, sent };
}
function fixture() {
  const grants = [{ peerId: 'first' }, { peerId: 'second' }];
  const opened: ReturnType<typeof relayStream>[] = []; const gates: ((value: unknown) => void)[] = []; let active = 0; let peak = 0;
  const link = { connected: true, noteAdmission: vi.fn(), dialRelay: vi.fn(async () => {
    active++; peak = Math.max(peak, active);
    const next = relayStream(() => new Promise((resolve) => { gates.push((value) => { active--; resolve(value); }); }));
    opened.push(next); return next.stream;
  }) } as unknown as RelayLink;
  const gateway = { grants, pairingInvitations: () => [] } as unknown as CompanionGateway;
  return { client: new RelayClient(link, gateway), link, grants, opened, gates, peak: () => peak };
}

describe('relay admission', () => {
  it('sends one admission at a time, each built from the grants as they are when it runs', async () => {
    const f = fixture();
    const first = f.client.advertise(); const second = f.client.advertise();
    await settle(); expect(f.opened).toHaveLength(1);
    f.grants.pop(); // a revoke lands while the first admission is still in flight
    f.gates.shift()!({ ok: true }); await settle();
    expect(await first).toBe(true);
    expect(f.opened).toHaveLength(2);
    f.gates.shift()!({ ok: true });
    expect(await second).toBe(true);
    expect(f.peak()).toBe(1);
    expect(f.opened[0]!.sent[0].devices).toStrictEqual(['first', 'second']);
    expect(f.opened[1]!.sent[0].devices).toStrictEqual(['first']);
  });

  it('reports every outcome to the link and never lets one failure block the next admission', async () => {
    const f = fixture();
    (f.link.dialRelay as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('relay unreachable'));
    expect(await f.client.advertise()).toBe(false);
    const next = f.client.advertise(); await settle(); f.gates.shift()!({ ok: true });
    expect(await next).toBe(true);
    expect((f.link.noteAdmission as ReturnType<typeof vi.fn>).mock.calls.map(([ok]) => ok)).toStrictEqual([false, true]);
  });

  it('does nothing while the link is down', async () => {
    const f = fixture(); (f.link as { connected: boolean }).connected = false;
    expect(await f.client.advertise()).toBe(false);
    expect(f.link.dialRelay).not.toHaveBeenCalled();
  });
});
