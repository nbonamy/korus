import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey, peerIdFromString } from '@libp2p/peer-id';
import { multiaddr } from '@multiformats/multiaddr';
import type { Libp2p, Stream } from '@libp2p/interface';
import { companionCompressedProtocol, companionCompressedUpdatesProtocol, companionProtocol, companionUpdatesProtocol } from '@workspace/core/companion-protocol';
import { requestCompanionStream } from './companion-request';
import { connectionDiagnostic, connectionError, connectionLogger } from './connection-diagnostics';
import type { ProtectedVault } from './protected-storage';

/** A paired laptop and the relay it is reached through; both ends are pinned by identity. */
export type PairedLaptop = { v: 1; relayOrigin: string; relayPeerId: string; hostId: string; name: string };
export type RelayHost = Pick<PairedLaptop, 'relayOrigin' | 'relayPeerId' | 'hostId'>;

const dialTimeoutMs = 8_000;
const bytes = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const base64 = (value: Uint8Array) => btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join(''));

/**
 * The phone's one libp2p node: it dials laptops through the pinned relay and holds this device's identity.
 * `suspend` stops the node after a long absence; it starts again on the next dial.
 */
export function createRelayNetwork(options: { vault: ProtectedVault; relayPeerId: string | undefined; addressFor(origin: string, peerId: string): string }) {
  let node: Libp2p | null = null;
  let opening: Promise<Libp2p> | null = null;
  let identity = '';
  let signingKey: Awaited<ReturnType<typeof generateKeyPair>> | undefined;
  let disposed = false;
  let suspended = false;

  async function start(): Promise<Libp2p> {
    const saved = await options.vault.read({ key: 'device-identity' });
    const key = saved.value ? privateKeyFromProtobuf(bytes(saved.value)) : await generateKeyPair('Ed25519');
    if (!saved.value) await options.vault.write({ key: 'device-identity', value: base64(privateKeyToProtobuf(key)) });
    identity = peerIdFromPrivateKey(key).toString();
    signingKey = key;
    const created = await createLibp2p({ privateKey: key, logger: connectionLogger, transports: [webSockets(), circuitRelayTransport({ maxReservationQueueLength: 1 })],
      // Native decryption is asynchronous. Outstanding receive credit must fit
      // the paused stream buffer, including at the relayed (inner Noise) layer.
      connectionEncrypters: [noise()], streamMuxers: [yamux({ streamOptions: { maxStreamWindowSize: 1024 * 1024 } })], services: { identify: identify() },
      connectionManager: { maxConnections: 4, maxParallelDials: 2 },
      // The update channel owns liveness: a transport ping that runs late after iOS resumes must not abort a healthy circuit.
      connectionMonitor: { abortConnectionOnPingFailure: false },
      connectionGater: { denyInboundConnection: () => true, denyDialMultiaddr: () => false },
    });
    created.addEventListener('connection:close', (event) => {
      connectionDiagnostic('transport.connection-close', { stage: event.detail.remotePeer.toString() === options.relayPeerId ? 'relay' : 'host', connectionCount: created.getConnections().length,
        connectionId: event.detail.id, remainingBytes: event.detail.limits?.bytes?.toString(), remainingSeconds: event.detail.limits?.seconds });
    });
    node = created;
    if (disposed || suspended) { await created.stop(); node = null; throw new Error('Companion closed or paused.'); }
    return created;
  }

  async function network(): Promise<Libp2p> {
    if (disposed || suspended) throw new Error('Companion closed or paused.');
    if (node) return node;
    return opening ??= start().finally(() => { opening = null; });
  }

  async function stop() {
    await opening?.catch(() => {});
    await node?.stop();
    node = null;
  }

  async function openStream(host: RelayHost, protocol: string): Promise<Stream> {
    const started = Date.now();
    const networkNode = await network();
    const address = `${options.addressFor(host.relayOrigin, host.relayPeerId)}/p2p-circuit/p2p/${host.hostId}`;
    const stage = protocol === companionUpdatesProtocol ? 'updates' : 'rpc';
    // libp2p's dial queue excludes limited circuits from automatic reuse. Reuse the
    // authenticated, pinned circuit explicitly so pairing polls do not exhaust admission quotas.
    const dial = { signal: AbortSignal.timeout(dialTimeoutMs), runOnLimitedConnection: true };
    const existing = networkNode.getConnections(peerIdFromString(host.hostId)).find((connection) => connection.status === 'open' && connection.remoteAddr.toString() === address);
    try {
      const protocols = protocol === companionUpdatesProtocol ? [companionCompressedUpdatesProtocol, protocol] : [companionCompressedProtocol, protocol];
      const stream: Stream = existing ? await existing.newStream(protocols, dial) : await networkNode.dialProtocol(multiaddr(address), protocols, dial);
      const connection = existing ?? networkNode.getConnections(peerIdFromString(host.hostId)).find((candidate) => candidate.remoteAddr.toString() === address);
      connectionDiagnostic('transport.stream-open', { stage, reused: Boolean(existing), elapsedMs: Date.now() - started, connectionCount: networkNode.getConnections().length,
        connectionId: connection?.id, remainingBytes: connection?.limits?.bytes?.toString(), remainingSeconds: connection?.limits?.seconds });
      return stream;
    } catch (error) {
      connectionDiagnostic('transport.open-error', { stage, reused: Boolean(existing), elapsedMs: Date.now() - started, ...connectionError(error) });
      throw error;
    }
  }

  return {
    network,
    openStream,
    async request<Result>(host: RelayHost, method: string, args: unknown): Promise<Result> {
      return requestCompanionStream<Result>(await openStream(host, companionProtocol), method, args);
    },
    /** This device's identity and a signature by it; the laptop checks it before accepting a push registration. */
    async signer() {
      await network();
      return { peerId: identity, sign: async (message: Uint8Array) => base64(await signingKey!.sign(message)) };
    },
    /** A circuit can still claim to be open after iOS suspended its WebSocket: retire both ends so the next dial cannot reuse it. */
    retireRoutes(host: RelayHost) {
      for (const connection of node?.getConnections() ?? []) {
        const peer = connection.remotePeer.toString();
        if (peer === host.hostId || peer === host.relayPeerId) connection.abort(new Error('Foreground liveness check failed.'));
      }
    },
    isDisposed: () => disposed,
    resume() { if (disposed) throw new Error('Companion closed.'); suspended = false; },
    async suspend() { suspended = true; await stop(); },
    async dispose() { disposed = true; await stop(); },
  };
}
export type RelayNetwork = ReturnType<typeof createRelayNetwork>;
