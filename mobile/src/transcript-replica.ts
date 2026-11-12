import type { CompanionCheckpoint } from '@workspace/core/companion-journal';
import { followCompanionConversation, isCompanionConversation, type CompanionConversation, type CompanionConversationFrame } from '@workspace/core/companion-protocol';

type Entry = { checkpoint: CompanionCheckpoint; frame: CompanionConversation; bytes: number };
const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Conversations retained by the transcript page, independent of selection, each followed from its checkpoint. */
export class TranscriptReplicas {
  private readonly entries = new Map<string, Entry>();
  clear() { this.entries.clear(); }
  apply(identity: string, checkpoint: CompanionCheckpoint, frames: CompanionConversationFrame[]): Entry | null {
    const previous = this.entries.get(identity);
    const reset = frames.findIndex(isCompanionConversation);
    if (reset < 0 && (!previous || previous.checkpoint.epoch !== checkpoint.epoch)) return null;
    // Duplicate overlap is expected when the native bridge coalesces batches produced before its last paint ack.
    let frame: CompanionConversation | null = reset >= 0 ? null : previous!.frame;
    let bytes = reset >= 0 ? 0 : previous!.bytes;
    for (const next of frames.slice(Math.max(reset, 0))) {
      const followed = followCompanionConversation(frame, next);
      if (!followed) { this.entries.delete(identity); return null; }
      if (followed !== frame) bytes = (next.type === 'conversation.sessionSnapshot' ? 0 : bytes) + byteLength(next);
      frame = followed;
    }
    if (!frame || frame.payload.snapshot.revision < checkpoint.revision) return null;
    const entry: Entry = { checkpoint: { epoch: checkpoint.epoch, revision: frame.payload.snapshot.revision }, frame, bytes };
    // Replaced provider sessions must not reuse an agent's old conversation.
    for (const [key, value] of this.entries) if (key !== identity && value.frame.agentId === entry.frame.agentId) this.entries.delete(key);
    this.entries.delete(identity); this.entries.set(identity, entry);
    let total = [...this.entries.values()].reduce((sum, value) => sum + value.bytes, 0);
    for (const [key, value] of this.entries) {
      if (this.entries.size <= 8 && total <= 64 * 1024 * 1024) break;
      if (key === identity) continue;
      this.entries.delete(key); total -= value.bytes;
    }
    return entry;
  }
}
