import type { ProviderConversationFrame } from './contracts';
import { isConversationReset } from './companion-protocol';

export type CompanionCheckpoint = { epoch: string; revision: number };
export type CompanionSync = { checkpoint: CompanionCheckpoint; frames: ProviderConversationFrame[] };
type Entry = { checkpoint: CompanionCheckpoint; frames: { frame: ProviderConversationFrame; bytes: number }[]; bytes: number };

/** Bounded replay of opaque provider events. Resets establish a new continuity domain. */
export class CompanionJournal {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  constructor(private readonly limits = { maxBytes: 8 * 1024 * 1024, maxConversations: 32 }) {}
  observe(frame: ProviderConversationFrame): void {
    frame = Object.fromEntries(['type', 'agentId', 'backend', 'threadId', 'backendSessionId', 'conversationId', 'turnId', 'seq', 'occurredAt', 'payload']
      .filter(key => Object.hasOwn(frame, key)).map(key => [key, frame[key as keyof ProviderConversationFrame]])) as ProviderConversationFrame;
    let entry = this.entries.get(frame.agentId);
    if (isConversationReset(frame)) {
      this.forget(frame.agentId);
      entry = { checkpoint: { epoch: crypto.randomUUID(), revision: frame.payload.revision }, frames: [], bytes: 0 };
      this.entries.set(frame.agentId, entry);
    } else {
      if (!entry || frame.payload.revision <= entry.checkpoint.revision) return;
      if (frame.payload.revision !== entry.checkpoint.revision + 1) { this.forget(frame.agentId); return; }
      const bytes = new TextEncoder().encode(JSON.stringify(frame)).byteLength;
      entry.frames.push({ frame, bytes }); entry.bytes += bytes; this.bytes += bytes;
      entry.checkpoint = { ...entry.checkpoint, revision: frame.payload.revision };
      while (entry.frames.length > 2048 || entry.bytes > Math.min(this.limits.maxBytes, 1024 * 1024)) {
        const removed = entry.frames.shift()!; entry.bytes -= removed.bytes; this.bytes -= removed.bytes;
      }
      this.entries.delete(frame.agentId); this.entries.set(frame.agentId, entry);
    }
    while (this.entries.size > this.limits.maxConversations || this.bytes > this.limits.maxBytes) this.forget(this.entries.keys().next().value!);
  }
  checkpoint(agentId: string): CompanionCheckpoint | null { return this.entries.get(agentId)?.checkpoint ?? null; }
  resume(agentId: string, since: CompanionCheckpoint): CompanionSync | null {
    const entry = this.entries.get(agentId);
    if (!entry || entry.checkpoint.epoch !== since.epoch || since.revision > entry.checkpoint.revision) return null;
    const frames = entry.frames.filter(({ frame }) => frame.payload.revision > since.revision).map(({ frame }) => frame);
    if (since.revision !== entry.checkpoint.revision && (frames[0]?.payload.revision !== since.revision + 1 || frames.at(-1)?.payload.revision !== entry.checkpoint.revision)) return null;
    return { checkpoint: entry.checkpoint, frames };
  }
  forget(agentId: string): void { const entry = this.entries.get(agentId); if (entry) this.bytes -= entry.bytes; this.entries.delete(agentId); }
  clear(): void { this.entries.clear(); this.bytes = 0; }
}
