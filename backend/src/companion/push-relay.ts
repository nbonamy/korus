import { z } from 'zod';
import { peerIdFromString } from '@libp2p/peer-id';
import { companionPushAuthorizationMessage, isCompanionNotification, type CompanionNotification } from '@workspace/core/companion-notification';
import type { ApnsSender, PushResult } from './apns';
import { WindowBudget } from './source-budget';

const request = z.object({ peerId: z.string().min(32).max(128), registration: z.object({
  token: z.string().regex(/^[a-f0-9]{32,512}$/), environment: z.enum(['development', 'production']),
  authorization: z.object({ expiresAt: z.number().int().positive(), signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) }).strict(),
}).strict(), notification: z.custom<CompanionNotification>(isCompanionNotification) }).strict();

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
    private readonly sender?: Pick<ApnsSender, 'send'>, private readonly now = Date.now) {
    // Fairness needs the global cap far above one source's: a single abuser then cannot
    // starve the relay. Laptop identities are free, so a per-laptop limit would add nothing.
    this.global = new WindowBudget(6000, 60_000, 1, now);
    this.sources = new WindowBudget(60, 60_000, 10_000, now);
    this.tokens = new WindowBudget(60, 60_000, 10_000, now);
  }
  async send(host: string, source: string, input: unknown): Promise<PushResult> {
    const { peerId, registration, notification } = request.parse(input);
    const now = this.now();
    const { expiresAt, signature } = registration.authorization;
    if (!this.allowed(host, peerId) || notification.target.hostId !== host
      || Math.abs(now - notification.createdAt) > 300_000 || expiresAt <= now || expiresAt > now + 31 * 86400_000) throw new Error('Push denied.');
    if (!this.sender) return 'unavailable';
    for (const [key, until] of this.recent) { if (until > now) break; this.recent.delete(key); }
    if (this.active >= 20 || !this.sources.take(source) || !this.tokens.take(`${registration.environment}/${registration.token}`) || !this.global.take('global')) return 'unavailable';
    const key = `${host}/${peerId}/${notification.id}`;
    this.active++;
    try {
      const publicKey = peerIdFromString(peerId).publicKey;
      if (!publicKey || publicKey.type !== 'Ed25519' || !await publicKey.verify(
        companionPushAuthorizationMessage(this.relayId, host, peerId, registration, expiresAt), Buffer.from(signature, 'base64'))) throw new Error('Push denied.');
      if (this.recent.has(key)) return 'sent';
      // A different request with the same ID must still prove phone consent before deduplication.
      const pending = this.pending.get(key);
      if (pending) return await pending;
      if (!this.allowed(host, peerId)) throw new Error('Push denied.');
      const work = this.sender.send(registration, notification).then(result => {
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
}
