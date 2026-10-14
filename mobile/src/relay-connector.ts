import { createCompanionStream } from './companion-stream';
import { ConversationCache } from './conversation-cache';
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
import { CompanionFrameDecoder, companionResponseLimit, companionProtocol, companionUpdatesProtocol, companionTarget, encodeCompanionFrame } from '@workspace/core/companion-protocol';
import type { BackendModelOption } from '@workspace/core/contracts';
import type { CompanionChatCreation, CompanionCommandReceipt, CompanionWorkspace } from '@workspace/core/companion-protocol';
import { companionRendezvousProtocol, relayAddress } from '@workspace/core/companion-relay';
import { createPairingExchange, normalizePairingCode, pairingChannel, pairingConfirmationsMatch } from '@workspace/core/companion-pairing';
import { PairingError, type CompanionConnector, type CompanionConversation, type CompanionHistoryPage, type CompanionSession } from './companion-port';
import type { ProtectedVault } from './protected-storage';

/** Both ends of a pairing are pinned by identity; the code that introduced them is never stored. */
type PairedLaptop = { v: 1; relayOrigin: string; relayPeerId: string; hostId: string; name: string };
export type RelayConfig = { origin: string; peerId: string; allowLocalDevelopment?: boolean };
function bytes(value: string) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
function base64(value: Uint8Array) { return btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join('')); }
/** The relay is deployment configuration baked into the build; the phone only needs a pairing code. */
export function createRelayConnector(vault: ProtectedVault, relay: RelayConfig | null): CompanionConnector {
  // Saved pairings cannot grant a transport exception: only this build's configured relay can.
  const addressFor = (origin: string, peerId: string) => relayAddress(origin, peerId,
    relay?.allowLocalDevelopment === true && origin === relay.origin && peerId === relay.peerId);
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
          addressFor(record.relayOrigin, record.relayPeerId);
          try { peerIdFromString(record.hostId); } catch { throw new Error('Saved laptop identity is invalid.'); }
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
  async function openStream(host: Pick<PairedLaptop, 'relayOrigin' | 'relayPeerId' | 'hostId'>, protocol: string): Promise<Stream> {
    const networkNode = await network();
    const address = `${addressFor(host.relayOrigin, host.relayPeerId)}/p2p-circuit/p2p/${host.hostId}`;
    // libp2p's dial queue excludes limited circuits from automatic reuse. Reuse the
    // authenticated, pinned circuit explicitly so pairing polls do not exhaust admission quotas.
    const options = { signal: AbortSignal.timeout(15_000), runOnLimitedConnection: true };
    const existing = networkNode.getConnections(peerIdFromString(host.hostId)).find((connection) => connection.status === 'open' && connection.remoteAddr.toString() === address);
    const stream: Stream = existing
      ? await existing.newStream(protocol, options)
      : await networkNode.dialProtocol(multiaddr(address), protocol, options);
    return stream;
  }
  async function request<Result>(host: Pick<PairedLaptop, 'relayOrigin' | 'relayPeerId' | 'hostId'>, method: string, args: unknown): Promise<Result> {
    const stream = await openStream(host, companionProtocol);
    stream.maxReadBufferLength = companionResponseLimit + 4; stream.maxWriteBufferLength = 1024 * 1024; stream.inactivityTimeout = 20_000;
    const id = crypto.randomUUID(); const decoder = new CompanionFrameDecoder(companionResponseLimit);
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
  /** Asks the relay which laptop is advertising this channel; trust comes from the end-to-end proof, not the relay's answer. */
  async function resolve(networkNode: Libp2p, config: RelayConfig, channel: string): Promise<string> {
    const stream: Stream = await networkNode.dialProtocol(multiaddr(addressFor(config.origin, config.peerId)), companionRendezvousProtocol, { signal: AbortSignal.timeout(15_000) });
    stream.maxReadBufferLength = 4096; stream.maxWriteBufferLength = 4096; stream.inactivityTimeout = 15_000;
    const decoder = new CompanionFrameDecoder();
    try {
      stream.send(encodeCompanionFrame({ channel }));
      await stream.close({ signal: AbortSignal.timeout(5000) });
      for await (const chunk of stream) for (const value of decoder.push(chunk instanceof Uint8Array ? chunk : chunk.subarray())) {
        const hostId = value && typeof value === 'object' && 'hostId' in value ? String(value.hostId) : '';
        try { peerIdFromString(hostId); return hostId; } catch { break; }
      }
    } catch { /* The relay aborts unknown channels. */ } finally { stream.abort(new Error('Lookup complete.')); }
    throw new PairingError('mobile.errors.noLaptop');
  }
  return {
    get laptops() { return records.map((record) => ({ id: record.hostId, name: record.name })); },
    initialize,
    relayConfigured: Boolean(relay),
    async pair(input, name, pending) {
      await initialize();
      if (!relay) throw new PairingError('mobile.errors.noRelay');
      const code = normalizePairingCode(input);
      if (!code) throw new PairingError('mobile.errors.codeFormat');
      const channel = pairingChannel(code);
      const networkNode = await network();
      const hostId = await resolve(networkNode, relay, channel);
      const laptop = { relayOrigin: relay.origin, relayPeerId: relay.peerId, hostId };
      const exchange = createPairingExchange({ role: 'initiator', code, initiatorId: identity, responderId: hostId });
      const started = await request<{ message: string; confirm: string }>(laptop, 'pair.start', { channel, message: base64(exchange.message), name });
      const confirmations = exchange.finish(bytes(started.message));
      // The laptop must prove it knows the code before this phone reveals anything further.
      if (!pairingConfirmationsMatch(confirmations.responderConfirm, bytes(started.confirm))) throw new PairingError('mobile.errors.codeMismatch');
      const result = await request<{ pendingId: string }>(laptop, 'pair.confirm', { channel, confirm: base64(confirmations.initiatorConfirm) });
      pending();
      const deadline = Date.now() + 300_000;
      while (Date.now() < deadline) {
        if (disposed) throw new Error('Pairing cancelled.');
        const state = await request<{ state: string; grant?: unknown }>(laptop, 'pair.status', { pendingId: result.pendingId });
        if (state.state === 'approved' && state.grant) {
          if (disposed) throw new Error('Pairing cancelled.');
          const record: PairedLaptop = { v: 1, ...laptop, name: 'Paired laptop' };
          const updated = [...records.filter((host) => host.hostId !== hostId), record];
          await vault.write({ key: 'paired-hosts', value: JSON.stringify(updated) }); records = updated;
          return hostId;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      }
      throw new PairingError('mobile.errors.pairingExpired');
    },
    async connect(laptopId) {
      await initialize();
      const host = records.find((record) => record.hostId === laptopId);
      if (!host) throw new Error('Pair the laptop first.');
      let closed = false; let workspace: CompanionWorkspace = { teams: [], agents: [] };
      const listeners = new Set<() => void>();
      const updates = new Set<(workspace: CompanionWorkspace, conversation: CompanionConversation | null) => void>();

      let icons: { version: string; value: Record<string, string> } = { version: '', value: {} };
      const read = async () => {
        const { iconsVersion, repositoryIcons, ...rest } = await channel.request<CompanionWorkspace & { iconsVersion?: string }>('snapshot.get', { iconsVersion: icons.version });
        if (repositoryIcons) icons = { version: iconsVersion ?? '', value: repositoryIcons };
        workspace = { ...rest, repositoryIcons: icons.value };
        return workspace;
      };
      const target = (agentId: string) => {
        const agent = workspace.agents.find((agent) => agent.id === agentId); const team = workspace.teams.find((team) => team.id === agent?.teamId);
        if (!agent || !team) throw new Error('Agent is outside the paired scope.');
        return companionTarget(host.hostId, team, agent);
      };
      const notify = (frame: CompanionConversation | null = null) => { if (!closed) for (const listener of updates) listener(workspace, frame); };
      const failed = () => { if (!closed) { close(); for (const listener of listeners) listener(); } };
      const cache = new ConversationCache((method, target) => channel.request(method, target), (frame) => notify(frame), failed);
      const channel = createCompanionStream(() => openStream(host, companionUpdatesProtocol), (update) => {
        if (update.type === 'workspace') {
          workspace = { ...update.workspace, repositoryIcons: update.workspace.repositoryIcons ?? icons.value };
          if (update.workspace.repositoryIcons) icons = { version: (update.workspace as CompanionWorkspace & { iconsVersion?: string }).iconsVersion ?? icons.version, value: update.workspace.repositoryIcons };
          cache.reconcile(workspace.agents.flatMap((agent) => {
            const team = workspace.teams.find((team) => team.id === agent.teamId);
            return team ? [companionTarget(host.hostId, team, agent)] : [];
          }));
          notify();
        } else cache.receive(update.frame);
      }, failed);
      const close = () => { closed = true; channel.close(); cache.close(); sessions.delete(handle); };
      const handle = { laptopId, close }; sessions.add(handle);
      const pinned = host;
      async function created(creationId: string, signal?: AbortSignal): Promise<string> {
        let failures = 0;
        for (const deadline = Date.now() + 600_000; Date.now() < deadline;) {
          await new Promise<void>((resolve) => setTimeout(resolve, 1000));
          if (closed || signal?.aborted) throw new Error('Disconnected.');
          const result = await request<CompanionChatCreation>(pinned, 'agent.create.status', { creationId }).catch((error: unknown) => { if (++failures > 3) throw error; return null; });
          if (!result) continue;
          failures = 0;
          if (result.state === 'success') return result.agentId;
          if (result.state === 'error') throw new Error(result.error);
        }
        throw new Error('Creating the chat took too long.');
      }
      const session: CompanionSession = {
        getWorkspace: read,
        async respondRequest(reply) { await request(host, 'agent.request.respond', reply); },
        deselectConversation() { void cache.select(null); },
        cachedConversation(agentId) { return cache.peek(target(agentId)); },
        async loadConversation(agentId) { return cache.select(agentId ? target(agentId) : null); },
        async loadOlderHistory(agentId) { const page = await request<CompanionHistoryPage>(host, 'conversation.loadOlder', target(agentId)); cache.receive(page.frame); return { ...page, frame: cache.peek(target(agentId)) ?? page.frame }; },
        async sendPrompt(agentId, prompt, clientCommandId = crypto.randomUUID(), options, attachments) {
          if (closed) throw new Error('Disconnected.');
          const receipt = await request<CompanionCommandReceipt>(host, 'prompt.submit', { target: target(agentId), text: prompt, clientCommandId, ...(options ? { options } : {}), ...(attachments?.length ? { attachments } : {}) });
          if (receipt.state !== 'accepted') throw new Error('Delivery is unresolved.');
        },
        async listModels(agentId) { return (await request<{ models: BackendModelOption[] }>(host, 'models.list', { agentId })).models; },
        async selectModel(agentId, selection) { await request(host, 'agent.model.select', { agentId, ...selection }); },
        async interrupt(agentId) { await request(host, 'agent.interrupt', { agentId }); },
        async restartSession(agentId) { await request(host, 'agent.restart', target(agentId)); },
        async previewCloseSession(agentId) { return request(host, 'agent.close.preview', target(agentId)); },
        async closeSession(target, input) { await request(host, 'agent.close', { target, ...(input ? { input } : {}) }); },
        // Worktree setup can outlast any single request: the laptop works on, the phone asks how it is going.
        async createChat(chat, signal) { return created((await request<{ creationId: string }>(host, 'agent.create', chat)).creationId, signal); },
        async createQuickChat(chat, signal) { return created((await request<{ creationId: string }>(host, 'agent.quickChat.create', chat)).creationId, signal); },
        async setBackend(agentId, backend) { await request(host, 'agent.backend.set', { agentId, backend }); },
        async startReview(agentId, input) { await request(host, 'agent.review.start', { agentId, input }); },
        async setApprovalPreset(agentId, preset) { await request(host, 'agent.approvalPreset.set', { agentId, preset }); },
        async setPermissionMode(agentId, mode) { await request(host, 'agent.permissionMode.set', { agentId, mode }); },
        async commandStatus(clientCommandId) { return (await request<{ state: 'accepted' | 'unresolved' | 'notReceived' }>(host, 'command.status', { clientCommandId })).state; },
        onDisconnect(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        onUpdate(listener) { updates.add(listener); return () => updates.delete(listener); },
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
