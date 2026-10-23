import { CompanionJournal, type CompanionCheckpoint, type CompanionSync } from '@workspace/core/companion-journal';
import { createAntigravityConversationReplica } from '@workspace/core/antigravity-conversation-replica';
import { createClaudeConversationReplica } from '@workspace/core/claude-conversation-replica';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { isConversationFrame, type CompanionReset } from '@workspace/core/companion-protocol';

type Followed = { revision: number; touchedAt: number; apply(event: unknown): void; snapshot(): unknown };

/** A tracked copy is trusted this long without news; after that the provider is asked again. */
const maxAgeMs = 30_000;
const maxConversations = 64;

/**
 * The authoritative conversation for each agent, as the provider publishes it. Codex re-publishes its whole
 * snapshot whenever it is asked, so it is asked each time. Claude and Antigravity publish a reset and then small
 * updates: asking them again re-reads the transcript from disk and can discard the turn in flight, so their
 * updates are applied here and only a gap, or a copy that has gone quiet, sends the request back to the provider.
 */
export class ConversationSource {
  private readonly journal = new CompanionJournal();
  private readonly frames = new Map<string, CompanionReset>();
  private readonly followed = new Map<string, Followed>();

  constructor(private readonly load: (agentId: string) => Promise<void>, private readonly now: () => number = Date.now) {}

  observe(event: AppBackendEvent): void {
    if (event.type === 'snapshot.updated') {
      const agents = new Set(event.payload.agents.map(agent => agent.id));
      for (const id of this.frames.keys()) if (!agents.has(id)) this.forget(id);
      return;
    }
    if (isConversationFrame(event)) this.journal.observe(event as import('@workspace/core/contracts').ProviderConversationFrame);
    if (event.type === 'codex.conversationSnapshotChanged') {
      this.retain(event); this.followed.delete(event.agentId);
    } else if (event.type === 'claude.conversationSnapshotChanged' || event.type === 'antigravity.conversationSnapshotChanged') {
      this.retain(event);
      const replica = event.type === 'claude.conversationSnapshotChanged'
        ? createClaudeConversationReplica(event.payload.snapshot)
        : createAntigravityConversationReplica(event.payload.snapshot);
      this.followed.set(event.agentId, { revision: event.payload.revision, touchedAt: this.now(), apply: (update) => replica.apply(update as never), snapshot: () => replica.getSnapshot() });
    } else if (event.type === 'claude.conversationEventReceived' || event.type === 'antigravity.conversationEventReceived') {
      const entry = this.followed.get(event.agentId);
      if (!entry) return;
      if (event.payload.revision !== entry.revision + 1) { this.followed.delete(event.agentId); return; }
      try { entry.apply(event.payload.event); entry.revision = event.payload.revision; entry.touchedAt = this.now(); }
      catch { this.followed.delete(event.agentId); }
    }
  }

  clear(): void { this.frames.clear(); this.followed.clear(); this.journal.clear(); }

  private forget(agentId: string): void { this.frames.delete(agentId); this.followed.delete(agentId); this.journal.forget(agentId); }

  private retain(event: CompanionReset): void {
    // Provider routing data only: daemon app snapshots must not stay alive with the transcript.
    const { type, agentId, backend, threadId, backendSessionId, conversationId, turnId, seq, occurredAt, payload } = event;
    this.frames.delete(agentId);
    this.frames.set(agentId, { type, agentId, backend, threadId, backendSessionId, conversationId, turnId, seq, occurredAt, payload } as CompanionReset);
    while (this.frames.size > maxConversations) this.forget(this.frames.keys().next().value!);
  }

  async synchronize(agentId: string, since: CompanionCheckpoint | null): Promise<CompanionSync> {
    const resumed = since && this.journal.resume(agentId, since);
    if (resumed) return resumed;
    const frame = await this.read(agentId);
    const head = this.journal.checkpoint(agentId);
    if (!head) throw new Error('Conversation checkpoint unavailable.');
    const checkpoint = { epoch: head.epoch, revision: frame.payload.revision };
    const tail = this.journal.resume(agentId, checkpoint);
    return { checkpoint: tail?.checkpoint ?? checkpoint, frames: [frame, ...tail?.frames ?? []] };
  }

  async read(agentId: string): Promise<CompanionReset> {
    const current = this.current(agentId);
    // A reconnect needs the provider's bounded recent window, not accumulated pages.
    if (current?.type === 'claude.conversationSnapshotChanged' && (current.payload.snapshot.messages.length > 50 || Buffer.byteLength(JSON.stringify(current)) > 768 * 1024)) {
      await this.load(agentId);
      const reset = this.frames.get(agentId);
      if (reset?.type === 'claude.conversationSnapshotChanged') return reset;
    }
    if (current) return current;
    this.frames.delete(agentId); this.followed.delete(agentId);
    await this.load(agentId);
    const frame = this.current(agentId) ?? this.frames.get(agentId);
    if (!frame) throw new Error('Authoritative conversation is unavailable.');
    return frame;
  }

  private current(agentId: string): CompanionReset | null {
    const entry = this.followed.get(agentId); const base = this.frames.get(agentId);
    if (!entry || !base) return null;
    if (this.now() - entry.touchedAt > maxAgeMs) { this.followed.delete(agentId); return null; }
    return { ...base, payload: { revision: entry.revision, snapshot: entry.snapshot() } } as CompanionReset;
  }
}
