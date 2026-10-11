import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { CompanionCommandReceipt, CompanionGrant, CompanionPending, CompanionReset, CompanionTarget, CompanionWorkspace } from '@workspace/core/companion-protocol';
import { companionSessionId } from '@workspace/core/companion-protocol';

const identity = z.string().min(1).max(200);
const targetSchema = z.object({ hostId: identity, locationId: identity, teamId: identity, agentId: identity, sessionId: z.string().max(500).nullable() }).strict();
const commandSchema = z.object({ target: targetSchema, text: z.string().min(1).max(100_000), clientCommandId: z.string().uuid() }).strict();
export type GatewayState = { grants: CompanionGrant[]; commands: Record<string, CompanionCommandReceipt & { fingerprint: string }> };
export type GatewayPort = {
  workspace(): Promise<CompanionWorkspace>;
  conversation(agentId: string): Promise<CompanionReset>;
  submit(agentId: string, text: string, clientId: string): Promise<void>;
  save(state: GatewayState): Promise<void>;
  revoked(peerId: string): void;
};

/** Peer identity is supplied exclusively by the authenticated Noise connection. */
export class CompanionGateway {
  private readonly invitations = new Map<string, { digest: Buffer; expiresAt: number; pendingId?: string }>();
  private readonly pending = new Map<string, CompanionPending & { inviteId: string }>();
  private mutations = Promise.resolve();
  constructor(readonly hostId: string, private state: GatewayState, private readonly port: GatewayPort, private readonly now = Date.now) {}
  get grants() { return this.state.grants.map((grant) => ({ ...grant, teamIds: [...grant.teamIds] })); }
  get pendingRequests() { this.expire(); return [...this.pending.values()].map(({ inviteId: _invite, ...pending }) => pending); }
  invite() {
    this.expire();
    if (this.invitations.size >= 5) throw new Error('Too many active invitations.');
    const inviteId = randomUUID(); const inviteSecret = randomBytes(32).toString('base64url'); const expiresAt = this.now() + 300_000;
    this.invitations.set(inviteId, { digest: digest(inviteSecret), expiresAt });
    return { inviteId, inviteSecret, expiresAt };
  }
  async decide(id: string, approve: boolean, teamIds: string[], canSend: boolean) {
    return this.mutate(async () => {
      this.expire();
      const pending = this.pending.get(id);
      if (!pending) throw new Error('Pairing request expired or consumed.');
      const workspace = await this.port.workspace();
      this.expire();
      if (this.pending.get(id) !== pending) throw new Error('Pairing request expired or consumed.');
      if (approve && this.state.grants.length >= 20 && !this.state.grants.some((grant) => grant.peerId === pending.peerId)) throw new Error('Too many paired devices.');
      if (approve && (!teamIds.length || teamIds.some((id) => !workspace.teams.some((team) => team.id === id)))) throw new Error('Invalid team scope.');
      const next = { ...this.state, grants: this.state.grants.filter((grant) => grant.peerId !== pending.peerId) };
      if (approve) next.grants.push({ peerId: pending.peerId, name: pending.name, teamIds: [...new Set(teamIds)], canSend, createdAt: this.now() });
      await this.port.save(next);
      this.state = next;
      this.pending.delete(id); this.invitations.delete(pending.inviteId);
    });
  }
  async revoke(peerId: string) {
    return this.mutate(async () => {
      const next = { ...this.state, grants: this.state.grants.filter((grant) => grant.peerId !== peerId) };
      await this.port.save(next); this.state = next;
      this.port.revoked(peerId);
    });
  }
  async request(peerId: string, method: string, args: unknown): Promise<unknown> {
    this.expire();
    if (method === 'pair.request') {
      const request = z.object({ inviteId: z.string().uuid(), inviteSecret: z.string().min(40).max(100), name: z.string().trim().min(1).max(80) }).strict().parse(args);
      const invitation = this.invitations.get(request.inviteId);
      if (!invitation || !timingSafeEqual(invitation.digest, digest(request.inviteSecret))) throw new Error('Invalid or expired invitation.');
      if (this.state.grants.some((grant) => grant.peerId === peerId)) {
        // An already approved device can recover a lost local pairing record without
        // leaving a second approval request or changing its existing scope.
        this.invitations.delete(request.inviteId);
        return { pendingId: randomUUID(), state: 'approved' };
      }
      if (invitation.pendingId) {
        const pending = this.pending.get(invitation.pendingId);
        if (pending?.peerId === peerId) return { pendingId: pending.id, state: 'awaitingApproval' };
        throw new Error('Invitation already claimed.');
      }
      const id = randomUUID();
      this.pending.set(id, { id, peerId, name: request.name, inviteId: request.inviteId, expiresAt: invitation.expiresAt });
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
      z.object({}).strict().parse(args);
      const workspace = await this.port.workspace();
      this.requireGrant(peerId, grant);
      const teams = workspace.teams.filter((team) => grant.teamIds.includes(team.id)).map(({ id, name, avatar, agentIds, remoteConnectionId }) => ({ id, name, avatar, agentIds, remoteConnectionId }));
      const agents = workspace.agents.filter((agent) => teams.some((team) => team.id === agent.teamId)).map(({ id, teamId, name, avatar, backend, backendSession, status, statusText, createdAt, updatedAt }) => ({ id, teamId, name, avatar, backend, backendSession: backendSession?.kind === 'claude' ? { kind: backendSession.kind, sessionId: backendSession.sessionId, transport: backendSession.transport } : backendSession, status, statusText, createdAt, updatedAt, folder: null }));
      return { teams, agents };
    }
    if (method === 'conversation.subscribe') {
      const target = targetSchema.parse(args);
      await this.validateTarget(grant, target);
      const frame = await this.port.conversation(target.agentId);
      const current = await this.validateTarget(grant, target);
      this.requireGrant(peerId, grant);
      const session = current.backendSession;
      if (frame.backend !== current.backend || (session?.kind === 'codex' && (frame.type !== 'codex.conversationSnapshotChanged' || frame.threadId !== session.threadId))
        || (session?.kind === 'claude' && (frame.type !== 'claude.conversationSnapshotChanged' || frame.payload.snapshot.sessionId !== session.sessionId))
        || (session?.kind === 'antigravity' && (frame.type !== 'antigravity.conversationSnapshotChanged' || frame.payload.snapshot.sessionId !== session.sessionId))) throw new Error('Conversation session mismatch.');
      if (frame.agentId !== target.agentId) throw new Error('Conversation identity mismatch.');
      return frame;
    }
    if (method === 'prompt.submit') {
      const command = commandSchema.parse(args);
      if (!grant.canSend) throw new Error('This device has read-only access.');
      const ledgerKey = `${peerId}:${command.clientCommandId}`;
      const fingerprint = createHash('sha256').update(JSON.stringify(command)).digest('hex');
      const existing = this.state.commands[ledgerKey];
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error('Command identity was reused.');
        return receipt(existing);
      }
      return this.mutate(async () => {
        // Recheck inside the serialized admission boundary, including revocation and concurrent retries.
        const currentGrant = this.state.grants.find((item) => item.peerId === peerId);
        if (!currentGrant?.canSend) throw new Error('Device is not authorized to send.');
        const duplicate = this.state.commands[ledgerKey];
        if (duplicate) { if (duplicate.fingerprint !== fingerprint) throw new Error('Command identity was reused.'); return receipt(duplicate); }
        await this.validateTarget(currentGrant, command.target);
        if (Object.keys(this.state.commands).length >= 10_000) throw new Error('Command receipt storage is full.');
        const pending = { clientCommandId: command.clientCommandId, state: 'pending' as const, target: command.target, fingerprint };
        const next = { ...this.state, commands: { ...this.state.commands, [ledgerKey]: pending } };
        await this.port.save(next); this.state = next;
        let state: 'accepted' | 'unresolved' = 'unresolved';
        try { await this.port.submit(command.target.agentId, command.text, `mobile:${peerId}`); state = 'accepted'; } catch { /* Admission may have happened; never replay. */ }
        const completed = { ...pending, state };
        const saved = { ...this.state, commands: { ...this.state.commands, [ledgerKey]: completed } };
        await this.port.save(saved); this.state = saved;
        return receipt(completed);
      });
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
  private async validateTarget(grant: CompanionGrant, target: CompanionTarget) {
    const workspace = await this.port.workspace();
    const team = workspace.teams.find((team) => team.id === target.teamId);
    const agent = workspace.agents.find((agent) => agent.id === target.agentId && agent.teamId === target.teamId);
    if (target.hostId !== this.hostId || !grant.teamIds.includes(target.teamId) || !team || !agent
      || target.locationId !== (team.remoteConnectionId ?? 'local') || target.sessionId !== companionSessionId(agent)) throw new Error('Target is stale or outside the device scope.');
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
function digest(value: string) { return createHash('sha256').update(value).digest(); }
function receipt({ fingerprint: _fingerprint, ...receipt }: GatewayState['commands'][string]): CompanionCommandReceipt {
  // Persisted pending entries can mean a killed process after provider admission.
  return { ...receipt, state: receipt.state === 'pending' ? 'unresolved' : receipt.state };
}
