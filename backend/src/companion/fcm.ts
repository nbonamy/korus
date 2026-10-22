import { JWT } from 'google-auth-library';
import type { CompanionNotification, CompanionPushRegistration } from '@workspace/core/companion-notification';
import type { PushResult } from './apns';

export type FcmConfig = { projectId: string; clientEmail: string; privateKey: string };

/** Only the relay holds service-account credentials; phones send attention metadata, never text. */
export class FcmSender {
  private readonly auth: JWT;
  constructor(private readonly config: FcmConfig) {
    this.auth = new JWT({ email: config.clientEmail, key: config.privateKey,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
      transporterOptions: { timeout: 10_000, retry: false } });
  }
  async send(registration: CompanionPushRegistration, notification: CompanionNotification): Promise<PushResult> {
    if (registration.transport !== 'fcm') return 'unavailable';
    const data = { notification: JSON.stringify(notification) };
    if (Buffer.byteLength(JSON.stringify(data)) > 4096) return 'unavailable';
    try {
      const { token } = await this.auth.getAccessToken();
      if (!token) return 'unavailable';
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${this.config.projectId}/messages:send`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(10_000), redirect: 'error',
        body: JSON.stringify({ message: { fid: registration.token, data, android: { priority: notification.kind === 'read' ? 'NORMAL' : 'HIGH', ttl: '300s' } } }),
      });
      if (response.ok) { await response.body?.cancel(); return 'sent'; }
      const result = await response.json() as { error?: { details?: { '@type'?: string; errorCode?: string }[] } };
      return result.error?.details?.some(detail => detail['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError' && detail.errorCode === 'UNREGISTERED') ? 'invalid' : 'unavailable';
    } catch { return 'unavailable'; }
  }
}
