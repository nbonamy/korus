import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ create: vi.fn(), getAccessToken: vi.fn() }));
vi.mock('google-auth-library', () => ({ JWT: class {
  constructor(options: unknown) { auth.create(options); }
  getAccessToken() { return auth.getAccessToken(); }
} }));
import { FcmSender } from '../fcm';

const config = { projectId: 'example-project', clientEmail: 'relay@example-project.iam.gserviceaccount.com', privateKey: 'operator-managed-key' };
const registration = { token: 'cTQy0Gz78H0x9xR1oCMkVb', environment: 'production' as const, transport: 'fcm' as const };
const notification = { id: 'event', kind: 'question' as const, name: 'Builder', createdAt: 1000,
  target: { hostId: 'host', locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: null } };
let fetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  auth.create.mockClear(); auth.getAccessToken.mockReset().mockResolvedValue({ token: 'short-lived-token' });
  fetch = vi.fn().mockResolvedValue(Response.json({ name: 'projects/example-project/messages/accepted' }));
  vi.stubGlobal('fetch', fetch);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Firebase push provider boundary', () => {
  it('uses scoped operator authentication and delivers attention metadata without conversation content', async () => {
    const sender = new FcmSender(config);
    expect(await sender.send(registration, notification)).toBe('sent');
    expect(auth.create).toHaveBeenCalledWith(expect.objectContaining({ email: config.clientEmail, key: config.privateKey, scopes: ['https://www.googleapis.com/auth/firebase.messaging'] }));
    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe('https://fcm.googleapis.com/v1/projects/example-project/messages:send');
    expect(options.headers).toStrictEqual({ authorization: 'Bearer short-lived-token', 'content-type': 'application/json' });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(options.body)).toStrictEqual({ message: {
      fid: registration.token, data: { notification: JSON.stringify(notification) },
      android: { priority: 'HIGH', ttl: '300s' },
    } });
    expect(await sender.send({ token: 'ab'.repeat(32), environment: 'production' }, notification)).toBe('unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('delivers read checkpoints as normal-priority data without creating another visible notification', async () => {
    const read = { ...notification, kind: 'read' as const, revision: 2 };
    expect(await new FcmSender(config).send(registration, read)).toBe('sent');
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toStrictEqual({ message: {
      fid: registration.token, data: { notification: JSON.stringify(read) }, android: { priority: 'NORMAL', ttl: '300s' },
    } });
  });
  it.each([
    [404, { error: { details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } }, 'invalid'],
    [400, { error: { status: 'INVALID_ARGUMENT' } }, 'unavailable'],
    [403, { error: { status: 'PERMISSION_DENIED' } }, 'unavailable'],
    [429, { error: { status: 'RESOURCE_EXHAUSTED' } }, 'unavailable'],
  ])('classifies provider response %s without deleting tokens for configuration or payload failures', async (status, response, expected) => {
    fetch.mockResolvedValue(Response.json(response, { status }));
    expect(await new FcmSender(config).send(registration, notification)).toBe(expected);
  });
  it('keeps failed authentication and transport errors retryable without leaking credentials', async () => {
    const sender = new FcmSender(config);
    auth.getAccessToken.mockRejectedValueOnce(new Error('private credential details'));
    expect(await sender.send(registration, notification)).toBe('unavailable');
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRejectedValueOnce(new Error('Offline'));
    expect(await sender.send(registration, notification)).toBe('unavailable');
    expect(await sender.send(registration, notification)).toBe('sent');
  });
});
