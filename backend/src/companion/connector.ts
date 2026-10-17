import { companionPushProtocol, type CompanionNotification, type CompanionPushRegistration } from '@workspace/core/companion-notification';
import type { PushResult } from './apns';
import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { multiaddr } from '@multiformats/multiaddr';
import type { Libp2p, PrivateKey, Stream } from '@libp2p/interface';
import { readCompanionFrames, readFirstCompanionFrame, companionBackgroundGraceMs, companionProtocol, companionUpdatesProtocol, companionFrameLimit, companionResponseLimit, encodeCompanionFrame } from '@workspace/core/companion-protocol';
import { relayAddress, companionAdmissionProtocol } from '@workspace/core/companion-relay';
import { z } from 'zod';
import type { CompanionGateway } from './gateway';
import { sendWithBackpressure } from './stream-io';
import { logMain, warnMain } from '../log';

const requestSchema = z.object({ v: z.literal(1), id: z.string().uuid(), method: z.string().min(1).max(80), args: z.unknown() }).strict();
export class CompanionOutboundConnector {
  private node: Libp2p | null = null;
  private stopped = true;
  private reserving = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private relay = '';
  private admissionTimer: ReturnType<typeof setInterval> | undefined;
  private readonly active = new Map<string, Set<Stream>>();
  connected = false;
  constructor(private readonly key: PrivateKey, private readonly gateway: CompanionGateway) {}
  async start(origin: string, relayPeerId: string) {
    await this.stop();
    const address = multiaddr(relayAddress(origin, relayPeerId));
    this.stopped = false; this.relay = address.toString();
    this.node = await createLibp2p({ start: false, privateKey: this.key, addresses: { listen: [`${address}/p2p-circuit`] }, transports: [webSockets(), circuitRelayTransport({ maxReservationQueueLength: 1, maxInboundStopStreams: 8 })],
      connectionEncrypters: [noise()], streamMuxers: [yamux()], services: { identify: identify() },
      connectionManager: { maxConnections: 20, maxParallelDials: 2 },
      connectionGater: { denyDialPeer: (peer) => peer.toString() !== relayPeerId,
        denyDialMultiaddr: (candidate) => candidate.toString() !== address.toString(),
        denyInboundRelayedConnection: (relay) => relay.toString() !== relayPeerId },
    });
    await this.node.handle(companionProtocol, (stream, connection) => this.track(stream, connection.remotePeer.toString(), this.serve),
      { maxInboundStreams: 4, maxOutboundStreams: 1, runOnLimitedConnection: true });
    await this.node.handle(companionUpdatesProtocol, (stream, connection) => this.track(stream, connection.remotePeer.toString(), this.serveUpdates),
      { maxInboundStreams: 1, maxOutboundStreams: 1, runOnLimitedConnection: true });
    this.node.addEventListener('connection:close', () => {
      if (!this.node?.getConnections().some((connection) => connection.remotePeer.toString() === relayPeerId)) {
        this.connected = false; if (!this.reserving) this.schedule(address.toString());
      }
    });
    await this.reserve(address.toString());
    this.admissionTimer = setInterval(() => { void this.advertise(); }, 20_000);
    this.admissionTimer.unref();
  }
  async advertise(): Promise<boolean> {
    if (!this.node || !this.connected) return false;
    try {
      const stream = await this.node.dialProtocol(multiaddr(this.relay), companionAdmissionProtocol, { signal: AbortSignal.timeout(10_000) });
      stream.send(encodeCompanionFrame({ devices: this.gateway.grants.map((grant) => grant.peerId), invitations: this.gateway.pairingInvitations() }));
      await stream.close({ signal: AbortSignal.timeout(5000) });
      return z.object({ ok: z.literal(true) }).strict().safeParse(await readFirstCompanionFrame(stream)).success;
    } catch { /* Endpoint grants remain authoritative during relay outages. */ }
    return false;
  }
  async push(peerId: string, registration: CompanionPushRegistration, notification: CompanionNotification): Promise<PushResult> {
    if (!this.node || !this.connected || !this.gateway.grants.some(grant => grant.peerId === peerId)) return 'unavailable';
    const stream = await this.node.dialProtocol(multiaddr(this.relay), companionPushProtocol, { signal: AbortSignal.timeout(10_000) });
    try {
      if (!this.gateway.grants.some(grant => grant.peerId === peerId)) return 'unavailable';
      stream.maxReadBufferLength = 16_384; stream.inactivityTimeout = 15_000;
      stream.send(encodeCompanionFrame({ peerId, registration, notification }));
      await stream.close({ signal: AbortSignal.timeout(5000) });
      return z.object({ result: z.enum(['sent', 'invalid', 'unavailable']) }).strict().parse(await readFirstCompanionFrame(stream)).result;
    } finally { stream.abort(new Error('Push request finished.')); }
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
  private async serveUpdates(stream: Stream, peerId: string) {
    stream.maxReadBufferLength = companionFrameLimit + 4;
    stream.maxWriteBufferLength = companionResponseLimit + 4;
    stream.inactivityTimeout = companionBackgroundGraceMs + 45_000;
    let sequence = 0; let queuedBytes = 0; let queuedFrames = 0; let closed = false;
    const started = Date.now(); let requestStarted = started; let method = ''; let requestId = '';
    const diagnostic = () => ({ streamId: stream.id, elapsedMs: Date.now() - started, method, requestId,
      requestAgeMs: method ? Date.now() - requestStarted : 0, sequence, queuedBytes, queuedFrames });
    logMain('companion', 'updates opened', diagnostic());
    let pending = Promise.resolve();
    const fail = (reason: string) => { if (!closed) warnMain('companion', 'updates failed', { ...diagnostic(), reason }); closed = true; stream.abort(new Error('Companion update stream closed.')); };
    const send = (value: unknown) => {
      if (closed) return;
      let bytes: Uint8Array;
      try { bytes = encodeCompanionFrame(value, companionResponseLimit); } catch { fail('encode-failed'); return; }
      queuedBytes += bytes.byteLength; queuedFrames++;
      if (queuedBytes > companionResponseLimit * 2 || queuedFrames > 256) { fail('send-queue-limit'); return; }
      pending = pending.then(async () => {
        if (closed) return;
        await sendWithBackpressure(stream, bytes);
        queuedBytes -= bytes.byteLength; queuedFrames--;
      }).catch(() => fail('send-failed'));
    };
    let subscription: ReturnType<CompanionGateway['subscribe']> | undefined;
    let loggedClose = false;
    const cleanup = () => {
      if (!loggedClose) { logMain('companion', 'updates closed', diagnostic()); loggedClose = true; }
      closed = true; subscription?.close();
    };
    stream.addEventListener('close', cleanup, { once: true });
    try {
      subscription = this.gateway.subscribe(peerId, (update) => send({ v: 1, seq: ++sequence, update }), () => fail('subscription-failed'));
      for await (const value of readCompanionFrames(stream)) {
        const request = requestSchema.parse(value);
        method = request.method; requestId = request.id; requestStarted = Date.now();
        logMain('companion', 'updates request', diagnostic());
        try {
          const result = await subscription.request(request.method, request.args);
          send({ v: 1, id: request.id, result });
          logMain('companion', 'updates reply', diagnostic());
        } catch { warnMain('companion', 'updates operation denied', diagnostic()); send({ v: 1, id: request.id, error: 'Operation denied or unavailable.' }); }
        finally { method = ''; requestId = ''; }
      }
    } catch { fail('receive-failed'); }
    finally { logMain('companion', 'updates ended', diagnostic()); cleanup(); stream.removeEventListener('close', cleanup); stream.abort(new Error('Updates ended.')); }
  }
  private async serve(stream: Stream, peerId: string) {
    stream.maxReadBufferLength = companionFrameLimit + 4;
    stream.maxWriteBufferLength = companionResponseLimit + 4;
    stream.inactivityTimeout = 30_000;
    try {
      const request = requestSchema.parse(await readFirstCompanionFrame(stream));
      let response;
      try {
        const result = await this.gateway.request(peerId, request.method, request.args);
        if (request.method === 'pair.claim') await this.advertise();
        response = encodeCompanionFrame({ v: 1, id: request.id, result }, companionResponseLimit);
      }
      catch { response = encodeCompanionFrame({ v: 1, id: request.id, error: 'Operation denied or unavailable.' }); }
      if (stream.status !== 'open') return;
      await sendWithBackpressure(stream, response);
      await stream.close({ signal: AbortSignal.timeout(5000) });
    } catch { stream.abort(new Error('Invalid companion request.')); }
  }
  /** Revocation and shutdown abort every stream a device holds. */
  private track(stream: Stream, peerId: string, serve: (this: CompanionOutboundConnector, stream: Stream, peerId: string) => Promise<void>) {
    const streams = this.active.get(peerId) ?? new Set<Stream>();
    streams.add(stream); this.active.set(peerId, streams);
    void serve.call(this, stream, peerId).finally(() => { streams.delete(stream); if (!streams.size) this.active.delete(peerId); });
  }
}
