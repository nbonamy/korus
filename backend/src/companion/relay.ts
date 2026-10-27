import { guestOwnerLimit } from '@workspace/core/guest-conversation';
import { ShareRelayDirectory } from '../sharing/relay-directory';
import { shareAdmissionProtocol, shareAdmissionFrameLimit, shareRendezvousProtocol, shareLookupFrameLimit, shareDirectoryCapacity, shareHandlePattern } from '@workspace/core/conversation-share-relay';
import { RelayIngress } from './relay-ingress';
import { WindowBudget } from './source-budget';
import { companionPushProtocol } from '@workspace/core/companion-notification';
import { CompanionPushRelay } from './push-relay';
import { RelayConnections } from './relay-connections';
import type { ApnsSender } from './apns';
import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import type { PrivateKey, Stream } from '@libp2p/interface';
import { encodeCompanionFrame, readFirstCompanionFrame } from '@workspace/core/companion-protocol';
import { companionAdmissionLeaseMs, companionAdmissionProtocol, companionMaxDevices, companionMaxInvitations, companionPeerIdPattern, companionRendezvousProtocol } from '@workspace/core/companion-relay';
import { z } from 'zod';
import { normalizePairingCode, pairingLifetimeMs, type PairingInvitation } from '@workspace/core/companion-pairing';
import type { ConfiguredPairing } from './configured-pairing';

/** Relay policy sees authenticated peer identities, never the encrypted companion payload. */
export class CompanionRelayPolicy {
  private readonly routes = new Map<string, Set<string>>();
  private readonly invitations = new Map<string, PairingInvitation & { host: string; claimant?: string; withdrawn: boolean }>();
  private readonly leases = new Map<string, { until: number; source: string }>();
  private readonly lookups: WindowBudget;
  readonly shares: ShareRelayDirectory;
  private readonly configuredClaims = new Map<string, number>();
  constructor(private readonly hosts?: Set<string>, private readonly now = Date.now, private readonly pairing?: ConfiguredPairing) {
    this.shares = new ShareRelayDirectory(now);
    this.lookups = new WindowBudget(10, pairingLifetimeMs, 200, now);
    if (hosts && (!hosts.size || hosts.size > 100)) throw new Error('Configure between 1 and 100 admitted laptop identities.');
  }
  private prune() {
    for (const [host, lease] of this.leases) if (lease.until <= this.now()) {
      this.leases.delete(host); this.routes.delete(host);
      if (host === this.pairing?.hostId) this.configuredClaims.clear();
      for (const owner of this.invitations.values()) if (owner.host === host) owner.withdrawn = true;
    }
    for (const [peer, until] of this.configuredClaims) if (until <= this.now()) this.configuredClaims.delete(peer);
  }
  admitted(host: string) { this.prune(); return this.hosts ? this.hosts.has(host) : this.leases.has(host); }
  reserve(host: string, source = host) {
    if (this.hosts) return this.hosts.has(host);
    this.prune();
    const previous = this.leases.get(host);
    if (previous?.source !== source && [...this.leases.values()].filter(lease => lease.source === source).length >= 20) return false;
    if (!previous && this.leases.size >= 1000) return false;
    this.leases.set(host, { until: this.now() + companionAdmissionLeaseMs, source });
    return true;
  }
  register(host: string, devices: string[], invitations: PairingInvitation[] = [], source = host) {
    this.prune();
    for (const [code, owner] of this.invitations) if (owner.expiresAt <= this.now()) this.invitations.delete(code);
    if (!this.reserve(host, source) || devices.length > companionMaxDevices || devices.some(id => !companionPeerIdPattern.test(id))
      || invitations.length > 5 || invitations.some(invite => normalizePairingCode(invite.code) !== invite.code
        || !Number.isSafeInteger(invite.expiresAt) || invite.expiresAt > this.now() + pairingLifetimeMs)) throw new Error('Invalid relay admission.');
    const fresh = invitations.filter(invite => invite.expiresAt > this.now());
    if (fresh.some(invite => invite.code === this.pairing?.code)) throw new Error('Pairing code is reserved by relay configuration.');
    if (fresh.some(invite => this.invitations.has(invite.code) && this.invitations.get(invite.code)!.host !== host)) throw new Error('Pairing code already registered.');
    const additions = fresh.filter(invite => !this.invitations.has(invite.code)).length;
    if (this.invitations.size + additions > 5000
      || [...this.invitations.values()].filter(invite => invite.host === host).length + additions > 50) throw new Error('Too many invitations.');
    this.routes.set(host, new Set(devices));
    // Keep tombstones until expiry: withdrawal or a heartbeat must never rearm a consumed code.
    for (const owner of this.invitations.values()) if (owner.host === host && !fresh.some(invite => invite.code === owner.code)) owner.withdrawn = true;
    for (const invite of fresh) {
      const existing = this.invitations.get(invite.code);
      if (existing) existing.expiresAt = Math.min(existing.expiresAt, invite.expiresAt);
      else this.invitations.set(invite.code, { ...invite, host, withdrawn: false });
    }
  }
  /** Claim atomically for the Noise-authenticated phone. Retrying that phone recovers a lost reply. */
  resolve(source: string, code: string) {
    this.prune();
    if (!this.lookups.take(source)) return null;
    if (this.pairing && code === this.pairing.code) {
      if (!this.admitted(this.pairing.hostId)) return null;
      this.configuredClaims.delete(source);
      // Lookup permissions are temporary; evicting the oldest never grants access to another host.
      if (this.configuredClaims.size >= 200) this.configuredClaims.delete(this.configuredClaims.keys().next().value!);
      this.configuredClaims.set(source, this.now() + pairingLifetimeMs);
      return this.pairing.hostId;
    }
    const owner = this.invitations.get(code);
    if (!owner || owner.withdrawn || owner.expiresAt <= this.now() || !this.admitted(owner.host)
      || (owner.claimant && owner.claimant !== source)) return null;
    owner.claimant = source;
    return owner.host;
  }
  paired(host: string, device: string) { return this.admitted(host) && this.routes.get(host)?.has(device) === true; }
  route(source: string, destination: string) {
    if (!this.admitted(destination)) return false;
    if (this.routes.get(destination)?.has(source)) return true;
    if (this.shares.route(source, destination)) return true;
    if (destination === this.pairing?.hostId && (this.configuredClaims.get(source) ?? 0) > this.now()) return true;
    return [...this.invitations.values()].some(invite => invite.host === destination && invite.claimant === source
      && !invite.withdrawn && invite.expiresAt > this.now());
  }
}
export async function createCompanionRelay(options: { key: PrivateKey; listen: string; now?: () => number; trustedProxy?: boolean; hostIds?: string[]; pairing?: ConfiguredPairing; tls?: { cert: string; key: string }; push?: Pick<ApnsSender, 'send'>; log?: (message: string, details: Record<string, unknown>) => void }) {
  const ingress = new RelayIngress(options.trustedProxy);
  const policy = new CompanionRelayPolicy(options.hostIds ? new Set(options.hostIds) : undefined, options.now ?? Date.now, options.pairing);
  const relay = await createLibp2p({ privateKey: options.key, addresses: { listen: [options.listen] },
    transports: [webSockets({ http: { IncomingMessage: ingress.IncomingMessage }, https: options.tls ? { ...options.tls, IncomingMessage: ingress.IncomingMessage } : undefined, maxBufferedAmount: 1024 * 1024 })], connectionEncrypters: [noise()], streamMuxers: [yamux()],
    // The transport socket address is nginx’s loopback address. RelayIngress owns real-source rate limits.
    connectionManager: { maxConnections: 1000, maxParallelDials: 2, maxIncomingPendingConnections: 200, inboundConnectionThreshold: Number.MAX_SAFE_INTEGER },
    // RelayConnections owns liveness: libp2p's monitor cuts a laptop link, and every phone circuit on it, after one slow ping.
    connectionMonitor: { enabled: false },
    connectionGater: {
      denyInboundConnection: connection => {
        if (ingress.admit(connection.remoteAddr)) return false;
        connection.abort(new Error('Relay source limit exceeded.'));
        return true;
      },
      denyInboundRelayReservation: (peer): boolean => {
        const connection = relay.getConnections(peer)[0];
        const source = connection && ingress.source(connection.remoteAddr);
        return !source || !policy.reserve(peer.toString(), source);
      },
      denyOutboundRelayedConnection: (source, destination) => !policy.route(source.toString(), destination.toString()),
    },
    services: { identify: identify(), relay: circuitRelayServer({ hopTimeout: 10_000, maxInboundHopStreams: 10, maxOutboundHopStreams: 10, maxOutboundStopStreams: guestOwnerLimit + 8,
      reservations: { maxReservations: 1000, reservationTtl: 120_000, reservationClearInterval: 60_000,
        // Every phone circuit is cut after this duration or volume; the phone redials, so these bound relay cost per circuit.
        applyDefaultLimit: true, defaultDurationLimit: 600_000, defaultDataLimit: 64n * 1024n * 1024n } }) },
  });
  const connections = new RelayConnections(relay, (peer) => policy.admitted(peer) ? 'laptop' : 'device', options.log ?? (() => {}));
  connections.start();
  relay.addEventListener('stop', () => { connections.stop(); });
  const request = z.object({ devices: z.array(z.string().min(32).max(128)).max(companionMaxDevices), invitations: z.array(z.object({ code: z.string().length(8), expiresAt: z.number().int() }).strict()).max(companionMaxInvitations) }).strict();
  await relay.handle(companionAdmissionProtocol, async (stream, connection) => {
    try {
      const source = ingress.source(connection.remoteAddr);
      if (!source || !policy.reserve(connection.remotePeer.toString(), source)) throw new Error('Denied.');
      const payload = request.parse(await readOne(stream));
      policy.register(connection.remotePeer.toString(), payload.devices, payload.invitations, source);
      stream.send(encodeCompanionFrame({ ok: true }));
      await stream.close({ signal: AbortSignal.timeout(5000) });
    } catch { stream.abort(new Error('Relay admission denied.')); }
  }, { maxInboundStreams: 1, maxOutboundStreams: 1 });
  const lookup = z.object({ code: z.string().length(8) }).strict();
  await relay.handle(companionRendezvousProtocol, async (stream, connection) => {
    try {
      const { code } = lookup.parse(await readOne(stream));
      const host = policy.resolve(connection.remotePeer.toString(), code);
      if (!host) throw new Error('Unknown invitation.');
      stream.send(encodeCompanionFrame({ hostId: host }));
      await stream.close({ signal: AbortSignal.timeout(5000) });
    } catch { stream.abort(new Error('Rendezvous denied.')); }
  }, { maxInboundStreams: 2, maxOutboundStreams: 1 });
  const shareAdmission = z.object({ v: z.literal(2), handles: z.array(z.string().regex(shareHandlePattern)).max(shareDirectoryCapacity) }).strict();
  const shareLookup = z.object({ v: z.literal(2), handle: z.string().regex(shareHandlePattern) }).strict();
  for (const registration of [true, false]) await relay.handle(registration ? shareAdmissionProtocol : shareRendezvousProtocol, async (stream, connection) => {
    try {
      const source = ingress.source(connection.remoteAddr);
      if (!source) throw new Error('Denied.');
      const payload = await readOne(stream, registration ? shareAdmissionFrameLimit : shareLookupFrameLimit);
      let status; let ownerId: string | undefined;
      if (payload && typeof payload === 'object' && 'v' in payload && payload.v !== 2) status = 'upgradeRequired';
      else if (registration) {
        const { handles } = shareAdmission.parse(payload);
        status = policy.reserve(connection.remotePeer.toString(), source)
          ? policy.shares.register(connection.remotePeer.toString(), source, handles) : 'capacity';
      } else {
        const { handle } = shareLookup.parse(payload);
        ({ status, ownerId } = policy.shares.discover(connection.remotePeer.toString(), source, handle));
      }
      stream.send(encodeCompanionFrame({ v: 2, status, ...(ownerId ? { ownerId } : {}) }));
      await stream.close({ signal: AbortSignal.timeout(5000) });
    } catch { stream.abort(new Error('Guest routing request denied.')); }
  }, { maxInboundStreams: 2, maxOutboundStreams: 1 });
  const push = new CompanionPushRelay(relay.peerId.toString(), (host, device) => policy.paired(host, device), options.push);
  await relay.handle(companionPushProtocol, async (stream, connection) => {
    try {
      const source = ingress.source(connection.remoteAddr);
      if (!source || !policy.reserve(connection.remotePeer.toString(), source)) throw new Error('Denied.');
      const result = await push.send(connection.remotePeer.toString(), source, await readOne(stream));
      stream.send(encodeCompanionFrame({ result }));
      await stream.close({ signal: AbortSignal.timeout(5000) });
    } catch { stream.abort(new Error('Push unavailable.')); }
  }, { maxInboundStreams: 4, maxOutboundStreams: 1 });
  return relay;
}
async function readOne(stream: Stream, limit = 16_384): Promise<unknown> {
  stream.maxReadBufferLength = limit + 4; stream.maxWriteBufferLength = 16_384; stream.inactivityTimeout = 10_000;
  return readFirstCompanionFrame(stream, limit);
}
