import type { ShareRoutingStatus } from '@workspace/core/conversation-share-relay';
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AppSnapshot } from '@workspace/core/contracts';
import { conversationShareTarget, encodeConversationShareLink } from '@workspace/core/conversation-sharing';
import type { ConversationShareControl, ConversationShareRoute, ConversationShareLink, ConversationShareResult, ConversationShareState, ConversationShareTarget, ShareRelay } from '@workspace/core/conversation-sharing';

const bounded = z.string().min(1).max(4096);
const conversation = z.discriminatedUnion('backend', [
  z.object({ backend: z.literal('codex'), threadId: bounded }).strict(),
  z.object({ backend: z.literal('claude'), sessionId: bounded, folder: bounded.nullable() }).strict(),
  z.object({ backend: z.literal('antigravity'), sessionId: bounded, folder: bounded.nullable() }).strict(),
]);
const targetSchema = z.object({ agentId: bounded, backend: z.enum(['codex', 'claude', 'antigravity']), sessionId: bounded, conversation }).strict();
const handleSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const recordSchema = z.object({ v: z.literal(1), relay: z.object({ origin: bounded, peerId: bounded }).strict(), ownerId: bounded,
  handle: handleSchema, credential: z.string().regex(/^[A-Za-z0-9_-]{43}$/), target: targetSchema, createdAt: z.string(), revokedAt: z.string().optional() }).strict();
const storeSchema = z.object({ v: z.literal(1), links: z.array(recordSchema) }).strict();
const controlSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), target: targetSchema }).strict(),
  z.object({ action: z.literal('create'), target: targetSchema }).strict(),
  z.object({ action: z.literal('copy'), target: targetSchema }).strict(),
  z.object({ action: z.literal('revoke'), target: targetSchema, handle: handleSchema }).strict(),
]);
type ShareRecord = ConversationShareLink & { target: ConversationShareTarget; createdAt: string; revokedAt?: string };
export type GuestConversationGrant = { target: ConversationShareTarget; valid(): boolean; onRevoke(listener: () => void): () => void };
type Store = { v: 1; links: ShareRecord[] };
export type ConversationSharingOptions = { directory: string; endpoint(): Promise<{ ownerId: string; relay: ShareRelay } | null>;
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
  private readonly invalidated = new Set<string>();
  private readonly guestCounts = new Map<string, number>();
  private readonly revocations = new Map<string, Set<() => void>>();
  private pendingRecord?: ShareRecord;
  private routingStatus: ConversationShareState['availability'] = 'transportPending';
  private readonly unsubscribeRouting?: () => void;
  constructor(private readonly options: ConversationSharingOptions, private readonly snapshot: () => AppSnapshot,
    private readonly changed: (agentId: string, state: ConversationShareState) => void) {
    this.unsubscribeRouting = options.routing?.subscribe(status => this.setRoutingStatus(status));
  }
  close() { this.unsubscribeRouting?.(); for (const handle of this.revocations.keys()) this.invalidate(handle); }
  /** Admission is inside the authenticated guest circuit; credentials never reach routing. */
  authorize(handle: string, credential: string): Promise<GuestConversationGrant> {
    return this.serial(async () => {
      if (!handleSchema.safeParse(handle).success || !/^[A-Za-z0-9_-]{43}$/.test(credential)) throw new Error('denied');
      await this.load(); await this.reconcileSaved();
      const link = this.saved!.links.find(link => link.handle === handle);
      if (!link || link.revokedAt || this.invalidated.has(handle) || !this.currentTarget(link.target)
        || !timingSafeEqual(Buffer.from(link.credential), Buffer.from(credential))) throw new Error('denied');
      const valid = () => Boolean(this.saved?.links.some(saved => saved.handle === handle && !saved.revokedAt)
        && !this.invalidated.has(handle) && this.currentTarget(link.target));
      return { target: structuredClone(link.target), valid, onRevoke: listener => {
        const listeners = this.revocations.get(handle) ?? new Set<() => void>(); listeners.add(listener); this.revocations.set(handle, listeners);
        if (!valid()) listener();
        return () => { listeners.delete(listener); if (!listeners.size) this.revocations.delete(handle); };
      } };
    });
  }
  connected(handle: string, count: number) {
    if (count) this.guestCounts.set(handle, count); else this.guestCounts.delete(handle);
    const link = this.saved?.links.find(link => link.handle === handle && !link.revokedAt);
    if (link) this.changed(link.target.agentId, this.state(link, true));
  }
  private invalidate(handle: string) {
    this.invalidated.add(handle);
    for (const listener of [...this.revocations.get(handle) ?? []]) listener();
    this.revocations.delete(handle); this.guestCounts.delete(handle);
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
      if (action.action === 'revoke') {
        if (!active || active.handle !== action.handle) throw new Error('Share link has changed. Reopen Share.');
        await this.write({ v: 1, links: this.saved!.links.map(link => link === active ? { ...link, revokedAt: new Date().toISOString() } : link) });
        this.invalidate(active.handle);
        await this.publish();
        this.changed(action.target.agentId, this.state(undefined, true));
        return { state: this.state(undefined, true) };
      }
      await this.publish();
      if (active) await this.checkCurrent(active, action.target);
      if (active) return { state: this.state(active, true), ...(action.action !== 'status' ? { link: encodeConversationShareLink(active) } : {}) };
      const endpoint = await this.options.endpoint();
      if (action.action === 'status') return { state: this.state(undefined, Boolean(endpoint)) };
      if (action.action === 'copy') throw new Error('Conversation is not shared.');
      if (!endpoint) throw new Error('Conversation sharing relay is not configured.');
      if (!this.currentTarget(action.target)) throw new Error('Conversation changed. Reopen Share.');
      active = { v: 1, ...endpoint, handle: randomBytes(24).toString('base64url'), credential: randomBytes(32).toString('base64url'), target: action.target, createdAt: new Date().toISOString() };
      const link = encodeConversationShareLink(active);
      this.pendingRecord = active;
      try { await this.write({ v: 1, links: [...this.saved!.links, active] }); }
      finally { this.pendingRecord = undefined; }
      // A target can change while fsync is in flight. Never expose a newly stale grant.
      if (this.invalidated.has(active.handle) || !this.currentTarget(action.target)) { await this.reconcileSaved(); throw new Error('Conversation changed. Reopen Share.'); }
      await this.publish();
      await this.checkCurrent(active, action.target);
      const state = this.state(active, true);
      this.changed(action.target.agentId, state);
      return { state, link };
    });
  }
  reconcile(): Promise<void> {
    // Capture immediately: a replacement followed by a restoration in the same tick
    // must still invalidate the original grant when the serialized write runs.
    const targets = this.currentTargets();
    for (const link of [...(this.saved?.links ?? []), ...(this.pendingRecord ? [this.pendingRecord] : [])]) {
      if (!link.revokedAt && !targets.some(target => sameTarget(target, link.target))) this.invalidate(link.handle);
    }
    return this.serial(async () => { await this.load(); await this.reconcileSaved(targets); await this.publish(); });
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
      return team && !team.remoteConnectionId && target ? [target] : [];
    });
  }
  private currentTarget(target: ConversationShareTarget): boolean {
    const snapshot = this.snapshot();
    const agent = snapshot.agents.find(agent => agent.id === target.agentId);
    const team = snapshot.teams.find(team => team.id === agent?.teamId);
    const current = agent && conversationShareTarget(agent);
    return Boolean(team && !team.remoteConnectionId && current && sameTarget(current, target));
  }
  private state(active: ShareRecord | undefined, configured: boolean): ConversationShareState {
    return { active: Boolean(active), handle: active?.handle ?? null, connectedGuests: active ? this.guestCounts.get(active.handle) ?? 0 : 0, availability: configured ? this.routingStatus : 'notConfigured' };
  }
  private async reconcileSaved(targets = this.currentTargets()) {
    const invalid = this.saved!.links.filter(link => !link.revokedAt && (this.invalidated.has(link.handle) || !targets.some(target => sameTarget(target, link.target))));
    for (const link of invalid) this.invalidate(link.handle);
    if (!invalid.length) return;
    await this.write({ v: 1, links: this.saved!.links.map(link => invalid.includes(link) ? { ...link, revokedAt: new Date().toISOString() } : link) });
    await this.publish();
    for (const link of invalid) { this.invalidated.delete(link.handle); this.changed(link.target.agentId, this.state(undefined, true)); }
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
        const saved = storeSchema.parse(JSON.parse(await readFile(file, 'utf8')));
        const handles = new Set<string>(); const active = new Set<string>();
        for (const link of saved.links) {
          encodeConversationShareLink(link);
          if (handles.has(link.handle)) throw new Error(); handles.add(link.handle);
          const key = conversationKey(link.target);
          if (!link.revokedAt && active.has(key)) throw new Error();
          if (!link.revokedAt) active.add(key);
        }
        this.saved = saved;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; this.saved = { v: 1, links: [] }; }
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
