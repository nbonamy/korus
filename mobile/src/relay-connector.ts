import { PromptRejectedError } from './companion-port';
import { companionPushAuthorizationMessage, type CompanionNotification } from '@workspace/core/companion-notification';
import { CompanionOperationDenied, createCompanionStream } from './companion-stream';
import { ConversationCache } from './conversation-cache';
import { requestCompanionStream } from './companion-request';
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
import { companionProtocol, companionUpdatesProtocol, companionTarget, encodeCompanionFrame, readFirstCompanionFrame } from '@workspace/core/companion-protocol';
import type { BackendModelOption, BackendSkillSummary, BackendPluginSummary } from '@workspace/core/contracts';
import type { CompanionChatCreation, CompanionCommandReceipt, CompanionWorkspace } from '@workspace/core/companion-protocol';
import { companionRendezvousProtocol, relayAddress } from '@workspace/core/companion-relay';
import { normalizePairingCode, pairingLifetimeMs } from '@workspace/core/companion-pairing';
import { PairingError, type CompanionConnector, type CompanionConversation, type CompanionSession } from './companion-port';
import type { ProtectedVault } from './protected-storage';
import { connectionDiagnostic, connectionError, connectionLogger } from './connection-diagnostics';

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
  let signingKey: Awaited<ReturnType<typeof generateKeyPair>> | undefined;
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
        // A deployment change starts fresh; stale dev pairings must not block startup.
        const current = records.filter(record => {
          if (record.relayOrigin !== relay?.origin || record.relayPeerId !== relay?.peerId) return false;
          try { addressFor(record.relayOrigin, record.relayPeerId); return true; } catch { return false; }
        });
        if (current.length !== records.length) await vault.write({ key: 'paired-hosts', value: JSON.stringify(current) });
        records = current;
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
      signingKey = key;
      node = await createLibp2p({ privateKey: key, logger: connectionLogger, transports: [webSockets(), circuitRelayTransport({ maxReservationQueueLength: 1 })],
        // Native decryption is asynchronous. Outstanding receive credit must fit
        // the paused stream buffer, including at the relayed (inner Noise) layer.
        connectionEncrypters: [noise()], streamMuxers: [yamux({ streamOptions: { maxStreamWindowSize: 1024 * 1024 } })], services: { identify: identify() },
        connectionManager: { maxConnections: 4, maxParallelDials: 2 },
        connectionGater: { denyInboundConnection: () => true, denyDialMultiaddr: () => false },
      });
      node.addEventListener('connection:close', event => {
        connectionDiagnostic('transport.connection-close', { stage: event.detail.remotePeer.toString() === relay?.peerId ? 'relay' : 'host', connectionCount: node?.getConnections().length ?? 0,
          connectionId: event.detail.id, remainingBytes: event.detail.limits?.bytes?.toString(), remainingSeconds: event.detail.limits?.seconds });
      });
      if (disposed || suspended) { await node.stop(); node = null; throw new Error('Companion closed or paused.'); }
      return node;
    })().finally(() => { opening = null; });
  }
  async function openStream(host: Pick<PairedLaptop, 'relayOrigin' | 'relayPeerId' | 'hostId'>, protocol: string): Promise<Stream> {
    const started = Date.now();
    const networkNode = await network();
    const address = `${addressFor(host.relayOrigin, host.relayPeerId)}/p2p-circuit/p2p/${host.hostId}`;
    // libp2p's dial queue excludes limited circuits from automatic reuse. Reuse the
    // authenticated, pinned circuit explicitly so pairing polls do not exhaust admission quotas.
    const options = { signal: AbortSignal.timeout(15_000), runOnLimitedConnection: true };
    const existing = networkNode.getConnections(peerIdFromString(host.hostId)).find((connection) => connection.status === 'open' && connection.remoteAddr.toString() === address);
    try {
      const stream: Stream = existing
        ? await existing.newStream(protocol, options)
        : await networkNode.dialProtocol(multiaddr(address), protocol, options);
      const connection = existing ?? networkNode.getConnections(peerIdFromString(host.hostId)).find(candidate => candidate.remoteAddr.toString() === address);
      connectionDiagnostic('transport.stream-open', { stage: protocol === companionUpdatesProtocol ? 'updates' : 'rpc', reused: Boolean(existing), elapsedMs: Date.now() - started, connectionCount: networkNode.getConnections().length,
        connectionId: connection?.id, remainingBytes: connection?.limits?.bytes?.toString(), remainingSeconds: connection?.limits?.seconds });
      return stream;
    } catch (error) {
      connectionDiagnostic('transport.open-error', { stage: protocol === companionUpdatesProtocol ? 'updates' : 'rpc', reused: Boolean(existing), elapsedMs: Date.now() - started, ...connectionError(error) });
      throw error;
    }
  }
  async function request<Result>(host: Pick<PairedLaptop, 'relayOrigin' | 'relayPeerId' | 'hostId'>, method: string, args: unknown): Promise<Result> {
    return requestCompanionStream<Result>(await openStream(host, companionProtocol), method, args);
  }
  /** Trust the pinned relay for introduction, then authenticate this laptop identity through Noise. */
  async function resolve(networkNode: Libp2p, config: RelayConfig, code: string): Promise<string> {
    const stream: Stream = await networkNode.dialProtocol(multiaddr(addressFor(config.origin, config.peerId)), companionRendezvousProtocol, { signal: AbortSignal.timeout(15_000) });
    stream.maxReadBufferLength = 4096; stream.maxWriteBufferLength = 4096; stream.inactivityTimeout = 15_000;
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
    get laptops() { return records.map((record) => ({ id: record.hostId, name: record.name })); },
    initialize,
    relayConfigured: Boolean(relay),
    async pair(input, name, pending) {
      await initialize();
      if (!relay) throw new PairingError('mobile.errors.noRelay');
      const code = normalizePairingCode(input);
      if (!code) throw new PairingError('mobile.errors.codeFormat');
      const networkNode = await network();
      const hostId = await resolve(networkNode, relay, code);
      const laptop = { relayOrigin: relay.origin, relayPeerId: relay.peerId, hostId };
      const result = await request<{ pendingId: string }>(laptop, 'pair.claim', { code, name });
      pending();
      const deadline = Date.now() + pairingLifetimeMs;
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
      connectionDiagnostic('session.connect');
      await initialize();
      const host = records.find((record) => record.hostId === laptopId);
      if (!host) throw new Error('Pair the laptop first.');
      let closed = false; let workspace: CompanionWorkspace = { teams: [], agents: [] };
      const listeners = new Set<() => void>();
      const notifications = new Set<(notification: CompanionNotification) => void>();
      const updates = new Set<(workspace: CompanionWorkspace, conversation: CompanionConversation | null) => void>();

      let supportsNotifications = true;
      let active = true;
      let icons: { version: string; value: Record<string, string> } = { version: '', value: {} };
      const read = async () => {
        const snapshot = () => channel.request<CompanionWorkspace & { iconsVersion?: string }>('snapshot.get', { iconsVersion: icons.version, ...(supportsNotifications ? { notifications: active } : {}) });
        const { iconsVersion, repositoryIcons, ...rest } = await snapshot().catch(error => {
          if (!supportsNotifications || !(error instanceof CompanionOperationDenied)) throw error;
          // Existing laptops reject unknown fields. Keep chat usable through rolling upgrades.
          supportsNotifications = false;
          return snapshot();
        });
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
      const cache = new ConversationCache((method, target) => channel.request(method, target), (frame) => notify(frame), () => {
        connectionDiagnostic('session.disconnect', { reason: 'conversation-cache' }); failed();
      });
      const channel = createCompanionStream(() => openStream(host, companionUpdatesProtocol), (update) => {
        if (update.type === 'workspace') {
          workspace = { ...update.workspace, repositoryIcons: update.workspace.repositoryIcons ?? icons.value };
          if (update.workspace.repositoryIcons) icons = { version: (update.workspace as CompanionWorkspace & { iconsVersion?: string }).iconsVersion ?? icons.version, value: update.workspace.repositoryIcons };
          cache.reconcile(workspace.agents.flatMap((agent) => {
            const team = workspace.teams.find((team) => team.id === agent.teamId);
            return team ? [companionTarget(host.hostId, team, agent)] : [];
          }));
          notify();
        } else if (update.type === 'notification') {
          if (update.notification.target.hostId === host.hostId) for (const listener of notifications) listener(update.notification);
        } else cache.receive(update.frame);
      }, failed);
      const close = () => { if (!closed) connectionDiagnostic('session.close'); closed = true; channel.close(); cache.close(); sessions.delete(handle); };
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
        async setActive(next) {
          active = next;
          const liveness = channel.setActive(next);
          // Retain the stream while allowing APNs immediately in the background.
          const presence = supportsNotifications ? read() : Promise.resolve();
          await Promise.all([liveness, presence]);
        },
        getWorkspace: read,
        readImage: (agentId, path) => request(host, 'conversation.image.read', { target: target(agentId), path }),
        getUsage: () => request(host, 'usage.get', {}),
        async registerPush(registration) {
          if (!registration) { await request(host, 'notifications.register', null); return; }
          await network();
          const expiresAt = Date.now() + 30 * 86400_000;
          const signature = base64(await signingKey!.sign(companionPushAuthorizationMessage(host.relayPeerId, host.hostId, identity, registration, expiresAt)));
          await request(host, 'notifications.register', { ...registration, authorization: { expiresAt, signature } });
        },
        onNotification(listener) { notifications.add(listener); return () => { notifications.delete(listener); }; },
        async markRead(agentId, revision) { await request(host, 'conversation.read', { target: target(agentId), revision }); },
        async respondRequest(reply) { await request(host, 'agent.request.respond', reply); },
        deselectConversation() { void cache.select(null); },
        cachedConversation(agentId) { return cache.peek(target(agentId)); },
        async loadConversation(agentId) { return cache.select(agentId ? target(agentId) : null); },
        async loadOlderHistory(agentId) {
          const identity = target(agentId);
          const page = await request<{ frame: import('@workspace/core/contracts').ProviderConversationFrame; hasOlder: boolean }>(host, 'conversation.loadOlder', identity);
          if (closed || JSON.stringify(target(agentId)) !== JSON.stringify(identity)) throw new Error('Conversation changed.');
          cache.receive(page.frame);
          const frame = cache.peek(identity) ?? (page.frame.type === 'codex.conversationSnapshotChanged' || page.frame.type === 'claude.conversationSnapshotChanged' || page.frame.type === 'antigravity.conversationSnapshotChanged' ? page.frame : null);
          if (!frame) throw new Error('Conversation history needs to be reloaded.');
          return { hasOlder: page.hasOlder, frame };
        },
        async readConversationContent(agentId, input) {
          const identity = target(agentId);
          if (closed) throw new Error('Disconnected.');
          const chunk = await request<import('@workspace/core/contracts/conversation').ConversationContentChunk>(host, 'conversation.content.read', { target: identity, input });
          if (closed || JSON.stringify(target(agentId)) !== JSON.stringify(identity)) throw new Error('Conversation changed.');
          return chunk;
        },
        async sendPrompt(target, prompt, clientCommandId = crypto.randomUUID(), options, attachments) {
          if (closed) throw new Error('Disconnected.');
          const receipt = await request<CompanionCommandReceipt>(host, 'prompt.submit', { target, text: prompt, clientCommandId, ...(options ? { options } : {}), ...(attachments?.length ? { attachments } : {}) });
          if (receipt.state === 'rejected') throw new PromptRejectedError('Prompt was rejected.');
          if (receipt.state !== 'accepted') throw new Error('Delivery is unresolved.');
        },
        async listModels(agentId) { return (await request<{ models: BackendModelOption[] }>(host, 'models.list', target(agentId))).models; },
        async listPlugins(agentId) { return (await request<{ plugins: BackendPluginSummary[] }>(host, 'plugins.list', target(agentId))).plugins; },
        async listSkills(agentId) { return (await request<{ skills: BackendSkillSummary[] }>(host, 'skills.list', target(agentId))).skills; },
        async selectModel(agentId, selection) { await request(host, 'agent.model.select', { target: target(agentId), ...selection }); },
        async changeGoal(target, objective) {
          if (closed) throw new Error('Disconnected.');
          await request(host, 'agent.goal.set', { target, objective });
        },
        async interrupt(agentId) { await request(host, 'agent.interrupt', target(agentId)); },
        async updateQueuedPrompt(target, promptId, action) { await request(host, `agent.queuedPrompt.${action}`, { target, promptId }); },
        async restartSession(agentId) { await request(host, 'agent.restart', target(agentId)); },
        async previewCloseSession(agentId) { return request(host, 'agent.close.preview', target(agentId)); },
        async closeSession(target, input) { await request(host, 'agent.close', { target, ...(input ? { input } : {}) }); },
        listBranches: (teamId, repositoryId) => request(host, 'repository.branches', { teamId, repositoryId }),
        githubRepositories: teamId => request(host, 'project.github.list', { teamId }),
        githubBranches: (teamId, repositoryId) => request(host, 'project.github.branches', { teamId, repositoryId }),
        async createProject(input, signal) { return created((await request<{ creationId: string }>(host, 'project.create', input)).creationId, signal); },
        // Worktree setup can outlast any single request: the laptop works on, the phone asks how it is going.
        async createChat(chat, signal) { return created((await request<{ creationId: string }>(host, 'agent.create', chat)).creationId, signal); },
        async createQuickChat(chat, signal) { return created((await request<{ creationId: string }>(host, 'agent.quickChat.create', chat)).creationId, signal); },
        async setBackend(agentId, backend) { await request(host, 'agent.backend.set', { target: target(agentId), backend }); },
        reviewSetup: (agentId, backend) => request(host, 'agent.review.setup', { target: target(agentId), ...(backend ? { backend } : {}) }),
        async startReview(target, input) {
          const result = await request<{ reviewerAgentId?: string | null }>(host, 'agent.review.start', { target, input });
          return result.reviewerAgentId ?? undefined;
        },
        async setApprovalPreset(agentId, preset) { await request(host, 'agent.approvalPreset.set', { target: target(agentId), preset }); },
        async setPermissionMode(agentId, mode) { await request(host, 'agent.permissionMode.set', { target: target(agentId), mode }); },
        async commandStatus(clientCommandId) { return (await request<{ state: CompanionCommandReceipt['state'] | 'notReceived' }>(host, 'command.status', { clientCommandId })).state; },
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
