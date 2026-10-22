import { peerIdFromString } from '@libp2p/peer-id';
import { multiaddr } from '@multiformats/multiaddr';
import type { Libp2p, Stream } from '@libp2p/interface';
import { encodeCompanionFrame, readFirstCompanionFrame } from '@workspace/core/companion-protocol';
import { companionRendezvousProtocol } from '@workspace/core/companion-relay';
import { normalizePairingCode, pairingLifetimeMs } from '@workspace/core/companion-pairing';
import { PairingError } from './companion-port';
import type { ProtectedVault } from './protected-storage';
import type { PairedLaptop, RelayNetwork } from './relay-network';

export type RelayConfig = { origin: string; peerId: string; allowLocalDevelopment?: boolean };

const maxPairedLaptops = 20;
const lookupTimeoutMs = 15_000;
const pairingPollMs = 1_000;

/** The laptops this phone is paired with: stored in the vault, introduced by the relay, and pinned by identity. */
export function createPairing(options: { vault: ProtectedVault; relay: RelayConfig | null; addressFor(origin: string, peerId: string): string; network: RelayNetwork }) {
  const { vault, relay, addressFor, network } = options;
  let records: PairedLaptop[] = [];
  let initialized: Promise<void> | null = null;
  const save = () => vault.write({ key: 'paired-hosts', value: JSON.stringify(records) });

  function initialize() {
    return initialized ??= (async () => {
      const stored = await vault.read({ key: 'paired-hosts' });
      if (!stored.value) return;
      const loaded = JSON.parse(stored.value) as PairedLaptop[];
      if (!Array.isArray(loaded) || loaded.length > maxPairedLaptops) throw new Error('Invalid paired devices.');
      // A deployment change starts fresh; stale dev pairings must not block startup.
      const current = loaded.filter((record) => {
        if (record.relayOrigin !== relay?.origin || record.relayPeerId !== relay?.peerId) return false;
        try { addressFor(record.relayOrigin, record.relayPeerId); return true; } catch { return false; }
      });
      records = current;
      if (current.length !== loaded.length) await save();
      for (const record of records) {
        addressFor(record.relayOrigin, record.relayPeerId);
        try { peerIdFromString(record.hostId); } catch { throw new Error('Saved laptop identity is invalid.'); }
      }
    })();
  }

  /** Trust the pinned relay for introduction, then authenticate this laptop identity through Noise. */
  async function resolve(node: Libp2p, config: RelayConfig, code: string): Promise<string> {
    const stream: Stream = await node.dialProtocol(multiaddr(addressFor(config.origin, config.peerId)), companionRendezvousProtocol, { signal: AbortSignal.timeout(lookupTimeoutMs) });
    stream.maxReadBufferLength = 4096; stream.maxWriteBufferLength = 4096; stream.inactivityTimeout = lookupTimeoutMs;
    try {
      stream.send(encodeCompanionFrame({ code }));
      await stream.close({ signal: AbortSignal.timeout(5000) });
      const value = await readFirstCompanionFrame(stream);
      const hostId = value && typeof value === 'object' && 'hostId' in value ? String(value.hostId) : '';
      peerIdFromString(hostId);
      return hostId;
    } catch { /* The relay aborts unavailable invitations. */ } finally { stream.abort(new Error('Lookup complete.')); }
    throw new PairingError('mobile.errors.noLaptop');
  }

  return {
    initialize,
    get laptops() { return records.map((record) => ({ id: record.hostId, name: record.name })); },
    find: (laptopId: string) => records.find((record) => record.hostId === laptopId),
    /** Forgets a laptop locally and returns what was stored, so the caller can tell the laptop too. */
    async forget(laptopId: string): Promise<PairedLaptop | undefined> {
      const host = records.find((record) => record.hostId === laptopId);
      records = records.filter((record) => record.hostId !== laptopId);
      await save();
      return host;
    },
    async pair(input: string, name: string, pending: () => void): Promise<string> {
      await initialize();
      if (!relay) throw new PairingError('mobile.errors.noRelay');
      const code = normalizePairingCode(input);
      if (!code) throw new PairingError('mobile.errors.codeFormat');
      const hostId = await resolve(await network.network(), relay, code);
      const laptop = { relayOrigin: relay.origin, relayPeerId: relay.peerId, hostId };
      const result = await network.request<{ pendingId: string }>(laptop, 'pair.claim', { code, name });
      pending();
      const deadline = Date.now() + pairingLifetimeMs;
      while (Date.now() < deadline) {
        if (network.isDisposed()) throw new Error('Pairing cancelled.');
        const state = await network.request<{ state: string; grant?: unknown }>(laptop, 'pair.status', { pendingId: result.pendingId });
        if (state.state === 'approved' && state.grant) {
          if (network.isDisposed()) throw new Error('Pairing cancelled.');
          records = [...records.filter((host) => host.hostId !== hostId), { v: 1, ...laptop, name: 'Paired laptop' }];
          await save();
          return hostId;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, pairingPollMs));
      }
      throw new PairingError('mobile.errors.pairingExpired');
    },
  };
}
