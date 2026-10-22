import type { CompanionNotification, CompanionPushRegistration } from '@workspace/core/companion-notification';
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

  constructor(private readonly key: PrivateKey, gateway: CompanionGateway) {
    this.client = new RelayClient(this.link, gateway);
    this.streams = new StreamServer(gateway, () => this.client.advertise());
  }

  get connected() { return this.link.connected; }

  async start(origin: string, relayPeerId: string) {
    await this.stop();
    await this.link.start({ key: this.key, origin, relayPeerId, register: (node) => this.streams.attach(node), admit: () => this.client.advertise() });
    this.client.startRenewal();
  }

  advertise() { return this.client.advertise(); }

  push(peerId: string, registration: CompanionPushRegistration, notification: CompanionNotification): Promise<PushResult> {
    return this.client.push(peerId, registration, notification);
  }

  revoke(peerId: string) {
    this.streams.abort(peerId, 'Device revoked.');
    this.link.closeConnectionsOf(peerId);
  }

  async stop() {
    this.client.stopRenewal();
    this.streams.abortAll('Companion disabled.');
    await this.link.stop();
  }
}
