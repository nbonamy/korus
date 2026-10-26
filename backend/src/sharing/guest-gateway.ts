import { createHash } from 'node:crypto';
import type { Stream } from '@libp2p/interface';
import { z } from 'zod';
import { companionPeerIdPattern } from '@workspace/core/companion-relay';
import { companionFrameLimit, companionResponseLimit, companionBackgroundIdleTimeoutMs, encodeCompanionFrame, readCompanionFrames, isConversationFrame, isConversationReset, type CompanionReset, type CompanionImage } from '@workspace/core/companion-protocol';
import { guestConversationLimit, guestOwnerLimit } from '@workspace/core/guest-conversation';
import { guestConversationFrame, guestConversationSync } from './guest-conversation';
import type { ConversationShareTarget } from '@workspace/core/conversation-sharing';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import type { ProviderConversationFrame } from '@workspace/core/contracts';
import type { ConversationContentInput, ConversationContentChunk } from '@workspace/core/contracts/conversation';
import type { CompanionCheckpoint, CompanionSync } from '@workspace/core/companion-journal';
import type { BackendHistoryLoadResult } from '@workspace/core/backend-driver';
import type { GuestConversationGrant } from './conversation-shares';
import { WindowBudget } from '../companion/source-budget';
import { conversationImageReferences, imagePath } from '../companion/images';
import { sendWithBackpressure } from '../companion/stream-io';
import { UpdateStreamWriter } from '../companion/update-writer';

export type GuestConversationPort = {
  authorize(handle: string, credential: string): Promise<GuestConversationGrant>;
  connected(handle: string, count: number): void;
  onEvent(listener: (event: AppBackendEvent) => void): () => void;
  synchronize(agentId: string, checkpoint: CompanionCheckpoint | null): Promise<CompanionSync>;
  conversation(agentId: string): Promise<CompanionReset>;
  loadOlderHistory(agentId: string): Promise<BackendHistoryLoadResult>;
  readConversationContent(agentId: string, input: ConversationContentInput): Promise<ConversationContentChunk>;
  readImage(agentId: string, path: string): Promise<CompanionImage>;
};
class GuestResourceLimit extends Error {}
const requestSchema = z.object({ v: z.literal(1), id: z.string().uuid(), method: z.string().min(1).max(80), args: z.unknown() }).strict();
const joinSchema = z.object({ handle: z.string().regex(/^[A-Za-z0-9_-]{32}$/), credential: z.string().regex(/^[A-Za-z0-9_-]{43}$/), name: z.string().max(200).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)).transform(value => value.trim()).pipe(z.string().min(1).max(80)) }).strict();
const emptySchema = z.object({}).strict();
const syncSchema = z.object({ checkpoint: z.object({ epoch: z.string().min(1).max(100), revision: z.number().int().nonnegative().safe() }).strict().nullable() }).strict();
const contentSchema = z.object({ input: z.object({ sessionId: z.string().min(1).max(4096), contentId: z.string().regex(/^[a-f0-9]{64}$/), offset: z.number().int().nonnegative().safe() }).strict() }).strict();
const imageSchema = z.object({ path: z.string().min(1).max(4096) }).strict();
/** Strict immutable identity checks apply to provider resets, pages, events and replay. */
function bound(frame: ProviderConversationFrame, target: ConversationShareTarget): boolean {
  if (frame.agentId !== target.agentId || frame.backend !== target.backend) return false;
  if (frame.conversationId && frame.conversationId !== target.sessionId) return false;
  if (frame.backend === 'codex') {
    if (frame.threadId !== target.sessionId) return false;
    return frame.type === 'codex.conversationSnapshotChanged' ? frame.payload.snapshot.activeConversationId === target.sessionId : frame.type === 'codex.conversationEventReceived' && frame.payload.event.conversationId === target.sessionId;
  }
  if (frame.backendSessionId && frame.backendSessionId !== target.sessionId) return false;
  if (frame.type === 'claude.conversationSnapshotChanged' || frame.type === 'antigravity.conversationSnapshotChanged') return frame.payload.snapshot.agentId === target.agentId && frame.payload.snapshot.sessionId === target.sessionId;
  if (frame.type === 'claude.conversationEventReceived') return frame.payload.event.agentId === target.agentId && (!frame.payload.event.backendSessionId || frame.payload.event.backendSessionId === target.sessionId);
  return frame.type === 'antigravity.conversationEventReceived' && frame.payload.event.agentId === target.agentId && frame.payload.event.sessionId === target.sessionId;
}

/** One encrypted stream, one bearer grant, one immutable target. No generic RPC or phone grant. */
export class GuestConversationGateway {
  private readonly streams = new Set<Stream>();
  private readonly sessions = new Map<Stream, { handle: string; close(): void }>();
  private readonly requests = new WindowBudget(120, 60_000, 1024);
  private readonly admissions = new WindowBudget(20, 60_000, 1024);
  constructor(private readonly port: GuestConversationPort) {}
  close() { for (const session of [...this.sessions.values()]) session.close(); for (const stream of this.streams) stream.abort(new Error('Guest gateway stopped.')); }
  async accept(stream: Stream, peer: string): Promise<void> {
    // Bound unauthenticated stream work as well as admitted sessions.
    if (!companionPeerIdPattern.test(peer) || this.streams.size - this.sessions.size >= 8 || this.streams.size >= guestOwnerLimit + 8) { stream.abort(new Error('Guest connection busy.')); return; }
    this.streams.add(stream);
    stream.maxReadBufferLength = companionFrameLimit + 4; stream.maxWriteBufferLength = companionResponseLimit + 4;
    stream.inactivityTimeout = 10_000;
    let grant: GuestConversationGrant | undefined; let handle = ''; let closed = false; let unlisten: (() => void) | undefined; let unRevoke: (() => void) | undefined;
    const images = new Set<string>(); const contentIds = new Set<string>();
    const remember = (frame: ProviderConversationFrame) => {
      const messages = isConversationReset(frame) ? frame.payload.snapshot.messages : (() => {
        const payload = frame.payload.event.payload;
        if ('messages' in payload && Array.isArray(payload.messages)) return payload.messages as CompanionReset['payload']['snapshot']['messages'];
        if ('message' in payload) return [payload.message] as CompanionReset['payload']['snapshot']['messages'];
        return [];
      })();
      // Check each addition so a single large page cannot grow the retained index beyond its cap.
      const add = (set: Set<string>, value: string) => {
        if (!set.has(value) && images.size + contentIds.size >= 2048) throw new GuestResourceLimit();
        set.add(value);
      };
      for (const path of conversationImageReferences(messages)) add(images, path);
      for (const message of messages) if ('deferredContent' in message && message.deferredContent) add(contentIds, message.deferredContent.contentId);
    };
    let watching = false; let pending = false; let revision = -1; let buffered: ProviderConversationFrame[] = []; let bufferedBytes = 0;
    const alive = () => !closed && Boolean(grant?.valid());
    const assert = () => { if (!alive()) throw new Error('denied'); };
    const close = (abort = true) => {
      if (closed) return; closed = true; writer.close(); unlisten?.(); unRevoke?.(); buffered = []; bufferedBytes = 0; images.clear(); contentIds.clear();
      this.streams.delete(stream); const admitted = this.sessions.delete(stream); if (admitted) this.count(handle);
      if (abort) stream.abort(new Error('Guest session closed.'));
    };
    const writer = new UpdateStreamWriter({ write: async bytes => { assert(); await sendWithBackpressure(stream, bytes); }, fail: () => close() });
    // Join failures have no grant; their small bounded response still uses transport backpressure.
    const reply = async (value: unknown) => { if (closed) return; const bytes = encodeCompanionFrame(value); if (bytes.byteLength > companionResponseLimit + 4) throw new Error('denied'); if (grant) { assert(); writer.enqueue(bytes); await writer.drained(); } else await sendWithBackpressure(stream, bytes); };
    const finish = async () => { await writer.flushed(); if (!closed) await stream.close({ signal: AbortSignal.timeout(5000) }); stream.inactivityTimeout = 10_000; close(false); };
    const deliver = async (frame: ProviderConversationFrame) => {
      assert(); if (!bound(frame, grant!.target)) throw new Error('denied');
      if (frame.payload.revision <= revision && !isConversationReset(frame)) return;
      remember(frame); revision = frame.payload.revision; await reply({ v: 1, update: guestConversationFrame(frame) }); assert();
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
            grant = candidate; handle = input.handle; this.sessions.set(stream, { handle, close }); this.count(handle);
            unRevoke = grant.onRevoke(() => {
              // Clear authorization and queued provider work before sending the terminal notice.
              close(false);
              void sendWithBackpressure(stream, encodeCompanionFrame({ v: 1, revoked: true }))
                .then(() => stream.close({ signal: AbortSignal.timeout(5000) })).catch(() => stream.abort(new Error('Guest session revoked.')));
            }); assert(); stream.inactivityTimeout = companionBackgroundIdleTimeoutMs;
            unlisten = this.port.onEvent(event => {
              if (!alive()) { close(); return; }
              if (!watching || !isConversationFrame(event) || !bound(event as ProviderConversationFrame, grant!.target)) return;
              const frame = event as ProviderConversationFrame;
              if (pending) {
                bufferedBytes += Buffer.byteLength(JSON.stringify(frame));
                if (buffered.length >= 256 || bufferedBytes > companionResponseLimit * 2) { close(); return; }
                buffered.push(frame);
              } else void deliver(frame).catch(() => close());
            });
            result = { target: grant.target, participant: { identity: peer, name: input.name, discriminator: createHash('sha256').update(peer).digest('hex').slice(0, 8) } };
          } else {
            assert(); const target = grant!.target;
            switch (request.method) {
              case 'ping': emptySchema.parse(request.args); result = {}; break;
              case 'conversation.synchronize': {
                const { checkpoint } = syncSchema.parse(request.args);
                watching = true; pending = true; buffered = []; bufferedBytes = 0;
                try {
                  const sync = await this.port.synchronize(target.agentId, checkpoint); assert();
                  for (const frame of sync.frames) { if (!bound(frame, target)) throw new Error('denied'); remember(frame); }
                  const projected = guestConversationSync(sync);
                  for (const update of projected.updates) { await reply({ v: 1, update }); assert(); }
                  revision = sync.checkpoint.revision;
                  while (buffered.length) await deliver(buffered.shift()!);
                  result = { checkpoint: { ...sync.checkpoint, revision } };
                } finally { pending = false; buffered = []; bufferedBytes = 0; }
                break;
              }
              case 'conversation.loadOlder': {
                emptySchema.parse(request.args);
                const page = await this.port.loadOlderHistory(target.agentId); assert();
                const frame = page.frame ?? await this.port.conversation(target.agentId); assert();
                if (!bound(frame, target)) throw new Error('denied'); remember(frame);
                result = { update: guestConversationFrame(frame), hasOlder: page.hasOlder }; break;
              }
              case 'conversation.image.read': {
                const { path } = imageSchema.parse(request.args);
                const frame = await this.port.conversation(target.agentId); assert(); if (!bound(frame, target)) throw new Error('denied');
                remember(frame); const reference = imagePath(path);
                if (!reference || !images.has(reference)) throw new Error('denied');
                result = await this.port.readImage(target.agentId, reference); assert(); break;
              }
              case 'conversation.content.read': {
                const { input } = contentSchema.parse(request.args);
                if (input.sessionId !== target.sessionId) throw new Error('denied');
                const frame = await this.port.conversation(target.agentId); assert(); if (!bound(frame, target)) throw new Error('denied');
                remember(frame); if (!contentIds.has(input.contentId)) throw new Error('denied');
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
  private count(handle: string) { this.port.connected(handle, [...this.sessions.values()].filter(session => session.handle === handle).length); }
}
