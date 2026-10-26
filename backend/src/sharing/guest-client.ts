import { randomUUID } from 'node:crypto';
import type { Stream } from '@libp2p/interface';
import { companionFrameLimit, companionResponseLimit, companionBackgroundIdleTimeoutMs, encodeCompanionFrame, readCompanionFrames } from '@workspace/core/companion-protocol';
import type { ConversationShareLink } from '@workspace/core/conversation-sharing';
import type { CompanionCheckpoint } from '@workspace/core/companion-journal';
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
  private needsReset = false;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  checkpoint: CompanionCheckpoint | null = null;
  get snapshot() { return this.cache.snapshot; }
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
  synchronize(checkpoint: CompanionCheckpoint | null = this.checkpoint): Promise<void> {
    if (this.syncing) return this.syncing;
    const work = (async () => {
      let since = checkpoint;
      for (let attempt = 0; attempt < 3; attempt++) {
        this.needsReset = false;
        const result = await this.request('conversation.synchronize', { checkpoint: since });
        const next = (result as { checkpoint: CompanionCheckpoint }).checkpoint;
        if (this.needsReset || !this.snapshot || this.snapshot.payload.revision < next.revision) { since = null; continue; }
        this.checkpoint = { ...next, revision: this.snapshot.payload.revision }; return;
      }
      throw new Error('Guest synchronization incomplete.');
    })();
    this.syncing = work.finally(() => { this.syncing = undefined; }); return this.syncing;
  }
  async loadOlder(): Promise<{ hasOlder: boolean }> {
    const result = await this.request('conversation.loadOlder', {}) as { update: GuestConversationUpdate; hasOlder: boolean };
    if (!this.cache.receive(result.update)) await this.synchronize(null); this.changed(); return { hasOlder: result.hasOlder };
  }
  readContent(input: ConversationContentInput): Promise<ConversationContentChunk> { return this.request('conversation.content.read', { input }) as Promise<ConversationContentChunk>; }
  readImage(path: string): Promise<{ dataUrl: string }> { return this.request('conversation.image.read', { path }) as Promise<{ dataUrl: string }>; }
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
        const value = raw as { v: number; update?: GuestConversationUpdate; id?: string; result?: unknown; error?: string; revoked?: boolean };
        if (!value || value.v !== 1) throw new Error('Invalid guest response.');
        if (value.revoked === true) { this.close('revoked'); return; }
        if (value.update) {
          if (!this.cache.receive(value.update)) {
            this.checkpoint = null; this.needsReset = true;
            // Gap recovery asks the existing authoritative provider source for a fresh baseline.
            if (!this.syncing) void this.synchronize(null).catch(() => this.close());
          } else {
            if (this.checkpoint && this.snapshot) this.checkpoint = { ...this.checkpoint, revision: this.snapshot.payload.revision };
            this.changed();
          }
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
    this.cache.clear(); this.checkpoint = null; this.joined = undefined;
    for (const pending of this.waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error('Guest session closed.')); } this.waiting.clear();
    this.stream.abort(new Error('Guest session closed.')); this.changed(); this.disconnected(reason);
  }
}
