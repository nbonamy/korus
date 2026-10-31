import { z } from 'zod';
import { peerIdFromString } from '@libp2p/peer-id';
import { companionPushAuthorizationMessage, isCompanionNotification, type CompanionNotification } from '@workspace/core/companion-notification';
import type { ApnsSender, PushResult } from './apns';
import { WindowBudget } from './source-budget';
import { pushRegistrationSchema } from './push-registration';
import { liveActivityAuthorizationMessage, type LiveActivityRegistration } from '@workspace/core/companion-live-activity';
import { liveActivityRegistrationSchema, liveActivityPushSchema } from './live-activity-schema';

const request = z.object({ peerId: z.string().min(32).max(128), registration: pushRegistrationSchema,
  notification: z.custom<CompanionNotification>(isCompanionNotification) }).strict();

/**
 * Public laptops need the phone's signed consent in addition to a current device route. Budgets
 * count per source network and device token, because laptop identities cost nothing to create.
 */
export class CompanionPushRelay {
  private readonly recent = new Map<string, number>();
  private readonly global: WindowBudget;
  private readonly sources: WindowBudget;
  private readonly tokens: WindowBudget;
  private active = 0;
  private readonly pending = new Map<string, Promise<PushResult>>();
  constructor(private readonly relayId: string, private readonly allowed: (host: string, device: string) => boolean,
    private readonly sender?: Pick<ApnsSender, 'send'> & Partial<Pick<ApnsSender, 'sendLiveActivity'>>, private readonly now = Date.now) {
    // Fairness needs the global cap far above one source's: a single abuser then cannot
    // starve the relay. Laptop identities are free, so a per-laptop limit would add nothing.
    this.global = new WindowBudget(6000, 60_000, 1, now);
    this.sources = new WindowBudget(60, 60_000, 10_000, now);
    this.tokens = new WindowBudget(60, 60_000, 10_000, now);
  }
  async send(host: string, source: string, input: unknown): Promise<PushResult> {
    const { peerId, registration, notification } = request.parse(input);
    if (notification.target.hostId !== host || Math.abs(this.now() - notification.createdAt) > 300_000) throw new Error('Push denied.');
    this.consent(host, peerId, registration);
    if (!this.sender) return 'unavailable';
    return this.deliver(host, source, peerId, registration, `${host}/${peerId}/${notification.id}`,
      expiresAt => companionPushAuthorizationMessage(this.relayId, host, peerId, registration, expiresAt), () => this.sender!.send(registration, notification));
  }

  async liveActivity(host: string, source: string, input: unknown): Promise<PushResult> {
    const { peerId, registration, activity } = z.object({ peerId: z.string().min(32).max(128),
      registration: liveActivityRegistrationSchema, activity: liveActivityPushSchema }).strict().parse(input);
    if (activity.hostId !== host || Math.abs(this.now() - activity.timestamp * 1000) > 300_000
      || (activity.event === 'start') !== (registration.kind === 'start')
      || registration.kind === 'update' && registration.instanceId !== activity.instanceId) throw new Error('Push denied.');
    this.consent(host, peerId, registration);
    if (!this.sender?.sendLiveActivity) return 'unavailable';
    return this.deliver(host, source, peerId, registration, `activity/${host}/${peerId}/${activity.instanceId}/${activity.event}/${activity.timestamp}`,
      expiresAt => liveActivityAuthorizationMessage(this.relayId, host, peerId, registration, expiresAt), () => this.sender!.sendLiveActivity!(registration, activity));
  }

  private async deliver(host: string, source: string, peerId: string,
    registration: LiveActivityRegistration | z.infer<typeof pushRegistrationSchema>, key: string,
    message: (expiresAt: number) => Uint8Array, send: () => Promise<PushResult>): Promise<PushResult> {
    const now = this.now();
    const { expiresAt, signature } = this.consent(host, peerId, registration);
    for (const [key, until] of this.recent) { if (until > now) break; this.recent.delete(key); }
    if (this.active >= 20 || !this.sources.take(source) || !this.tokens.take(`${'kind' in registration ? 'activity' : registration.transport ?? 'apns'}/${registration.environment}/${registration.token}`) || !this.global.take('global')) return 'unavailable';
    this.active++;
    try {
      const publicKey = peerIdFromString(peerId).publicKey;
      if (!publicKey || publicKey.type !== 'Ed25519' || !await publicKey.verify(
        message(expiresAt), Buffer.from(signature, 'base64'))) throw new Error('Push denied.');
      if (this.recent.has(key)) return 'sent';
      // A different request with the same ID must still prove phone consent before deduplication.
      const pending = this.pending.get(key);
      if (pending) return await pending;
      if (!this.allowed(host, peerId)) throw new Error('Push denied.');
      const work = send().then(result => {
        if (result === 'sent') {
          if (this.recent.size >= 12_000) this.recent.delete(this.recent.keys().next().value!);
          this.recent.set(key, now + 300_000);
        }
        return result;
      });
      this.pending.set(key, work);
      try { return await work; } finally { this.pending.delete(key); }
    } finally { this.active--; }
  }
  private consent(host: string, peerId: string, registration: Pick<LiveActivityRegistration, 'authorization'>) {
    const authorization = registration.authorization;
    if (!authorization || !this.allowed(host, peerId) || authorization.expiresAt <= this.now()
      || authorization.expiresAt > this.now() + 31 * 86400_000) throw new Error('Push denied.');
    return authorization;
  }
}
