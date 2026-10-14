import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { companionPushAuthorizationMessage } from '@workspace/core/companion-notification';
import { CompanionPushRelay } from '../push-relay';

const host = 'h'.repeat(52); const relayId = 'relay';
let phone: Awaited<ReturnType<typeof generateKeyPair>>; let peerId: string;
beforeEach(async () => { phone = await generateKeyPair('Ed25519'); peerId = peerIdFromPrivateKey(phone).toString(); });
async function input() {
  const registration = { token: 'ab'.repeat(32), environment: 'development' as const };
  const expiresAt = 100000;
  const signature = Buffer.from(await phone.sign(companionPushAuthorizationMessage(relayId, host, peerId, registration, expiresAt))).toString('base64');
  return { peerId, registration: { ...registration, authorization: { expiresAt, signature } }, notification: {
    id: 'event', name: 'Agent', kind: 'completed', createdAt: 1000,
    target: { hostId: host, locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: null },
  } };
}
describe('push relay admission', () => {
  it('requires phone consent bound to the relay, laptop, device token, environment and expiry', async () => {
    const send = vi.fn(async () => 'sent' as const);
    const relay = new CompanionPushRelay(relayId, () => true, { send }, () => 1000);
    const valid = await input();
    for (const registration of [
      { token: valid.registration.token, environment: 'development' },
      { ...valid.registration, token: 'cd'.repeat(32) },
      { ...valid.registration, environment: 'production' },
      { ...valid.registration, authorization: { ...valid.registration.authorization, expiresAt: 999 } },
      { ...valid.registration, authorization: { ...valid.registration.authorization, expiresAt: 90000 } },
    ]) await expect(relay.send(host, { ...valid, registration })).rejects.toThrow();
    await expect(relay.send('other-host', { ...valid, notification: { ...valid.notification, target: { ...valid.notification.target, hostId: 'other-host' } } })).rejects.toThrow();
    await expect(new CompanionPushRelay('another-relay', () => true, { send }, () => 1000).send(host, valid)).rejects.toThrow();
    await expect(relay.send(host, { ...valid, peerId: peerIdFromPrivateKey(await generateKeyPair('Ed25519')).toString() })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(await relay.send(host, valid)).toBe('sent');
    expect(await relay.send(host, valid)).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('rejects unpaired, forged, malformed and expired alerts before calling Apple', async () => {
    const send = vi.fn(async () => 'sent' as const); const valid = await input();
    const relay = new CompanionPushRelay(relayId, (h, p) => h === host && p === peerId, { send }, () => 1000);
    for (const value of [ { ...valid, peerId: 'x'.repeat(52) }, { ...valid, registration: { token: '../invalid', environment: 'development' } },
      { ...valid, notification: { ...valid.notification, createdAt: -400000 } },
      { ...valid, notification: { ...valid.notification, target: { ...valid.notification.target, hostId: 'forged' } } } ]) {
      await expect(relay.send(host, value)).rejects.toThrow();
    }
    expect(send).not.toHaveBeenCalled();
  });
  it('coalesces concurrent delivery and permits a retry after an Apple transport failure', async () => {
    const valid = await input();
    let complete!: (result: 'sent') => void;
    const send = vi.fn(() => new Promise<'sent'>(resolve => { complete = resolve; }));
    const relay = new CompanionPushRelay(relayId, () => true, { send }, () => 1000);
    const first = relay.send(host, valid); const duplicate = relay.send(host, valid);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    complete('sent');
    expect(await Promise.all([first, duplicate])).toStrictEqual(['sent', 'sent']);
    send.mockRejectedValueOnce(new Error('Offline'));
    const next = { ...valid, notification: { ...valid.notification, id: 'next' } };
    await expect(relay.send(host, next)).rejects.toThrow('Offline');
    send.mockResolvedValueOnce('sent');
    expect(await relay.send(host, next)).toBe('sent');
  });
  it('reports unavailable setup, retries transient failure, and bounds delivery to a device', async () => {
    const valid = await input();
    expect(await new CompanionPushRelay(relayId, () => true, undefined, () => 1000).send(host, valid)).toBe('unavailable');
    const send = vi.fn(async () => 'sent' as const).mockResolvedValueOnce('unavailable' as never);
    const relay = new CompanionPushRelay(relayId, () => true, { send }, () => 1000);
    expect(await relay.send(host, valid)).toBe('unavailable');
    expect(await relay.send(host, valid)).toBe('sent');
    for (let i = 0; i < 125; i++) await relay.send(host, { ...valid, notification: { ...valid.notification, id: String(i) } });
    expect(send).toHaveBeenCalledTimes(60);
  });
});
