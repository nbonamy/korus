import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { multiaddr } from '@multiformats/multiaddr';
import type { Libp2p, PrivateKey, Stream } from '@libp2p/interface';
import { CompanionFrameDecoder, companionProtocol, encodeCompanionFrame } from '@workspace/core/companion-protocol';
import { relayAddress, companionAdmissionProtocol } from '@workspace/core/companion-relay';
import { z } from 'zod';
import type { CompanionGateway } from './gateway';

const requestSchema = z.object({ v: z.literal(1), id: z.string().uuid(), method: z.string().min(1).max(80), args: z.unknown() }).strict();
export class CompanionOutboundConnector {
  private node: Libp2p | null = null;
  private stopped = true;
  private reserving = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private relay = '';
  private pairUntil = 0;
  private admissionTimer: ReturnType<typeof setInterval> | undefined;
  private readonly active = new Map<string, Set<Stream>>();
  connected = false;
  constructor(private readonly key: PrivateKey, private readonly gateway: CompanionGateway) {}
  async start(origin: string, relayPeerId: string, allowLoopbackDevelopment = false) {
    await this.stop();
    const address = multiaddr(relayAddress(origin, relayPeerId, allowLoopbackDevelopment));
    this.stopped = false; this.relay = address.toString();
    this.node = await createLibp2p({ start: false, privateKey: this.key, addresses: { listen: [`${address}/p2p-circuit`] }, transports: [webSockets(), circuitRelayTransport({ maxReservationQueueLength: 1, maxInboundStopStreams: 8 })],
      connectionEncrypters: [noise()], streamMuxers: [yamux()], services: { identify: identify() },
      connectionManager: { maxConnections: 20, maxParallelDials: 2 },
      connectionGater: { denyDialPeer: (peer) => peer.toString() !== relayPeerId,
        denyDialMultiaddr: (candidate) => candidate.toString() !== address.toString(),
        denyInboundRelayedConnection: (relay) => relay.toString() !== relayPeerId },
    });
    await this.node.handle(companionProtocol, (stream, connection) => {
      const peerId = connection.remotePeer.toString();
      const streams = this.active.get(peerId) ?? new Set<Stream>();
      streams.add(stream); this.active.set(peerId, streams);
      void this.serve(stream, peerId).finally(() => { streams.delete(stream); if (!streams.size) this.active.delete(peerId); });
    }, { maxInboundStreams: 4, maxOutboundStreams: 1, runOnLimitedConnection: true });
    this.node.addEventListener('connection:close', () => {
      if (!this.node?.getConnections().some((connection) => connection.remotePeer.toString() === relayPeerId)) {
        this.connected = false; if (!this.reserving) this.schedule(address.toString());
      }
    });
    await this.reserve(address.toString());
    this.admissionTimer = setInterval(() => { void this.advertise(); }, 20_000);
    this.admissionTimer.unref();
  }
  async advertise(pairUntil = this.pairUntil) {
    this.pairUntil = pairUntil;
    if (!this.node || !this.connected) return;
    try {
      const stream = await this.node.dialProtocol(multiaddr(this.relay), companionAdmissionProtocol, { signal: AbortSignal.timeout(10_000) });
      stream.send(encodeCompanionFrame({ devices: this.gateway.grants.map((grant) => grant.peerId), pairUntil: Math.max(0, this.pairUntil) }));
      await stream.close({ signal: AbortSignal.timeout(5000) });
      for await (const _chunk of stream) { /* Relay confirms admission without carrying app data. */ }
    } catch { /* Endpoint grants remain authoritative during relay outages. */ }
  }
  revoke(peerId: string) {
    for (const stream of this.active.get(peerId) ?? []) stream.abort(new Error('Device revoked.'));
    for (const connection of this.node?.getConnections() ?? []) if (connection.remotePeer.toString() === peerId) void connection.close();
  }
  async stop() {
    this.stopped = true; clearTimeout(this.timer); this.timer = undefined;
    this.connected = false; this.attempts = 0;
    clearInterval(this.admissionTimer); this.admissionTimer = undefined;
    const node = this.node; this.node = null;
    for (const streams of this.active.values()) for (const stream of streams) stream.abort(new Error('Companion disabled.'));
    this.active.clear(); await node?.stop();
  }
  private async reserve(address: string) {
    if (!this.node || this.stopped || this.reserving) return;
    const node = this.node;
    this.reserving = true;
    try {
      if (node.status !== 'stopped') await node.stop();
      await node.start();
      if (this.stopped || this.node !== node) { await node.stop(); return; }
      this.connected = true; this.attempts = 0; await this.advertise();
    } catch { this.connected = false; this.schedule(address); }
    finally { this.reserving = false; }
  }
  private schedule(address: string) {
    if (this.timer || this.stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5)) + Math.floor(Math.random() * 500);
    this.timer = setTimeout(() => { this.timer = undefined; void this.reserve(address); }, delay);
    this.timer.unref();
  }
  private async serve(stream: Stream, peerId: string) {
    stream.maxReadBufferLength = 4 * 1024 * 1024 + 4;
    stream.maxWriteBufferLength = 4 * 1024 * 1024 + 4;
    stream.inactivityTimeout = 30_000;
    const decoder = new CompanionFrameDecoder();
    try {
      for await (const chunk of stream) {
        const frames = decoder.push(chunk instanceof Uint8Array ? chunk : chunk.subarray());
        if (!frames.length) continue;
        if (frames.length !== 1) throw new Error('One request per stream.');
        const request = requestSchema.parse(frames[0]);
        let response;
        try { response = { v: 1, id: request.id, result: await this.gateway.request(peerId, request.method, request.args) }; }
        catch { response = { v: 1, id: request.id, error: 'Operation denied or unavailable.' }; }
        if (stream.status !== 'open') return;
        if (!stream.send(encodeCompanionFrame(response))) {
          await new Promise<void>((resolve, reject) => {
            const close = () => { cleanup(); reject(new Error('Closed.')); };
            const drain = () => { cleanup(); resolve(); };
            const cleanup = () => { stream.removeEventListener('close', close); stream.removeEventListener('drain', drain); };
            stream.addEventListener('close', close, { once: true }); stream.addEventListener('drain', drain, { once: true });
          });
        }
        await stream.close({ signal: AbortSignal.timeout(5000) });
        return;
      }
    } catch { stream.abort(new Error('Invalid companion request.')); }
  }
}
