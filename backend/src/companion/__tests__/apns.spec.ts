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
