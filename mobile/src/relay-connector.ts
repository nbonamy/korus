import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf, publicKeyFromProtobuf } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey, peerIdFromPublicKey, peerIdFromString } from '@libp2p/peer-id';
import { multiaddr } from '@multiformats/multiaddr';
import type { Libp2p, Stream } from '@libp2p/interface';
import { CompanionFrameDecoder, companionProtocol, companionTarget, encodeCompanionFrame } from '@workspace/core/companion-protocol';
import type { CompanionCommandReceipt, CompanionInvitation, CompanionWorkspace } from '@workspace/core/companion-protocol';
import { relayAddress } from '@workspace/core/companion-relay';
import type { CompanionConnector, CompanionConversation, CompanionSession } from './companion-port';
import type { ProtectedVault } from './protected-storage';

type PairedLaptop = Omit<CompanionInvitation, 'inviteSecret' | 'inviteId' | 'expiresAt'> & { name: string; canSend: boolean };
function bytes(value: string) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
function base64(value: Uint8Array) { return btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join('')); }
export function parseInvitation(text: string): CompanionInvitation {
  if (text.length > 4000) throw new Error('Invalid pairing invitation.');
  const invite = JSON.parse(text) as CompanionInvitation;
  if (invite.v !== 1 || !Number.isFinite(invite.expiresAt) || invite.expiresAt <= Date.now() || invite.expiresAt > Date.now() + 300_000
    || typeof invite.inviteId !== 'string' || !/^[a-f0-9-]{36}$/.test(invite.inviteId)
    || typeof invite.inviteSecret !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(invite.inviteSecret)
    || typeof invite.hostPublicKey !== 'string' || invite.hostPublicKey.length > 200) throw new Error('Invalid or expired pairing invitation.');
  relayAddress(invite.relayOrigin, invite.relayPeerId);
  if (peerIdFromPublicKey(publicKeyFromProtobuf(bytes(invite.hostPublicKey))).toString() !== invite.hostId) throw new Error('Laptop identity does not match its public key.');
  return invite;
}
export function createRelayConnector(vault: ProtectedVault): CompanionConnector {
  let records: PairedLaptop[] = [];
  let initialized: Promise<void> | null = null;
  let node: Libp2p | null = null;
  let identity = '';
  let disposed = false;
  let suspended = false;
  const sessions = new Set<{ laptopId: string; close(): void }>();
  let opening: Promise<Libp2p> | null = null;
  async function initialize() {
    return initialized ??= (async () => {
      const stored = await vault.read({ key: 'paired-hosts' });
      if (stored.value) {
        records = JSON.parse(stored.value) as PairedLaptop[];
        if (!Array.isArray(records) || records.length > 20) throw new Error('Invalid paired devices.');
        for (const record of records) {
          relayAddress(record.relayOrigin, record.relayPeerId);
          if (peerIdFromPublicKey(publicKeyFromProtobuf(bytes(record.hostPublicKey))).toString() !== record.hostId) throw new Error('Saved laptop identity is invalid.');
        }
      }
    })();
  }
  async function network() {
    if (disposed || suspended) throw new Error('Companion closed or paused.');
    if (node) return node;
    return opening ??= (async () => {
      const saved = await vault.read({ key: 'device-identity' });
      const key = saved.value ? privateKeyFromProtobuf(bytes(saved.value)) : await generateKeyPair('Ed25519');
      if (!saved.value) await vault.write({ key: 'device-identity', value: base64(privateKeyToProtobuf(key)) });
      identity = peerIdFromPrivateKey(key).toString();
      node = await createLibp2p({ privateKey: key, transports: [webSockets(), circuitRelayTransport({ maxReservationQueueLength: 1 })],
        connectionEncrypters: [noise()], streamMuxers: [yamux()], services: { identify: identify() },
        connectionManager: { maxConnections: 4, maxParallelDials: 2 },
        connectionGater: { denyInboundConnection: () => true, denyDialMultiaddr: () => false },
      });
      if (disposed || suspended) { await node.stop(); node = null; throw new Error('Companion closed or paused.'); }
      return node;
    })().finally(() => { opening = null; });
  }
  async function request<Result>(host: Pick<CompanionInvitation, 'relayOrigin' | 'relayPeerId' | 'hostId'>, method: string, args: unknown): Promise<Result> {
    const networkNode = await network();
    const address = `${relayAddress(host.relayOrigin, host.relayPeerId)}/p2p-circuit/p2p/${host.hostId}`;
    // libp2p's dial queue excludes limited circuits from automatic reuse. Reuse the
    // authenticated, pinned circuit explicitly so pairing polls do not exhaust admission quotas.
    const options = { signal: AbortSignal.timeout(15_000), runOnLimitedConnection: true };
    const existing = networkNode.getConnections(peerIdFromString(host.hostId)).find((connection) => connection.status === 'open' && connection.remoteAddr.toString() === address);
    const stream: Stream = existing
      ? await existing.newStream(companionProtocol, options)
      : await networkNode.dialProtocol(multiaddr(address), companionProtocol, options);
    stream.maxReadBufferLength = 4 * 1024 * 1024 + 4; stream.maxWriteBufferLength = 1024 * 1024; stream.inactivityTimeout = 20_000;
    const id = crypto.randomUUID(); const decoder = new CompanionFrameDecoder();
    try {
      stream.send(encodeCompanionFrame({ v: 1, id, method, args }));
      await stream.close({ signal: AbortSignal.timeout(5000) });
      for await (const chunk of stream) for (const value of decoder.push(chunk instanceof Uint8Array ? chunk : chunk.subarray())) {
        if (!value || typeof value !== 'object' || !('v' in value) || value.v !== 1 || !('id' in value) || value.id !== id) throw new Error('Invalid companion response.');
        if ('error' in value) throw new Error('Laptop denied the operation or is unavailable.');
        if (!('result' in value)) throw new Error('Invalid companion result.');
        return value.result as Result;
      }
      throw new Error('Connection closed without a receipt.');
    } finally { stream.abort(new Error('Request complete.')); }
  }
  return {
    get laptops() { return records.map((record) => ({ id: record.hostId, name: record.name })); },
    initialize,
    async pair(text, name, pending) {
      await initialize();
      const invite = parseInvitation(text);
      await network();
      const result = await request<{ pendingId: string }>(invite, 'pair.request', { inviteId: invite.inviteId, inviteSecret: invite.inviteSecret, name });
      pending(identity);
      while (Date.now() < invite.expiresAt) {
        if (disposed) throw new Error('Pairing cancelled.');
        const state = await request<{ state: string; grant?: { canSend: boolean } }>(invite, 'pair.status', { pendingId: result.pendingId });
        if (state.state === 'approved' && state.grant) {
          if (disposed) throw new Error('Pairing cancelled.');
          const record: PairedLaptop = { v: 1, relayOrigin: invite.relayOrigin, relayPeerId: invite.relayPeerId, hostId: invite.hostId, hostPublicKey: invite.hostPublicKey, name: 'Paired laptop', canSend: state.grant.canSend };
          const updated = [...records.filter((host) => host.hostId !== invite.hostId), record];
          await vault.write({ key: 'paired-hosts', value: JSON.stringify(updated) }); records = updated;
          return invite.hostId;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error('Pairing expired.');
    },
    async connect(laptopId) {
      await initialize();
      const host = records.find((record) => record.hostId === laptopId);
      if (!host) throw new Error('Pair the laptop first.');
      let closed = false; let workspace: CompanionWorkspace = { teams: [], agents: [] }; let selected = '';
      const listeners = new Set<() => void>();
      const updates = new Set<(workspace: CompanionWorkspace, conversation: CompanionConversation | null) => void>();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const read = async () => { workspace = await request(host, 'snapshot.get', {}); return workspace; };
      const target = (agentId: string) => {
        const agent = workspace.agents.find((agent) => agent.id === agentId); const team = workspace.teams.find((team) => team.id === agent?.teamId);
        if (!agent || !team) throw new Error('Agent is outside the paired scope.');
        return companionTarget(host.hostId, team, agent);
      };
      const conversation = async (agentId: string) => {
        const selectedTarget = target(agentId);
        const agent = workspace.agents.find((agent) => agent.id === agentId);
        if (!agent?.backendSession) return null;
        return request<CompanionConversation>(host, 'conversation.subscribe', selectedTarget);
      };
      async function poll() {
        if (closed) return;
        try {
          const nextWorkspace = await read();
          const frame = selected ? await conversation(selected) : null;
          if (closed) return;
          for (const listener of updates) listener(nextWorkspace, frame);
          timer = setTimeout(() => void poll(), 1200);
        } catch { if (!closed) { close(); for (const listener of listeners) listener(); } }
      }
      const close = () => { closed = true; clearTimeout(timer); sessions.delete(handle); };
      const handle = { laptopId, close }; sessions.add(handle);
      const session: CompanionSession = {
        canSend: host.canSend,
        getWorkspace: read,
        async loadConversation(agentId) { selected = agentId; return conversation(agentId); },
        async sendPrompt(agentId, prompt, clientCommandId = crypto.randomUUID()) {
          if (closed) throw new Error('Disconnected.');
          const receipt = await request<CompanionCommandReceipt>(host, 'prompt.submit', { target: target(agentId), text: prompt, clientCommandId });
          if (receipt.state !== 'accepted') throw new Error('Delivery is unresolved.');
        },
        async commandStatus(clientCommandId) { return (await request<{ state: 'accepted' | 'unresolved' | 'notReceived' }>(host, 'command.status', { clientCommandId })).state; },
        onDisconnect(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        onUpdate(listener) { updates.add(listener); if (!timer) timer = setTimeout(() => void poll(), 1200); return () => updates.delete(listener); },
        close,
      };
      return session;
    },
    async revoke(laptopId) {
      const host = records.find((record) => record.hostId === laptopId);
      for (const session of sessions) if (session.laptopId === laptopId) session.close();
      records = records.filter((record) => record.hostId !== laptopId);
      await vault.write({ key: 'paired-hosts', value: JSON.stringify(records) });
      if (host) await request(host, 'device.forget', {});
    },
    async resume() { if (disposed) throw new Error('Companion closed.'); suspended = false; },
    async suspend() { suspended = true; for (const session of sessions) session.close(); await opening?.catch(() => {}); await node?.stop(); node = null; },
    async dispose() { disposed = true; for (const session of sessions) session.close(); await opening?.catch(() => {}); await node?.stop(); node = null; },
  };
}
