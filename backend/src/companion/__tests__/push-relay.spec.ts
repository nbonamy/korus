import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { companionPushAuthorizationMessage } from '@workspace/core/companion-notification';
import { CompanionPushRelay } from '../push-relay';

const host = 'h'.repeat(52); const relayId = 'relay';
let phone: Awaited<ReturnType<typeof generateKeyPair>>; let peerId: string;
beforeEach(async () => { phone = await generateKeyPair('Ed25519'); peerId = peerIdFromPrivateKey(phone).toString(); });
const source = '192.0.2.1';
async function input(hostId = host, token = 'ab'.repeat(32), transport?: 'fcm') {
  const registration = { token, environment: 'development' as const, ...(transport ? { transport } : {}) };
  const expiresAt = 100000;
  const signature = Buffer.from(await phone.sign(companionPushAuthorizationMessage(relayId, hostId, peerId, registration, expiresAt))).toString('base64');
  return { peerId, registration: { ...registration, authorization: { expiresAt, signature } }, notification: {
    id: 'event', name: 'Agent', kind: 'completed', createdAt: 1000,
    target: { hostId, locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: null },
  } };
}
describe('push relay admission', () => {
  it('admits opaque FCM tokens with phone consent and rejects switching the signed delivery service', async () => {
    const send = vi.fn(async () => 'sent' as const);
    const relay = new CompanionPushRelay(relayId, () => true, { send }, () => 1000);
    // Both services can carry a hexadecimal token: rejection must come from consent, not syntax.
    const hex = await input(host, 'ab'.repeat(32), 'fcm');
    const { transport: _transport, ...legacy } = hex.registration;
    await expect(relay.send(host, source, { ...hex, registration: legacy })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    const opaque = await input(host, 'device-token:APA91b-example_-registration', 'fcm');
    expect(await relay.send(host, source, opaque)).toBe('sent');
    expect(send).toHaveBeenCalledExactlyOnceWith(opaque.registration, opaque.notification);
    await expect(relay.send(host, source, { ...opaque, registration: { ...opaque.registration, token: 'another:opaque-token' } })).rejects.toThrow();
    await expect(relay.send(host, source, { ...opaque, registration: { ...opaque.registration, token: 'x'.repeat(4097) } })).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
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
    ]) await expect(relay.send(host, source, { ...valid, registration })).rejects.toThrow();
    await expect(relay.send('other-host', source, { ...valid, notification: { ...valid.notification, target: { ...valid.notification.target, hostId: 'other-host' } } })).rejects.toThrow();
    await expect(new CompanionPushRelay('another-relay', () => true, { send }, () => 1000).send(host, source, valid)).rejects.toThrow();
    await expect(relay.send(host, source, { ...valid, peerId: peerIdFromPrivateKey(await generateKeyPair('Ed25519')).toString() })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(await relay.send(host, source, valid)).toBe('sent');
    expect(await relay.send(host, source, valid)).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('rejects unpaired, forged, malformed and expired alerts before calling Apple', async () => {
    const send = vi.fn(async () => 'sent' as const); const valid = await input();
    const relay = new CompanionPushRelay(relayId, (h, p) => h === host && p === peerId, { send }, () => 1000);
    for (const value of [ { ...valid, peerId: 'x'.repeat(52) }, { ...valid, registration: { token: '../invalid', environment: 'development' } },
      { ...valid, notification: { ...valid.notification, createdAt: -400000 } },
      { ...valid, notification: { ...valid.notification, target: { ...valid.notification.target, hostId: 'forged' } } } ]) {
      await expect(relay.send(host, source, value)).rejects.toThrow();
    }
    expect(send).not.toHaveBeenCalled();
  });
  it('coalesces concurrent delivery and permits a retry after an Apple transport failure', async () => {
    const valid = await input();
    let complete!: (result: 'sent') => void;
    const send = vi.fn(() => new Promise<'sent'>(resolve => { complete = resolve; }));
    const relay = new CompanionPushRelay(relayId, () => true, { send }, () => 1000);
    const first = relay.send(host, source, valid); const duplicate = relay.send(host, source, valid);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    complete('sent');
    expect(await Promise.all([first, duplicate])).toStrictEqual(['sent', 'sent']);
    send.mockRejectedValueOnce(new Error('Offline'));
    const next = { ...valid, notification: { ...valid.notification, id: 'next' } };
    await expect(relay.send(host, source, next)).rejects.toThrow('Offline');
    send.mockResolvedValueOnce('sent');
    expect(await relay.send(host, source, next)).toBe('sent');
  });
  it('reports unavailable setup, retries transient failure, and bounds delivery to a device', async () => {
    const valid = await input();
    expect(await new CompanionPushRelay(relayId, () => true, undefined, () => 1000).send(host, source, valid)).toBe('unavailable');
    const send = vi.fn(async () => 'sent' as const).mockResolvedValueOnce('unavailable' as never);
    const relay = new CompanionPushRelay(relayId, () => true, { send }, () => 1000);
    expect(await relay.send(host, source, valid)).toBe('unavailable');
    expect(await relay.send(host, source, valid)).toBe('sent');
    for (let i = 0; i < 125; i++) await relay.send(host, source, { ...valid, notification: { ...valid.notification, id: String(i) } });
    expect(send).toHaveBeenCalledTimes(60);
  });
  it('keeps delivering for other sources while one source rotates laptop identities', async () => {
    const send = vi.fn(async () => 'sent' as const);
    const relay = new CompanionPushRelay(relayId, () => true, { send }, () => 1000);
    for (let laptop = 0; laptop < 10; laptop++) {
      const id = String(laptop).repeat(52); const valid = await input(id, String(laptop).repeat(64));
      for (let i = 0; i < 60; i++) await relay.send(id, source, { ...valid, notification: { ...valid.notification, id: String(i) } });
    }
    expect(send).toHaveBeenCalledTimes(60);
    expect(await relay.send(host, '198.51.100.7', await input())).toBe('sent');
  });
});
