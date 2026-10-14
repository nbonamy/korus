import { createPrivateKey, sign } from 'node:crypto';
import { connect } from 'node:http2';
import type { CompanionNotification, CompanionPushRegistration } from '@workspace/core/companion-notification';

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
    if (registration.environment !== this.config.environment) return 'unavailable';
    const now = Math.floor(Date.now() / 1000);
    if (!this.token || now - this.issuedAt >= 3000) {
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const unsigned = `${encode({ alg: 'ES256', kid: this.config.keyId })}.${encode({ iss: this.config.teamId, iat: now })}`;
      this.token = `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key: this.key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
      this.issuedAt = now;
    }
    const payload = JSON.stringify({ aps: { alert: { title: notification.name, body: messages[notification.kind] }, sound: 'default', 'thread-id': notification.target.agentId }, notification });
    if (Buffer.byteLength(payload) > 4096) return 'unavailable';
    const client = connect(registration.environment === 'development' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com');
    return new Promise(resolve => {
      let finished = false;
      const finish = (result: PushResult) => { if (finished) return; finished = true; clearTimeout(timer); client.destroy(); resolve(result); };
      const timer = setTimeout(() => finish('unavailable'), 10_000);
      client.on('error', () => finish('unavailable'));
      const request = client.request({ ':method': 'POST', ':path': `/3/device/${registration.token}`,
        authorization: `bearer ${this.token}`, 'apns-topic': this.config.topic, 'apns-push-type': 'alert',
        'apns-priority': '10', 'apns-expiration': String(now + 300), 'apns-collapse-id': notification.id });
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
