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
  constructor(private readonly hosts: Set<string>, private readonly now = Date.now) {
    if (!hosts.size || hosts.size > 100) throw new Error('Configure between 1 and 100 admitted laptop identities.');
  }
  reserve(host: string) { return this.hosts.has(host); }
  register(host: string, devices: string[], pairUntil: number, channels: string[] = []) {
    if (!this.hosts.has(host) || devices.length > 20 || devices.some((id) => !/^[a-zA-Z0-9]{32,128}$/.test(id)) || !Number.isFinite(pairUntil) || pairUntil > this.now() + 300_000
      || channels.length > 5 || channels.some((channel) => !/^[A-Z2-9]{4}$/.test(channel))) throw new Error('Invalid relay admission.');
    this.routes.set(host, new Set(devices));
    this.windows.set(host, Math.max(this.now(), pairUntil));
    for (const [channel, owner] of this.channels) if (owner.host === host || owner.expiresAt <= this.now()) this.channels.delete(channel);
    // The first laptop to hold a live channel keeps it; a collision simply fails safe at the end-to-end proof.
    for (const channel of channels) if (!this.channels.has(channel)) this.channels.set(channel, { host, expiresAt: Math.max(this.now(), pairUntil) });
  }
  /** A phone finds the laptop advertising a channel. This reveals only a public identity; pairing is proven end to end. */
  resolve(source: string, channel: string) {
    for (const [id, lookup] of this.lookups) if (lookup.expiresAt <= this.now()) this.lookups.delete(id);
    if (this.lookups.size >= 200 && !this.lookups.has(source)) return null;
    const lookup = this.lookups.get(source) ?? { count: 0, expiresAt: this.now() + 300_000 };
    this.lookups.set(source, lookup);
    if (++lookup.count > 10) return null;
    const owner = this.channels.get(channel);
    return owner && owner.expiresAt > this.now() ? owner.host : null;
  }
  route(source: string, destination: string) {
    if (!this.hosts.has(destination)) return false;
    if (this.routes.get(destination)?.has(source)) return true;
    if ((this.windows.get(destination) ?? 0) <= this.now()) return false;
    for (const [id, attempt] of this.attempts) if (attempt.expiresAt <= this.now()) this.attempts.delete(id);
    if (this.attempts.size >= 200) return false;
    const attempt = this.attempts.get(source) ?? { count: 0, expiresAt: this.now() + 300_000 };
    this.attempts.set(source, attempt);
    return ++attempt.count <= 3;
  }
}
export async function createCompanionRelay(options: { key: PrivateKey; listen: string; hostIds: string[]; tls?: { cert: string; key: string } }) {
  const policy = new CompanionRelayPolicy(new Set(options.hostIds));
  let admissions = { until: 0, count: 0 };
  const relay = await createLibp2p({ privateKey: options.key, addresses: { listen: [options.listen] },
    transports: [webSockets({ https: options.tls, maxBufferedAmount: 1024 * 1024 })], connectionEncrypters: [noise()], streamMuxers: [yamux()],
    connectionManager: { maxConnections: 50, maxParallelDials: 2, inboundConnectionThreshold: 10 },
    connectionGater: {
      denyInboundConnection: () => { const now = Date.now(); if (admissions.until <= now) admissions = { until: now + 60_000, count: 0 }; return ++admissions.count > 100; },
      denyInboundRelayReservation: (source) => !policy.reserve(source.toString()),
      denyOutboundRelayedConnection: (source, destination) => !policy.route(source.toString(), destination.toString()),
    },
    services: { identify: identify(), relay: circuitRelayServer({ hopTimeout: 10_000, maxInboundHopStreams: 10, maxOutboundHopStreams: 10, maxOutboundStopStreams: 20,
      reservations: { maxReservations: 100, reservationTtl: 3600_000, reservationClearInterval: 60_000,
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
