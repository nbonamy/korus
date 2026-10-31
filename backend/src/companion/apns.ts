import { createHash, createPrivateKey, sign } from 'node:crypto';
import { connect } from 'node:http2';
import type { CompanionNotification, CompanionPushRegistration } from '@workspace/core/companion-notification';
import type { LiveActivityRegistration, LiveActivityPush } from '@workspace/core/companion-live-activity';
import { product } from '@workspace/core/product';

export type ApnsConfig = { keyId: string; teamId: string; topic: string; privateKey: string; environment: CompanionPushRegistration['environment'] };
export type PushResult = 'sent' | 'invalid' | 'unavailable';
const messages = { completed: 'Finished its turn', approval: 'Needs your approval', question: 'Has a question for you' };

/** The Apple signing key belongs only to the relay operator, never to a phone or laptop build. */
export class ApnsSender {
  private readonly key;
  private token = '';
  private issuedAt = 0;
  constructor(private readonly config: ApnsConfig) {
    this.key = createPrivateKey(config.privateKey);
    if (this.key.asymmetricKeyType !== 'ec' || this.key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('APNs requires a P-256 key.');
  }
  async send(registration: CompanionPushRegistration, notification: CompanionNotification): Promise<PushResult> {
    if (registration.transport === 'fcm' || registration.environment !== this.config.environment) return 'unavailable';
    const read = notification.kind === 'read';
    const target = notification.target;
    const collapseId = read ? notification.id : createHash('sha256').update(JSON.stringify([
      target.hostId, target.locationId, target.teamId, target.agentId, target.sessionId,
    ])).digest('hex');
    return this.deliver(registration, { aps: read ? { 'content-available': 1 } : { alert: { title: notification.name, body: messages[notification.kind as keyof typeof messages] }, sound: 'default', 'thread-id': notification.target.agentId }, notification },
      this.config.topic, read ? 'background' : 'alert', read ? '5' : '10', collapseId);
  }

  async sendLiveActivity(registration: LiveActivityRegistration, push: LiveActivityPush): Promise<PushResult> {
    if (registration.environment !== this.config.environment) return 'unavailable';
    const aps = { timestamp: push.timestamp, event: push.event, 'content-state': push.state,
      ...(push.event === 'end' ? { 'dismissal-date': push.timestamp } : { 'stale-date': push.timestamp + 900 }),
      ...(push.event === 'start' ? { 'attributes-type': 'WorkActivityAttributes', attributes: { hostId: push.hostId, instanceId: push.instanceId, startedAt: push.startedAt },
        'input-push-token': 1, alert: { title: product.name, body: 'Your agents are active' } } : {}) };
    return this.deliver(registration, { aps }, `${this.config.topic}.push-type.liveactivity`, 'liveactivity',
      push.event === 'update' && push.state.attention === 0 ? '5' : '10', push.instanceId);
  }

  private async deliver(registration: Pick<CompanionPushRegistration, 'token' | 'environment'>, value: unknown, topic: string, pushType: string, priority: string, collapseId: string): Promise<PushResult> {
    const now = Math.floor(Date.now() / 1000);
    if (!this.token || now - this.issuedAt >= 3000) {
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const unsigned = `${encode({ alg: 'ES256', kid: this.config.keyId })}.${encode({ iss: this.config.teamId, iat: now })}`;
      this.token = `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key: this.key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
      this.issuedAt = now;
    }
    const payload = JSON.stringify(value);
    if (Buffer.byteLength(payload) > 4096) return 'unavailable';
    const client = connect(registration.environment === 'development' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com');
    return new Promise(resolve => {
      let finished = false;
      const finish = (result: PushResult) => { if (finished) return; finished = true; clearTimeout(timer); client.destroy(); resolve(result); };
      const timer = setTimeout(() => finish('unavailable'), 10_000);
      client.on('error', () => finish('unavailable'));
      const request = client.request({ ':method': 'POST', ':path': `/3/device/${registration.token}`,
        authorization: `bearer ${this.token}`, 'apns-topic': topic, 'apns-push-type': pushType,
        'apns-priority': priority, 'apns-expiration': String(now + 300), 'apns-collapse-id': collapseId });
      let status = 0; let body = '';
      request.on('response', headers => { status = Number(headers[':status']); });
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { if (body.length < 4096) body += chunk; });
      request.on('error', () => finish('unavailable'));
      request.on('end', () => {
        let reason = ''; try { reason = JSON.parse(body).reason; } catch { /* Empty success response. */ }
        finish(status === 200 ? 'sent' : status === 410 || status === 400 && ['BadDeviceToken', 'DeviceTokenNotForTopic'].includes(reason) ? 'invalid' : 'unavailable');
      });
      request.on('close', () => finish('unavailable'));
      request.end(payload);
    });
  }
}
