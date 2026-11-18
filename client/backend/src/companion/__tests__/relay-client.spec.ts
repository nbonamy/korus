import { describe, expect, it, vi } from 'vitest';
import { CompanionFrameDecoder, encodeCompanionFrame } from '@workspace/core/companion-protocol';
import { RelayClient } from '../relay-client';
import type { RelayLink } from '../relay-link';
import type { CompanionGateway } from '../gateway';

vi.mock('../../log', () => ({ logMain: vi.fn(), warnMain: vi.fn() }));
import { warnMain } from '../../log';
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

describe('Live Activity delivery', () => {
  const registration = { token: 'ab'.repeat(32), environment: 'production' as const, kind: 'start' as const };
  const activity = { hostId: 'host', instanceId: 'a7dd30ba-8472-4b2e-8675-910016589490', timestamp: 1000, startedAt: 990_000, event: 'start' as const, state: { running: 1, attention: 0, agents: [], more: 0 } };
  it.each([
    ['link-down', (f: ReturnType<typeof fixture>) => { (f.link as { connected: boolean }).connected = false; }],
    ['not-paired', (f: ReturnType<typeof fixture>) => { f.grants.splice(0); }],
    ['relay-refused', (f: ReturnType<typeof fixture>) => { (f.link.dialRelay as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Push unavailable.')); }],
  ] as const)('names the stage that kept a Live Activity from the relay: %s', async (stage, arrange) => {
    const f = fixture(); arrange(f); vi.mocked(warnMain).mockClear();
    expect(await f.client.liveActivity('first', registration as never, activity as never)).toBe('unavailable');
    expect(warnMain).toHaveBeenCalledWith('companion', 'live activity not delivered', { stage });
    expect(JSON.stringify(vi.mocked(warnMain).mock.calls)).not.toContain(registration.token);
  });
  it('passes on the relay\'s answer when the relay could not deliver it', async () => {
    const f = fixture(); vi.mocked(warnMain).mockClear();
    const result = f.client.liveActivity('first', registration as never, activity as never);
    await settle(); f.gates.shift()!({ result: 'unavailable' });
    expect(await result).toBe('unavailable');
    expect(warnMain).toHaveBeenCalledWith('companion', 'live activity not delivered', { stage: 'relay-answer', result: 'unavailable' });
  });
});
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
