import { shareInvitationPattern, type ShareRoutingStatus } from '@workspace/core/conversation-share-relay';
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { GuestParticipant } from '@workspace/core/guest-conversation';
import type { AppSnapshot } from '@workspace/core/contracts';
import { conversationShareTarget, decodeConversationInvitation, encodeConversationInvitation, encodeConversationShareLink } from '@workspace/core/conversation-sharing';
import type { ConversationShareControl, ConversationShareRoute, ConversationShareLink, ConversationShareResult, ConversationShareState, ConversationShareTarget, ShareRelay } from '@workspace/core/conversation-sharing';
import type { GuestProposal, GuestProposalState } from '@workspace/core/conversation-sharing';

const bounded = z.string().min(1).max(4096);
const conversation = z.discriminatedUnion('backend', [
  z.object({ backend: z.literal('codex'), threadId: bounded }).strict(),
  z.object({ backend: z.literal('claude'), sessionId: bounded, folder: bounded.nullable() }).strict(),
  z.object({ backend: z.literal('antigravity'), sessionId: bounded, folder: bounded.nullable() }).strict(),
]);
const targetSchema = z.object({ agentId: bounded, backend: z.enum(['codex', 'claude', 'antigravity']), sessionId: bounded, conversation }).strict();
const handleSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const recordSchema = z.object({ v: z.literal(2), relay: z.object({ origin: bounded, peerId: bounded }).strict(), ownerId: bounded,
  handle: handleSchema, credential: z.string().regex(shareInvitationPattern), target: targetSchema, createdAt: z.string(), revokedAt: z.string().optional() }).strict();
const proposalSchema = z.object({ id: z.string().uuid(), handle: handleSchema, identity: bounded, name: z.string().min(1).max(80), discriminator: z.string().length(8), text: z.string().max(100_000), followUpBehavior: z.enum(['queue', 'steer']).optional(), accessId: z.string().uuid().optional(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(), status: z.enum(['pending', 'queued', 'dispatching', 'dismissed', 'submitted', 'rejected', 'unresolved']), createdAt: z.string(), messageId: bounded.optional(), turnId: bounded.optional() }).strict();
const storeSchema = z.object({ v: z.literal(2), links: z.array(recordSchema), proposals: z.array(proposalSchema).optional() }).strict();
const controlSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), target: targetSchema }).strict(),
  z.object({ action: z.literal('create'), target: targetSchema }).strict(),
  z.object({ action: z.literal('copy'), target: targetSchema }).strict(),
  z.object({ action: z.literal('revoke'), target: targetSchema, handle: handleSchema }).strict(),
  z.object({ action: z.literal('access'), target: targetSchema, handle: handleSchema, identity: bounded, writeAccess: z.boolean() }).strict(),
  z.object({ action: z.enum(['send', 'dismiss']), target: targetSchema, handle: handleSchema, proposalId: z.string().uuid() }).strict(),
]);
type ShareRecord = ConversationShareLink & { ownerId: string; target: ConversationShareTarget; createdAt: string; revokedAt?: string };
export type GuestConversationGrant = { target: ConversationShareTarget; title: string; valid(): boolean; onRevoke(listener: () => void): () => void };
type StoredProposal = GuestProposal & { fingerprint?: string; followUpBehavior?: 'queue' | 'steer'; accessId?: string };
type SubmissionContext = { followUpBehavior?: 'queue' | 'steer' };
type Store = { v: 2; links: ShareRecord[]; proposals?: StoredProposal[] };
const fingerprint = (text: string) => createHash('sha256').update(text).digest('hex');
const publicProposal = ({ followUpBehavior: _behavior, accessId: _access, fingerprint: _fingerprint, ...proposal }: StoredProposal): GuestProposal => proposal;
const pendingStatuses = ['pending', 'queued', 'dispatching'];
const compactProposal = (record: StoredProposal): StoredProposal => ['dismissed', 'submitted', 'rejected'].includes(record.status) ? { ...record, fingerprint: record.fingerprint ?? fingerprint(record.text), text: '' } : record;
export type ConversationSharingOptions = { directory: string; endpoint(): Promise<{ ownerId: string; relay: ShareRelay } | null>;
  canSubmit?(target: ConversationShareTarget, context: SubmissionContext): boolean;
  submit?(target: ConversationShareTarget, text: string, context: SubmissionContext): Promise<{ turnId?: string; messageId?: string }>;
  routing?: {
    update(routes: ConversationShareRoute[]): Promise<ShareRoutingStatus>;
    subscribe(listener: (status: ShareRoutingStatus) => void): () => void;
  };
};
const conversationKey = (target: ConversationShareTarget) => JSON.stringify([target.backend, target.sessionId,
  target.conversation.backend === 'codex' ? target.conversation.threadId : [target.conversation.folder, target.conversation.sessionId]]);
const sameTarget = (a: ConversationShareTarget, b: ConversationShareTarget) => a.agentId === b.agentId && conversationKey(a) === conversationKey(b);

/** Daemon-owned, serialized durable authority. No phone grants, renderer minting or expiry. */
export class ConversationShares {
  private saved?: Store;
  private operations = Promise.resolve();
  private dispatching = false;
  private closed = false;
  private readonly invalidated = new Set<string>();
  private readonly guests = new Map<string, GuestParticipant[]>();
  private readonly writeAccess = new Map<string, Map<string, { id: string }>>();
  private readonly guestCounts = new Map<string, number>();
  private readonly revocations = new Map<string, Set<() => void>>();
  private pendingRecord?: ShareRecord;
  private reconcileQueued?: Promise<void>;
  private routingStatus: ConversationShareState['availability'] = 'transportPending';
  private readonly unsubscribeRouting?: () => void;
  constructor(private readonly options: ConversationSharingOptions, private readonly snapshot: () => AppSnapshot,
    private readonly changed: (agentId: string, state: ConversationShareState) => void) {
    this.unsubscribeRouting = options.routing?.subscribe(status => this.setRoutingStatus(status));
  }
  async close() { this.closed = true; this.unsubscribeRouting?.(); for (const handle of this.revocations.keys()) this.invalidate(handle); await this.operations; }
  propose(handle: string, identity: string, name: string, input: import('@workspace/core/conversation-sharing').GuestPromptInput): Promise<GuestProposal> {
    return this.serial(async () => {
      const value = z.object({ id: z.string().uuid(), text: z.string().min(1).max(100_000).refine(text => Boolean(text.trim())), followUpBehavior: z.enum(['queue', 'steer']).optional() }).strict().parse(input);
      await this.load();
      const link = this.saved!.links.find(link => link.handle === handle && !link.revokedAt);
      if (this.closed || !link || this.invalidated.has(handle) || !this.currentTarget(link.target)) throw new Error('denied');
      const records = this.saved!.proposals ?? [];
      const known = records.find(record => record.handle === handle && record.id === value.id);
      if (known) {
        if (known.identity !== identity || (known.fingerprint ?? fingerprint(known.text)) !== fingerprint(value.text)) throw new Error('denied');
        if (known.accessId && (known.followUpBehavior ?? 'queue') !== (value.followUpBehavior ?? 'queue')) throw new Error('denied');
        queueMicrotask(() => { void this.dispatchQueued().catch(() => {}); });
        return structuredClone(publicProposal(known));
      }
      const pending = records.filter(record => record.handle === handle && pendingStatuses.includes(record.status));
      if (pending.length >= 40 || pending.filter(record => record.identity === identity).length >= 5 || records.filter(record => record.handle === handle).length >= 10_000 || records.filter(record => record.handle === handle).reduce((total, record) => total + Buffer.byteLength(record.text), Buffer.byteLength(value.text)) > 2 * 1024 * 1024) throw new Error('busy');
      const proposal: StoredProposal = { id: value.id, text: value.text, fingerprint: fingerprint(value.text), handle, identity, name, discriminator: createHash('sha256').update(identity).digest('hex').slice(0, 8), status: 'pending', createdAt: new Date().toISOString() };
      const access = this.writeAccess.get(handle)?.get(identity);
      if (access) { proposal.status = 'queued'; proposal.followUpBehavior = value.followUpBehavior ?? 'queue'; proposal.accessId = access.id; }
      await this.write({ ...this.saved!, proposals: [...records, proposal] });
      this.changed(link.target.agentId, this.state(link, true));
      queueMicrotask(() => { void this.dispatchQueued().catch(() => {}); });
      return structuredClone(publicProposal(proposal));
    });
  }
  guestState(handle: string, identity: string): Promise<GuestProposalState> {
    return this.serial(async () => {
      await this.load();
      const records = (this.saved!.proposals ?? []).filter(record => record.handle === handle);
      return structuredClone({ writeAccess: Boolean(this.writeAccess.get(handle)?.has(identity)), proposals: records.filter(record => record.identity === identity).map(publicProposal), authors: this.authors(this.saved!.links.find(link => link.handle === handle)?.target) });
    });
  }
  withdraw(handle: string, identity: string, proposalId: string): Promise<void> {
    return this.serial(async () => {
      if (!z.string().uuid().safeParse(proposalId).success) throw new Error('denied');
      await this.load();
      const link = this.saved!.links.find(link => link.handle === handle && !link.revokedAt);
      const proposal = this.saved!.proposals?.find(record => record.handle === handle && record.id === proposalId);
      if (this.closed || !link || this.invalidated.has(handle) || !this.currentTarget(link.target)
        || !proposal || proposal.identity !== identity || !['pending', 'dismissed'].includes(proposal.status)) throw new Error('denied');
      if (proposal.status === 'dismissed') return;
      await this.write({ ...this.saved!, proposals: this.saved!.proposals!.map(record => record === proposal ? compactProposal({ ...record, status: 'dismissed' }) : record) });
      this.changed(link.target.agentId, this.state(link, true));
    });
  }
  /** Coordination admission queue, not a provider transcript or provider-native queue. */
  async dispatchQueued(): Promise<void> {
    if (this.dispatching || this.closed || !this.options.submit) return;
    this.dispatching = true;
    try {
      while (!this.closed) {
        const next = await this.serial(async () => {
          await this.load();
          const proposal = this.saved!.proposals?.find(record => record.status === 'queued' && this.saved!.links.some(link => link.handle === record.handle && !link.revokedAt && this.currentTarget(link.target) && this.authorizedProposal(record) && (this.options.canSubmit?.(link.target, record) ?? true)));
          if (!proposal) return null;
          const link = this.saved!.links.find(link => link.handle === proposal.handle)!;
          await this.write({ ...this.saved!, proposals: this.saved!.proposals!.map(record => record === proposal ? { ...record, status: 'dispatching' } : record) });
          return { proposal, target: link.target };
        });
        if (!next) return;
        let result: { turnId?: string; messageId?: string } = {};
        const authorized = !this.closed && !this.invalidated.has(next.proposal.handle) && this.saved?.links.some(link => link.handle === next.proposal.handle && !link.revokedAt) && this.currentTarget(next.target) && this.authorizedProposal(next.proposal);
        try { if (authorized) result = await this.options.submit(next.target, next.proposal.text, { followUpBehavior: next.proposal.followUpBehavior }); } catch { /* Possible delivery is never retried automatically. */ }
        await this.serial(async () => {
          if (this.closed) return;
          await this.load();
          await this.write({ ...this.saved!, proposals: (this.saved!.proposals ?? []).map(record => record.id === next.proposal.id && record.handle === next.proposal.handle ? compactProposal({ ...record, ...result, status: !authorized ? 'rejected' : result.messageId ? 'submitted' : 'unresolved' }) : record) });
          const link = this.saved!.links.find(link => link.handle === next.proposal.handle);
          if (link && !link.revokedAt) this.changed(link.target.agentId, this.state(link, true));
        });
      }
    } finally { this.dispatching = false; }
  }
  /** Admission is inside the authenticated guest circuit; credentials never reach routing. */
  authorize(handle: string, credential: string): Promise<GuestConversationGrant> {
    return this.serial(async () => {
      if (!handleSchema.safeParse(handle).success || !shareInvitationPattern.test(credential)) throw new Error('denied');
      await this.load(); await this.reconcileSaved();
      const link = this.saved!.links.find(link => link.handle === handle);
      if (!link || link.revokedAt || this.invalidated.has(handle) || !this.currentTarget(link.target)
        || !timingSafeEqual(Buffer.from(link.credential), Buffer.from(credential))) throw new Error('denied');
      const valid = () => Boolean(this.saved?.links.some(saved => saved.handle === handle && !saved.revokedAt)
        && !this.invalidated.has(handle) && this.currentTarget(link.target));
      const agent = this.snapshot().agents.find(agent => agent.id === link.target.agentId)!;
      const title = (agent.conversationTitle?.trim() || agent.name || 'Shared conversation').replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, 200) || 'Shared conversation';
      return { target: structuredClone(link.target), title, valid, onRevoke: listener => {
        const listeners = this.revocations.get(handle) ?? new Set<() => void>(); listeners.add(listener); this.revocations.set(handle, listeners);
        if (!valid()) listener();
        return () => { listeners.delete(listener); if (!listeners.size) this.revocations.delete(handle); };
      } };
    });
  }
  connected(handle: string, count: number, guests: GuestParticipant[] = []) {
    this.guests.set(handle, [...new Map(guests.map(guest => [guest.identity, guest])).values()]);
    const rights = this.writeAccess.get(handle);
    for (const identity of rights?.keys() ?? []) if (!guests.some(guest => guest.identity === identity)) rights!.delete(identity);
    // Disconnect invalidates authority immediately, before any queued disk operation.
    void this.serial(async () => {
      if (this.closed) return;
      await this.load();
      const proposals = this.saved!.proposals ?? [];
      if (!proposals.some(record => record.handle === handle && record.status === 'queued' && record.accessId && !this.authorizedProposal(record))) return;
      await this.write({ ...this.saved!, proposals: proposals.map(record => record.handle === handle && record.status === 'queued' && record.accessId && !this.authorizedProposal(record) ? { ...record, status: 'pending', followUpBehavior: undefined, accessId: undefined } : record) });
      const link = this.saved!.links.find(link => link.handle === handle && !link.revokedAt);
      if (link) this.changed(link.target.agentId, this.state(link, true));
    }).catch(() => {});
    if (count) this.guestCounts.set(handle, count); else this.guestCounts.delete(handle);
    const link = this.saved?.links.find(link => link.handle === handle && !link.revokedAt);
    if (link) this.changed(link.target.agentId, this.state(link, true));
  }
  private authorizedProposal(record: StoredProposal): boolean {
    return record.accessId === undefined || Boolean(record.accessId && this.writeAccess.get(record.handle)?.get(record.identity)?.id === record.accessId);
  }
  private invalidate(handle: string) {
    this.invalidated.add(handle);
    for (const listener of [...this.revocations.get(handle) ?? []]) listener();
    this.revocations.delete(handle); this.guestCounts.delete(handle); this.guests.delete(handle); this.writeAccess.delete(handle);
  }
  private setRoutingStatus(status: ShareRoutingStatus) {
    if (this.routingStatus === status) return;
    this.routingStatus = status;
    for (const link of this.saved?.links ?? []) if (!link.revokedAt) this.changed(link.target.agentId, this.state(link, true));
  }
  private async publish() {
    if (!this.options.routing) return;
    const routes = this.saved!.links.filter(link => !link.revokedAt && !this.invalidated.has(link.handle))
      .map(({ relay, ownerId, handle }) => ({ relay, ownerId, handle }));
    try { this.setRoutingStatus(await this.options.routing.update(routes)); }
    catch { this.setRoutingStatus('unavailable'); }
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.operations.then(work);
    this.operations = next.then(() => {}, () => {});
    return next;
  }
  control(input: ConversationShareControl): Promise<ConversationShareResult> {
    return this.serial(async () => {
      const parsed = controlSchema.safeParse(input);
      if (!parsed.success) throw new Error('Invalid share operation.');
      const action = parsed.data;
      await this.load();
      await this.reconcileSaved();
      if (!this.currentTarget(action.target)) throw new Error('Conversation is unavailable for sharing.');
      let active = this.saved!.links.find(link => !link.revokedAt && conversationKey(link.target) === conversationKey(action.target));
      if (action.action === 'access') {
        if (!active || active.handle !== action.handle || !this.guests.get(active.handle)?.some(guest => guest.identity === action.identity)) throw new Error('Guest is no longer connected.');
        const rights = this.writeAccess.get(active.handle) ?? new Map<string, { id: string }>();
        this.writeAccess.set(active.handle, rights);
        if (action.writeAccess) {
          if (!rights.has(action.identity)) rights.set(action.identity, { id: randomUUID() });
        } else rights.delete(action.identity);
        // Existing read-only suggestions are never promoted when access is enabled.
        if (!action.writeAccess) await this.write({ ...this.saved!, proposals: this.saved!.proposals?.map(record => record.handle === active!.handle && record.identity === action.identity && record.accessId && record.status === 'queued' ? { ...record, status: 'pending', followUpBehavior: undefined, accessId: undefined } : record) });
        this.changed(active.target.agentId, this.state(active, true));
        return { state: this.state(active, true) };
      }
      if (action.action === 'send' || action.action === 'dismiss') {
        if (!active || active.handle !== action.handle) throw new Error('Share link has changed.');
        const proposal = this.saved!.proposals?.find(record => record.handle === active!.handle && record.id === action.proposalId);
        if (!proposal) throw new Error('Proposal unavailable.');
        if (proposal.status === 'pending') {
          await this.write({ ...this.saved!, proposals: this.saved!.proposals!.map(record => record === proposal ? compactProposal({ ...record, followUpBehavior: undefined, accessId: undefined, status: action.action === 'send' ? 'queued' : 'dismissed' }) : record) });
          this.changed(action.target.agentId, this.state(active, true));
          queueMicrotask(() => { void this.dispatchQueued().catch(() => {}); });
        }
        return { state: this.state(active, true) };
      }
      if (action.action === 'revoke') {
        if (!active || active.handle !== action.handle) throw new Error('Share link has changed. Reopen Share.');
        await this.write({ ...this.saved!, links: this.saved!.links.map(link => link === active ? { ...link, revokedAt: new Date().toISOString() } : link), proposals: this.saved!.proposals?.map(record => record.handle === active!.handle && ['pending', 'queued'].includes(record.status) ? compactProposal({ ...record, status: 'rejected' }) : record) });
        this.invalidate(active.handle);
        await this.publish();
        this.changed(action.target.agentId, this.state(undefined, true, action.target));
        return { state: this.state(undefined, true, action.target) };
      }
      await this.publish();
      if (active) await this.checkCurrent(active, action.target);
      if (active) return { state: this.state(active, true), ...(action.action !== 'status' ? { link: encodeConversationShareLink(active), invitation: encodeConversationInvitation(active) } : {}) };
      const endpoint = await this.options.endpoint();
      if (action.action === 'status') return { state: this.state(undefined, Boolean(endpoint), action.target) };
      if (action.action === 'copy') throw new Error('Conversation is not shared.');
      if (!endpoint) throw new Error('Conversation sharing relay is not configured.');
      if (!this.currentTarget(action.target)) throw new Error('Conversation changed. Reopen Share.');
      active = { ...decodeConversationInvitation(randomUUID(), endpoint.relay)!, ownerId: endpoint.ownerId, target: action.target, createdAt: new Date().toISOString() };
      const link = encodeConversationShareLink(active);
      this.pendingRecord = active;
      try { await this.write({ ...this.saved!, links: [...this.saved!.links, active] }); }
      finally { this.pendingRecord = undefined; }
      // A target can change while fsync is in flight. Never expose a newly stale grant.
      if (this.invalidated.has(active.handle) || !this.currentTarget(action.target)) { await this.reconcileSaved(); throw new Error('Conversation changed. Reopen Share.'); }
      await this.publish();
      await this.checkCurrent(active, action.target);
      const state = this.state(active, true);
      this.changed(action.target.agentId, state);
      return { state, link, invitation: encodeConversationInvitation(active) };
    });
  }
  reconcile(): Promise<void> {
    // Capture immediately: a replacement followed by a restoration in the same tick
    // must still invalidate the original grant when the serialized write runs.
    const targets = this.currentTargets();
    for (const link of [...(this.saved?.links ?? []), ...(this.pendingRecord ? [this.pendingRecord] : [])]) {
      if (!link.revokedAt && !targets.some(target => sameTarget(target, link.target))) this.invalidate(link.handle);
    }
    // Coalesce: invalidation above is already synchronous, so one queued pass covers every call made before it starts.
    if (this.reconcileQueued) return this.reconcileQueued;
    const queued = this.serial(async () => { this.reconcileQueued = undefined; await this.load(); await this.reconcileSaved(this.currentTargets()); await this.publish(); });
    this.reconcileQueued = queued;
    return queued;
  }
  private async checkCurrent(link: ShareRecord, requested: ConversationShareTarget) {
    if (this.invalidated.has(link.handle) || !this.currentTarget(link.target) || !this.currentTarget(requested)) {
      await this.reconcileSaved();
      throw new Error('Conversation changed. Reopen Share.');
    }
  }
  private currentTargets(): ConversationShareTarget[] {
    const snapshot = this.snapshot();
    return snapshot.agents.flatMap(agent => {
      const team = snapshot.teams.find(team => team.id === agent.teamId);
      const target = conversationShareTarget(agent);
      return team && !agent.remoteConnectionId && target ? [target] : [];
    });
  }
  private currentTarget(target: ConversationShareTarget): boolean {
    const snapshot = this.snapshot();
    const agent = snapshot.agents.find(agent => agent.id === target.agentId);
    const team = snapshot.teams.find(team => team.id === agent?.teamId);
    const current = agent && conversationShareTarget(agent);
    return Boolean(team && !agent?.remoteConnectionId && current && sameTarget(current, target));
  }
  private state(active: ShareRecord | undefined, configured: boolean, target = active?.target): ConversationShareState {
    const records = active ? (this.saved?.proposals ?? []).filter(record => record.handle === active.handle) : [];
    const authors = this.authors(target);
    return { active: Boolean(active), handle: active?.handle ?? null, connectedGuests: active ? this.guestCounts.get(active.handle) ?? 0 : 0, availability: configured ? this.routingStatus : 'notConfigured', ...(active ? { guests: (this.guests.get(active.handle) ?? []).map(guest => ({ ...guest, writeAccess: Boolean(this.writeAccess.get(active.handle)?.has(guest.identity)) })) } : {}), ...(records.length || authors.length ? { proposals: structuredClone(records.map(publicProposal)), authors } : {}) };
  }
  private authors(target: ConversationShareTarget | undefined): GuestProposalState['authors'] {
    const handles = new Set((this.saved?.links ?? []).filter(link => target && conversationKey(link.target) === conversationKey(target)).map(link => link.handle));
    return (this.saved?.proposals ?? []).flatMap(record => handles.has(record.handle) && record.status === 'submitted' && record.messageId ? [{ messageId: record.messageId, identity: record.identity, name: record.name, discriminator: record.discriminator }] : []);
  }
  private async reconcileSaved(targets = this.currentTargets()) {
    const invalid = this.saved!.links.filter(link => !link.revokedAt && (this.invalidated.has(link.handle) || !targets.some(target => sameTarget(target, link.target))));
    for (const link of invalid) this.invalidate(link.handle);
    if (!invalid.length) return;
    await this.write({ ...this.saved!, links: this.saved!.links.map(link => invalid.includes(link) ? { ...link, revokedAt: new Date().toISOString() } : link), proposals: this.saved!.proposals?.map(record => invalid.some(link => link.handle === record.handle) && ['pending', 'queued'].includes(record.status) ? compactProposal({ ...record, status: 'rejected' }) : record) });
    await this.publish();
    for (const link of invalid) { this.invalidated.delete(link.handle); this.changed(link.target.agentId, this.state(undefined, true, link.target)); }
  }
  private async load() {
    if (this.saved) return;
    try {
      await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
      const directory = await lstat(this.options.directory);
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error();
      await chmod(this.options.directory, 0o700);
      const file = path.join(this.options.directory, 'state.json');
      try {
        const stats = await lstat(file);
        if (!stats.isFile() || stats.isSymbolicLink()) throw new Error();
        await chmod(file, 0o600);
        const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
        // Big-bang switch: withdraw all legacy grants rather than accepting old invitations.
        if (raw && typeof raw === 'object' && 'v' in raw && raw.v === 1) { await this.write({ v: 2, links: [] }); return; }
        const saved = storeSchema.parse(raw);
        const handles = new Set<string>(); const active = new Set<string>();
        for (const link of saved.links) {
          encodeConversationShareLink(link);
          if (handles.has(link.handle)) throw new Error(); handles.add(link.handle);
          const key = conversationKey(link.target);
          if (!link.revokedAt && active.has(key)) throw new Error();
          if (!link.revokedAt) active.add(key);
        }
        this.saved = saved;
        if (saved.proposals?.some(record => record.status === 'dispatching' || (record.status === 'queued' && record.accessId))) await this.write({ ...saved, proposals: saved.proposals.map(record => record.status === 'dispatching' ? { ...record, status: 'unresolved' } : record.status === 'queued' && record.accessId ? { ...record, status: 'pending', followUpBehavior: undefined, accessId: undefined } : record) });
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; this.saved = { v: 2, links: [] }; }
    } catch { throw new Error('Share storage is unavailable. Check local storage and try again.'); }
  }
  private async write(next: Store) {
    const file = path.join(this.options.directory, 'state.json');
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(next)); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, file);
      if (process.platform !== 'win32') {
        const directory = await open(this.options.directory, 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      }
      this.saved = next;
    } catch { this.saved = undefined; throw new Error('Share storage is unavailable. Check local storage and try again.'); }
    finally { await unlink(temporary).catch(() => {}); }
  }
}
