import type { CompanionNotification, CompanionPushRegistration } from '@workspace/core/companion-notification';
import type { AgentRequestResponse } from '@workspace/core/agent-request';
import type { BackendHistoryLoadResult } from '@workspace/core/backend-driver';
import type { ConversationContentInput, ConversationContentChunk } from '@workspace/core/contracts/conversation';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { CompanionSubscription } from './subscription';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AgentBackend, BackendSkillSummary, BackendPluginSummary, SourceBranch } from '@workspace/core/contracts';
import type { CompanionReviewSetup } from '@workspace/core/companion-review';
import type { CompanionCloseOptions, CompanionClosePreview, CompanionCommandReceipt, CompanionGrant, CompanionPending, CompanionReset, CompanionTarget, CompanionWorkspace } from '@workspace/core/companion-protocol';
import { companionSessionId, companionMaxUploadBytes, companionMaxUploads } from '@workspace/core/companion-protocol';
import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import { canSelectAgentBackend } from '@workspace/core/agent-backends';
import { opaquePath, projectCompanionWorkspace } from '@workspace/core/companion-projection';
import { ChatCreations } from './chat-creations';
import type { CompanionUpload } from './uploads';
import { createPairingExchange, generatePairingCode, normalizePairingCode, pairingChannel, pairingConfirmationsMatch } from '@workspace/core/companion-pairing';

const identity = z.string().min(1).max(200);
const targetSchema = z.object({ hostId: identity, locationId: identity, teamId: identity, agentId: identity, sessionId: z.string().max(500).nullable() }).strict();
const requestReplySchema = z.object({ target: targetSchema, id: identity, conversationId: z.string().min(1).max(500), outcome: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('answered'), answers: z.record(z.string().min(1).max(500), z.object({ answers: z.array(z.string().max(100_000)).max(100) }).strict()) }).strict(),
  z.object({ kind: z.literal('decision'), decision: z.enum(['allow', 'allow_conversation', 'always_allow', 'deny']) }).strict(),
  z.object({ kind: z.literal('cancelled') }).strict(),
]) }).strict();
const closeSchema = z.object({ target: targetSchema, input: z.object({ deleteWorktree: z.literal(true), deleteRemoteBranch: z.boolean(), discardChanges: z.boolean(), confirmed: z.literal(true) }).strict().optional() }).strict();
/** What a phone may ask of a prompt beyond its text: the same composer choices the desktop sends. */
const promptOptionsSchema = z.object({
  skills: z.array(z.object({ name: z.string().min(1).max(500), path: z.string().min(1).max(4096) }).strict()).max(100).optional(),
  model: z.string().min(1).max(200).nullable().optional(), reasoningEffort: z.string().min(1).max(40).nullable().optional(),
  serviceTier: z.string().min(1).max(80).nullable().optional(), planMode: z.boolean().optional(), inputMethod: z.enum(['typed', 'dictated']).optional(),
  delegation: z.object({ startingContext: z.enum(['conversation', 'handoff']), instructions: z.string().max(100_000).optional() }).strict().optional(),
}).strict();
const reviewSchema = z.object({ agentId: identity, target: targetSchema.optional(), input: z.object({ scope: z.discriminatedUnion('type', [z.object({ type: z.literal('uncommitted') }).strict(), z.object({ type: z.literal('branch'), baseRef: z.string().min(1).max(200) }).strict()]),
  threadMode: z.enum(['current', 'independent']), instructions: z.string().max(100_000).optional(),
  backend: z.enum(['codex', 'claude', 'antigravity']).optional(), model: identity.optional(), reasoningEffort: z.string().min(1).max(40).optional(),
  automation: z.object({ enabled: z.boolean(), maxPriority: z.enum(['p0', 'p1', 'p2', 'p3']), maxRounds: z.number().int().min(1).max(10), autoCommit: z.boolean().optional() }).strict().optional(),
}).strict().refine(input => input.threadMode === 'independent' || (!input.automation?.enabled && !input.model && !input.reasoningEffort)) }).strict();
/** A branch name git accepts and no option or path trick can hide in. */
const branchName = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/).refine((name) => !name.includes('..') && !name.includes('//') && !/[./]$/.test(name) && !name.endsWith('.lock'));
const repositorySchema = z.object({ teamId: identity, repositoryId: identity }).strict();
const newChatSchema = z.object({ teamId: identity, repositoryId: identity, backend: z.enum(['codex', 'claude', 'antigravity']), existingBranch: z.string().min(1).max(1024).optional(), worktree: z.object({ branchName }).strict().optional() }).strict().refine((input) => !(input.existingBranch && input.worktree), 'Choose an existing branch or a new worktree.');
/** A new chat as the laptop runs it: the paths are real, resolved from what the phone named. */
type NewChatRequest = { teamId: string; remoteConnectionId?: string; backend: AgentBackend; repositoryName: string; repositoryRoot: string; defaultBranch?: string; existingBranch?: string; worktree?: { branchName: string } };
type CompanionPromptOptions = z.infer<typeof promptOptionsSchema>;
const maxUploadBytes = companionMaxUploadBytes;
const uploadSchema = z.object({ type: z.enum(['image', 'file']), name: z.string().min(1).max(200), mimeType: z.string().max(120), data: z.string().max(Math.ceil(maxUploadBytes * 4 / 3) + 4).regex(/^[A-Za-z0-9+/]*={0,2}$/) }).strict();
const commandSchema = z.object({ target: targetSchema, text: z.string().max(100_000), clientCommandId: z.string().uuid(), options: promptOptionsSchema.optional(), attachments: z.array(uploadSchema).max(companionMaxUploads).optional() }).strict()
  .refine((command) => command.text.length > 0 || (command.attachments?.length ?? 0) > 0, 'A prompt needs text or an attachment.');
const modelSelectionSchema = z.object({ agentId: identity, model: z.string().min(1).max(200), reasoningEffort: z.string().min(1).max(40).nullable(), serviceTier: z.string().min(1).max(80).nullable() }).strict();
export type GatewayState = { push?: Record<string, CompanionPushRegistration>; grants: CompanionGrant[]; commands: Record<string, CompanionCommandReceipt & { fingerprint: string }> };
export type GatewayPort = {
  push?(peerId: string, registration: CompanionPushRegistration, notification: CompanionNotification): Promise<'sent' | 'invalid' | 'unavailable'>;
  markRead?(agentId: string, revision: number): Promise<void>;
  respondRequest?(response: AgentRequestResponse): Promise<void>;
  onEvent?(listener: (event: AppBackendEvent) => void): () => void;
  workspace(): Promise<CompanionWorkspace>;
  conversation(agentId: string): Promise<CompanionReset>;
  loadOlderHistory(agentId: string): Promise<BackendHistoryLoadResult>;
  readConversationContent?(agentId: string, input: ConversationContentInput): Promise<ConversationContentChunk>;
  submit(agentId: string, text: string, clientId: string, options?: CompanionPromptOptions, uploads?: CompanionUpload[]): Promise<void>;
  models(agentId: string): Promise<unknown[]>;
  plugins?(agentId: string): Promise<BackendPluginSummary[]>;
  skills(agentId: string): Promise<BackendSkillSummary[]>;
  changeGoal?(agentId: string, objective: string | null): Promise<void>;
  interrupt(agentId: string): Promise<void>;
  restart(agentId: string): Promise<void>;
  branches(repositoryRoot: string, remoteConnectionId?: string): Promise<SourceBranch[]>;
  createChat(request: NewChatRequest): Promise<string>;
  createQuickChat(request: { teamId: string; backend: AgentBackend }): Promise<string>;
  setBackend(agentId: string, backend: AgentBackend): Promise<void>;
  closePreview(agentId: string): Promise<Omit<CompanionClosePreview, 'target'>>;
  close(agentId: string, input?: CompanionCloseOptions): Promise<void>;
  setApprovalPreset(agentId: string, preset: string): Promise<void>;
  setPermissionMode(agentId: string, mode: string): Promise<void>;
  startReview(agentId: string, input: z.infer<typeof reviewSchema>['input']): Promise<string | void>;
  reviewSetup?(agentId: string, backend?: AgentBackend): Promise<CompanionReviewSetup>;
  selectModel(agentId: string, selection: { model: string; reasoningEffort: string | null; serviceTier: string | null }): Promise<void>;
  save(state: GatewayState): Promise<void>;
  revoked(peerId: string): void;
};

/** Peer identity is supplied exclusively by the authenticated Noise connection. */
export class CompanionGateway {
  /** Keyed by the public rendezvous channel (first half of the code); the whole code is the PAKE password. */
  private readonly invitations = new Map<string, { code: string; expiresAt: number; attempts: number; sessions: Map<string, { confirm: Uint8Array; name: string }>; pendingId?: string }>();
  private readonly pending = new Map<string, CompanionPending & { channel: string }>();
  private readonly notifications = new Set<(notification: CompanionNotification) => void>();
  private mutations = Promise.resolve();
  private readonly creations = new ChatCreations();
  constructor(readonly hostId: string, private state: GatewayState, private readonly port: GatewayPort, private readonly now = Date.now) {}
  get grants() { return this.state.grants.map((grant) => ({ ...grant })); }
  get pendingRequests() { this.expire(); return [...this.pending.values()].map(({ channel: _channel, ...pending }) => pending); }
  /** Channels of live invitations, advertised to the relay so a phone can find this laptop from its code. */
  pairChannels() { this.expire(); return [...this.invitations.keys()]; }
  invite() {
    this.expire();
    if (this.invitations.size >= 5) throw new Error('Too many active invitations.');
    let code = generatePairingCode();
    while (this.invitations.has(pairingChannel(normalizePairingCode(code)!))) code = generatePairingCode();
    const expiresAt = this.now() + 300_000;
    this.invitations.set(pairingChannel(normalizePairingCode(code)!), { code: normalizePairingCode(code)!, expiresAt, attempts: 0, sessions: new Map() });
    return { code, expiresAt };
  }
  /** Approval grants everything: every team, reading and sending. The desktop decides per device, not per scope. */
  async decide(id: string, approve: boolean) {
    return this.mutate(async () => {
      this.expire();
      const pending = this.pending.get(id);
      if (!pending) throw new Error('Pairing request expired or consumed.');
      if (approve && this.state.grants.length >= 20 && !this.state.grants.some((grant) => grant.peerId === pending.peerId)) throw new Error('Too many paired devices.');
      const next = { ...this.state, grants: this.state.grants.filter((grant) => grant.peerId !== pending.peerId) };
      if (approve) next.grants.push({ peerId: pending.peerId, name: pending.name, createdAt: this.now() });
      await this.port.save(next);
      this.state = next;
      this.pending.delete(id); this.invitations.delete(pending.channel);
    });
  }
  async notify(notification: CompanionNotification) {
    for (const listener of this.notifications) listener(notification);
    await Promise.all(this.state.grants.map(async grant => {
      const registration = this.state.push?.[grant.peerId];
      if (!registration || !this.port.push) return;
      const result = await this.port.push(grant.peerId, registration, notification).catch(() => 'unavailable');
      if (result === 'invalid') await this.mutate(async () => {
        if (this.state.push?.[grant.peerId] !== registration) return;
        const push = { ...this.state.push }; delete push[grant.peerId];
        const next = { ...this.state, push }; await this.port.save(next); this.state = next;
      });
    }));
  }
  async revoke(peerId: string) {
    return this.mutate(async () => {
      const push = { ...this.state.push }; delete push[peerId];
      const next = { ...this.state, push, grants: this.state.grants.filter((grant) => grant.peerId !== peerId) };
      await this.port.save(next); this.state = next;
      this.port.revoked(peerId);
    });
  }
  subscribe(peerId: string, emit: ConstructorParameters<typeof CompanionSubscription>[1], fail: () => void) {
    const grant = this.state.grants.find((grant) => grant.peerId === peerId);
    if (!grant || !this.port.onEvent) throw new Error('Device is not authorized for updates.');
    return new CompanionSubscription({
      authorized: () => this.state.grants.includes(grant),
      onNotification: listener => { this.notifications.add(listener); return () => { this.notifications.delete(listener); }; },
      onEvent: (listener) => this.port.onEvent!(listener),
      request: (method, args) => this.request(peerId, method, args),
    }, emit, fail);
  }
  async request(peerId: string, method: string, args: unknown): Promise<unknown> {
    this.expire();
    if (method === 'pair.start') {
      const request = z.object({ channel: z.string().length(4), message: z.string().min(40).max(48), name: z.string().trim().min(1).max(80) }).strict().parse(args);
      const invitation = this.invitations.get(request.channel);
      if (!invitation) throw new Error('Invalid or expired invitation.');
      // Online guessing is the only way to test a code, so each start is an attempt and three burn the invitation.
      if (++invitation.attempts > 3) { this.invitations.delete(request.channel); throw new Error('Invalid or expired invitation.'); }
      const exchange = createPairingExchange({ role: 'responder', code: invitation.code, initiatorId: peerId, responderId: this.hostId });
      const confirmations = exchange.finish(new Uint8Array(Buffer.from(request.message, 'base64')));
      invitation.sessions.set(peerId, { confirm: confirmations.initiatorConfirm, name: request.name });
      return { message: Buffer.from(exchange.message).toString('base64'), confirm: Buffer.from(confirmations.responderConfirm).toString('base64') };
    }
    if (method === 'pair.confirm') {
      const request = z.object({ channel: z.string().length(4), confirm: z.string().min(40).max(48) }).strict().parse(args);
      const invitation = this.invitations.get(request.channel);
      const session = invitation?.sessions.get(peerId);
      if (!invitation || !session) throw new Error('Invalid or expired invitation.');
      if (!pairingConfirmationsMatch(session.confirm, new Uint8Array(Buffer.from(request.confirm, 'base64')))) {
        this.invitations.delete(request.channel);
        throw new Error('Invalid or expired invitation.');
      }
      if (this.state.grants.some((grant) => grant.peerId === peerId)) {
        // An already approved device can recover a lost local pairing record without
        // leaving a second approval request or changing its existing scope.
        this.invitations.delete(request.channel);
        return { pendingId: randomUUID(), state: 'approved' };
      }
      if (invitation.pendingId) {
        const pending = this.pending.get(invitation.pendingId);
        if (pending?.peerId === peerId) return { pendingId: pending.id, state: 'awaitingApproval' };
        throw new Error('Invitation already claimed.');
      }
      const id = randomUUID();
      this.pending.set(id, { id, peerId, name: session.name, channel: request.channel, expiresAt: invitation.expiresAt });
      invitation.pendingId = id;
      return { pendingId: id, state: 'awaitingApproval' };
    }
    if (method === 'pair.status') {
      const { pendingId } = z.object({ pendingId: z.string().uuid() }).strict().parse(args);
      const grant = this.state.grants.find((grant) => grant.peerId === peerId);
      if (grant) return { state: 'approved', grant };
      const pending = this.pending.get(pendingId);
      if (!pending || pending.peerId !== peerId) throw new Error('Pairing denied or expired.');
      return { state: 'awaitingApproval' };
    }
    const grant = this.state.grants.find((grant) => grant.peerId === peerId);
    if (!grant) throw new Error('Device is not authorized.');
    if (method === 'notifications.register') {
      const registration = z.object({ token: z.string().regex(/^[a-f0-9]{32,512}$/), environment: z.enum(['development', 'production']), authorization: z.object({ expiresAt: z.number().int().positive(), signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) }).strict().optional() }).strict().nullable().parse(args);
      await this.mutate(async () => {
        this.requireGrant(peerId, grant);
        const push = { ...this.state.push };
        if (registration) push[peerId] = registration; else delete push[peerId];
        const next = { ...this.state, push }; await this.port.save(next); this.state = next;
      });
      return {};
    }
    if (method === 'snapshot.get') {
      const { iconsVersion } = z.object({ iconsVersion: z.string().max(64).optional(), notifications: z.boolean().optional() }).strict().parse(args);
      const workspace = await this.port.workspace();
      this.requireGrant(peerId, grant);
      const { repositoryIcons, ...projected } = projectCompanionWorkspace(workspace);
      // Icons are large and rarely change: send them only when the phone's copy is out of date.
      const version = createHash('sha256').update(JSON.stringify(Object.entries(repositoryIcons).sort())).digest('hex').slice(0, 16);
      return { ...projected, iconsVersion: version, ...(version === iconsVersion ? {} : { repositoryIcons }) };
    }
    if (method === 'conversation.read') {
      const { target, revision } = z.object({ target: targetSchema, revision: z.number().int().nonnegative().safe() }).strict().parse(args);
      await this.validateTarget(target); this.requireGrant(peerId, grant);
      if (!this.port.markRead) throw new Error('Read acknowledgments unavailable.');
      await this.port.markRead(target.agentId, revision); return {};
    }
    if (method === 'conversation.subscribe' || method === 'conversation.loadOlder') {
      const target = targetSchema.parse(args);
      await this.validateTarget(target);
      this.requireGrant(peerId, grant);
      const page = method === 'conversation.loadOlder' ? await this.port.loadOlderHistory(target.agentId) : null;
      if (page?.frame) {
        const current = await this.validateTarget(target);
        this.requireGrant(peerId, grant);
        if (page.frame.agentId !== target.agentId || current.backendSession?.kind !== 'claude'
          || page.frame.payload.event.backendSessionId !== current.backendSession.sessionId
          || page.frame.payload.event.type !== 'history.prepended') throw new Error('Conversation identity mismatch.');
        return { frame: page.frame, hasOlder: page.hasOlder };
      }
      const frame = await this.port.conversation(target.agentId);
      const current = await this.validateTarget(target);
      this.requireGrant(peerId, grant);
      const session = current.backendSession;
      // Claude and Antigravity can rebind a session id mid-conversation; their frame is already this agent's own replica.
      if (frame.backend !== current.backend || (session?.kind === 'codex' && (frame.type !== 'codex.conversationSnapshotChanged' || frame.threadId !== session.threadId))
        || (session?.kind === 'claude' && frame.type !== 'claude.conversationSnapshotChanged')
        || (session?.kind === 'antigravity' && frame.type !== 'antigravity.conversationSnapshotChanged')) throw new Error('Conversation session mismatch.');
      if (frame.agentId !== target.agentId) throw new Error('Conversation identity mismatch.');
      return page ? { frame, hasOlder: page.hasOlder } : frame;
    }
    if (method === 'conversation.content.read') {
      const { target, input } = z.object({ target: targetSchema, input: z.object({ sessionId: identity, contentId: z.string().regex(/^[a-f0-9]{64}$/), offset: z.number().int().nonnegative().safe() }).strict() }).strict().parse(args);
      const current = await this.validateTarget(target);
      this.requireGrant(peerId, grant);
      if (current.backendSession?.kind !== 'claude' || current.backendSession.sessionId !== input.sessionId || !this.port.readConversationContent) throw new Error('Conversation content is unavailable.');
      const chunk = await this.port.readConversationContent(target.agentId, input);
      await this.validateTarget(target);
      this.requireGrant(peerId, grant);
      return chunk;
    }
    if (method === 'agent.request.respond') {
      const reply = requestReplySchema.parse(args);
      await this.validateTarget(reply.target);
      const workspace = await this.port.workspace();
      const pending = workspace.agentRequests?.[reply.target.agentId]?.find((request) => request.id === reply.id && request.conversationId === reply.conversationId);
      if (!pending || !this.port.respondRequest) throw new Error('Request is no longer pending.');
      await this.validateTarget(reply.target);
      this.requireGrant(peerId, grant);
      // The daemon request owner validates decision scopes and consumes the pending request.
      await this.port.respondRequest({ agentId: reply.target.agentId, id: reply.id, outcome: reply.outcome });
      return {};
    }
    if (method === 'prompt.submit') {
      const command = commandSchema.parse(args);
      const ledgerKey = `${peerId}:${command.clientCommandId}`;
      const fingerprint = createHash('sha256').update(JSON.stringify(command)).digest('hex');
      const existing = this.state.commands[ledgerKey];
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error('Command identity was reused.');
        return receipt(existing);
      }
      return this.mutate(async () => {
        // Recheck inside the serialized admission boundary, including revocation and concurrent retries.
        if (!this.state.grants.some((item) => item.peerId === peerId)) throw new Error('Device is not authorized.');
        const duplicate = this.state.commands[ledgerKey];
        if (duplicate) { if (duplicate.fingerprint !== fingerprint) throw new Error('Command identity was reused.'); return receipt(duplicate); }
        const { backend, folder } = await this.validateTarget(command.target);
        if (command.options?.skills?.length) {
          const catalog = await this.port.skills(command.target.agentId);
          if (command.options.skills.some((selected) => !catalog.some((skill) => skill.enabled && skill.name === selected.name && skill.path === selected.path))) throw new Error('Skill is unavailable.');
          const current = await this.validateTarget(command.target);
          if (current.backend !== backend || current.folder !== folder) throw new Error('Target is stale.');
          this.requireGrant(peerId, grant);
        }
        if (command.attachments?.length && command.target.locationId !== 'local') throw new Error('Remote attachments require a trusted file transfer.');
        const uploads = command.attachments?.length ? command.attachments.map((upload) => ({ ...upload, data: Buffer.from(upload.data, 'base64') })) : undefined;
        if (uploads && (uploads.reduce((total, upload) => total + upload.data.byteLength, 0) > maxUploadBytes || uploads.some((upload, index) => upload.data.toString('base64') !== command.attachments![index]!.data))) throw new Error('Attachment too large.');
        if (Object.keys(this.state.commands).length >= 10_000) throw new Error('Command receipt storage is full.');
        const pending = { clientCommandId: command.clientCommandId, state: 'pending' as const, target: command.target, fingerprint };
        const next = { ...this.state, commands: { ...this.state.commands, [ledgerKey]: pending } };
        await this.port.save(next); this.state = next;
        let state: 'accepted' | 'unresolved' = 'unresolved';
        try { await (uploads ? this.port.submit(command.target.agentId, command.text, `mobile:${peerId}`, command.options, uploads) : this.port.submit(command.target.agentId, command.text, `mobile:${peerId}`, command.options)); state = 'accepted'; } catch { /* Admission may have happened; never replay. */ }
        const completed = { ...pending, state };
        const saved = { ...this.state, commands: { ...this.state.commands, [ledgerKey]: completed } };
        await this.port.save(saved); this.state = saved;
        return receipt(completed);
      });
    }
    if (method === 'skills.list' || method === 'plugins.list') {
      const target = targetSchema.parse(args);
      const { backend, folder } = await this.validateTarget(target);
      const items = method === 'skills.list' ? await this.port.skills(target.agentId) : await this.port.plugins?.(target.agentId) ?? [];
      const current = await this.validateTarget(target);
      this.requireGrant(peerId, grant);
      if (current.backend !== backend || current.folder !== folder) throw new Error('Target is stale.');
      return method === 'skills.list' ? { skills: items } : { plugins: items };
    }
    if (method === 'models.list') {
      const { agentId } = z.object({ agentId: identity }).strict().parse(args);
      await this.requireAgent(agentId);
      const models = await this.port.models(agentId);
      this.requireGrant(peerId, grant);
      return { models };
    }
    if (method === 'agent.model.select') {
      const { agentId, ...selection } = modelSelectionSchema.parse(args);
      await this.requireAgent(agentId);
      this.requireGrant(peerId, grant);
      await this.port.selectModel(agentId, selection);
      return {};
    }
    if (method === 'agent.close.preview') {
      const target = targetSchema.parse(args);
      await this.validateTarget(target);
      const preview = await this.port.closePreview(target.agentId);
      await this.validateTarget(target);
      this.requireGrant(peerId, grant);
      return { ...preview, target };
    }
    if (method === 'agent.close') {
      const { target, input } = closeSchema.parse(args);
      await this.validateTarget(target);
      this.requireGrant(peerId, grant);
      await this.port.close(target.agentId, input);
      return {};
    }
    if (method === 'agent.restart') {
      const target = targetSchema.parse(args);
      const agent = await this.validateTarget(target);
      this.requireGrant(peerId, grant);
      if (agent.status.type === 'working' || agent.status.type === 'awaitingInput') throw new Error('Stop the agent before restarting.');
      await this.port.restart(target.agentId);
      return {};
    }
    if (method === 'repository.branches') {
      const input = repositorySchema.parse(args);
      const workspace = await this.port.workspace();
      this.requireGrant(peerId, grant);
      const { team, repository } = this.repository(workspace, input);
      const branches = await this.port.branches(repository.primaryWorktreeRoot, team.remoteConnectionId);
      this.requireGrant(peerId, grant);
      return branches.map(({ name, isDefault, worktreePath }) => ({ name, isDefault, isCheckedOut: Boolean(worktreePath) }));
    }
    if (method === 'agent.create') {
      const input = newChatSchema.parse(args);
      const workspace = await this.port.workspace();
      this.requireGrant(peerId, grant);
      const { team, repository } = this.repository(workspace, input);
      if (workspace.backends && !workspace.backends[team.id]?.includes(input.backend)) throw new Error('That engine is not available.');
      const request: NewChatRequest = { teamId: team.id, ...(team.remoteConnectionId ? { remoteConnectionId: team.remoteConnectionId } : {}), backend: input.backend,
        repositoryName: repository.repositoryName, repositoryRoot: repository.primaryWorktreeRoot, ...(repository.defaultBranch ? { defaultBranch: repository.defaultBranch } : {}),
        ...(input.existingBranch ? { existingBranch: input.existingBranch } : {}), ...(input.worktree ? { worktree: input.worktree } : {}) };
      return { creationId: this.creations.start(peerId, () => this.port.createChat(request)) };
    }
    if (method === 'agent.quickChat.create') {
      const input = z.object({ teamId: identity, backend: z.enum(['codex', 'claude', 'antigravity']) }).strict().parse(args);
      const workspace = await this.port.workspace();
      this.requireGrant(peerId, grant);
      if (!workspace.teams.some((team) => team.id === input.teamId)) throw new Error('Team not found.');
      if (workspace.backends && !workspace.backends[input.teamId]?.includes(input.backend)) throw new Error('That engine is not available.');
      return { creationId: this.creations.start(peerId, () => this.port.createQuickChat(input)) };
    }
    if (method === 'agent.backend.set') {
      const { agentId, backend } = z.object({ agentId: identity, backend: z.enum(['codex', 'claude', 'antigravity']) }).strict().parse(args);
      const workspace = await this.port.workspace();
      this.requireGrant(peerId, grant);
      const agent = workspace.agents.find((candidate) => candidate.id === agentId);
      if (!agent) throw new Error('Agent not found.');
      if (!canSelectAgentBackend(agent)) throw new Error('The engine can only change before the first prompt.');
      if (workspace.backends && !workspace.backends[agent.teamId ?? '']?.includes(backend)) throw new Error('That engine is not available.');
      await this.port.setBackend(agentId, backend);
      return {};
    }
    if (method === 'agent.create.status') {
      const { creationId } = z.object({ creationId: z.string().uuid() }).strict().parse(args);
      return this.creations.status(peerId, creationId);
    }
    if (method === 'agent.interrupt') {
      const { agentId } = z.object({ agentId: identity }).strict().parse(args);
      await this.requireAgent(agentId); this.requireGrant(peerId, grant);
      await this.port.interrupt(agentId);
      return {};
    }
    if (method === 'agent.approvalPreset.set') {
      const { agentId, preset } = z.object({ agentId: identity, preset: z.string().min(1).max(40) }).strict().parse(args);
      await this.requireAgent(agentId); this.requireGrant(peerId, grant);
      await this.port.setApprovalPreset(agentId, preset);
      return {};
    }
    if (method === 'agent.permissionMode.set') {
      const { agentId, mode } = z.object({ agentId: identity, mode: z.string().min(1).max(80) }).strict().parse(args);
      await this.requireAgent(agentId); this.requireGrant(peerId, grant);
      await this.port.setPermissionMode(agentId, mode);
      return {};
    }
    if (method === 'agent.goal.set') {
      const { target, objective } = z.object({ target: targetSchema, objective: z.string().trim().min(1).max(100_000).nullable() }).strict().parse(args);
      const agent = await this.validateTarget(target); this.requireGrant(peerId, grant);
      if (!defaultBackendCapabilities(agent.backend).goals || !this.port.changeGoal) throw new Error('Goals unavailable.');
      await this.port.changeGoal(agent.id, objective);
      return {};
    }
    if (method === 'agent.review.setup') {
      const { target, backend } = z.object({ target: targetSchema, backend: z.enum(['codex', 'claude', 'antigravity']).optional() }).strict().parse(args);
      await this.validateTarget(target); this.requireGrant(peerId, grant);
      if (!this.port.reviewSetup) throw new Error('Review setup unavailable.');
      const setup = await this.port.reviewSetup(target.agentId, backend);
      await this.validateTarget(target); this.requireGrant(peerId, grant);
      return setup;
    }
    if (method === 'agent.review.start') {
      const { agentId, target, input } = reviewSchema.parse(args);
      if (target) {
        if (target.agentId !== agentId) throw new Error('Review target changed.');
        await this.validateTarget(target);
      }
      await this.requireAgent(agentId); this.requireGrant(peerId, grant);
      const reviewerAgentId = await this.port.startReview(agentId, input);
      return { reviewerAgentId: reviewerAgentId ?? null };
    }
    if (method === 'command.status') {
      const { clientCommandId } = z.object({ clientCommandId: z.string().uuid() }).strict().parse(args);
      const stored = this.state.commands[`${peerId}:${clientCommandId}`];
      return stored ? receipt(stored) : { clientCommandId, state: 'notReceived' };
    }
    if (method === 'device.forget') { z.object({}).strict().parse(args); await this.revoke(peerId); return {}; }
    throw new Error('Companion operation is not supported.');
  }
  private repository(workspace: CompanionWorkspace, input: { teamId: string; repositoryId: string }) {
    const team = workspace.teams.find((candidate) => candidate.id === input.teamId);
    if (!team) throw new Error('Team not found.');
    const repository = workspace.agents.flatMap((agent) => agent.teamId === team.id && agent.sessionKind !== 'quickChat' && agent.workspace?.kind === 'git' && opaquePath(agent.workspace.primaryWorktreeRoot) === input.repositoryId ? [agent.workspace] : [])[0];
    if (!repository) throw new Error('Repository not found.');
    return { team, repository };
  }
  private requireGrant(peerId: string, grant: CompanionGrant) {
    if (this.state.grants.find((current) => current.peerId === peerId) !== grant) throw new Error('Device is not authorized.');
  }
  private async requireAgent(agentId: string) {
    if (!(await this.port.workspace()).agents.some((agent) => agent.id === agentId)) throw new Error('Target is stale.');
  }
  private async validateTarget(target: CompanionTarget) {
    const workspace = await this.port.workspace();
    const team = workspace.teams.find((team) => team.id === target.teamId);
    const agent = workspace.agents.find((agent) => agent.id === target.agentId && agent.teamId === target.teamId);
    if (target.hostId !== this.hostId || !team || !agent
      || target.locationId !== (team.remoteConnectionId ?? 'local') || target.sessionId !== companionSessionId(agent)) throw new Error('Target is stale.');
    return agent;
  }
  private mutate<Result>(action: () => Promise<Result>): Promise<Result> {
    const pending = this.mutations.then(action);
    this.mutations = pending.then(() => {}, () => {});
    return pending;
  }
  private expire() {
    for (const [id, invitation] of this.invitations) if (invitation.expiresAt <= this.now()) {
      if (invitation.pendingId) this.pending.delete(invitation.pendingId);
      this.invitations.delete(id);
    }
  }
}
function receipt({ fingerprint: _fingerprint, ...receipt }: GatewayState['commands'][string]): CompanionCommandReceipt {
  // Persisted pending entries can mean a killed process after provider admission.
  return { ...receipt, state: receipt.state === 'pending' ? 'unresolved' : receipt.state };
}
