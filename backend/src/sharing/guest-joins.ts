import { chmod, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import type { PrivateKey } from '@libp2p/interface';
import { z } from 'zod';
import { companionPeerIdPattern } from '@workspace/core/companion-relay';
import { product } from '@workspace/core/product';
import { decodeConversationInvitation, decodeConversationShareLink, encodeConversationShareLink, type ConversationShareLink, type ShareRelay } from '@workspace/core/conversation-sharing';
import type { GuestJoinControl, GuestJoinState, GuestJoinView } from '@workspace/core/guest-navigation';
import type { ConversationContentInput, ConversationContentChunk } from '@workspace/core/contracts/conversation';
import { GuestConversationClient } from './guest-client';
import { GuestConversationTransport } from './guest-transport';

const nameSchema = z.string().max(200).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)).transform(value => value.trim()).pipe(z.string().min(1).max(80));
const idSchema = z.string().regex(/^[a-f0-9]{64}$/);
const controlSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('state') }).strict(), z.object({ action: z.literal('prepare'), link: z.string().max(2048), teamId: z.string().min(1).max(200).optional() }).strict(),
  ...(['open', 'leave', 'history', 'cancel'] as const).map(action => z.object({ action: z.literal(action), id: idSchema }).strict()),
  z.object({ action: z.literal('join'), id: idSchema, name: z.string().max(200) }).strict(),
  z.object({ action: z.literal('propose'), id: idSchema, proposalId: z.string().uuid(), text: z.string().min(1).max(100_000), followUpBehavior: z.enum(['queue', 'steer']).optional() }).strict(),
  z.object({ action: z.literal('withdraw'), id: idSchema, proposalId: z.string().uuid() }).strict(),
]);
const titleSchema = z.string().min(1).max(200).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value));
const recordSchema = z.object({ id: idSchema, link: z.string().max(2048), name: nameSchema, title: titleSchema.optional(), teamId: z.string().min(1).max(200).optional(), ownerId: z.string().regex(companionPeerIdPattern).optional(), binding: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
const storeSchema = z.object({ v: z.literal(2), identity: z.string().max(4096), joins: z.array(recordSchema) }).strict();
type JoinRecord = { ownerId?: string; id: string; link: string; name: string; title?: string; teamId?: string; binding?: string };
type Store = { v: 2; identity: string; joins: JoinRecord[] };
type Session = { link: ConversationShareLink; view: GuestJoinView; client?: GuestConversationClient; transport?: GuestConversationTransport; connecting?: Promise<void>; generation: number; timer?: ReturnType<typeof setTimeout>; retries: number; stopping?: Promise<void> };
export type GuestJoinsOptions = { directory: string; relay?: ShareRelay };
const keyFor = (link: ConversationShareLink) => createHash('sha256').update(JSON.stringify([link.relay, link.handle])).digest('hex');
const emptyView = (id: string, name = '', title?: string): GuestJoinView => ({ id, name, title: title ?? 'Shared conversation', status: 'needsName', participant: null, target: null, frame: null });

/** Installed guest authority. One protected app identity, durable pins/authorization, memory-only transcripts. */
export class GuestJoins {
  private saved?: Store;
  private key?: PrivateKey;
  private operations = Promise.resolve();
  private readonly sessions = new Map<string, Session>();
  private selected: GuestJoinView | null = null;
  private stopped = false;
  private readonly relay: ShareRelay;
  constructor(private readonly options: GuestJoinsOptions) { this.relay = options.relay ?? product.companionRelay; }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.operations.then(work); this.operations = next.then(() => {}, () => {}); return next;
  }
  async control(input: GuestJoinControl, currentTeamId?: string): Promise<GuestJoinState> {
    const parsed = controlSchema.safeParse(input); if (!parsed.success) throw new Error('Invalid guest operation.');
    const action = parsed.data;
    if (action.action === 'propose' || action.action === 'withdraw') {
      const session = this.ready(action.id); const generation = session.generation;
      if (action.action === 'propose') await session.client!.propose({ id: action.proposalId, text: action.text, ...(action.followUpBehavior ? { followUpBehavior: action.followUpBehavior } : {}) });
      else await session.client!.withdraw(action.proposalId);
      const proposalState = await session.client!.proposals();
      if (generation !== session.generation) throw new Error('Guest conversation unavailable.');
      session.view.proposalState = proposalState; return this.state();
    }
    // A history read must not hold the persistence mutex: Leave/revocation can cancel it.
    if (action.action === 'history') {
      const session = this.ready(action.id); const generation = session.generation;
      await session.client!.loadOlder(); if (generation !== session.generation) throw new Error('Guest conversation unavailable.');
      return this.state();
    }
    return this.serial(async () => {
      if (this.stopped) throw new Error('Guest conversations closed.');
      await this.load();
      if (action.action === 'prepare') {
        const link = decodeConversationInvitation(action.link, this.relay);
        if (!link) {
          this.selected = { ...emptyView('invalid'), status: 'invalid' }; return this.state();
        }
        const id = keyFor(link); let session = this.sessions.get(id);
        const record = this.saved!.joins.find(record => record.id === id);
        if (!session) { session = { link: { ...link, ...(record?.ownerId ? { ownerId: record.ownerId } : {}) }, view: emptyView(id, record?.name, record?.title), generation: 0, retries: 0 }; this.sessions.set(id, session); }
        // A substituted credential cannot replace a previously saved authorization for the same route.
        if (session.link.credential !== link.credential) { this.selected = { ...emptyView('invalid'), status: 'invalid' }; return this.state(); }
        session.view.teamId ??= record?.teamId ?? action.teamId ?? currentTeamId;
        this.select(session);
        if (record) this.connect(session);
      } else if (action.action === 'open') {
        const ended = this.sessions.get(action.id);
        if (ended?.view.status === 'rejected') { this.select(ended); return this.state(); }
        const record = this.saved!.joins.find(record => record.id === action.id); if (!record) throw new Error('Shared conversation not found.');
        let session = this.sessions.get(record.id);
        if (!session) {
          const link = decodeConversationShareLink(record.link, this.relay); if (!link) throw new Error('Saved relay is unsupported.');
          session = { link: { ...link, ownerId: record.ownerId }, view: { ...emptyView(record.id, record.name, record.title), teamId: record.teamId ?? currentTeamId }, generation: 0, retries: 0 }; this.sessions.set(record.id, session);
        }
        this.select(session); this.connect(session);
      } else if (action.action === 'join') {
        const name = nameSchema.safeParse(action.name); if (!name.success) throw new Error('Invalid display name.');
        const session = this.sessions.get(action.id); if (!session || ['rejected', 'storageUnavailable'].includes(session.view.status)) throw new Error('Shared conversation not found.');
        const existing = this.saved!.joins.find(record => record.id === action.id);
        if (!existing) await this.write({ ...this.saved!, joins: [...this.saved!.joins, { id: action.id, link: encodeConversationShareLink(session.link), name: name.data, ...(session.view.teamId ?? currentTeamId ? { teamId: session.view.teamId ?? currentTeamId } : {}) }] });
        session.view.name = existing?.name ?? name.data; this.select(session); this.connect(session);
      } else if (action.action === 'cancel') {
        // Cancel discards only an unconfirmed invitation; saved joins are unaffected.
        if (!this.saved!.joins.some(record => record.id === action.id)) {
          const session = this.sessions.get(action.id); if (session) this.dispose(session);
          this.sessions.delete(action.id); if (this.selected?.id === action.id) this.selected = null;
        }
      } else if (action.action === 'leave') {
        if (this.saved!.joins.some(record => record.id === action.id)) await this.write({ ...this.saved!, joins: this.saved!.joins.filter(record => record.id !== action.id) });
        const session = this.sessions.get(action.id); if (session) this.dispose(session);
        this.sessions.delete(action.id); if (this.selected?.id === action.id) this.selected = null;
      }
      return this.state();
    });
  }
  private select(session: Session) {
    for (const previous of this.sessions.values()) {
      if (previous === session) continue;
      this.dispose(previous); if (previous.view.status !== 'rejected' && !this.saved?.joins.some(record => record.id === previous.view.id)) this.sessions.delete(previous.view.id);
    }
    this.selected = session.view;
  }
  private state(): GuestJoinState {
    const entries = (this.saved?.joins ?? []).map(({ id, name, title, teamId }) => ({ id, name, title: emptyView(id, name, title).title, ...(teamId ? { teamId } : {}) }));
    // Ended rows are navigation only: authorization and transcripts have been removed.
    for (const session of this.sessions.values()) {
      if (session.view.status !== 'rejected' || entries.some(entry => entry.id === session.view.id)) continue;
      const { id, name, title, teamId } = session.view;
      entries.push({ id, name, title, ...(teamId ? { teamId } : {}) });
    }
    const view = this.selected ? { ...this.selected, title: entries.find(entry => entry.id === this.selected!.id)?.title ?? this.selected.title } : null;
    return structuredClone({ entries, view });
  }
  private ready(id: string) {
    const session = this.sessions.get(id);
    if (!session || session.view.status !== 'ready' || !session.client) throw new Error('Guest conversation unavailable.');
    return session;
  }
  async readImage(id: string, imagePath: string): Promise<{ dataUrl: string }> {
    if (!idSchema.safeParse(id).success || typeof imagePath !== 'string' || imagePath.length > 4096) throw new Error('Invalid guest image.');
    const session = this.ready(id); const generation = session.generation; const result = await session.client!.readImage(imagePath);
    if (generation !== session.generation || session.view.status !== 'ready') throw new Error('Guest conversation unavailable.'); return result;
  }
  async readContent(id: string, input: ConversationContentInput): Promise<ConversationContentChunk> {
    if (!idSchema.safeParse(id).success) throw new Error('Invalid guest content.');
    const session = this.ready(id); const generation = session.generation; const result = await session.client!.readContent(input);
    if (generation !== session.generation || session.view.status !== 'ready') throw new Error('Guest conversation unavailable.'); return result;
  }
  private connect(session: Session) {
    if (['rejected', 'storageUnavailable'].includes(session.view.status) || session.connecting || (session.view.status === 'ready' && session.client) || !this.key || this.stopped) return;
    clearTimeout(session.timer); session.timer = undefined;
    const generation = ++session.generation; session.view.status = 'connecting';
    const current = () => !this.stopped && generation === session.generation && this.sessions.get(session.view.id) === session;
    const work = async () => {
      const previousTransport = session.transport; session.client?.close(); session.client = undefined; await session.stopping; await previousTransport?.stop();
      if (!current()) return;
      const transport = new GuestConversationTransport(this.key!, this.relay); session.transport = transport;
      const opened = await transport.open(session.link);
      if (!current()) { if (opened.status === 'ready') opened.stream.abort(new Error('Guest join cancelled.')); await transport.stop(); return; }
      if (opened.status !== 'ready') { session.view.status = opened.status === 'upgradeRequired' ? 'upgradeRequired' : opened.status === 'capacity' || opened.status === 'rateLimited' ? 'busy' : 'unavailable'; return; }
      try {
        await this.serial(async () => {
          if (!current()) return;
          if (session.link.ownerId === opened.ownerId) return;
          await this.write({ ...this.saved!, joins: this.saved!.joins.map(record => record.id === session.view.id ? { ...record, ownerId: opened.ownerId } : record) });
          session.link.ownerId = opened.ownerId;
        });
      } catch { await transport.stop(); session.view.status = 'storageUnavailable'; return; }
      if (!current()) { await transport.stop(); return; }
      const client = new GuestConversationClient(opened.stream, () => {
        if (current() && client.snapshot) session.view.frame = client.snapshot;
        if (current() && client.proposalState) session.view.proposalState = client.proposalState;
      }, reason => {
        if (!current()) return;
        session.client = undefined;
        if (reason === 'revoked') { void this.reject(session).catch(() => {}); return; }
        session.view.status = 'unavailable'; this.retry(session);
      }); session.client = client;
      try {
        const joined = await client.join(session.link, session.view.name);
        if (!current()) return;
        const record = this.saved!.joins.find(record => record.id === session.view.id);
        if (!record || (record.binding && record.binding !== createHash('sha256').update(JSON.stringify(joined.target)).digest('hex'))) { await this.reject(session); return; }
        await this.serial(async () => {
          if (!current()) return;
          const title = titleSchema.safeParse(joined.title);
          await this.write({ ...this.saved!, joins: this.saved!.joins.map(saved => saved.id === record.id ? { ...saved, ...(title.success ? { title: title.data } : {}), binding: createHash('sha256').update(JSON.stringify(joined.target)).digest('hex') } : saved) });
        });
        if (!current()) return;
        session.view.title = this.saved!.joins.find(saved => saved.id === record.id)?.title ?? session.view.title;
        session.view.target = joined.target; session.view.participant = joined.participant;
        await client.synchronize(); if (!current()) return;
        session.view.frame = client.snapshot; session.view.status = 'ready'; session.retries = 0;
        void client.proposals().catch(() => {});
      } catch (error) {
        if (!current()) return;
        if (error instanceof Error && error.message === 'denied') { await this.reject(session); return; }
        session.view.status = error instanceof Error && error.message.startsWith('Guest storage is unavailable') ? 'storageUnavailable'
          : error instanceof Error && ['busy', 'rateLimited'].includes(error.message) ? 'busy' : 'unavailable';
        session.client = undefined; client.close();
      }
    };
    session.connecting = work().catch(() => { if (current()) session.view.status = 'unavailable'; }).finally(() => {
      session.connecting = undefined; if (current() && (session.view.status === 'unavailable' || session.view.status === 'busy')) this.retry(session);
      // A reopen during a stale attempt returned early from connect(); resume it now that the attempt has settled.
      else if (!current() && !this.stopped && this.selected === session.view && this.sessions.get(session.view.id) === session && session.view.status === 'unavailable' && !session.timer
        && this.saved?.joins.some(record => record.id === session.view.id)) this.connect(session);
    });
  }
  private retry(session: Session) {
    if (session.timer || this.stopped || !this.saved?.joins.some(record => record.id === session.view.id)) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(session.retries++, 5));
    session.timer = setTimeout(() => { session.timer = undefined; this.connect(session); }, delay); session.timer.unref();
  }
  private async reject(session: Session) {
    this.dispose(session); session.view.proposalState = undefined; session.view.status = 'rejected'; session.view.frame = null; session.view.participant = null; session.view.target = null;
    try {
      await this.serial(async () => {
        if (this.saved) await this.write({ ...this.saved, joins: this.saved.joins.filter(record => record.id !== session.view.id) });
      });
    } catch { session.view.status = 'storageUnavailable'; }
  }
  private dispose(session: Session) {
    ++session.generation; clearTimeout(session.timer); session.timer = undefined;
    const client = session.client; session.client = undefined; client?.close();
    session.stopping = session.transport?.stop(); session.view.frame = null;
    if (session.view.status === 'ready' || session.view.status === 'connecting') session.view.status = 'unavailable';
  }
  async close() {
    this.stopped = true;
    for (const session of this.sessions.values()) this.dispose(session);
    await Promise.allSettled([...this.sessions.values()].map(session => session.stopping));
    this.sessions.clear(); this.selected = null; await this.operations;
  }
  private async load() {
    if (this.saved) return;
    try {
      await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
      const directory = await lstat(this.options.directory); if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error(); await chmod(this.options.directory, 0o700);
      const file = path.join(this.options.directory, 'state.json');
      try {
        const stats = await lstat(file); if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 16 * 1024 * 1024) throw new Error(); await chmod(file, 0o600);
        const raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
        // Legacy joins are intentionally discarded; retain only the protected app identity.
        if (raw && typeof raw === 'object' && 'v' in raw && raw.v === 1 && 'identity' in raw && typeof raw.identity === 'string') {
          this.key = privateKeyFromProtobuf(Buffer.from(raw.identity, 'base64'));
          await this.write({ v: 2, identity: raw.identity, joins: [] }); return;
        }
        const saved = storeSchema.parse(raw);
        const seen = new Set<string>();
        for (const record of saved.joins) {
          const link = decodeConversationShareLink(record.link, this.relay); if (!link || keyFor(link) !== record.id || seen.has(record.id)) throw new Error(); seen.add(record.id);
        }
        this.key = privateKeyFromProtobuf(Buffer.from(saved.identity, 'base64')); this.saved = saved as Store;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        this.key = await generateKeyPair('Ed25519'); await this.write({ v: 2, identity: Buffer.from(privateKeyToProtobuf(this.key)).toString('base64'), joins: [] });
      }
    } catch { throw new Error('Guest storage is unavailable. Check local storage and try again.'); }
  }
  private async write(next: Store) {
    const file = path.join(this.options.directory, 'state.json'); const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const encoded = JSON.stringify(next); if (Buffer.byteLength(encoded) > 16 * 1024 * 1024) throw new Error();
      const handle = await open(temporary, 'wx', 0o600); try { await handle.writeFile(encoded); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, file);
      if (process.platform !== 'win32') { const directory = await open(this.options.directory, 'r'); try { await directory.sync(); } finally { await directory.close(); } }
      this.saved = next;
    } catch { throw new Error('Guest storage is unavailable. Check local storage and try again.'); }
    finally { await unlink(temporary).catch(() => {}); }
  }
}
