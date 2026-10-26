import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { multiaddr } from '@multiformats/multiaddr';
import type { Libp2p, PrivateKey, Stream } from '@libp2p/interface';
import { z } from 'zod';
import { companionPeerIdPattern, relayAddress } from '@workspace/core/companion-relay';
import { encodeCompanionFrame, readFirstCompanionFrame } from '@workspace/core/companion-protocol';
import { shareGuestProtocol, shareHandlePattern, shareRendezvousProtocol, type ShareRoutingStatus } from '@workspace/core/conversation-share-relay';
import type { ShareRelay } from '@workspace/core/conversation-sharing';
import { unsupportedShareProtocol } from './owner-transport';

type Route = { relay: ShareRelay; ownerId: string; handle: string };
type OpenResult = { status: 'ready'; stream: Stream } | { status: Exclude<ShareRoutingStatus, 'ready'> | 'invalid' };
const answer = z.object({ v: z.literal(1), status: z.enum(['ready', 'unavailable', 'capacity', 'rateLimited', 'upgradeRequired']) }).strict();

/** Narrow desktop guest entry: resolve routing, then Noise-authenticate the independently pinned owner.
 * The caller must authorize inside the resulting stream; no paired-phone/session API is exposed.
 */
export class GuestConversationTransport {
  private node?: Libp2p;
  private opening = false;
  private ownerId = '';
  constructor(private readonly key: PrivateKey, private readonly supportedRelay: ShareRelay) {}
  async open(route: Route): Promise<OpenResult> {
    if (this.opening) return { status: 'unavailable' };
    if (route.relay.origin !== this.supportedRelay.origin || route.relay.peerId !== this.supportedRelay.peerId
      || !companionPeerIdPattern.test(route.ownerId) || !shareHandlePattern.test(route.handle)) return { status: 'invalid' };
    this.opening = true;
    try {
      const relay = multiaddr(relayAddress(this.supportedRelay.origin, this.supportedRelay.peerId)).toString();
      const circuit = `${relay}/p2p-circuit/p2p/${route.ownerId}`;
      if (this.ownerId !== route.ownerId) await this.stop();
      const node = this.node ?? await createLibp2p({ privateKey: this.key,
        transports: [webSockets(), circuitRelayTransport()], connectionEncrypters: [noise()], streamMuxers: [yamux()], services: { identify: identify() },
        connectionManager: { maxConnections: 2, maxParallelDials: 1 },
        connectionGater: {
          denyDialPeer: peer => ![route.ownerId, this.supportedRelay.peerId].includes(peer.toString()),
          denyDialMultiaddr: address => ![relay, circuit].includes(address.toString()),
          denyInboundConnection: () => true,
        },
      });
      this.node = node; this.ownerId = route.ownerId;
      const lookup = await node.dialProtocol(multiaddr(relay), shareRendezvousProtocol, { signal: AbortSignal.timeout(10_000) });
      let status;
      try {
        lookup.maxReadBufferLength = 4096; lookup.maxWriteBufferLength = 4096; lookup.inactivityTimeout = 10_000;
        // The credential is intentionally absent from the routing contract.
        lookup.send(encodeCompanionFrame({ v: 1, ownerId: route.ownerId, handle: route.handle }));
        await lookup.close({ signal: AbortSignal.timeout(5000) });
        status = answer.parse(await readFirstCompanionFrame(lookup, 4096)).status;
      } finally { lookup.abort(new Error('Guest lookup finished.')); }
      if (status !== 'ready') return { status };
      const stream = await node.dialProtocol(multiaddr(circuit), shareGuestProtocol, { signal: AbortSignal.timeout(10_000), runOnLimitedConnection: true });
      return { status: 'ready', stream };
    } catch (error) {
      await this.stop();
      return { status: unsupportedShareProtocol(error) ? 'upgradeRequired' : 'unavailable' };
    } finally { this.opening = false; }
  }
  async stop() { const node = this.node; this.node = undefined; await node?.stop(); }
}
