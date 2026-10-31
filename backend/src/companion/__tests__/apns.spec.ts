import { generateKeyPairSync, verify } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ connect: vi.fn(), headers: {} as Record<string, string>, body: '', status: 200, reason: '', destroyed: vi.fn() }));
vi.mock('node:http2', async () => {
  const { EventEmitter } = await import('node:events');
  transport.connect.mockImplementation(() => {
    const client = new EventEmitter();
    return Object.assign(client, { destroy: transport.destroyed, request(headers: Record<string, string>) {
      transport.headers = headers;
      const stream = new EventEmitter();
      return Object.assign(stream, { setEncoding() {}, end(body: string) {
        transport.body = body;
        queueMicrotask(() => {
          stream.emit('response', { ':status': transport.status });
          if (transport.reason) stream.emit('data', JSON.stringify({ reason: transport.reason }));
          stream.emit('end');
        });
      } });
    } });
  });
  return { connect: transport.connect };
});
import { ApnsSender } from '../apns';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const config = { environment: 'development' as const, keyId: 'KEY1234567', teamId: 'TEAM123456', topic: 'com.example.app', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
const registration = { token: 'ab'.repeat(32), environment: 'development' as const };
const notification = { id: 'a'.repeat(64), kind: 'question' as const, name: 'Builder', createdAt: 1000, target: { hostId: 'host', locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: null } };
beforeEach(() => { transport.status = 200; transport.reason = ''; transport.connect.mockClear(); transport.destroyed.mockClear(); });
describe('Apple push provider boundary', () => {
  it('starts, updates and ends an aggregate Live Activity using its dedicated Apple topic and token', async () => {
    const sender = new ApnsSender(config);
    const state = { running: 4, attention: 2, agents: [{ id: 'a', name: 'Mobile', status: 'approval' as const, detail: 'Needs your approval' }], more: 3 };
    const base = { hostId: 'host', instanceId: 'a7dd30ba-8472-4b2e-8675-910016589490', timestamp: 1000, startedAt: 990_000, state };
    await sender.sendLiveActivity({ ...registration, kind: 'start' }, { ...base, event: 'start' });
    expect(transport.headers['apns-topic']).toBe(`${config.topic}.push-type.liveactivity`);
    expect(transport.headers['apns-push-type']).toBe('liveactivity');
    expect(JSON.parse(transport.body)).toStrictEqual({ aps: {
      timestamp: 1000, event: 'start', 'content-state': state, 'stale-date': 1900,
      'attributes-type': 'WorkActivityAttributes', attributes: { hostId: 'host', instanceId: base.instanceId, startedAt: base.startedAt },
      'input-push-token': 1, alert: { title: 'Korus', body: 'Your agents are active' },
    } });
    const update = { ...registration, kind: 'update' as const, instanceId: base.instanceId };
    await sender.sendLiveActivity(update, { ...base, event: 'update' });
    expect(JSON.parse(transport.body)).toStrictEqual({ aps: { timestamp: 1000, event: 'update', 'content-state': state, 'stale-date': 1900 } });
    await sender.sendLiveActivity(update, { ...base, event: 'end', state: { running: 0, attention: 0, agents: [], more: 0 } });
    expect(JSON.parse(transport.body)).toStrictEqual({ aps: { timestamp: 1000, event: 'end', 'content-state': { running: 0, attention: 0, agents: [], more: 0 }, 'dismissal-date': 1000 } });
    expect(await sender.sendLiveActivity({ ...update, environment: 'production' }, { ...base, event: 'update' })).toBe('unavailable');
    expect(transport.connect).toHaveBeenCalledTimes(3);
  });
  it('sends a verifiable ES256 token and bounded alert payload to the matching Apple environment', async () => {
    const sender = new ApnsSender(config);
    expect(await sender.send(registration, notification)).toBe('sent');
    expect(transport.connect).toHaveBeenCalledWith('https://api.sandbox.push.apple.com');
    const jwt = transport.headers.authorization!.slice(7).split('.');
    expect(JSON.parse(Buffer.from(jwt[0]!, 'base64url').toString())).toStrictEqual({ alg: 'ES256', kid: config.keyId });
    expect(verify('sha256', Buffer.from(`${jwt[0]}.${jwt[1]}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(jwt[2]!, 'base64url'))).toBe(true);
    expect(transport.headers['apns-topic']).toBe(config.topic);
    expect(transport.headers['apns-push-type']).toBe('alert');
    expect(JSON.parse(transport.body)).toStrictEqual({ aps: { alert: { title: 'Builder', body: 'Has a question for you' }, sound: 'default', 'thread-id': 'agent' }, notification });
    expect(transport.destroyed).toHaveBeenCalledTimes(1);
    expect(await sender.send({ ...registration, environment: 'production' }, notification)).toBe('unavailable');
    expect(transport.connect).toHaveBeenCalledTimes(1);
  });
  it('replaces alerts for one conversation without merging other conversations or read clears', async () => {
    const sender = new ApnsSender(config);
    await sender.send(registration, notification);
    const original = transport.headers['apns-collapse-id'];
    await sender.send(registration, { ...notification, id: 'second', kind: 'completed' });
    expect(transport.headers['apns-collapse-id']).toBe(original);
    for (const target of [
      { ...notification.target, hostId: 'other-host' },
      { ...notification.target, sessionId: 'other-session' },
      { ...notification.target, agentId: 'other-agent' },
    ]) {
      await sender.send(registration, { ...notification, id: 'third', target });
      expect(transport.headers['apns-collapse-id']).not.toBe(original);
    }
    await sender.send(registration, { ...notification, kind: 'read', revision: 1 });
    expect(transport.headers['apns-collapse-id']).not.toBe(original);
    expect(Buffer.byteLength(original!)).toBeLessThanOrEqual(64);
  });
  it('sends read acknowledgments as silent background pushes without an alert or sound', async () => {
    const read = { ...notification, kind: 'read' as const, revision: 4 };
    expect(await new ApnsSender(config).send(registration, read)).toBe('sent');
    expect(transport.headers['apns-push-type']).toBe('background');
    expect(transport.headers['apns-priority']).toBe('5');
    expect(JSON.parse(transport.body)).toStrictEqual({ aps: { 'content-available': 1 }, notification: read });
  });
  it.each([[410, 'Unregistered', 'invalid'], [400, 'BadDeviceToken', 'invalid'], [403, 'InvalidProviderToken', 'unavailable'], [429, 'TooManyRequests', 'unavailable']])('classifies Apple response %s without exposing credentials', async (status, reason, result) => {
    transport.status = status as number; transport.reason = reason as string;
    expect(await new ApnsSender(config).send(registration, notification)).toBe(result);
    expect(transport.destroyed).toHaveBeenCalledTimes(1);
  });
});
