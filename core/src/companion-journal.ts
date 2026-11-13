import { companionConversationFrame, companionFrameRevision, sameCompanionStream, type CompanionConversationFrame, type CompanionConversationStream } from './companion-protocol';

export type CompanionCheckpoint = { epoch: string; revision: number };
/** What a phone needs to catch up: the frames after its checkpoint, a snapshot first when it has to start over. */
export type CompanionConversationSync = { checkpoint: CompanionCheckpoint; frames: CompanionConversationFrame[] };
type Limits = { maxBytes: number; maxConversations: number };
type Retained<F> = { frame: F; bytes: number };
type Entry<F> = { checkpoint: CompanionCheckpoint; frames: Retained<F>[]; bytes: number };

const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Bounded per-agent retention shared by both journals: a checkpoint and the frames that lead to it. */
class Retention<F> {
  readonly entries = new Map<string, Entry<F>>();
  private bytes = 0;
  constructor(private readonly limits: Limits) {}
  start(agentId: string, revision: number): Entry<F> {
    this.forget(agentId);
    const entry: Entry<F> = { checkpoint: { epoch: crypto.randomUUID(), revision }, frames: [], bytes: 0 };
    this.entries.set(agentId, entry);
    this.trim();
    return entry;
  }
  append(agentId: string, entry: Entry<F>, frame: F, revision: number): void {
    const bytes = byteLength(frame);
    entry.frames.push({ frame, bytes }); entry.bytes += bytes; this.bytes += bytes;
    entry.checkpoint = { ...entry.checkpoint, revision };
    while (entry.frames.length > 2048 || entry.bytes > Math.min(this.limits.maxBytes, 1024 * 1024)) {
      const removed = entry.frames.shift()!; entry.bytes -= removed.bytes; this.bytes -= removed.bytes;
    }
    this.entries.delete(agentId); this.entries.set(agentId, entry);
    this.trim();
  }
  resume(agentId: string, since: CompanionCheckpoint, revision: (frame: F) => number): { checkpoint: CompanionCheckpoint; frames: F[] } | null {
    const entry = this.entries.get(agentId);
    if (!entry || entry.checkpoint.epoch !== since.epoch || since.revision > entry.checkpoint.revision) return null;
    const frames = entry.frames.filter(({ frame }) => revision(frame) > since.revision).map(({ frame }) => frame);
    if (since.revision !== entry.checkpoint.revision && (!frames.length || revision(frames[0]!) !== since.revision + 1 || revision(frames.at(-1)!) !== entry.checkpoint.revision)) return null;
    return { checkpoint: entry.checkpoint, frames };
  }
  forget(agentId: string): void { const entry = this.entries.get(agentId); if (entry) this.bytes -= entry.bytes; this.entries.delete(agentId); }
  clear(): void { this.entries.clear(); this.bytes = 0; }
  private trim() { while (this.entries.size > this.limits.maxConversations || this.bytes > this.limits.maxBytes) this.forget(this.entries.keys().next().value!); }
}

/**
 * Bounded replay of an agent's conversation patches. A snapshot starts a new continuity domain unless it restates the
 * state the journal already holds; a patch from another stream, or one that skips a revision, ends it.
 */
export class CompanionJournal {
  private readonly retention: Retention<CompanionConversationFrame>;
  private readonly streams = new Map<string, { agentId: string; payload: CompanionConversationStream }>();
  constructor(limits: Limits = { maxBytes: 8 * 1024 * 1024, maxConversations: 32 }) { this.retention = new Retention(limits); }
  observe(event: CompanionConversationFrame): void {
    const frame = companionConversationFrame(event);
    const revision = companionFrameRevision(frame);
    let entry = this.retention.entries.get(frame.agentId);
    const stream = this.streams.get(frame.agentId);
    const same = Boolean(entry && stream && sameCompanionStream(stream, frame));
    if (frame.type === 'conversation.sessionSnapshot') {
      if (same && revision <= entry!.checkpoint.revision) return;
      entry = this.retention.start(frame.agentId, revision);
      // The stream's identity only; the snapshot itself is never retained.
      this.streams.set(frame.agentId, { agentId: frame.agentId, payload: { conversation: frame.payload.conversation, epoch: frame.payload.epoch } });
      this.prune();
      return;
    }
    if (!entry || !same) { this.forget(frame.agentId); return; }
    if (revision <= entry.checkpoint.revision) return;
    if (revision !== entry.checkpoint.revision + 1) { this.forget(frame.agentId); return; }
    this.retention.append(frame.agentId, entry, frame, revision);
    this.prune();
  }
  checkpoint(agentId: string): CompanionCheckpoint | null { return this.retention.entries.get(agentId)?.checkpoint ?? null; }
  resume(agentId: string, since: CompanionCheckpoint): CompanionConversationSync | null { return this.retention.resume(agentId, since, companionFrameRevision); }
  forget(agentId: string): void { this.retention.forget(agentId); this.streams.delete(agentId); }
  clear(): void { this.retention.clear(); this.streams.clear(); }
  private prune() { for (const id of this.streams.keys()) if (!this.retention.entries.has(id)) this.streams.delete(id); }
}
