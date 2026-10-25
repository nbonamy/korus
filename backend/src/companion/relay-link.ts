import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { multiaddr } from '@multiformats/multiaddr';
import type { Connection, Libp2p, PrivateKey, Stream } from '@libp2p/interface';
import { relayAddress } from '@workspace/core/companion-relay';
import { warnMain } from '../log';
import { describeError } from './describe-error';
import { FailureStreak } from './failure-streak';

/** Consecutive refused or unanswered admissions (20 s apart) before the relay link is presumed dead. */
const silentRelayLimit = 3;
/** How often the relay connection proves it is alive, and how long it has to answer. A dead link costs a few seconds, not a minute. */
const probeIntervalMs = 2_000;
const probeTimeoutMs = 2_000;
const probeFailureLimit = 2;
/** One attempt to (re)establish the link; a slow relay is retried, not waited for. */
const reserveTimeoutMs = 10_000;
const stopTimeoutMs = 3_000;
const retryBaseMs = 500;
const retryCapMs = 5_000;

type Start = {
  key: PrivateKey; origin: string; relayPeerId: string;
  /** Installs the protocol handlers once, on the freshly created node. */
  register(node: Libp2p): Promise<void>;
  /** Tells the relay which devices to route; run after every successful (re)connection. */
  admit(): Promise<boolean>;
};

/** The muxer is what carries every stream; libp2p does not expose its liveness on `Connection`. */
type Muxed = Connection & { muxer?: { status?: string; ping?(options?: { signal?: AbortSignal }): Promise<unknown> } };

const timeout = (ms: number) => new Promise<never>((_, reject) => { setTimeout(() => reject(new Error(`Timed out after ${ms} ms.`)), ms).unref(); });

/**
 * The laptop's one outbound link: a libp2p node holding a reservation on the pinned relay, rebuilt from scratch
 * the moment the relay connection is gone or stops answering. Phones reach the laptop only through circuits on this link.
 */
export class RelayLink {
  /** True once the relay has accepted the reservation and the connection is still open. */
  connected = false;
  private node: Libp2p | null = null;
  private options: Start | null = null;
  private stopped = true;
  private reserving = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private probe: ReturnType<typeof setInterval> | undefined;
  private probing = false;
  private attempts = 0;
  private address = '';
  private relayPeerId = '';
  private readonly silence = new FailureStreak(silentRelayLimit);
  private readonly unanswered = new FailureStreak(probeFailureLimit);

  async start(options: Start) {
    await this.stop();
    this.options = options;
    this.stopped = false; this.address = multiaddr(relayAddress(options.origin, options.relayPeerId)).toString(); this.relayPeerId = options.relayPeerId;
    await this.reserve();
  }

  async stop() {
    this.stopped = true; clearTimeout(this.timer); this.timer = undefined; clearInterval(this.probe); this.probe = undefined;
    this.connected = false; this.attempts = 0;
    const node = this.node; this.node = null;
    await this.release(node);
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
    this.drop(closed ? 'relay connection closed' : 'relay link silent', closed ? {} : { failures: silentRelayLimit });
  }

  /** Throws the link away and builds a new one now, whatever state the old connection claims to be in. */
  private drop(reason: string, details: Record<string, unknown> = {}) {
    if (this.stopped || this.reserving) return;
    warnMain('companion', `${reason}; reconnecting`, details);
    this.connected = false;
    this.attempts = 0;
    clearTimeout(this.timer); this.timer = undefined;
    this.schedule(0);
  }

  private relayConnections(): Muxed[] { return (this.node?.getConnections() ?? []).filter((connection) => connection.remotePeer.toString() === this.relayPeerId); }

  /** Every couple of seconds, ask the relay's muxer for an answer. A closed muxer is dead on the spot; a silent one after two misses. */
  private startProbe(node: Libp2p) {
    clearInterval(this.probe);
    this.probe = setInterval(() => { void this.check(node); }, probeIntervalMs);
    this.probe.unref();
  }

  private async check(node: Libp2p) {
    if (this.probing || this.stopped || this.reserving || this.node !== node || !this.connected) return;
    this.probing = true;
    try {
      const open = this.relayConnections().filter((connection) => connection.status === 'open' && connection.muxer?.status !== 'closed' && connection.muxer?.status !== 'closing');
      if (!open.length) { this.drop('relay connection lost'); return; }
      const ping = open[0]!.muxer?.ping;
      // A muxer that cannot be pinged is judged by admissions alone.
      if (!ping) return;
      try { await ping.call(open[0]!.muxer, { signal: AbortSignal.timeout(probeTimeoutMs) }); this.unanswered.record(true); }
      catch { if (this.unanswered.record(false)) this.drop('relay link unresponsive', { probeMs: probeTimeoutMs }); }
    } finally { this.probing = false; }
  }

  private async create(options: Start): Promise<Libp2p> {
    const node = await createLibp2p({ start: false, privateKey: options.key, addresses: { listen: [`${this.address}/p2p-circuit`] },
      transports: [webSockets(), circuitRelayTransport({ maxReservationQueueLength: 1, maxInboundStopStreams: 8 })],
      connectionEncrypters: [noise()], streamMuxers: [yamux()], services: { identify: identify() },
      connectionManager: { maxConnections: 20, maxParallelDials: 2 },
      // The update channel's heartbeat decides when a phone is gone, and the relay probe when the relay is:
      // a transport ping that times out during a brief stall must not tear a healthy circuit down.
      connectionMonitor: { abortConnectionOnPingFailure: false },
      connectionGater: { denyDialPeer: (peer) => peer.toString() !== options.relayPeerId,
        denyDialMultiaddr: (candidate) => candidate.toString() !== this.address,
        denyInboundRelayedConnection: (relay) => relay.toString() !== options.relayPeerId },
    });
    await options.register(node);
    node.addEventListener('connection:close', (event) => {
      const connection = event.detail;
      if (this.node !== node || connection.remotePeer.toString() !== options.relayPeerId) return;
      // How long the link lived says whether the relay, the path or this process ended it.
      warnMain('companion', 'relay connection ended', { aliveMs: Date.now() - connection.timeline.open });
      if (!this.relayConnections().length) this.drop('relay connection lost');
    });
    return node;
  }

  /** Stops a node without letting a stuck connection hold the caller. */
  private async release(node: Libp2p | null) {
    if (!node || node.status === 'stopped') return;
    await Promise.race([Promise.resolve(node.stop()).catch(() => {}), new Promise<void>((resolve) => { setTimeout(resolve, stopTimeoutMs).unref(); })]);
  }

  /** Each attempt is a new node with a bounded time to come up; the last one is discarded in the background. */
  private async reserve() {
    const options = this.options;
    if (!options || this.stopped || this.reserving) return;
    this.reserving = true;
    clearInterval(this.probe); this.probe = undefined;
    const previous = this.node; this.node = null;
    void this.release(previous);
    const began = Date.now();
    let node: Libp2p | null = null;
    try {
      node = await this.create(options);
      this.node = node;
      await Promise.race([node.start(), timeout(reserveTimeoutMs)]);
      if (this.stopped || this.node !== node) { void this.release(node); return; }
      this.connected = true; this.attempts = 0; this.silence.record(true); this.unanswered.record(true);
      this.startProbe(node);
      await this.admit(options);
    } catch (error) {
      this.connected = false;
      warnMain('companion', 'relay reservation failed', { error: describeError(error), attempt: this.attempts, ms: Date.now() - began });
      if (node && this.node === node) this.node = null;
      void this.release(node);
      this.schedule();
    } finally {
      this.reserving = false;
      // A relay close during the awaits above was ignored while reserving; catch it now.
      if (!this.stopped && node && this.node === node && this.connected && !this.relayConnections().length) this.drop('relay connection lost');
    }
  }

  private async admit(options: Start) {
    try { await options.admit(); } catch (error) { warnMain('companion', 'relay admission failed', { error: describeError(error) }); }
  }

  private schedule(delay = Math.min(retryCapMs, retryBaseMs * 2 ** Math.min(this.attempts++, 4)) + Math.floor(Math.random() * 250)) {
    if (this.timer || this.stopped) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.reserve(); }, delay);
    this.timer.unref();
  }
}
