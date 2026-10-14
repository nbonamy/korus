import type { AgentRequestResponse } from '@workspace/core/agent-request';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { CompanionSubscription } from './subscription';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CompanionCloseOptions, CompanionClosePreview, CompanionCommandReceipt, CompanionGrant, CompanionPending, CompanionReset, CompanionTarget, CompanionWorkspace } from '@workspace/core/companion-protocol';
import { companionSessionId } from '@workspace/core/companion-protocol';
import { projectCompanionWorkspace } from '@workspace/core/companion-projection';
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
  model: z.string().min(1).max(200).nullable().optional(), reasoningEffort: z.string().min(1).max(40).nullable().optional(),
  serviceTier: z.string().min(1).max(80).nullable().optional(), planMode: z.boolean().optional(), inputMethod: z.enum(['typed', 'dictated']).optional(),
  delegation: z.object({ startingContext: z.enum(['conversation', 'handoff']), instructions: z.string().max(100_000).optional() }).strict().optional(),
}).strict();
const reviewSchema = z.object({ agentId: identity, input: z.object({ scope: z.discriminatedUnion('type', [z.object({ type: z.literal('uncommitted') }).strict(), z.object({ type: z.literal('branch'), baseRef: z.string().min(1).max(200) }).strict()]),
  threadMode: z.enum(['current', 'independent']), instructions: z.string().max(100_000).optional() }).strict() }).strict();
type CompanionPromptOptions = z.infer<typeof promptOptionsSchema>;
const maxUploadBytes = 2_500_000;
const uploadSchema = z.object({ type: z.enum(['image', 'file']), name: z.string().min(1).max(200), mimeType: z.string().max(120), data: z.string().max(Math.ceil(maxUploadBytes * 4 / 3) + 4).regex(/^[A-Za-z0-9+/]*={0,2}$/) }).strict();
const commandSchema = z.object({ target: targetSchema, text: z.string().max(100_000), clientCommandId: z.string().uuid(), options: promptOptionsSchema.optional(), attachments: z.array(uploadSchema).max(5).optional() }).strict()
  .refine((command) => command.text.length > 0 || (command.attachments?.length ?? 0) > 0, 'A prompt needs text or an attachment.');
const modelSelectionSchema = z.object({ agentId: identity, model: z.string().min(1).max(200), reasoningEffort: z.string().min(1).max(40).nullable(), serviceTier: z.string().min(1).max(80).nullable() }).strict();
export type GatewayState = { grants: CompanionGrant[]; commands: Record<string, CompanionCommandReceipt & { fingerprint: string }> };
export type GatewayPort = {
  respondRequest?(response: AgentRequestResponse): Promise<void>;
  onEvent?(listener: (event: AppBackendEvent) => void): () => void;
  workspace(): Promise<CompanionWorkspace>;
  conversation(agentId: string): Promise<CompanionReset>;
  loadOlderHistory(agentId: string): Promise<{ hasOlder: boolean }>;
  submit(agentId: string, text: string, clientId: string, options?: CompanionPromptOptions, uploads?: CompanionUpload[]): Promise<void>;
  models(agentId: string): Promise<unknown[]>;
  interrupt(agentId: string): Promise<void>;
  restart(agentId: string): Promise<void>;
  closePreview(agentId: string): Promise<Omit<CompanionClosePreview, 'target'>>;
  close(agentId: string, input?: CompanionCloseOptions): Promise<void>;
  setApprovalPreset(agentId: string, preset: string): Promise<void>;
  setPermissionMode(agentId: string, mode: string): Promise<void>;
  startReview(agentId: string, input: z.infer<typeof reviewSchema>['input']): Promise<void>;
  selectModel(agentId: string, selection: { model: string; reasoningEffort: string | null; serviceTier: string | null }): Promise<void>;
  save(state: GatewayState): Promise<void>;
  revoked(peerId: string): void;
};

/** Peer identity is supplied exclusively by the authenticated Noise connection. */
export class CompanionGateway {
  /** Keyed by the public rendezvous channel (first half of the code); the whole code is the PAKE password. */
  private readonly invitations = new Map<string, { code: string; expiresAt: number; attempts: number; sessions: Map<string, { confirm: Uint8Array; name: string }>; pendingId?: string }>();
  private readonly pending = new Map<string, CompanionPending & { channel: string }>();
  private mutations = Promise.resolve();
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
  async revoke(peerId: string) {
    return this.mutate(async () => {
      const next = { ...this.state, grants: this.state.grants.filter((grant) => grant.peerId !== peerId) };
      await this.port.save(next); this.state = next;
      this.port.revoked(peerId);
    });
  }
  subscribe(peerId: string, emit: ConstructorParameters<typeof CompanionSubscription>[1], fail: () => void) {
    const grant = this.state.grants.find((grant) => grant.peerId === peerId);
    if (!grant || !this.port.onEvent) throw new Error('Device is not authorized for updates.');
    return new CompanionSubscription({
      authorized: () => this.state.grants.includes(grant),
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
    if (method === 'snapshot.get') {
      const { iconsVersion } = z.object({ iconsVersion: z.string().max(64).optional() }).strict().parse(args);
      const workspace = await this.port.workspace();
      this.requireGrant(peerId, grant);
      const { repositoryIcons, ...projected } = projectCompanionWorkspace(workspace);
      // Icons are large and rarely change: send them only when the phone's copy is out of date.
      const version = createHash('sha256').update(JSON.stringify(Object.entries(repositoryIcons).sort())).digest('hex').slice(0, 16);
      return { ...projected, iconsVersion: version, ...(version === iconsVersion ? {} : { repositoryIcons }) };
    }
    if (method === 'conversation.subscribe' || method === 'conversation.loadOlder') {
      const target = targetSchema.parse(args);
      await this.validateTarget(target);
      this.requireGrant(peerId, grant);
      const page = method === 'conversation.loadOlder' ? await this.port.loadOlderHistory(target.agentId) : null;
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
        await this.validateTarget(command.target);
        const uploads = command.attachments?.length ? command.attachments.map((upload) => ({ ...upload, data: Buffer.from(upload.data, 'base64') })) : undefined;
        if (uploads?.some((upload) => upload.data.byteLength > maxUploadBytes)) throw new Error('Attachment too large.');
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
    if (method === 'agent.review.start') {
      const { agentId, input } = reviewSchema.parse(args);
      await this.requireAgent(agentId); this.requireGrant(peerId, grant);
      await this.port.startReview(agentId, input);
      return {};
    }
    if (method === 'command.status') {
      const { clientCommandId } = z.object({ clientCommandId: z.string().uuid() }).strict().parse(args);
      const stored = this.state.commands[`${peerId}:${clientCommandId}`];
      return stored ? receipt(stored) : { clientCommandId, state: 'notReceived' };
    }
    if (method === 'device.forget') { z.object({}).strict().parse(args); await this.revoke(peerId); return {}; }
    throw new Error('Companion operation is not supported.');
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
