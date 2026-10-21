import { PromptRejectedError } from '../agents/prompt-rejected';
import { product } from '@workspace/core/product';
import { CompanionNotifications } from './notifications';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import type { PrivateKey } from '@libp2p/interface';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { AccountRateLimits, Agent, AgentGitWorkflow, AppSnapshot, SourceBranch, SourceWorktree } from '@workspace/core/contracts';
import type { CompanionControl, CompanionControlResult, CompanionWorkspace } from '@workspace/core/companion-protocol';
import { companionWorkspaceOf } from '@workspace/core/companion-projection';
import { matchingBranchUpstream } from '@workspace/core/git-remote';
import { relayAddress } from '@workspace/core/companion-relay';
import { z } from 'zod';
import { CompanionGateway, type GatewayState } from './gateway';
import { CompanionOutboundConnector } from './connector';
import { ConversationSource } from './conversation-source';
import { warnMain } from '../log';
import { storePromptUploads } from './uploads';
import { readReviewSetup } from './review-setup';
import { CompanionProjectAcquisition } from './project-acquisition';
import { readConversationImage } from './images';
import { readConfiguredPairing } from './configured-pairing';

type Saved = { v: 1; identity: string; enabled: boolean; relayOrigin: string; relayPeerId: string; gateway: GatewayState };
const controlSchema = z.discriminatedUnion('action', [z.object({ action: z.literal('status') }).strict(),
  z.object({ action: z.literal('enable'), relayOrigin: z.string().max(500), relayPeerId: z.string().min(32).max(128) }).strict(),
  z.object({ action: z.literal('resume') }).strict(),
  z.object({ action: z.literal('disable') }).strict(), z.object({ action: z.literal('invite') }).strict(),
  z.object({ action: z.literal('decide'), pendingId: z.string().uuid(), approve: z.boolean() }).strict(),
  z.object({ action: z.literal('revoke'), peerId: z.string().min(1).max(128) }).strict()]);
export type CompanionBackendPort = {
  desktopFocused?(): Promise<boolean>;
  request<Result>(method: string, params?: unknown): Promise<Result>;
  onAccessChanged?: (enabled: boolean) => void;
};
type Relay = { origin: string; peerId: string };

/** The relay is deployment configuration: the operator sets it once and users only pair phones. */
function relayFromEnvironment(env: NodeJS.ProcessEnv): { relay: Relay | null; error?: string } {
  const packaged = typeof __APP_COMPANION_RELAY__ === 'undefined' ? undefined : __APP_COMPANION_RELAY__;
  const runtimeOrigin = env.APP_COMPANION_RELAY_URL?.trim() ?? '';
  const runtimePeerId = env.APP_COMPANION_RELAY_PEER_ID?.trim() ?? '';
  const hasRuntimeOverride = Boolean(runtimeOrigin || runtimePeerId);
  const origin = hasRuntimeOverride ? runtimeOrigin : packaged?.origin.trim() ?? '';
  const peerId = hasRuntimeOverride ? runtimePeerId : packaged?.peerId.trim() ?? '';
  if (!origin && !peerId) return { relay: null };
  try {
    relayAddress(origin, peerId);
    return { relay: { origin, peerId } };
  } catch { return { relay: null, error: 'APP_COMPANION_RELAY_URL must be a wss:// origin and APP_COMPANION_RELAY_PEER_ID the relay identity.' }; }
}

/** One service inside the owning daemon. No provider process or public local RPC listener. */
export class CompanionManager {
  private saved!: Saved;
  private key!: PrivateKey;
  private gateway!: CompanionGateway;
  private notifications?: CompanionNotifications;
  private notificationWork = Promise.resolve();
  private connector!: CompanionOutboundConnector;
  private writes = Promise.resolve();
  private controls = Promise.resolve();
  private ready: Promise<void> | null = null;
  private readonly conversations = new ConversationSource((agentId) => this.loadConversation(agentId));
  private readonly environment: ReturnType<typeof relayFromEnvironment>;
  constructor(private readonly directory: string, private readonly backend: CompanionBackendPort, private readonly env: NodeJS.ProcessEnv = process.env) {
    this.environment = relayFromEnvironment(env);
  }
  /** Explicit deployment choices take precedence over the bundled public relay. */
  private get relay(): Relay | null {
    if (this.environment.error) return null;
    if (this.environment.relay) return this.environment.relay;
    return this.saved.relayOrigin ? { origin: this.saved.relayOrigin, peerId: this.saved.relayPeerId } : product.companionRelay;
  }
  private readonly eventListeners = new Set<(event: AppBackendEvent) => void>();
  recordPrompt(agent: Agent, clientId: string) { return this.notifications?.recordPrompt(agent, clientId); }
  event(event: AppBackendEvent) {
    const desktopOrigin = this.notifications?.observe(event) === true;
    this.conversations.observe(event);
    if (this.saved?.enabled && this.notifications?.accepts(event)) {
      this.notificationWork = this.notificationWork.then(async () => {
        if (!this.saved.enabled) return;
        const notification = this.notifications!.create(event, await this.workspace());
        if (notification && this.saved.enabled) void this.gateway.notify(notification, async () => !desktopOrigin || !await this.backend.desktopFocused?.().catch(() => false)).catch(() => { warnMain('companion', 'push delivery unavailable'); });
      }).catch(() => { warnMain('companion', 'notification delivery unavailable'); });
    }
    for (const listener of this.eventListeners) listener(event);
  }
  async control(input: CompanionControl): Promise<CompanionControlResult> {
    const action = controlSchema.parse(input);
    await this.initialize();
    if (action.action === 'status') return { status: this.status() };
    const result = this.controls.then(async () => {
      let invitation;
      switch (action.action) {
        case 'enable':
          if (this.environment.relay) throw new Error('The relay is configured by the build or environment.');
          relayAddress(action.relayOrigin, action.relayPeerId);
          await this.persist((saved) => ({ ...saved, enabled: true, relayOrigin: action.relayOrigin, relayPeerId: action.relayPeerId }));
          await this.connector.start(action.relayOrigin, action.relayPeerId);
          break;
        case 'resume':
          await this.resume(); break;
        case 'disable':
          await this.persist((saved) => ({ ...saved, enabled: false })); await this.connector.stop(); this.conversations.clear(); break;
        case 'invite':
          await this.resume();
          if (!this.connector.connected) throw new Error('Relay is not connected.');
          invitation = this.gateway.invite();
          if (!await this.connector.advertise()) {
            this.gateway.discardInvitation(invitation.code);
            throw new Error('Could not register the pairing code. Check the relay connection and try again.');
          }
          break;
        case 'decide': await this.gateway.decide(action.pendingId, action.approve); await this.connector.advertise(); break;
        case 'revoke': await this.gateway.revoke(action.peerId); await this.connector.advertise(); break;
      }
      return { status: this.status(), ...(invitation ? { invitation } : {}) };
    });
    this.controls = result.then(() => {}, () => {});
    return result;
  }
  private async resume() {
    if (!this.relay) throw new Error('Mobile access is not configured.');
    if (this.saved.enabled) return;
    const { origin, peerId } = this.relay;
    await this.persist((saved) => ({ ...saved, enabled: true, relayOrigin: origin, relayPeerId: peerId }));
    await this.connector.start(origin, peerId);
  }
  async stop() {
    await this.ready?.catch(() => {});
    await this.connector?.stop();
    this.conversations.clear();
    this.backend.onAccessChanged?.(false);
  }
  private status() {
    return { configured: Boolean(this.relay), enabled: this.saved.enabled, connected: this.connector.connected, hostId: this.gateway.hostId,
      relayOrigin: this.relay?.origin ?? '', devices: this.gateway.grants, pending: this.gateway.pendingRequests,
      ...(this.environment.error ? { error: this.environment.error } : {}) };
  }
  private initialize() { return this.ready ??= this.load(); }
  private async load() {
    const pairing = await readConfiguredPairing(this.env);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let saved: Saved;
    try {
      saved = JSON.parse(await readFile(path.join(this.directory, 'state.json'), 'utf8')) as Saved;
      if (saved.v !== 1 || typeof saved.enabled !== 'boolean' || !Array.isArray(saved.gateway?.grants) || !saved.gateway?.commands) throw new Error('Invalid companion state.');
      this.key = privateKeyFromProtobuf(Buffer.from(saved.identity, 'base64'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Companion identity cannot be loaded. Restore it or explicitly reset pairing.');
      this.key = await generateKeyPair('Ed25519');
      saved = { v: 1, identity: Buffer.from(privateKeyToProtobuf(this.key)).toString('base64'), enabled: false, relayOrigin: '', relayPeerId: '', gateway: { grants: [], commands: {} } };
    }
    this.saved = saved;
    this.notifications = new CompanionNotifications(peerIdFromPrivateKey(this.key).toString());
    const projects = new CompanionProjectAcquisition(this.backend);
    this.gateway = new CompanionGateway(peerIdFromPrivateKey(this.key).toString(), saved.gateway, {
      gitDiff: (agentId, target) => this.backend.request(backendMethods.agentGitDiffGet, { agentId, target, _clientId: 'companion-read' }),
      readImage: (agentId, filePath) => readConversationImage(() => this.backend.request(backendMethods.agentFilePreview, { agentId, filePath, _clientId: 'companion-read' })),
      githubRepositories: remote => projects.list(remote),
      githubBranches: (repositoryId, remote) => projects.branches(repositoryId, remote),
      createProject: (input, remote, authorize) => projects.create(input, remote, authorize),
      push: (peerId, registration, notification) => this.connector.push(peerId, registration, notification),
      onEvent: (listener) => { this.eventListeners.add(listener); return () => { this.eventListeners.delete(listener); }; },
      workspace: () => this.workspace(),
      usage: async () => {
        const { snapshot } = await this.backend.request<{ snapshot: AppSnapshot }>(backendMethods.snapshotGet, { _clientId: 'companion-read' });
        const providers = (snapshot.providerConnections ?? []).filter(provider => provider.installed && provider.connected && provider.enabled !== false
          && provider.backend !== 'antigravity' && !(provider.authentication?.kind === 'codex' && provider.authentication.state.account?.type === 'apiKey'));
        return Promise.all(providers.map(async ({ backend }) => {
          try {
            const limits = await this.backend.request<AccountRateLimits | null>(backendMethods.providerUsageGet, { backend });
            return { backend, limits: limits ? { primary: limits.primary, secondary: limits.secondary } : null, failed: false };
          } catch { return { backend, limits: null, failed: true }; }
        }));
      },
      markRead: async (agentId, revision) => { await this.backend.request(backendMethods.agentMarkRead, { agentId, revision, _clientId: 'companion-read' }); },
      loadOlderHistory: (agentId) => this.backend.request(backendMethods.agentConversationHistoryLoadOlder, { agentId, _clientId: 'companion-read' }),
      readConversationContent: (agentId, input) => this.backend.request(backendMethods.agentConversationContentRead, { agentId, input, _clientId: 'companion-read' }),
      synchronize: (agentId, checkpoint) => this.conversations.synchronize(agentId, checkpoint),
      conversation: async (agentId) => {
        try { return await this.conversations.read(agentId); }
        catch (error) { warnMain('companion', 'conversation unavailable', { agentId, message: error instanceof Error ? error.message : String(error) }); throw error; }
      },
      submit: async (target, prompt, clientId, options, uploads) => {
        const attachments = uploads ? await storePromptUploads(this.directory, uploads).catch(() => { throw new PromptRejectedError('Attachments could not be stored.'); }) : undefined;
        const { followUpBehavior = 'steer', ...composerOptions } = options ?? {};
        const promptOptions = options || attachments ? { ...composerOptions, ...(attachments ? { attachments } : {}) } : undefined;
        const method = followUpBehavior === 'queue' ? backendMethods.agentPromptSend : backendMethods.agentPromptSteer;
        await this.backend.request(method, { agentId: target.agentId, expectedSessionId: target.sessionId, prompt, ...(followUpBehavior === 'steer' ? { startIfIdle: true } : {}), ...(promptOptions ? { options: promptOptions } : {}), _clientId: clientId });
      },
      respondRequest: async (response) => { await this.backend.request(backendMethods.agentRequestRespond, { response, _clientId: 'companion-write' }); },
      updateQueuedPrompt: async (target, promptId, action) => {
        await this.backend.request(action === 'steer' ? backendMethods.agentQueuedPromptSteer : backendMethods.agentQueuedPromptDelete,
          { agentId: target.agentId, promptId, expectedSessionId: target.sessionId, _clientId: 'companion-write' });
      },
      models: (agentId) => this.backend.request<unknown[]>(backendMethods.agentModelsList, { agentId, _clientId: 'companion-read' }),
      plugins: (agentId) => this.backend.request(backendMethods.agentPluginsList, { agentId, _clientId: 'companion-read' }),
      skills: (agentId) => this.backend.request(backendMethods.agentSkillsList, { agentId, _clientId: 'companion-read' }),
      changeGoal: async (agentId, objective) => {
        if (objective === null) await this.backend.request(backendMethods.agentGoalClear, { agentId, _clientId: 'companion-write' });
        else await this.backend.request(backendMethods.agentGoalUpdate, { agentId, objective, _clientId: 'companion-write' });
      },
      interrupt: async (agentId) => { await this.backend.request(backendMethods.agentInterrupt, { agentId, _clientId: 'companion-write' }); },
      restart: async (agentId) => { await this.backend.request(backendMethods.agentConversationReset, { agentId, _clientId: 'companion-write' }); },
      branches: (repoPath, remoteConnectionId) => this.backend.request<SourceBranch[]>(backendMethods.sourceBranchesList, { repoPath, ...(remoteConnectionId ? { remoteConnectionId } : {}), _clientId: 'companion-read' }),
      createChat: async (chat) => {
        const remote = chat.remoteConnectionId ? { remoteConnectionId: chat.remoteConnectionId } : {};
        let folder = chat.repositoryRoot;
        if (!chat.worktree) {
          // Resolve both explicit and default branches at creation: primary worktrees
          // can be on any branch, and checkouts can move after the menu was opened.
          const branches = await this.backend.request<SourceBranch[]>(backendMethods.sourceBranchesList, { repoPath: chat.repositoryRoot, ...remote, _clientId: 'companion-read' });
          const branch = chat.existingBranch
            ? branches.find(candidate => candidate.name === chat.existingBranch)
            : branches.find(candidate => candidate.isDefault);
          if (!branch) throw new Error(chat.existingBranch ? 'Branch not found. Refresh the branch list.' : 'Default branch not found. Refresh the branch list.');
          folder = branch.worktreePath ?? (await this.backend.request<SourceWorktree>(backendMethods.sourceWorktreeCreate, {
            input: { repoPath: chat.repositoryRoot, branchName: branch.name, ...remote }, _clientId: 'companion-write',
          })).path;
        } else if (chat.worktree) {
          const worktree = await this.backend.request<SourceWorktree>(backendMethods.sourceWorktreeCreate, { input: { repoPath: chat.repositoryRoot, branchName: chat.worktree.branchName,
            ...(chat.defaultBranch ? { baseBranch: chat.defaultBranch } : {}), ...remote }, _clientId: 'companion-write' });
          folder = worktree.path;
        }
        const result = await this.backend.request<AppSnapshot>(backendMethods.agentCreate, { input: { name: null, folder, backend: chat.backend, sourceRepositoryName: chat.repositoryName, teamId: chat.teamId }, _clientId: 'companion-write' });
        const created = result.agents.find((agent) => agent.id === result.activeAgentId && agent.teamId === chat.teamId && agent.folder === folder);
        if (!created) throw new Error('The chat was not created.');
        return created.id;
      },
      createQuickChat: async ({ teamId, backend }) => {
        const result = await this.backend.request<AppSnapshot>(backendMethods.agentQuickChatCreate, { input: { teamId, backend }, _clientId: 'companion-write' });
        const created = result.agents.find((agent) => agent.id === result.activeAgentId && agent.teamId === teamId && agent.sessionKind === 'quickChat');
        if (!created) throw new Error('The chat was not created.');
        return created.id;
      },
      setBackend: async (agentId, backend) => { await this.backend.request(backendMethods.agentUpdate, { input: { id: agentId, backend }, _clientId: 'companion-write' }); },
      closePreview: async (agentId) => {
        const workspace = await this.workspace();
        const agent = workspace.agents.find((agent) => agent.id === agentId);
        const location = (teamId: string | undefined) => workspace.teams.find((team) => team.id === teamId)?.remoteConnectionId ?? 'local';
        const plain = { isLinkedWorktree: false, branch: null, upstream: null, hasChanges: false };
        if (!agent) throw new Error('Agent not found.');
        if (agent.folder && workspace.agents.some((other) => other.id !== agentId && other.folder === agent.folder && location(other.teamId) === location(agent.teamId))) return plain;
        try {
          const workflow = await this.backend.request<AgentGitWorkflow>(backendMethods.agentGitWorkflowGet, { agentId, _clientId: 'companion-read' });
          return { isLinkedWorktree: workflow.isLinkedWorktree, branch: workflow.branch ?? null, upstream: matchingBranchUpstream(workflow.branch, workflow.upstream, workflow.baseBranch) ?? null, hasChanges: workflow.files.length > 0 };
        } catch { return plain; } // Non-Git or unavailable workspaces can still close while keeping all files.
      },
      close: async (agentId, input) => { await this.backend.request(backendMethods.agentDelete, { agentId, ...(input ? { input } : {}), _clientId: 'companion-write' }); },
      setApprovalPreset: async (agentId, preset) => { await this.backend.request(backendMethods.agentApprovalPresetUpdate, { agentId, preset, _clientId: 'companion-write' }); },
      setPermissionMode: async (agentId, mode) => { await this.backend.request(backendMethods.agentPermissionModeUpdate, { agentId, mode, _clientId: 'companion-write' }); },
      startReview: async (agentId, input) => {
        const snapshot = await this.backend.request<AppSnapshot>(backendMethods.agentCodeReviewStart, { agentId, input, _clientId: 'companion-write' });
        return snapshot.agents.find(agent => agent.codeReview?.targetAgentId === agentId && agent.codeReview.status !== 'finished')?.codeReview?.reviewerAgentId;
      },
      reviewSetup: (agentId, backend) => readReviewSetup(this.backend, peerIdFromPrivateKey(this.key).toString(), agentId, backend),
      selectModel: async (agentId, modelSelection) => { await this.backend.request(backendMethods.agentUpdate, { input: { id: agentId, modelSelection }, _clientId: 'companion-write' }); },
      save: (gateway) => this.persist((saved) => ({ ...saved, gateway })),
      revoked: (peerId) => this.connector.revoke(peerId),
    }, Date.now, pairing?.hostId === peerIdFromPrivateKey(this.key).toString() ? pairing.code : undefined);
    this.connector = new CompanionOutboundConnector(this.key, this.gateway);
    await this.persist();
    const relay = this.relay;
    this.backend.onAccessChanged?.(saved.enabled && Boolean(relay));
    if (saved.enabled && relay) await this.connector.start(relay.origin, relay.peerId);
  }
  private async loadConversation(agentId: string): Promise<void> {
    await this.backend.request(backendMethods.agentConversationLoad, { agentId, _clientId: 'companion-read' });
  }
  private async workspace(): Promise<CompanionWorkspace> {
    const { snapshot } = await this.backend.request<{ snapshot: AppSnapshot }>(backendMethods.snapshotGet, { _clientId: 'companion-read' });
    return companionWorkspaceOf(snapshot);
  }
  private persist(update: (saved: Saved) => Saved = (saved) => saved) {
    const write = this.writes.then(async () => {
      const next = update(this.saved);
      const content = JSON.stringify(next);
      const file = path.join(this.directory, 'state.json'); const temporary = `${file}.${randomUUID()}.tmp`;
      const handle = await open(temporary, 'wx', 0o600);
      try {
        try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, file);
        if (process.platform !== 'win32') {
          const directory = await open(this.directory, 'r');
          try { await directory.sync(); } finally { await directory.close(); }
        }
        const accessChanged = this.saved.enabled !== next.enabled;
        this.saved = next;
        if (accessChanged) this.backend.onAccessChanged?.(next.enabled && Boolean(this.relay));
      } finally { await unlink(temporary).catch(() => {}); }
    });
    this.writes = write.catch(() => {});
    return write;
  }
}
