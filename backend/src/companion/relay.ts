import { companionPushProtocol } from '@workspace/core/companion-notification';
import { CompanionPushRelay } from './push-relay';
import type { ApnsSender } from './apns';
import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import type { PrivateKey, Stream } from '@libp2p/interface';
import { CompanionFrameDecoder, encodeCompanionFrame } from '@workspace/core/companion-protocol';
import { companionAdmissionProtocol, companionRendezvousProtocol } from '@workspace/core/companion-relay';
import { z } from 'zod';

/** Relay policy sees authenticated peer identities, never the encrypted companion payload. */
export class CompanionRelayPolicy {
  private readonly windows = new Map<string, number>();
  private readonly routes = new Map<string, Set<string>>();
  private readonly attempts = new Map<string, { expiresAt: number; count: number }>();
  private readonly channels = new Map<string, { host: string; expiresAt: number }>();
  private readonly lookups = new Map<string, { expiresAt: number; count: number }>();
  private readonly leases = new Map<string, number>();
  constructor(private readonly hosts?: Set<string>, private readonly now = Date.now) {
    if (hosts && (!hosts.size || hosts.size > 100)) throw new Error('Configure between 1 and 100 admitted laptop identities.');
  }
  private prune() {
    for (const [host, until] of this.leases) if (until <= this.now()) {
      this.leases.delete(host); this.routes.delete(host); this.windows.delete(host);
      for (const [channel, owner] of this.channels) if (owner.host === host) this.channels.delete(channel);
    }
  }
  private admitted(host: string) { this.prune(); return this.hosts ? this.hosts.has(host) : this.leases.has(host); }
  reserve(host: string) {
    if (this.hosts) return this.hosts.has(host);
    this.prune();
    if (!this.leases.has(host) && this.leases.size >= 1000) return false;
    this.leases.set(host, this.now() + 120_000);
    return true;
  }
  register(host: string, devices: string[], pairUntil: number, channels: string[] = []) {
    if (!this.reserve(host) || devices.length > 20 || devices.some((id) => !/^[a-zA-Z0-9]{32,128}$/.test(id)) || !Number.isFinite(pairUntil) || pairUntil > this.now() + 300_000
      || channels.length > 5 || channels.some((channel) => !/^[A-Z2-9]{4}$/.test(channel))) throw new Error('Invalid relay admission.');
    this.routes.set(host, new Set(devices));
    this.windows.set(host, Math.max(this.now(), pairUntil));
    for (const [channel, owner] of this.channels) if (owner.host === host || owner.expiresAt <= this.now()) this.channels.delete(channel);
    // The first laptop to hold a live channel keeps it; a collision simply fails safe at the end-to-end proof.
    for (const channel of channels) if (!this.channels.has(channel)) this.channels.set(channel, { host, expiresAt: Math.max(this.now(), pairUntil) });
  }
  /** A phone finds the laptop advertising a channel. This reveals only a public identity; pairing is proven end to end. */
  resolve(source: string, channel: string) {
    this.prune();
    for (const [id, lookup] of this.lookups) if (lookup.expiresAt <= this.now()) this.lookups.delete(id);
    if (this.lookups.size >= 200 && !this.lookups.has(source)) return null;
    const lookup = this.lookups.get(source) ?? { count: 0, expiresAt: this.now() + 300_000 };
    this.lookups.set(source, lookup);
    if (++lookup.count > 10) return null;
    const owner = this.channels.get(channel);
    return owner && owner.expiresAt > this.now() ? owner.host : null;
  }
  paired(host: string, device: string) { return this.admitted(host) && this.routes.get(host)?.has(device) === true; }
  route(source: string, destination: string) {
    if (!this.admitted(destination)) return false;
    if (this.routes.get(destination)?.has(source)) return true;
    if ((this.windows.get(destination) ?? 0) <= this.now()) return false;
    for (const [id, attempt] of this.attempts) if (attempt.expiresAt <= this.now()) this.attempts.delete(id);
    if (this.attempts.size >= 200) return false;
    const attempt = this.attempts.get(source) ?? { count: 0, expiresAt: this.now() + 300_000 };
    this.attempts.set(source, attempt);
    return ++attempt.count <= 3;
  }
}
export async function createCompanionRelay(options: { key: PrivateKey; listen: string; hostIds?: string[]; tls?: { cert: string; key: string }; push?: Pick<ApnsSender, 'send'> }) {
  const policy = new CompanionRelayPolicy(options.hostIds ? new Set(options.hostIds) : undefined);
  let admissions = { until: 0, count: 0 };
  const relay = await createLibp2p({ privateKey: options.key, addresses: { listen: [options.listen] },
    transports: [webSockets({ https: options.tls, maxBufferedAmount: 1024 * 1024 })], connectionEncrypters: [noise()], streamMuxers: [yamux()],
    connectionManager: { maxConnections: 1000, maxParallelDials: 2, inboundConnectionThreshold: 200 },
    connectionGater: {
      denyInboundConnection: () => { const now = Date.now(); if (admissions.until <= now) admissions = { until: now + 60_000, count: 0 }; return ++admissions.count > 600; },
      denyInboundRelayReservation: (source) => !policy.reserve(source.toString()),
      denyOutboundRelayedConnection: (source, destination) => !policy.route(source.toString(), destination.toString()),
    },
    services: { identify: identify(), relay: circuitRelayServer({ hopTimeout: 10_000, maxInboundHopStreams: 10, maxOutboundHopStreams: 10, maxOutboundStopStreams: 20,
      reservations: { maxReservations: 1000, reservationTtl: 3600_000, reservationClearInterval: 60_000,
        applyDefaultLimit: true, defaultDurationLimit: 600_000, defaultDataLimit: 64n * 1024n * 1024n } }) },
  });
  const request = z.object({ devices: z.array(z.string().min(32).max(128)).max(20), pairUntil: z.number().finite(), channels: z.array(z.string().length(4)).max(5).default([]) }).strict();
  await relay.handle(companionAdmissionProtocol, async (stream, connection) => {
    try {
      if (!policy.reserve(connection.remotePeer.toString())) throw new Error('Denied.');
      const payload = request.parse(await readOne(stream));
      policy.register(connection.remotePeer.toString(), payload.devices, payload.pairUntil, payload.channels);
      stream.send(encodeCompanionFrame({ ok: true }));
      await stream.close({ signal: AbortSignal.timeout(5000) });
    } catch { stream.abort(new Error('Relay admission denied.')); }
  }, { maxInboundStreams: 1, maxOutboundStreams: 1 });
  const lookup = z.object({ channel: z.string().length(4) }).strict();
  await relay.handle(companionRendezvousProtocol, async (stream, connection) => {
    try {
      const { channel } = lookup.parse(await readOne(stream));
      const host = policy.resolve(connection.remotePeer.toString(), channel);
      if (!host) throw new Error('Unknown channel.');
      stream.send(encodeCompanionFrame({ hostId: host }));
      await stream.close({ signal: AbortSignal.timeout(5000) });
    } catch { stream.abort(new Error('Rendezvous denied.')); }
  }, { maxInboundStreams: 2, maxOutboundStreams: 1 });
  const push = new CompanionPushRelay(relay.peerId.toString(), (host, device) => policy.paired(host, device), options.push);
  await relay.handle(companionPushProtocol, async (stream, connection) => {
    try {
      if (!policy.reserve(connection.remotePeer.toString())) throw new Error('Denied.');
      const result = await push.send(connection.remotePeer.toString(), await readOne(stream));
      stream.send(encodeCompanionFrame({ result }));
      await stream.close({ signal: AbortSignal.timeout(5000) });
    } catch { stream.abort(new Error('Push unavailable.')); }
  }, { maxInboundStreams: 4, maxOutboundStreams: 1 });
  return relay;
}
async function readOne(stream: Stream): Promise<unknown> {
  stream.maxReadBufferLength = 16_384; stream.maxWriteBufferLength = 16_384; stream.inactivityTimeout = 10_000;
  const decoder = new CompanionFrameDecoder();
  for await (const chunk of stream) {
    const frames = decoder.push(chunk instanceof Uint8Array ? chunk : chunk.subarray());
    if (frames.length) { if (frames.length !== 1) throw new Error('One admission per stream.'); return frames[0]; }
  }
  throw new Error('Admission closed.');
}
