import type { ProviderConversationFrame } from '@workspace/core/contracts';
import type { CompanionCheckpoint } from '@workspace/core/companion-journal';
import { isConversationReset, type CompanionReset } from '@workspace/core/companion-protocol';
import { createCompanionReplica } from './conversation-cache';

type Entry = { checkpoint: CompanionCheckpoint; frame: CompanionReset; replica: ReturnType<typeof createCompanionReplica>; bytes: number };
/** Read-only provider replicas retained by the transcript page, independent of selection. */
export class TranscriptReplicas {
  private readonly entries = new Map<string, Entry>();
  clear() { this.entries.clear(); }
  apply(identity: string, checkpoint: CompanionCheckpoint, frames: ProviderConversationFrame[]): Entry | null {
    let entry = this.entries.get(identity);
    const reset = frames.findIndex(frame => isConversationReset(frame));
    if (reset < 0 && (!entry || entry.checkpoint.epoch !== checkpoint.epoch)) return null;
    // Validate continuity before mutating a replica. Duplicate overlap is expected
    // when the native bridge coalesces batches produced before its last paint ack.
    let revision = reset >= 0 ? frames[reset]!.payload.revision : entry!.checkpoint.revision;
    for (const frame of frames.slice(reset >= 0 ? reset + 1 : 0)) {
      if (frame.payload.revision <= revision) continue;
      if (isConversationReset(frame)) revision = frame.payload.revision;
      else if (frame.payload.revision !== revision + 1) return null;
      else revision++;
    }
    if (revision < checkpoint.revision) return null;
    try {
      for (const frame of frames) {
        if (isConversationReset(frame)) {
          const snapshot = frame as CompanionReset;
          entry = { checkpoint: { epoch: checkpoint.epoch, revision: frame.payload.revision }, frame: snapshot, replica: createCompanionReplica(snapshot), bytes: new TextEncoder().encode(JSON.stringify(frame)).byteLength };
        } else if (entry && frame.payload.revision > entry.checkpoint.revision) {
          if (frame.agentId !== entry.frame.agentId || frame.backend !== entry.frame.backend) return null;
          entry.replica.apply(frame.payload.event as never);
          const snapshot = entry.replica.getSnapshot();
          if (!snapshot) return null;
          entry.frame = { ...entry.frame, payload: { revision: frame.payload.revision, snapshot } } as CompanionReset;
          entry.checkpoint = { epoch: checkpoint.epoch, revision: frame.payload.revision };
          entry.bytes += new TextEncoder().encode(JSON.stringify(frame)).byteLength;
        }
      }
    } catch { this.entries.delete(identity); return null; }
    if (!entry) return null;
    // Replaced provider sessions must not reuse an agent's old replica.
    for (const [key, value] of this.entries) if (key !== identity && value.frame.agentId === entry.frame.agentId) this.entries.delete(key);
    this.entries.delete(identity); this.entries.set(identity, entry);
    let bytes = [...this.entries.values()].reduce((sum, value) => sum + value.bytes, 0);
    for (const [key, value] of this.entries) {
      if (this.entries.size <= 8 && bytes <= 64 * 1024 * 1024) break;
      if (key === identity) continue;
      this.entries.delete(key); bytes -= value.bytes;
    }
    return entry;
  }
}
