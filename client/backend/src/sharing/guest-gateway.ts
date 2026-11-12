import type { Message } from '@korus-dev/multi-agent-sdk';
import { shareInvitationPattern } from '@workspace/core/conversation-share-relay';
import { conversationImageInput, readEmbeddedConversationImage } from '@workspace/core/conversation-images';
import { createHash } from 'node:crypto';
import type { Stream } from '@libp2p/interface';
import { z } from 'zod';
import { companionPeerIdPattern } from '@workspace/core/companion-relay';
import { companionFrameLimit, companionResponseLimit, companionBackgroundIdleTimeoutMs, encodeCompanionFrame, readCompanionFrames, type CompanionImage } from '@workspace/core/companion-protocol';
import { guestConversationLimit, guestOwnerLimit, type GuestConversationUpdate } from '@workspace/core/guest-conversation';
import { SessionConversationSource, deliveredMessages, guestConversationUpdate, guestSnapshotUpdate, isSessionConversationEvent } from './guest-conversation';
import type { ConversationShareTarget } from '@workspace/core/conversation-sharing';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import type { ConversationContentInput, ConversationContentChunk } from '@workspace/core/contracts/conversation';
import type { GuestConversationGrant } from './conversation-shares';
import { WindowBudget } from '../companion/source-budget';
import { conversationImageReferences, imagePath } from '../companion/images';
import { sendWithBackpressure } from '../companion/stream-io';
import { UpdateStreamWriter } from '../companion/update-writer';

export type GuestConversationPort = {
  propose?(handle: string, identity: string, name: string, input: import('@workspace/core/conversation-sharing').GuestPromptInput): Promise<import('@workspace/core/conversation-sharing').GuestProposal>;
  proposals?(handle: string, identity: string): Promise<import('@workspace/core/conversation-sharing').GuestProposalState>;
  withdraw?(handle: string, identity: string, proposalId: string): Promise<void>;
  authorize(handle: string, credential: string): Promise<GuestConversationGrant>;
  connected(handle: string, count: number, guests?: import('@workspace/core/guest-conversation').GuestParticipant[]): void;
  onEvent(listener: (event: AppBackendEvent) => void): () => void;
  /** Loads the agent's conversation, which publishes a fresh session snapshot before it resolves. */
  loadConversation(agentId: string): Promise<void>;
  loadOlderHistory(agentId: string): Promise<{ hasOlder: boolean }>;
  loadTurnHistory?(agentId: string, turnId: string): Promise<void>;
  readConversationContent(agentId: string, input: ConversationContentInput): Promise<ConversationContentChunk>;
  readImage(agentId: string, path: string): Promise<CompanionImage>;
};
class GuestResourceLimit extends Error {}
const requestSchema = z.object({ v: z.literal(1), id: z.string().uuid(), method: z.string().min(1).max(80), args: z.unknown() }).strict();
const joinSchema = z.object({ handle: z.string().regex(/^[A-Za-z0-9_-]{32}$/), credential: z.string().regex(shareInvitationPattern), name: z.string().max(200).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)).transform(value => value.trim()).pipe(z.string().min(1).max(80)) }).strict();
const emptySchema = z.object({}).strict();
const contentSchema = z.object({ input: z.object({ sessionId: z.string().min(1).max(4096), contentId: z.string().regex(/^[a-f0-9]{64}$/), offset: z.number().int().nonnegative().safe() }).strict() }).strict();
const imageSchema = z.object({ path: z.string().min(1).max(4096) }).strict();
/** Strict immutable identity checks apply to snapshots, patches and replay: the bound agent, provider and conversation only. */
function bound(update: GuestConversationUpdate, target: ConversationShareTarget): boolean {
  return update.agentId === target.agentId && update.provider === target.provider && update.payload.conversation === target.sessionId;
}

/** One encrypted stream, one bearer grant, one immutable target. No generic RPC or phone grant. */
export class GuestConversationGateway {
  private readonly streams = new Set<Stream>();
  private readonly sessions = new Map<Stream, { handle: string; identity: string; name: string; discriminator: string; close(): void }>();
  private readonly requests = new WindowBudget(120, 60_000, 1024);
  private readonly admissions = new WindowBudget(20, 60_000, 1024);
  private readonly source: SessionConversationSource;
  constructor(private readonly port: GuestConversationPort) { this.source = new SessionConversationSource(agentId => port.loadConversation(agentId)); }
  close() { for (const session of [...this.sessions.values()]) session.close(); for (const stream of this.streams) stream.abort(new Error('Guest gateway stopped.')); }
  async accept(stream: Stream, peer: string): Promise<void> {
    // Bound unauthenticated stream work as well as admitted sessions.
    if (!companionPeerIdPattern.test(peer) || this.streams.size - this.sessions.size >= 8 || this.streams.size >= guestOwnerLimit + 8) { stream.abort(new Error('Guest connection busy.')); return; }
    this.streams.add(stream);
    stream.maxReadBufferLength = companionFrameLimit + 4; stream.maxWriteBufferLength = companionResponseLimit + 4;
    stream.inactivityTimeout = 10_000;
    let grant: GuestConversationGrant | undefined; let handle = ''; let guestName = ''; let closed = false; let unlisten: (() => void) | undefined; let unRevoke: (() => void) | undefined; let unwatch: (() => void) | undefined;
    const images = new Set<string>(); const contentIds = new Set<string>();
    // The messages a patch changed in place, read when it was observed: later patches may move them.
    const changedInPlace = new WeakMap<GuestConversationUpdate, Message[]>();
    const remember = (update: GuestConversationUpdate) => {
      const messages = changedInPlace.get(update) ?? deliveredMessages(update);
      // Check each addition so a single large page cannot grow the retained index beyond its cap.
      const add = (set: Set<string>, value: string) => {
        if (!set.has(value) && images.size + contentIds.size >= 2048) throw new GuestResourceLimit();
        set.add(value);
      };
      for (const path of conversationImageReferences(messages as never)) add(images, path);
      for (const message of messages) if (message.deferredContent) add(contentIds, message.deferredContent.contentId);
    };
    // What this guest last received: late snapshots and repeated patches of that stream are not sent again.
    let watching = false; let pending = false; let delivered: { epoch: string; conversation: string | null; revision: number } | null = null;
    let buffered: GuestConversationUpdate[] = []; let bufferedBytes = 0;
    const alive = () => !closed && Boolean(grant?.valid());
    const assert = () => { if (!alive()) throw new Error('denied'); };
    const close = (abort = true) => {
      if (closed) return; closed = true; writer.close(); unlisten?.(); unRevoke?.(); unwatch?.(); buffered = []; bufferedBytes = 0; images.clear(); contentIds.clear();
      this.streams.delete(stream); const admitted = this.sessions.delete(stream); if (admitted) this.count(handle);
      if (abort) stream.abort(new Error('Guest session closed.'));
    };
    const writer = new UpdateStreamWriter({ write: async bytes => { assert(); await sendWithBackpressure(stream, bytes); }, fail: () => close() });
    // Join failures have no grant; their small bounded response still uses transport backpressure.
    const reply = async (value: unknown) => { if (closed) return; const bytes = encodeCompanionFrame(value, companionResponseLimit); if (bytes.byteLength > companionResponseLimit + 4) throw new Error('denied'); if (grant) { assert(); writer.enqueue(bytes); await writer.drained(); } else await sendWithBackpressure(stream, bytes); };
    const finish = async () => { await writer.flushed(); if (!closed) await stream.close({ signal: AbortSignal.timeout(5000) }); stream.inactivityTimeout = 10_000; close(false); };
    const deliver = async (update: GuestConversationUpdate) => {
      assert(); if (!bound(update, grant!.target)) throw new Error('denied');
      const { epoch, conversation } = update.payload;
      const revision = update.type === 'conversation.sessionSnapshot' ? update.payload.snapshot.revision : update.payload.patch.revision;
      if (delivered && delivered.epoch === epoch && delivered.conversation === conversation
        && revision <= delivered.revision) return;
      remember(update); delivered = { epoch, conversation, revision }; await reply({ v: 1, update }); assert();
    };
    /** Ownership also covers what the owner shows now, which the guest may not have received yet. */
    const rememberCurrent = async () => {
      const update = guestSnapshotUpdate(await this.source.read(grant!.target.agentId, grant!.target.sessionId)); assert();
      if (!bound(update, grant!.target)) throw new Error('denied'); remember(update);
    };
    const ended = () => close();
    stream.addEventListener('close', ended, { once: true });
    try {
      for await (const raw of readCompanionFrames(stream)) {
        const request = requestSchema.parse(raw);
        try {
          if (!this.requests.take(peer)) { await reply({ v: 1, id: request.id, error: 'rateLimited' }); await finish(); break; }
          let result: unknown;
          if (request.method === 'guest.join') {
            if (grant || !this.admissions.take(peer)) throw new Error('denied');
            const input = joinSchema.parse(request.args);
            const candidate = await this.port.authorize(input.handle, input.credential);
            if (closed || !candidate.valid()) throw new Error('denied');
            const count = [...this.sessions.values()].filter(session => session.handle === input.handle).length;
            if (count >= guestConversationLimit || this.sessions.size >= guestOwnerLimit) { await reply({ v: 1, id: request.id, error: 'busy' }); continue; }
            grant = candidate; handle = input.handle; guestName = input.name; this.sessions.set(stream, { handle, identity: peer, name: guestName, discriminator: createHash('sha256').update(peer).digest('hex').slice(0, 8), close }); this.count(handle);
            unRevoke = grant.onRevoke(() => {
              // Clear authorization and queued provider work before sending the terminal notice.
              close(false);
              void sendWithBackpressure(stream, encodeCompanionFrame({ v: 1, revoked: true }))
                .then(() => stream.close({ signal: AbortSignal.timeout(5000) })).catch(() => stream.abort(new Error('Guest session revoked.')));
            }); assert(); stream.inactivityTimeout = companionBackgroundIdleTimeoutMs;
            unwatch = this.source.watch(grant.target.agentId, grant.target.sessionId);
            unlisten = this.port.onEvent(event => {
              this.source.observe(event);
              if (!alive()) { close(); return; }
              if (event.type === 'conversation.shareChanged' && event.agentId === grant!.target.agentId && this.port.proposals) {
                // The owner event contains all proposals. Fetch a peer-filtered projection instead of forwarding it.
                void this.port.proposals(handle, peer).then(proposalState => reply({ v: 1, proposalState })).catch(() => close());
                return;
              }
              if (!watching || !isSessionConversationEvent(event)) return;
              const update = guestConversationUpdate(event);
              if (!bound(update, grant!.target)) return;
              changedInPlace.set(update, deliveredMessages(update, this.source.current(event.agentId, event.payload.conversation)?.snapshot.state));
              if (pending) {
                bufferedBytes += Buffer.byteLength(JSON.stringify(update));
                if (buffered.length >= 256 || bufferedBytes > companionResponseLimit * 2) { close(); return; }
                buffered.push(update);
              } else void deliver(update).catch(() => close());
            });
            result = { target: grant.target, title: grant.title, participant: { identity: peer, name: input.name, discriminator: createHash('sha256').update(peer).digest('hex').slice(0, 8) } };
          } else {
            assert(); const target = grant!.target;
            switch (request.method) {
              case 'guest.propose': {
                const input = z.object({ id: z.string().uuid(), text: z.string().min(1).max(100_000), followUpBehavior: z.enum(['queue', 'steer']).optional() }).strict().parse(request.args);
                if (!this.port.propose) throw new Error('denied');
                result = await this.port.propose(handle, peer, guestName, input); break;
              }
              case 'guest.proposals':
                emptySchema.parse(request.args); result = await this.port.proposals?.(handle, peer) ?? { proposals: [], authors: [] }; break;
              case 'guest.withdraw': {
                const { id } = z.object({ id: z.string().uuid() }).strict().parse(request.args);
                if (!this.port.withdraw) throw new Error('denied');
                await this.port.withdraw(handle, peer, id); result = {}; break;
              }
              case 'ping': emptySchema.parse(request.args); result = {}; break;
              case 'conversation.synchronize': {
                emptySchema.parse(request.args);
                watching = true; pending = true; buffered = []; bufferedBytes = 0;
                try {
                  // A synchronize always starts the guest over from the owner's current snapshot.
                  const session = await this.source.read(target.agentId, target.sessionId); assert();
                  const update = guestSnapshotUpdate(session); if (!bound(update, target)) throw new Error('denied');
                  delivered = null; await deliver(update);
                  while (buffered.length) await deliver(buffered.shift()!);
                  result = {};
                } finally { pending = false; buffered = []; bufferedBytes = 0; }
                break;
              }
              case 'conversation.turn.load': {
                const { turnId } = z.object({ turnId: z.string().min(1).max(200) }).strict().parse(request.args);
                if (!this.port.loadTurnHistory) throw new Error('denied');
                // The loaded turn reaches the guest as session patches on its stream.
                await this.port.loadTurnHistory(target.agentId, turnId); assert();
                result = {}; break;
              }
              case 'conversation.loadOlder': {
                emptySchema.parse(request.args);
                const page = await this.port.loadOlderHistory(target.agentId); assert();
                result = { hasOlder: page.hasOlder }; break;
              }
              case 'conversation.image.read': {
                const { path } = imageSchema.parse(request.args);
                const embedded = conversationImageInput(path);
                if (embedded) {
                  if (embedded.sessionId !== target.sessionId || !images.has(path)) throw new Error('denied');
                  result = { dataUrl: await readEmbeddedConversationImage(path, async input => {
                    assert(); const chunk = await this.port.readConversationContent(target.agentId, input); assert(); return chunk;
                  }) };
                  break;
                }
                await rememberCurrent(); const reference = imagePath(path);
                if (!reference || !images.has(reference)) throw new Error('denied');
                result = await this.port.readImage(target.agentId, reference); assert(); break;
              }
              case 'conversation.content.read': {
                const { input } = contentSchema.parse(request.args);
                if (input.sessionId !== target.sessionId) throw new Error('denied');
                await rememberCurrent(); if (!contentIds.has(input.contentId)) throw new Error('denied');
                result = await this.port.readConversationContent(target.agentId, input); assert(); break;
              }
              default: throw new Error('denied');
            }
            assert();
          }
          await reply({ v: 1, id: request.id, result });
        } catch (error) {
          if (grant && !alive()) { close(); break; }
          await reply({ v: 1, id: request.id, error: error instanceof GuestResourceLimit ? 'busy' : 'denied' });
          if (error instanceof GuestResourceLimit) { await finish(); break; }
        }
      }
    } catch { /* Never log request values, credentials, links or provider failures. */ }
    finally { close(); stream.removeEventListener('close', ended); }
  }
  private count(handle: string) {
    const sessions = [...this.sessions.values()].filter(session => session.handle === handle);
    const guests = [...new Map(sessions.map(({ identity, name, discriminator }) => [identity, { identity, name, discriminator }])).values()];
    this.port.connected(handle, guests.length, guests);
  }
}
