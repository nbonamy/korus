import { ShareOwnerTransport, type ShareOwnerOptions } from '../sharing/owner-transport';
import type { CompanionNotification, CompanionPushRegistration } from '@workspace/core/companion-notification';
import type { LiveActivityRegistration, LiveActivityPush } from '@workspace/core/companion-live-activity';
import type { PrivateKey } from '@libp2p/interface';
import type { PushResult } from './apns';
import type { CompanionGateway } from './gateway';
import { RelayClient } from './relay-client';
import { RelayLink } from './relay-link';
import { StreamServer } from './stream-server';

/** The laptop's side of the companion transport: a relay link, what it asks of the relay, and the streams it serves. */
export class CompanionOutboundConnector {
  private readonly link = new RelayLink();
  private readonly client: RelayClient;
  private readonly streams: StreamServer;
  private readonly sharing?: ShareOwnerTransport;

  constructor(private readonly key: PrivateKey, gateway: CompanionGateway, options: { phoneEnabled?: () => boolean; sharing?: ShareOwnerOptions } = {}) {
    this.client = new RelayClient(this.link, gateway, options.phoneEnabled);
    this.streams = new StreamServer(gateway, () => this.client.advertise(), options.phoneEnabled);
    if (options.sharing) this.sharing = new ShareOwnerTransport(this.link, options.sharing);
  }

  get connected() { return this.link.connected; }

  async start(origin: string, relayPeerId: string) {
    await this.stop();
    await this.link.start({ key: this.key, origin, relayPeerId, register: async (node) => { await this.streams.attach(node); await this.sharing?.attach(node); }, admit: () => this.advertise(), disconnected: () => this.sharing?.disconnected() });
    this.client.startRenewal(() => this.advertise());
  }

  async advertise() {
    const phone = await this.client.advertise();
    await this.sharing?.advertise();
    return phone;
  }

  disablePhone() { this.streams.abortAll('Mobile access disabled.'); }

  push(peerId: string, registration: CompanionPushRegistration, notification: CompanionNotification): Promise<PushResult> {
    return this.client.push(peerId, registration, notification);
  }

  liveActivity(peerId: string, registration: LiveActivityRegistration, activity: LiveActivityPush): Promise<PushResult> {
    return this.client.liveActivity(peerId, registration, activity);
  }

  revoke(peerId: string) {
    this.streams.abort(peerId, 'Device revoked.');
    this.link.closeConnectionsOf(peerId);
  }

  async stop() {
    this.client.stopRenewal();
    this.sharing?.stop();
    this.streams.abortAll('Companion disabled.');
    await this.link.stop();
  }
}
