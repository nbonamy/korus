import { PromptRejectedError } from './companion-port';
import { companionPushAuthorizationMessage, type CompanionNotification } from '@workspace/core/companion-notification';
import { CompanionOperationDenied, createCompanionStream, type CompanionDisconnectReason } from './companion-stream';
import { ConversationCache } from './conversation-cache';
import { companionTarget, companionUpdatesProtocol, isConversationReset } from '@workspace/core/companion-protocol';
import type { BackendModelOption, BackendSkillSummary, BackendPluginSummary, ProviderConversationFrame } from '@workspace/core/contracts';
import type { ConversationContentChunk } from '@workspace/core/contracts/conversation';
import type { CompanionChatCreation, CompanionCommandReceipt, CompanionWorkspace } from '@workspace/core/companion-protocol';
import type { CompanionConversation, CompanionSession } from './companion-port';
import { connectionDiagnostic } from './connection-diagnostics';
import type { PairedLaptop, RelayNetwork } from './relay-network';

const pushAuthorizationLifetimeMs = 30 * 86_400_000;
/** Worktree setup can outlast any single request: the laptop works on, the phone asks how it is going. */
const creationTimeoutMs = 600_000;
const creationPollMs = 1_000;

type CacheRequest = ConstructorParameters<typeof ConversationCache>[0];
type CacheChanged = ConstructorParameters<typeof ConversationCache>[1];

/** One conversation cache per laptop, shared by successive sessions; only the newest session receives its changes. */
export class ConversationCaches {
  private readonly caches = new Map<string, ConversationCache>();
  private readonly owners = new Map<string, symbol>();

  peek(target: Parameters<ConversationCache['peek']>[0]) { return this.caches.get(target.hostId)?.peek(target); }
  updates(target: Parameters<ConversationCache['updates']>[0], since: Parameters<ConversationCache['updates']>[1]) { return this.caches.get(target.hostId)?.updates(target, since) ?? null; }

  /** Makes the caller the cache's owner. A session that was replaced can no longer disconnect or feed it. */
  bind(hostId: string, request: CacheRequest, changed: CacheChanged) {
    const owner = Symbol(); this.owners.set(hostId, owner);
    const cache = this.caches.get(hostId) ?? new ConversationCache(request, changed);
    cache.reconnect(request, changed);
    this.caches.set(hostId, cache);
    const owns = () => this.owners.get(hostId) === owner;
    return { cache, owns, release: () => { if (owns()) { cache.disconnect(); this.owners.delete(hostId); } } };
  }

  forget(hostId: string) { this.caches.get(hostId)?.close(); this.caches.delete(hostId); this.owners.delete(hostId); }
  closeAll() { for (const cache of this.caches.values()) cache.close(); this.caches.clear(); }
}

/** One live connection to one paired laptop: the update channel, the conversation cache and every call the app makes. */
export function createRelaySession(deps: { host: PairedLaptop; network: RelayNetwork; caches: ConversationCaches; onClosed(session: CompanionSession): void }): CompanionSession {
  const { host, network, caches, onClosed } = deps;
  const call = <Result>(method: string, args: unknown) => network.request<Result>(host, method, args);
  let closed = false; let workspace: CompanionWorkspace = { teams: [], agents: [] };
  const listeners = new Set<(reason?: string) => void>();
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
  const notify = (frame: CompanionConversation | null = null) => { if (!closed && ownsCache()) for (const listener of updates) listener(workspace, frame); };
  const failed = (reason?: CompanionDisconnectReason) => {
    if (closed) return;
    if (reason === 'resume-timeout') network.retireRoutes(host);
    close(); for (const listener of listeners) listener(reason);
  };
  const cacheRequest: ConstructorParameters<typeof ConversationCache>[0] = (method, target, checkpoint) =>
    method === 'conversation.subscribe' && workspace.conversationSync
      ? channel.request('conversation.synchronize', { target, checkpoint: checkpoint ?? null })
      : channel.request(method, target);
  const cacheChanged = (frame: CompanionConversation) => notify(frame);
  const { cache, owns: ownsCache, release: releaseCache } = caches.bind(host.hostId, cacheRequest, cacheChanged);
  const channel = createCompanionStream(() => network.openStream(host, companionUpdatesProtocol), (update) => {
    if (closed || !ownsCache()) return;
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
  const close = () => { if (closed) return; connectionDiagnostic('session.close'); closed = true; channel.close(); releaseCache(); onClosed(session); };
  async function created(creationId: string, signal?: AbortSignal): Promise<string> {
    let failures = 0;
    for (const deadline = Date.now() + creationTimeoutMs; Date.now() < deadline;) {
      await new Promise<void>((resolve) => setTimeout(resolve, creationPollMs));
      if (closed || signal?.aborted) throw new Error('Disconnected.');
      const result = await call<CompanionChatCreation>('agent.create.status', { creationId }).catch((error: unknown) => { if (++failures > 3) throw error; return null; });
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
      await channel.setActive(next);
      // Presence enables APNs while hidden, but workspace reads must not delay
      // foreground recovery or block the selected conversation's live stream.
      if (supportsNotifications && !closed) {
        if (next) void read().then(() => notify()).catch(() => {});
        else await read();
      }
    },
    getWorkspace: read,
    createTeam: async name => (await call<{ teamId: string }>('team.create', { name })).teamId,
    gitDiff: (agentId, scope) => call('agent.git.diff', { target: target(agentId), scope }),
    readImage: (agentId, path) => call('conversation.image.read', { target: target(agentId), path }),
    getUsage: () => call('usage.get', {}),
    async registerPush(registration) {
      if (!registration) { await call('notifications.register', null); return; }
      const signer = await network.signer();
      const expiresAt = Date.now() + pushAuthorizationLifetimeMs;
      const signature = await signer.sign(companionPushAuthorizationMessage(host.relayPeerId, host.hostId, signer.peerId, registration, expiresAt));
      await call('notifications.register', { ...registration, authorization: { expiresAt, signature } });
    },
    onNotification(listener) { notifications.add(listener); return () => { notifications.delete(listener); }; },
    async markRead(agentId, revision) { await call('conversation.read', { target: target(agentId), revision }); },
    async respondRequest(reply) { await call('agent.request.respond', reply); },
    deselectConversation() { void cache.select(null); },
    isConversationCurrent(agentId) { return cache.current(target(agentId)); },
    cachedConversation(agentId) { return cache.peek(target(agentId)); },
    async loadConversation(agentId) { return cache.select(agentId ? target(agentId) : null); },
    async loadOlderHistory(agentId) {
      const identity = target(agentId);
      const page = await call<{ frame: ProviderConversationFrame; hasOlder: boolean }>('conversation.loadOlder', identity);
      if (closed || JSON.stringify(target(agentId)) !== JSON.stringify(identity)) throw new Error('Conversation changed.');
      cache.receive(page.frame);
      const returned = page.frame;
      const frame = cache.peek(identity) ?? (isConversationReset(returned) ? returned : null);
      if (!frame) throw new Error('Conversation history needs to be reloaded.');
      return { hasOlder: page.hasOlder, frame };
    },
    async readConversationContent(agentId, input) {
      const identity = target(agentId);
      if (closed) throw new Error('Disconnected.');
      const chunk = await call<ConversationContentChunk>('conversation.content.read', { target: identity, input });
      if (closed || JSON.stringify(target(agentId)) !== JSON.stringify(identity)) throw new Error('Conversation changed.');
      return chunk;
    },
    async sendPrompt(target, prompt, clientCommandId = crypto.randomUUID(), options, attachments) {
      if (closed) throw new Error('Disconnected.');
      // Steer is also the default on released desktops, whose strict schema predates this option.
      const { followUpBehavior, ...composerOptions } = options ?? {};
      const wireOptions = options ? { ...composerOptions, ...(followUpBehavior === 'queue' ? { followUpBehavior } : {}) } : undefined;
      const receipt = await call<CompanionCommandReceipt>('prompt.submit', { target, text: prompt, clientCommandId, ...(wireOptions ? { options: wireOptions } : {}), ...(attachments?.length ? { attachments } : {}) });
      if (receipt.state === 'rejected') throw new PromptRejectedError('Prompt was rejected.');
      if (receipt.state !== 'accepted') throw new Error('Delivery is unresolved.');
    },
    async listModels(agentId) { return (await call<{ models: BackendModelOption[] }>('models.list', target(agentId))).models; },
    async listPlugins(agentId) { return (await call<{ plugins: BackendPluginSummary[] }>('plugins.list', target(agentId))).plugins; },
    async listSkills(agentId) { return (await call<{ skills: BackendSkillSummary[] }>('skills.list', target(agentId))).skills; },
    async selectModel(agentId, selection) { await call('agent.model.select', { target: target(agentId), ...selection }); },
    async changeGoal(target, objective) {
      if (closed) throw new Error('Disconnected.');
      await call('agent.goal.set', { target, objective });
    },
    async interrupt(agentId) { await call('agent.interrupt', target(agentId)); },
    async updateQueuedPrompt(target, promptId, action) { await call(`agent.queuedPrompt.${action}`, { target, promptId }); },
    async restartSession(agentId) { await call('agent.restart', target(agentId)); },
    async previewCloseSession(agentId) { return call('agent.close.preview', target(agentId)); },
    async closeSession(target, input) { await call('agent.close', { target, ...(input ? { input } : {}) }); },
    listBranches: (teamId, repositoryId) => call('repository.branches', { teamId, repositoryId }),
    localRepositories: teamId => call('project.local.list', { teamId }),
    localBranches: (teamId, repositoryId) => call('project.local.branches', { teamId, repositoryId }),
    async duplicateAgent(target, backend) { return (await call<{ agentId: string }>('agent.duplicate', { target, backend })).agentId; },
    async renameAgent(target, name) { await call('agent.rename', { target, name }); },
    githubRepositories: teamId => call('project.github.list', { teamId }),
    githubBranches: (teamId, repositoryId) => call('project.github.branches', { teamId, repositoryId }),
    async createProject(input, signal) { return created((await call<{ creationId: string }>('project.create', input)).creationId, signal); },
    // Worktree setup can outlast any single request: the laptop works on, the phone asks how it is going.
    async createChat(chat, signal) { return created((await call<{ creationId: string }>('agent.create', chat)).creationId, signal); },
    async createQuickChat(chat, signal) { return created((await call<{ creationId: string }>('agent.quickChat.create', chat)).creationId, signal); },
    async setBackend(agentId, backend) { await call('agent.backend.set', { target: target(agentId), backend }); },
    reviewSetup: (agentId, backend) => call('agent.review.setup', { target: target(agentId), ...(backend ? { backend } : {}) }),
    async startReview(target, input) {
      const result = await call<{ reviewerAgentId?: string | null }>('agent.review.start', { target, input });
      return result.reviewerAgentId ?? undefined;
    },
    async setApprovalPreset(agentId, preset) { await call('agent.approvalPreset.set', { target: target(agentId), preset }); },
    async setPermissionMode(agentId, mode) { await call('agent.permissionMode.set', { target: target(agentId), mode }); },
    async commandStatus(clientCommandId) { return (await call<{ state: CompanionCommandReceipt['state'] | 'notReceived' }>('command.status', { clientCommandId })).state; },
    onDisconnect(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    onUpdate(listener) { updates.add(listener); return () => updates.delete(listener); },
    close,
  };

  return session;
}
