import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { multiaddr } from '@multiformats/multiaddr';
import type { Libp2p, PrivateKey, Stream } from '@libp2p/interface';
import { relayAddress } from '@workspace/core/companion-relay';
import { warnMain } from '../log';
import { describeError } from './describe-error';
import { FailureStreak } from './failure-streak';

/** Consecutive refused or unanswered admissions (20 s apart) before the relay link is presumed dead. */
const silentRelayLimit = 3;

type Start = {
  key: PrivateKey; origin: string; relayPeerId: string;
  /** Installs the protocol handlers once, on the freshly created node. */
  register(node: Libp2p): Promise<void>;
  /** Tells the relay which devices to route; run after every successful (re)connection. */
  admit(): Promise<boolean>;
};

/**
 * The laptop's one outbound link: a libp2p node holding a reservation on the pinned relay, reconnected with
 * backoff whenever the relay connection is gone. Phones reach the laptop only through circuits on this link.
 */
export class RelayLink {
  /** True once the relay has accepted the reservation and the connection is still open. */
  connected = false;
  private node: Libp2p | null = null;
  private stopped = true;
  private reserving = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private address = '';
  private relayPeerId = '';
  private admit: () => Promise<boolean> = async () => true;
  private readonly silence = new FailureStreak(silentRelayLimit);

  async start(options: Start) {
    await this.stop();
    const address = multiaddr(relayAddress(options.origin, options.relayPeerId));
    this.stopped = false; this.address = address.toString(); this.relayPeerId = options.relayPeerId; this.admit = options.admit;
    this.node = await createLibp2p({ start: false, privateKey: options.key, addresses: { listen: [`${address}/p2p-circuit`] },
      transports: [webSockets(), circuitRelayTransport({ maxReservationQueueLength: 1, maxInboundStopStreams: 8 })],
      connectionEncrypters: [noise()], streamMuxers: [yamux()], services: { identify: identify() },
      connectionManager: { maxConnections: 20, maxParallelDials: 2 },
      // The update channel's heartbeat decides when a phone is gone, and admission failures decide when the relay is:
      // a transport ping that times out during a brief stall must not tear a healthy circuit down.
      connectionMonitor: { abortConnectionOnPingFailure: false },
      connectionGater: { denyDialPeer: (peer) => peer.toString() !== options.relayPeerId,
        denyDialMultiaddr: (candidate) => candidate.toString() !== this.address,
        denyInboundRelayedConnection: (relay) => relay.toString() !== options.relayPeerId },
    });
    await options.register(this.node);
    this.node.addEventListener('connection:close', (event) => {
      const connection = event.detail;
      // How long the link lived says whether the relay, the path or this process ended it.
      if (connection.remotePeer.toString() === options.relayPeerId) warnMain('companion', 'relay connection ended', { aliveMs: Date.now() - connection.timeline.open });
      if (!this.relayUp()) { this.connected = false; if (!this.reserving) this.schedule(); }
    });
    await this.reserve();
  }

  async stop() {
    this.stopped = true; clearTimeout(this.timer); this.timer = undefined;
    this.connected = false; this.attempts = 0;
    const node = this.node; this.node = null;
    await node?.stop();
  }

  /** Opens a stream to the relay itself, for admission and push. */
  dialRelay(protocol: string, timeoutMs: number): Promise<Stream> {
    if (!this.node) return Promise.reject(new Error('Relay link is stopped.'));
    return this.node.dialProtocol(multiaddr(this.address), protocol, { signal: AbortSignal.timeout(timeoutMs) });
  }

  /** Closes every connection a device holds, circuits included. */
  closeConnectionsOf(peerId: string) {
    for (const connection of this.node?.getConnections() ?? []) if (connection.remotePeer.toString() === peerId) void connection.close();
  }

  /**
   * Feeds the relay's answer to an admission. A connection that reports itself closed is dead for certain and
   * is replaced at once; otherwise a silent relay (no close event, e.g. a NAT drop) is reconnected after a streak.
   */
  noteAdmission(ok: boolean, error?: unknown) {
    const closed = !ok && error instanceof Error && error.name === 'ConnectionClosedError';
    const silent = this.silence.record(ok);
    if (!this.node || !(closed || silent)) return;
    warnMain('companion', closed ? 'relay connection closed; reconnecting' : 'relay link silent; reconnecting', closed ? {} : { failures: silentRelayLimit });
    for (const connection of this.node.getConnections()) if (connection.remotePeer.toString() === this.relayPeerId) connection.abort(new Error('Relay link lost.'));
  }

  private relayUp() { return this.node?.getConnections().some((connection) => connection.remotePeer.toString() === this.relayPeerId) ?? false; }

  private async reserve() {
    if (!this.node || this.stopped || this.reserving) return;
    const node = this.node;
    this.reserving = true;
    try {
      // Restarting the node re-creates the relay connection and its reservation from scratch.
      if (node.status !== 'stopped') await node.stop();
      await node.start();
      if (this.stopped || this.node !== node) { await node.stop(); return; }
      this.connected = true; this.attempts = 0; await this.admit();
    } catch (error) {
      this.connected = false;
      warnMain('companion', 'relay reservation failed', { error: describeError(error), attempt: this.attempts });
      this.schedule();
    } finally {
      this.reserving = false;
      // A relay close during the awaits above was ignored while reserving; catch it now.
      if (!this.stopped && this.node === node && this.connected && !this.relayUp()) { this.connected = false; this.schedule(); }
    }
  }

  private schedule() {
    if (this.timer || this.stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5)) + Math.floor(Math.random() * 500);
    this.timer = setTimeout(() => { this.timer = undefined; void this.reserve(); }, delay);
    this.timer.unref();
  }
}
