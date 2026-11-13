import { randomUUID } from 'node:crypto';
import type { Stream } from '@libp2p/interface';
import { companionFrameLimit, companionResponseLimit, companionBackgroundIdleTimeoutMs, encodeCompanionFrame, readCompanionFrames } from '@workspace/core/companion-protocol';
import type { ConversationShareLink } from '@workspace/core/conversation-sharing';
import type { ConversationContentInput, ConversationContentChunk } from '@workspace/core/contracts/conversation';
import type { GuestConversationJoined, GuestConversationUpdate } from '@workspace/core/guest-conversation';
import { GuestConversationCache } from './guest-conversation';
import { sendWithBackpressure } from '../companion/stream-io';

/** Minimal desktop guest session over the separately pinned owner circuit. No phone controls or generic RPC. */
export class GuestConversationClient {
  private readonly cache = new GuestConversationCache();
  private readonly waiting = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private closed = false;
  private joined?: GuestConversationJoined;
  private syncing?: Promise<void>;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  proposalState?: import('@workspace/core/conversation-sharing').GuestProposalState;
  /** The shared conversation as neutral session state, or null before the first snapshot. */
  get session() { return this.cache.session; }
  constructor(private readonly stream: Stream, private readonly changed: () => void = () => {}, private readonly disconnected: (reason: 'offline' | 'revoked') => void = () => {}) {
    stream.maxReadBufferLength = companionResponseLimit + 4; stream.maxWriteBufferLength = companionFrameLimit + 4; stream.inactivityTimeout = companionBackgroundIdleTimeoutMs;
    stream.addEventListener('close', this.ended, { once: true });
    void this.receive().finally(() => this.close());
    this.heartbeat = setInterval(() => { if (this.joined) void this.request('ping', {}).catch(() => this.close()); }, 30_000); this.heartbeat.unref();
  }
  async join(link: Pick<ConversationShareLink, 'handle' | 'credential'>, name: string): Promise<GuestConversationJoined> {
    const result = await this.request('guest.join', { handle: link.handle, credential: link.credential, name }) as GuestConversationJoined;
    if (this.closed) throw new Error('Guest session closed.'); this.joined = result; return result;
  }
  /** Starts over from the owner's current snapshot; the owner sends it, and any live updates after it, before replying. */
  synchronize(): Promise<void> {
    if (this.syncing) return this.syncing;
    const work = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.request('conversation.synchronize', {});
        if (this.session && !this.cache.stale) return;
      }
      throw new Error('Guest synchronization incomplete.');
    })();
    this.syncing = work.finally(() => { this.syncing = undefined; }); return this.syncing;
  }
  /** The loaded history arrives as session patches before the reply. */
  async loadTurnHistory(turnId: string): Promise<void> { await this.request('conversation.turn.load', { turnId }); }
  async loadOlder(): Promise<{ hasOlder: boolean }> { return await this.request('conversation.loadOlder', {}) as { hasOlder: boolean }; }
  readContent(input: ConversationContentInput): Promise<ConversationContentChunk> { return this.request('conversation.content.read', { input }) as Promise<ConversationContentChunk>; }
  readImage(path: string): Promise<{ dataUrl: string }> { return this.request('conversation.image.read', { path }) as Promise<{ dataUrl: string }>; }
  propose(input: import('@workspace/core/conversation-sharing').GuestPromptInput): Promise<import('@workspace/core/conversation-sharing').GuestProposal> { return this.request('guest.propose', input) as Promise<import('@workspace/core/conversation-sharing').GuestProposal>; }
  async withdraw(id: string): Promise<void> { await this.request('guest.withdraw', { id }); }
  async proposals(): Promise<import('@workspace/core/conversation-sharing').GuestProposalState> { const state = await this.request('guest.proposals', {}) as import('@workspace/core/conversation-sharing').GuestProposalState; this.proposalState = state; this.changed(); return state; }
  private async request(method: string, args: unknown): Promise<unknown> {
    if (this.closed) throw new Error('Guest session closed.'); if (this.waiting.size >= 16) throw new Error('Guest session busy.');
    const id = randomUUID();
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error('Guest request timed out.')); this.close(); }, 30_000); timer.unref();
      this.waiting.set(id, { resolve, reject, timer });
    });
    try { await sendWithBackpressure(this.stream, encodeCompanionFrame({ v: 1, id, method, args })); }
    catch { this.close(); }
    return result;
  }
  private async receive() {
    try {
      for await (const raw of readCompanionFrames(this.stream, companionResponseLimit)) {
        const value = raw as { v: number; update?: GuestConversationUpdate; proposalState?: import('@workspace/core/conversation-sharing').GuestProposalState; id?: string; result?: unknown; error?: string; revoked?: boolean };
        if (!value || value.v !== 1) throw new Error('Invalid guest response.');
        if (value.revoked === true) { this.close('revoked'); return; }
        if (value.proposalState) { this.proposalState = value.proposalState; this.changed(); continue; }
        if (value.update) {
          // A missed revision or another stream keeps the last state visible and asks the owner for a fresh snapshot.
          if (this.cache.receive(value.update)) this.changed();
          else if (!this.syncing) void this.synchronize().catch(() => this.close());
        } else if (value.id) {
          const pending = this.waiting.get(value.id); if (!pending) continue;
          clearTimeout(pending.timer); this.waiting.delete(value.id);
          if (value.error) pending.reject(new Error(['busy', 'rateLimited', 'denied'].includes(value.error) ? value.error : 'Guest request failed.')); else pending.resolve(value.result);
        } else throw new Error('Invalid guest response.');
      }
    } catch { /* Transport errors contain no user-visible diagnostics. */ }
  }
  private readonly ended = () => this.close();
  close(reason: 'offline' | 'revoked' = 'offline') {
    if (this.closed) return; this.closed = true; clearInterval(this.heartbeat); this.stream.removeEventListener('close', this.ended);
    this.cache.clear(); this.joined = undefined;
    this.proposalState = undefined;
    for (const pending of this.waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error('Guest session closed.')); } this.waiting.clear();
    this.stream.abort(new Error('Guest session closed.')); this.changed(); this.disconnected(reason);
  }
}
