import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import type { PrivateKey } from '@libp2p/interface';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { AgentGitWorkflow, AppSnapshot, SourceBranch, SourceWorktree } from '@workspace/core/contracts';
import type { CompanionControl, CompanionControlResult, CompanionWorkspace } from '@workspace/core/companion-protocol';
import { companionWorkspaceOf } from '@workspace/core/companion-projection';
import { relayAddress } from '@workspace/core/companion-relay';
import { z } from 'zod';
import { CompanionGateway, type GatewayState } from './gateway';
import { CompanionOutboundConnector } from './connector';
import { ConversationSource } from './conversation-source';
import { warnMain } from '../log';
import { storePromptUploads } from './uploads';
import { readReviewSetup } from './review-setup';

type Saved = { v: 1; identity: string; enabled: boolean; relayOrigin: string; relayPeerId: string; gateway: GatewayState };
const controlSchema = z.discriminatedUnion('action', [z.object({ action: z.literal('status') }).strict(),
  z.object({ action: z.literal('enable'), relayOrigin: z.string().max(500), relayPeerId: z.string().min(32).max(128) }).strict(),
  z.object({ action: z.literal('resume') }).strict(),
  z.object({ action: z.literal('disable') }).strict(), z.object({ action: z.literal('invite') }).strict(),
  z.object({ action: z.literal('decide'), pendingId: z.string().uuid(), approve: z.boolean() }).strict(),
  z.object({ action: z.literal('revoke'), peerId: z.string().min(1).max(128) }).strict()]);
export type CompanionBackendPort = { request<Result>(method: string, params?: unknown): Promise<Result> };
type Relay = { origin: string; peerId: string };

/** The relay is deployment configuration: the operator sets it once and users only pair phones. */
function relayFromEnvironment(env: NodeJS.ProcessEnv): { relay: Relay | null; error?: string } {
  const origin = env.APP_COMPANION_RELAY_URL?.trim() ?? ''; const peerId = env.APP_COMPANION_RELAY_PEER_ID?.trim() ?? '';
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
  private connector!: CompanionOutboundConnector;
  private writes = Promise.resolve();
  private controls = Promise.resolve();
  private ready: Promise<void> | null = null;
  private readonly conversations = new ConversationSource((agentId) => this.loadConversation(agentId));
  private readonly environment: ReturnType<typeof relayFromEnvironment>;
  constructor(private readonly directory: string, private readonly backend: CompanionBackendPort, env: NodeJS.ProcessEnv = process.env) {
    this.environment = relayFromEnvironment(env);
  }
  /** The environment owns the relay when set; otherwise a relay saved by an explicit enable applies. */
  private get relay(): Relay | null {
    if (this.environment.relay) return this.environment.relay;
    return this.saved.relayOrigin ? { origin: this.saved.relayOrigin, peerId: this.saved.relayPeerId } : null;
  }
  private readonly eventListeners = new Set<(event: AppBackendEvent) => void>();
  event(event: AppBackendEvent) {
    this.conversations.observe(event);
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
          if (this.environment.relay) throw new Error('The relay is configured by the environment.');
          relayAddress(action.relayOrigin, action.relayPeerId);
          await this.persist((saved) => ({ ...saved, enabled: true, relayOrigin: action.relayOrigin, relayPeerId: action.relayPeerId }));
          await this.connector.start(action.relayOrigin, action.relayPeerId);
          break;
        case 'resume':
          await this.resume(); break;
        case 'disable':
          await this.persist((saved) => ({ ...saved, enabled: false })); await this.connector.stop(); break;
        case 'invite':
          await this.resume();
          if (!this.connector.connected) throw new Error('Relay is not connected.');
          invitation = this.gateway.invite();
          await this.connector.advertise(invitation.expiresAt);
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
  async stop() { await this.ready?.catch(() => {}); await this.connector?.stop(); }
  private status() {
    return { configured: Boolean(this.relay), enabled: this.saved.enabled, connected: this.connector.connected, hostId: this.gateway.hostId,
      relayOrigin: this.relay?.origin ?? '', devices: this.gateway.grants, pending: this.gateway.pendingRequests,
      ...(this.environment.error ? { error: this.environment.error } : {}) };
  }
  private initialize() { return this.ready ??= this.load(); }
  private async load() {
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
    this.gateway = new CompanionGateway(peerIdFromPrivateKey(this.key).toString(), saved.gateway, {
      onEvent: (listener) => { this.eventListeners.add(listener); return () => { this.eventListeners.delete(listener); }; },
      workspace: () => this.workspace(),
      markRead: async (agentId, revision) => { await this.backend.request(backendMethods.agentMarkRead, { agentId, revision, _clientId: 'companion-read' }); },
      loadOlderHistory: (agentId) => this.backend.request(backendMethods.agentConversationHistoryLoadOlder, { agentId, _clientId: 'companion-read' }),
      readConversationContent: (agentId, input) => this.backend.request(backendMethods.agentConversationContentRead, { agentId, input, _clientId: 'companion-read' }),
      conversation: async (agentId) => {
        try { return await this.conversations.read(agentId); }
        catch (error) { warnMain('companion', 'conversation unavailable', { agentId, message: error instanceof Error ? error.message : String(error) }); throw error; }
      },
      submit: async (agentId, prompt, clientId, options, uploads) => {
        const attachments = uploads ? await storePromptUploads(this.directory, uploads) : undefined;
        const promptOptions = options || attachments ? { ...options, ...(attachments ? { attachments } : {}) } : undefined;
        await this.backend.request(backendMethods.agentPromptSteer, { agentId, prompt, startIfIdle: true, ...(promptOptions ? { options: promptOptions } : {}), _clientId: clientId });
      },
      respondRequest: async (response) => { await this.backend.request(backendMethods.agentRequestRespond, { response, _clientId: 'companion-write' }); },
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
        if (chat.existingBranch) {
          // Resolve again at creation: a checkout may have moved or the branch may have been deleted.
          const branches = await this.backend.request<SourceBranch[]>(backendMethods.sourceBranchesList, { repoPath: chat.repositoryRoot, ...remote, _clientId: 'companion-read' });
          const branch = branches.find((candidate) => candidate.name === chat.existingBranch);
          if (!branch) throw new Error('Branch not found. Refresh the branch list.');
          folder = branch.worktreePath ?? (await this.backend.request<SourceWorktree>(backendMethods.sourceWorktreeCreate, {
            input: { repoPath: chat.repositoryRoot, branchName: branch.name, ...remote }, _clientId: 'companion-write',
          })).path;
        } else if (chat.worktree) {
          const worktree = await this.backend.request<SourceWorktree>(backendMethods.sourceWorktreeCreate, { input: { repoPath: chat.repositoryRoot, branchName: chat.worktree.branchName,
            ...(chat.defaultBranch ? { baseBranch: chat.defaultBranch } : {}), ...remote }, _clientId: 'companion-write' });
          folder = worktree.path;
        }
        const known = new Set((await this.workspace()).agents.map((agent) => agent.id));
        await this.backend.request(backendMethods.agentCreate, { input: { name: null, folder, backend: chat.backend, sourceRepositoryName: chat.repositoryName, teamId: chat.teamId }, _clientId: 'companion-write' });
        const created = (await this.workspace()).agents.find((agent) => !known.has(agent.id) && agent.folder === folder);
        if (!created) throw new Error('The chat was not created.');
        return created.id;
      },
      createQuickChat: async ({ teamId, backend }) => {
        const known = new Set((await this.workspace()).agents.map((agent) => agent.id));
        await this.backend.request(backendMethods.agentQuickChatCreate, { input: { teamId, backend }, _clientId: 'companion-write' });
        const created = (await this.workspace()).agents.find((agent) => !known.has(agent.id) && agent.teamId === teamId && agent.sessionKind === 'quickChat');
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
          return { isLinkedWorktree: workflow.isLinkedWorktree, branch: workflow.branch ?? null, upstream: workflow.upstream ?? null, hasChanges: workflow.files.length > 0 };
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
    });
    this.connector = new CompanionOutboundConnector(this.key, this.gateway);
    await this.persist();
    const relay = this.relay;
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
        this.saved = next;
      } finally { await unlink(temporary).catch(() => {}); }
    });
    this.writes = write.catch(() => {});
    return write;
  }
}
