import { hostname } from 'node:os';
import { GuestConversationGateway } from '../sharing/guest-gateway';
import type { GuestConversationGrant } from '../sharing/conversation-shares';
import type { ConversationShareRoute } from '@workspace/core/conversation-sharing';
import type { ShareRoutingStatus } from '@workspace/core/conversation-share-relay';
import { PromptRejectedError } from '../agents/prompt-rejected';
import { product } from '@workspace/core/product';
import { CompanionNotifications } from './notifications';
import { CompanionLiveActivities, type SavedLiveActivities } from './live-activities';
import { chmod, lstat, mkdir, open, readFile, rename, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { UnchangedWrites } from '../persistence/unchanged-writes';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import type { PrivateKey } from '@libp2p/interface';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { AccountRateLimits, Agent, AppSnapshot, CreatedAgentResult, SourceBranch, SourceWorktree } from '@workspace/core/contracts';
import { companionQuotaProviders, companionTarget, sameCompanionTarget, type CompanionControl, type CompanionControlResult, type CompanionTarget, type CompanionWorkspace } from '@workspace/core/companion-protocol';
import { companionWorkspaceOf } from '@workspace/core/companion-projection';
import { defaultTeamColor } from '@workspace/core/team-colors';
import { relayAddress } from '@workspace/core/companion-relay';
import { z } from 'zod';
import { CompanionGateway, type GatewayState } from './gateway';
import { CompanionOutboundConnector } from './connector';
import { ConversationSource } from './conversation-source';
import { warnMain } from '../log';
import { systemHostName } from './host-name';
import { setTimeout as delay } from 'node:timers/promises';
import { storePromptUploads } from './uploads';
import { readReviewSetup, readReviewSession, actOnReview } from './review-setup';
import { CompanionProjectAcquisition } from './project-acquisition';
import { resolveRepositorySession } from '../projects/repository-session';
import { connectionAccount, supportsSubscriptionQuota } from '@workspace/core/provider-capabilities';
import { readConversationImage } from './images';
import { readConfiguredPairing } from './configured-pairing';

type Saved = { v: 1; identity: string; enabled: boolean; relayOrigin: string; relayPeerId: string; gateway: GatewayState; activities?: SavedLiveActivities };
const controlSchema = z.discriminatedUnion('action', [z.object({ action: z.literal('status') }).strict(),
  z.object({ action: z.literal('enable'), relayOrigin: z.string().max(500), relayPeerId: z.string().min(32).max(128) }).strict(),
  z.object({ action: z.literal('resume') }).strict(),
  z.object({ action: z.literal('disable') }).strict(), z.object({ action: z.literal('invite') }).strict(),
  z.object({ action: z.literal('decide'), pendingId: z.string().uuid(), approve: z.boolean() }).strict(),
  z.object({ action: z.literal('revoke'), peerId: z.string().min(1).max(128) }).strict()]);
export type CompanionBackendPort = {
  proposeGuest?(handle: string, identity: string, name: string, input: import('@workspace/core/conversation-sharing').GuestPromptInput): Promise<import('@workspace/core/conversation-sharing').GuestProposal>;
  guestProposals?(handle: string, identity: string): Promise<import('@workspace/core/conversation-sharing').GuestProposalState>;
  withdrawGuest?(handle: string, identity: string, proposalId: string): Promise<void>;
  authorizeGuest?(handle: string, credential: string): Promise<GuestConversationGrant>;
  guestCount?(handle: string, count: number, guests?: import('@workspace/core/guest-conversation').GuestParticipant[]): void;
  desktopFocused?(): Promise<boolean>;
  request<Result>(method: string, params?: unknown): Promise<Result>;
  onAccessChanged?: (enabled: boolean) => void;
};
type Relay = { origin: string; peerId: string };

/** The relay is deployment configuration: the operator sets it once and users only pair phones. */
export function relayFromEnvironment(env: NodeJS.ProcessEnv): { relay: Relay | null; error?: string } {
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
  /** What the person calls this computer, read once; phones pairing before it is known get no name from us. */
  private hostName = '';
  private gateway!: CompanionGateway;
  private guestGateway?: GuestConversationGateway;
  private notifications?: CompanionNotifications;
  private activities?: CompanionLiveActivities;
  private activityTimer?: ReturnType<typeof setTimeout>;
  private activityHeartbeat?: ReturnType<typeof setInterval>;
  private activityRefreshedAt = 0;
  private notificationWork = Promise.resolve();
  private connector!: CompanionOutboundConnector;
  private writes = Promise.resolve();
  private controls = Promise.resolve();
  private ready: Promise<void> | null = null;
  private shareRoutes: ConversationShareRoute[] = [];
  private shareStatus: ShareRoutingStatus = 'unavailable';
  private readonly shareListeners = new Set<(status: ShareRoutingStatus) => void>();
  private transportRelay = '';
  onShareRoutingStatus(listener: (status: ShareRoutingStatus) => void) {
    this.shareListeners.add(listener); return () => { this.shareListeners.delete(listener); };
  }
  private setShareStatus(status: ShareRoutingStatus) {
    if (this.shareRoutes.some(route => !this.matchesRelay(route))) status = 'unavailable';
    this.shareStatus = status;
    for (const listener of this.shareListeners) listener(status);
  }
  private matchesRelay(route: ConversationShareRoute) {
    return route.ownerId === peerIdFromPrivateKey(this.key).toString()
      && route.relay.origin === this.relay?.origin && route.relay.peerId === this.relay?.peerId;
  }
  async updateShareRoutes(routes: ConversationShareRoute[]): Promise<ShareRoutingStatus> {
    await this.initialize();
    const work = this.controls.then(async () => {
      const changed = JSON.stringify(this.shareRoutes) !== JSON.stringify(routes);
      this.shareRoutes = routes;
      if (this.saved.enabled || this.shareRoutes.some(route => this.matchesRelay(route))) {
        const started = await this.startTransport();
        if (!started && changed) await this.connector.advertise();
      } else if (this.transportRelay) {
        // Withdraw while still connected; lease expiry covers a disconnected owner.
        await this.connector.advertise();
        await this.connector.stop(); this.transportRelay = '';
      }
      if (routes.some(route => !this.matchesRelay(route))) this.setShareStatus('unavailable');
      return this.shareStatus;
    });
    this.controls = work.then(() => {}, () => {});
    return work;
  }
  private async startTransport(): Promise<boolean> {
    const relay = this.relay;
    if (!relay) return false;
    const key = JSON.stringify(relay);
    if (this.transportRelay === key) return false;
    await this.connector.start(relay.origin, relay.peerId);
    this.transportRelay = key;
    return true;
  }
  private readonly conversations = new ConversationSource((agentId) => this.loadConversation(agentId));
  /** Guest sharing still reads native provider frames. */
  private readonly environment: ReturnType<typeof relayFromEnvironment>;
  private readonly directory: string;
  constructor(private readonly home: string, private readonly provider: CompanionBackendPort, private readonly env: NodeJS.ProcessEnv = process.env) {
    this.directory = path.join(home, 'companion');
    this.environment = relayFromEnvironment(env);
  }
  /** Explicit deployment choices take precedence over the bundled public relay. */
  private get relay(): Relay | null {
    if (this.environment.error) return null;
    if (this.environment.relay) return this.environment.relay;
    return this.saved.relayOrigin ? { origin: this.saved.relayOrigin, peerId: this.saved.relayPeerId } : product.companionRelay;
  }
  private readonly eventListeners = new Set<(event: AppBackendEvent) => void>();
  event(event: AppBackendEvent) {
    this.scheduleActivity();
    const notifications = this.notifications?.capture(event) ?? [];
    this.conversations.observe(event);
    for (const action of notifications) if (this.saved?.enabled) {
      // Let visible clients acknowledge the result before creating an alert. Each
      // grace starts at capture time, so a burst does not add one delay per agent.
      const ready = action.event.type === 'agent.updated' ? Promise.resolve() : delay(500);
      this.notificationWork = this.notificationWork.then(async () => {
        await ready;
        if (!this.saved.enabled) return;
        const notification = this.notifications!.create(action.event, await this.workspace(), action.revision);
        if (notification && notification.kind !== 'read' && await this.desktopIsViewing(notification.target)) return;
        if (notification && this.saved.enabled) void this.gateway.notify(notification).catch(() => { warnMain('companion', 'push delivery unavailable'); });
      }).catch(() => { warnMain('companion', 'notification delivery unavailable'); });
    }
    for (const listener of this.eventListeners) listener(event);
  }
  private scheduleActivity() {
    if (!this.activities || !this.saved.enabled || this.activityTimer) return;
    this.activityTimer = setTimeout(() => {
      this.activityTimer = undefined; this.activityRefreshedAt = Date.now();
      void this.activities?.refresh().catch(() => { warnMain('companion', 'Live Activity update unavailable'); });
    }, Math.max(0, 15_000 - (Date.now() - this.activityRefreshedAt)));
    this.activityTimer.unref();
  }
  private async desktopIsViewing(target: CompanionTarget): Promise<boolean> {
    try {
      if (!await this.provider.desktopFocused?.()) return false;
      const { snapshot } = await this.provider.request<{ snapshot: AppSnapshot }>(backendMethods.snapshotGet, { _clientId: 'desktop' });
      const agent = snapshot.agents.find(agent => agent.id === snapshot.activeAgentId);
      const team = snapshot.teams.find(team => team.id === snapshot.activeTeamId && team.id === agent?.teamId);
      if (!agent || !team) return false;
      return sameCompanionTarget(companionTarget(target.hostId, team, agent), target);
    } catch { return false; }
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
          await this.startTransport();
          break;
        case 'resume':
          await this.resume(); break;
        case 'disable':
          for (const grant of this.gateway.grants) await this.activities?.register(grant.peerId, null);
          await this.persist((saved) => ({ ...saved, enabled: false })); this.connector.disablePhone();
          if (this.shareRoutes.some(route => this.matchesRelay(route))) await this.connector.advertise();
          else { await this.connector.stop(); this.transportRelay = ''; }
          this.conversations.clear(); break;
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
        case 'revoke': await this.activities?.register(action.peerId, null); await this.gateway.revoke(action.peerId); await this.connector.advertise(); break;
      }
      return { status: this.status(), ...(invitation ? { invitation } : {}) };
    });
    this.controls = result.then(() => {}, () => {});
    return result;
  }
  /** Reuse the protected endpoint identity without enabling access or minting phone grants. */
  async shareEndpoint(): Promise<{ ownerId: string; relay: Relay } | null> {
    await this.initialize();
    const relay = this.relay;
    return relay ? { ownerId: peerIdFromPrivateKey(this.key).toString(), relay } : null;
  }
  private async resume() {
    if (!this.relay) throw new Error('Mobile access is not configured.');
    if (this.saved.enabled) return;
    const { origin, peerId } = this.relay;
    await this.persist((saved) => ({ ...saved, enabled: true, relayOrigin: origin, relayPeerId: peerId }));
    await this.startTransport();
  }
  async stop() {
    await this.ready?.catch(() => {});
    clearTimeout(this.activityTimer); clearInterval(this.activityHeartbeat);
    await this.connector?.stop(); this.transportRelay = '';
    this.guestGateway?.close();
    this.conversations.clear();
    this.provider.onAccessChanged?.(false);
  }
  private status() {
    return { configured: Boolean(this.relay), enabled: this.saved.enabled, connected: this.connector.connected, hostId: this.gateway.hostId,
      relayOrigin: this.relay?.origin ?? '', devices: this.gateway.grants, pending: this.gateway.pendingRequests,
      ...(this.environment.error ? { error: this.environment.error } : {}) };
  }
  private initialize() { return this.ready ??= this.load(); }
  private async load() {
    const pairing = await readConfiguredPairing(this.env);
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    let saved: Saved;
    let migrated = false;
    try {
      const read = async (file: string): Promise<Saved> => {
        const stats = await lstat(file);
        if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 32 * 1024 * 1024) throw new Error('Invalid companion state file.');
        await chmod(file, 0o600);
        return JSON.parse(await readFile(file, 'utf8')) as Saved;
      };
      try { saved = await read(path.join(this.home, 'companions.json')); }
      // TODO(remove-after: 2026-11-30): Remove the legacy fallback and migrated-source retirement below. https://github.com/nbonamy/korus/issues/74
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        saved = await read(path.join(this.directory, 'state.json'));
        migrated = true;
      }
      if (saved.v !== 1 || typeof saved.enabled !== 'boolean' || !Array.isArray(saved.gateway?.grants) || !saved.gateway?.commands) throw new Error('Invalid companion state.');
      this.key = privateKeyFromProtobuf(Buffer.from(saved.identity, 'base64'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Companion identity cannot be loaded. Restore it or explicitly reset pairing.');
      this.key = await generateKeyPair('Ed25519');
      saved = { v: 1, identity: Buffer.from(privateKeyToProtobuf(this.key)).toString('base64'), enabled: false, relayOrigin: '', relayPeerId: '', gateway: { grants: [], commands: {} } };
    }
    this.saved = saved;
    this.notifications = new CompanionNotifications(peerIdFromPrivateKey(this.key).toString());
    const projects = new CompanionProjectAcquisition(this.provider);
    void systemHostName().then((name) => { this.hostName = name; }).catch(() => {});
    this.gateway = new CompanionGateway(peerIdFromPrivateKey(this.key).toString(), saved.gateway, {
      registerLiveActivity: (peerId, registration) => this.activities!.register(peerId, registration),
      hostName: () => this.hostName,
      gitDiff: (agentId, target) => this.provider.request(backendMethods.agentGitDiffGet, { agentId, target, _clientId: 'companion-read' }),
      previewFile: (agentId, filePath) => this.provider.request(backendMethods.agentFilePreview, { agentId, filePath, _clientId: 'companion-read' }),
      readImage: (agentId, filePath) => readConversationImage(() => this.provider.request(backendMethods.agentFilePreview, { agentId, filePath, _clientId: 'companion-read' })),
      localRepositories: remote => projects.localList(remote),
      localBranches: (repositoryId, remote) => projects.localBranches(repositoryId, remote),
      repositoryCatalog: (provider, remote) => projects.catalog(provider, remote),
      repositoryBranches: (id, provider, remote) => projects.catalogBranches(id, provider, remote),
      githubRepositories: remote => projects.list(remote),
      githubBranches: (repositoryId, remote) => projects.branches(repositoryId, remote),
      createProject: (input, remote, authorize) => projects.create(input, remote, authorize),
      push: (peerId, registration, notification) => this.connector.push(peerId, registration, notification),
      onEvent: (listener) => { this.eventListeners.add(listener); return () => { this.eventListeners.delete(listener); }; },
      workspace: () => this.workspace(),
      executeMission: async (input) => { await this.provider.request(backendMethods.missionExecute, { input, _clientId: 'companion-write' }); },
      createTeam: async name => {
        const snapshot = await this.provider.request<AppSnapshot>(backendMethods.teamCreate, {
          input: { name, color: defaultTeamColor }, _clientId: 'companion-write',
        });
        if (!snapshot.activeTeamId) throw new Error('Workspace creation returned no workspace.');
        return snapshot.activeTeamId;
      },
      usage: async (everyProvider) => {
        const { snapshot } = await this.provider.request<{ snapshot: AppSnapshot }>(backendMethods.snapshotGet, { _clientId: 'companion-read' });
        // Released phones label only these quota providers; the others go to phones that ask for every engine.
        const providers = (snapshot.providerConnections ?? []).filter(provider => provider.installed && provider.connected && provider.enabled !== false
          && (everyProvider || companionQuotaProviders.includes(provider.provider)) && supportsSubscriptionQuota(connectionAccount(provider.authentication)));
        return Promise.all(providers.map(async ({ provider: provider }) => {
          try {
            const limits = await this.provider.request<AccountRateLimits | null>(backendMethods.providerUsageGet, { provider: provider });
            return { provider: provider, limits: limits ? { primary: limits.primary, secondary: limits.secondary } : null, failed: false };
          } catch { return { provider: provider, limits: null, failed: true }; }
        }));
      },
      markRead: async (agentId, revision) => { await this.provider.request(backendMethods.agentMarkRead, { agentId, revision, _clientId: 'companion-read' }); },
      loadTurnHistory: async (agentId, turnId) => { await this.provider.request(backendMethods.agentConversationTurnHistoryLoad, { agentId, turnId, _clientId: 'companion-read' }); },
      loadOlderHistory: (agentId) => this.provider.request(backendMethods.agentConversationHistoryLoadOlder, { agentId, _clientId: 'companion-read' }),
      readConversationContent: (agentId, input) => this.provider.request(backendMethods.agentConversationContentRead, { agentId, input, _clientId: 'companion-read' }),
      synchronize: (agentId, checkpoint) => this.conversations.synchronize(agentId, checkpoint),
      conversation: async (agentId) => {
        try { return await this.conversations.read(agentId); }
        catch (error) { warnMain('companion', 'conversation unavailable', { agentId, message: error instanceof Error ? error.message : String(error) }); throw error; }
      },
      submit: async (target, prompt, clientId, options, uploads) => {
        const attachments = uploads ? await storePromptUploads(this.directory, uploads, Date.now(), target.agentId).catch(() => { throw new PromptRejectedError('Attachments could not be stored.'); }) : undefined;
        const { followUpBehavior = 'steer', ...composerOptions } = options ?? {};
        const promptOptions = options || attachments ? { ...composerOptions, ...(attachments ? { attachments } : {}) } : undefined;
        const method = followUpBehavior === 'queue' ? backendMethods.agentPromptSend : backendMethods.agentPromptSteer;
        await this.provider.request(method, { agentId: target.agentId, expectedSessionId: target.sessionId, prompt, ...(followUpBehavior === 'steer' ? { startIfIdle: true } : {}), ...(promptOptions ? { options: promptOptions } : {}), _clientId: clientId });
      },
      respondRequest: async (response) => { await this.provider.request(backendMethods.agentRequestRespond, { response, _clientId: 'companion-write' }); },
      updateQueuedPrompt: async (target, promptId, action) => {
        await this.provider.request(action === 'steer' ? backendMethods.agentQueuedPromptSteer : backendMethods.agentQueuedPromptDelete,
          { agentId: target.agentId, promptId, expectedSessionId: target.sessionId, _clientId: 'companion-write' });
      },
      models: (agentId) => this.provider.request<unknown[]>(backendMethods.agentModelsList, { agentId, _clientId: 'companion-read' }),
      plugins: (agentId) => this.provider.request(backendMethods.agentPluginsList, { agentId, _clientId: 'companion-read' }),
      skills: (agentId) => this.provider.request(backendMethods.agentSkillsList, { agentId, _clientId: 'companion-read' }),
      changeGoal: async (agentId, objective) => {
        if (objective === null) await this.provider.request(backendMethods.agentGoalClear, { agentId, _clientId: 'companion-write' });
        else await this.provider.request(backendMethods.agentGoalUpdate, { agentId, objective, _clientId: 'companion-write' });
      },
      interrupt: async (agentId) => { await this.provider.request(backendMethods.agentInterrupt, { agentId, _clientId: 'companion-write' }); },
      restart: async (agentId) => { await this.provider.request(backendMethods.agentConversationReset, { agentId, _clientId: 'companion-write' }); },
      branches: (repoPath, remoteConnectionId) => this.provider.request<SourceBranch[]>(backendMethods.sourceBranchesList, { repoPath, ...(remoteConnectionId ? { remoteConnectionId } : {}), _clientId: 'companion-read' }),
      createChat: async (chat) => {
        const remote = chat.remoteConnectionId ? { remoteConnectionId: chat.remoteConnectionId } : {};
        const folder = await resolveRepositorySession(chat.repositoryRoot, {
          ...(chat.existingBranch ? { existingBranch: chat.existingBranch } : {}),
          ...(chat.worktree ? { worktree: { ...chat.worktree, ...(chat.defaultBranch ? { baseBranch: chat.defaultBranch } : {}) } } : {}),
        }, {
          branches: () => this.provider.request(backendMethods.sourceBranchesList, { repoPath: chat.repositoryRoot, ...remote, _clientId: 'companion-read' }),
          createWorktree: input => this.provider.request(backendMethods.sourceWorktreeCreate, { input: { ...input, ...remote }, _clientId: 'companion-write' }),
        });
        const result = await this.provider.request<CreatedAgentResult>(backendMethods.agentCreate, { input: { name: null, folder, selection: { ...chat.selection }, sourceRepositoryName: chat.repositoryName, teamId: chat.teamId, ...remote }, entityResult: true, _clientId: 'companion-write' });
        return result.agentId;
      },
      createQuickChat: async ({ teamId, provider: backend }) => (await this.provider.request<CreatedAgentResult>(backendMethods.agentQuickChatCreate, { input: { teamId, selection: { provider: backend } }, entityResult: true, _clientId: 'companion-write' })).agentId,
      duplicateAgent: async (agentId, provider) => (await this.provider.request<CreatedAgentResult>(backendMethods.agentDuplicate, { agentId, options: { selection: { provider: provider } }, entityResult: true, _clientId: 'companion-write' })).agentId,
      renameAgent: async (agentId, name) => { await this.provider.request(backendMethods.agentUpdate, { input: { id: agentId, name }, _clientId: 'companion-write' }); },
      setProvider: async (agentId, provider) => { await this.provider.request(backendMethods.agentUpdate, { input: { id: agentId, selection: { provider: provider } }, _clientId: 'companion-write' }); },
      closePreview: agentId => this.provider.request(backendMethods.agentClosePreview, { agentId, _clientId: 'companion-read' }),
      close: async (agentId, input) => { await this.provider.request(backendMethods.agentDelete, { agentId, ...(input ? { input } : {}), _clientId: 'companion-write' }); },
      setPermission: async (agentId, permission) => { await this.provider.request(backendMethods.agentPermissionModeUpdate, { agentId, mode: permission, _clientId: 'companion-write' }); },
      startReview: async (agentId, input) => (await this.provider.request<CreatedAgentResult>(backendMethods.agentCodeReviewStart, { agentId, input, entityResult: true, _clientId: 'companion-write' })).agentId,
      readReview: agentId => readReviewSession(this.provider, peerIdFromPrivateKey(this.key).toString(), agentId),
      reviewAction: (agentId, input) => actOnReview(this.provider, agentId, input),
      reviewSetup: (agentId, backend) => readReviewSetup(this.provider, peerIdFromPrivateKey(this.key).toString(), agentId, backend),
      selectModel: async (agentId, selection) => { await this.provider.request(backendMethods.agentUpdate, { input: { id: agentId, selection }, _clientId: 'companion-write' }); },
      save: (gateway) => this.persist((saved) => ({ ...saved, gateway })),
      revoked: (peerId) => this.connector.revoke(peerId),
    }, Date.now, pairing?.hostId === peerIdFromPrivateKey(this.key).toString() ? pairing.code : undefined);
    if (this.provider.authorizeGuest) this.guestGateway = new GuestConversationGateway({
      ...(this.provider.proposeGuest ? { propose: (handle, identity, name, input) => this.provider.proposeGuest!(handle, identity, name, input) } : {}),
      ...(this.provider.guestProposals ? { proposals: (handle, identity) => this.provider.guestProposals!(handle, identity) } : {}),
      ...(this.provider.withdrawGuest ? { withdraw: (handle, identity, proposalId) => this.provider.withdrawGuest!(handle, identity, proposalId) } : {}),
      authorize: (handle, credential) => this.provider.authorizeGuest!(handle, credential),
      connected: (handle, count, guests) => this.provider.guestCount?.(handle, count, guests),
      onEvent: listener => { this.eventListeners.add(listener); return () => { this.eventListeners.delete(listener); }; },
      loadConversation: agentId => this.provider.request(backendMethods.agentConversationLoad, { agentId, _clientId: 'guest-read' }).then(() => {}),
      loadTurnHistory: async (agentId, turnId) => { await this.provider.request(backendMethods.agentConversationTurnHistoryLoad, { agentId, turnId, _clientId: 'guest-read' }); },
      loadOlderHistory: agentId => this.provider.request(backendMethods.agentConversationHistoryLoadOlder, { agentId, _clientId: 'guest-read' }),
      readConversationContent: (agentId, input) => this.provider.request(backendMethods.agentConversationContentRead, { agentId, input, _clientId: 'guest-read' }),
      readImage: (agentId, filePath) => readConversationImage(() => this.provider.request(backendMethods.agentFilePreview, { agentId, filePath, _clientId: 'guest-read' })),
    });
    this.connector = new CompanionOutboundConnector(this.key, this.gateway, {
      phoneEnabled: () => this.saved.enabled,
      sharing: { handles: () => this.shareRoutes.filter(route => this.matchesRelay(route)).map(route => route.handle), status: value => this.setShareStatus(value), ...(this.guestGateway ? { accept: (stream, peer) => this.guestGateway!.accept(stream, peer) } : {}) },
    });
    this.activities = new CompanionLiveActivities({ hostId: this.gateway.hostId, hostName: hostname(), initial: saved.activities,
      authorized: peerId => this.saved.enabled && this.gateway.grants.some(grant => grant.peerId === peerId),
      workspace: () => this.workspace(), save: activities => this.persist(saved => ({ ...saved, activities })),
      push: (peerId, registration, activity) => this.connector.liveActivity(peerId, registration, activity) });
    this.activityHeartbeat = setInterval(() => this.scheduleActivity(), 30_000); this.activityHeartbeat.unref();
    await this.persist();
    if (migrated) {
      const verified = JSON.parse(await readFile(path.join(this.home, 'companions.json'), 'utf8'));
      if (JSON.stringify(verified) !== JSON.stringify(this.saved)) throw new Error('Companion migration verification failed.');
      await unlink(path.join(this.directory, 'state.json'));
      await rmdir(this.directory).catch(error => { if (!['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(error.code)) throw error; });
    }
    const relay = this.relay;
    this.provider.onAccessChanged?.(saved.enabled && Boolean(relay));
    if (saved.enabled && relay) await this.startTransport();
  }
  private async loadConversation(agentId: string): Promise<void> {
    await this.provider.request(backendMethods.agentConversationLoad, { agentId, _clientId: 'companion-read' });
  }
  private async workspace(): Promise<CompanionWorkspace> {
    const { snapshot } = await this.provider.request<{ snapshot: AppSnapshot }>(backendMethods.snapshotGet, { _clientId: 'companion-read' });
    return companionWorkspaceOf(snapshot);
  }
  private readonly written = new UnchangedWrites();
  private persist(update: (saved: Saved) => Saved = (saved) => saved) {
    const write = this.writes.then(async () => {
      const next = update(this.saved);
      const content = JSON.stringify(next);
      await this.written.writeIfChanged(path.join(this.home, 'companions.json'), content, async (file, text) => {
        const temporary = `${file}.${randomUUID()}.tmp`;
        const handle = await open(temporary, 'wx', 0o600);
        try {
          try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
          await rename(temporary, file);
          if (process.platform !== 'win32') {
            const directory = await open(this.home, 'r');
            try { await directory.sync(); } finally { await directory.close(); }
          }
        } finally { await unlink(temporary).catch(() => {}); }
      });
      const accessChanged = this.saved.enabled !== next.enabled;
      this.saved = next;
      if (accessChanged) this.provider.onAccessChanged?.(next.enabled && Boolean(this.relay));
    });
    this.writes = write.catch(() => {});
    return write;
  }
}
