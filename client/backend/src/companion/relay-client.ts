import { companionPushProtocol, type CompanionNotification, type CompanionPushRegistration } from '@workspace/core/companion-notification';
import { companionLiveActivityProtocol, type LiveActivityRegistration, type LiveActivityPush } from '@workspace/core/companion-live-activity';
import { readFirstCompanionFrame, encodeCompanionFrame } from '@workspace/core/companion-protocol';
import { companionAdmissionIntervalMs, companionAdmissionProtocol } from '@workspace/core/companion-relay';
import { z } from 'zod';
import { warnMain } from '../log';
import type { PushResult } from './apns';
import { describeError } from './describe-error';
import type { CompanionGateway } from './gateway';
import type { RelayLink } from './relay-link';

const dialTimeoutMs = 10_000;
const closeTimeoutMs = 5_000;
const admissionAnswer = z.object({ ok: z.literal(true) }).strict();
const pushAnswer = z.object({ result: z.enum(['sent', 'invalid', 'unavailable']) }).strict();

/** What the laptop asks of the relay itself: route these devices and invitations, and deliver this push. */
export class RelayClient {
  private admissionQueue: Promise<unknown> = Promise.resolve();
  private renewal: ReturnType<typeof setInterval> | undefined;
  private renewing = false;

  constructor(private readonly link: RelayLink, private readonly gateway: CompanionGateway, private readonly phoneEnabled: () => boolean = () => true) {}

  /** Renews the relay's routing every few seconds so it never outlives a lease the relay has dropped. */
  startRenewal(advertise = () => this.advertise()) {
    this.stopRenewal();
    this.renewal = setInterval(() => {
      if (this.renewing) return;
      this.renewing = true;
      void advertise().finally(() => { this.renewing = false; });
    }, companionAdmissionIntervalMs);
    this.renewal.unref();
  }

  stopRenewal() { clearInterval(this.renewal); this.renewal = undefined; }

  /** One admission at a time, each built from the grants as they are when it runs, so a stale list never lands after a revoke. */
  advertise(): Promise<boolean> {
    const run = this.admissionQueue.then(() => this.sendAdmission(), () => this.sendAdmission());
    this.admissionQueue = run;
    return run;
  }

  async push(peerId: string, registration: CompanionPushRegistration, notification: CompanionNotification): Promise<PushResult> {
    return this.deliver(peerId, companionPushProtocol, { peerId, registration, notification });
  }

  liveActivity(peerId: string, registration: LiveActivityRegistration, activity: LiveActivityPush): Promise<PushResult> {
    return this.deliver(peerId, companionLiveActivityProtocol, { peerId, registration, activity });
  }

  private async deliver(peerId: string, protocol: string, payload: unknown): Promise<PushResult> {
    if (!this.link.connected || !this.authorized(peerId)) return 'unavailable';
    const stream = await this.link.dialRelay(protocol, dialTimeoutMs);
    try {
      if (!this.authorized(peerId)) return 'unavailable';
      stream.maxReadBufferLength = 16_384; stream.inactivityTimeout = 15_000;
      stream.send(encodeCompanionFrame(payload));
      await stream.close({ signal: AbortSignal.timeout(closeTimeoutMs) });
      return pushAnswer.parse(await readFirstCompanionFrame(stream)).result;
    } finally { stream.abort(new Error('Push request finished.')); }
  }

  private authorized(peerId: string) { return this.phoneEnabled() && this.gateway.grants.some((grant) => grant.peerId === peerId); }

  private async sendAdmission(): Promise<boolean> {
    if (!this.link.connected) return false;
    let ok = false; let failure: unknown;
    try {
      const stream = await this.link.dialRelay(companionAdmissionProtocol, dialTimeoutMs);
      try {
        stream.maxReadBufferLength = 16_384; stream.inactivityTimeout = dialTimeoutMs;
        stream.send(encodeCompanionFrame({ devices: this.phoneEnabled() ? this.gateway.grants.map((grant) => grant.peerId) : [], invitations: this.phoneEnabled() ? this.gateway.pairingInvitations() : [] }));
        await stream.close({ signal: AbortSignal.timeout(closeTimeoutMs) });
        ok = admissionAnswer.safeParse(await readFirstCompanionFrame(stream)).success;
      } finally { stream.abort(new Error('Admission finished.')); }
    } catch (error) {
      // Endpoint grants remain authoritative during relay outages; the streak tells a dead link from a bad attempt.
      failure = error;
      warnMain('companion', 'relay admission failed', { error: describeError(error) });
    }
    this.link.noteAdmission(ok, failure);
    return ok;
  }
}
