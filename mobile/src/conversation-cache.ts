import { createCodexConversationReplica } from '@codex-app-sdk/core/conversation-replica';
import { createClaudeConversationReplica } from '@workspace/core/claude-conversation-replica';
import { createAntigravityConversationReplica } from '@workspace/core/antigravity-conversation-replica';
import type { ProviderConversationFrame } from '@workspace/core/contracts';
import type { CompanionReset, CompanionTarget } from '@workspace/core/companion-protocol';

type Replica = { apply(event: never): unknown; getSnapshot(): unknown };
type Entry = { target: CompanionTarget; frame: CompanionReset | null; replica?: Replica; timer?: ReturnType<typeof setTimeout>; expiresAt?: number; loading?: Promise<CompanionReset | null> };
const graceMs = 5 * 60_000;
const same = (a: CompanionTarget, b: CompanionTarget) => JSON.stringify(a) === JSON.stringify(b);

/** A provider-owned replica per viewed chat; hidden subscriptions expire after five minutes. */
export class ConversationCache {
  private readonly entries = new Map<string, Entry>();
  private selected = '';
  constructor(private readonly request: (method: string, target: CompanionTarget) => Promise<unknown>, private readonly changed: (frame: CompanionReset) => void, private readonly failed: () => void) {}
  peek(target: CompanionTarget): CompanionReset | null | undefined {
    const entry = this.entries.get(target.agentId);
    return entry && same(entry.target, target) && !entry.loading && (!target.sessionId || entry.frame) ? entry.frame : undefined;
  }
  async select(target: CompanionTarget | null): Promise<CompanionReset | null> {
    if (this.selected !== target?.agentId) {
      const previous = this.entries.get(this.selected);
      if (previous) {
        clearTimeout(previous.timer);
        previous.expiresAt = Date.now() + graceMs;
        previous.timer = setTimeout(() => this.drop(previous), graceMs);
      }
    }
    this.selected = target?.agentId ?? '';
    if (!target) return null;
    let entry = this.entries.get(target.agentId);
    if (entry && !same(entry.target, target)) { this.drop(entry); entry = undefined; }
    if (!entry) { entry = { target, frame: null }; this.entries.set(target.agentId, entry); }
    clearTimeout(entry.timer); entry.timer = undefined; entry.expiresAt = undefined;
    if (!target.sessionId) return null;
    return entry.loading ?? (entry.frame ? entry.frame : this.load(entry));
  }
  receive(frame: ProviderConversationFrame) {
    const entry = this.entries.get(frame.agentId);
    if (!entry) return;
    if (frame.backend === 'codex' && entry.target.sessionId !== JSON.stringify({ kind: 'codex', threadId: frame.threadId })) return;
    const current = entry.frame;
    if (current && current.backend !== frame.backend) return;
    if (current && frame.payload.revision <= current.payload.revision) return;
    if (frame.type === 'codex.conversationSnapshotChanged') entry.replica = createCodexConversationReplica(frame.payload.snapshot);
    else if (frame.type === 'claude.conversationSnapshotChanged') entry.replica = createClaudeConversationReplica(frame.payload.snapshot);
    else if (frame.type === 'antigravity.conversationSnapshotChanged') entry.replica = createAntigravityConversationReplica(frame.payload.snapshot);
    else {
      if (!current || !entry.replica || frame.payload.revision !== current.payload.revision + 1) { void this.load(entry).catch(this.failed); return; }
      try {
        entry.replica.apply(frame.payload.event as never);
        const snapshot = entry.replica.getSnapshot();
        // A peer can run a newer SDK. Some replicas return undefined for an unknown
        // event; recover from its authoritative reset before touching renderer state.
        if (!snapshot) throw new Error('Provider event did not produce a snapshot.');
        entry.frame = { ...current, payload: { revision: frame.payload.revision, snapshot } } as CompanionReset;
        this.changed(entry.frame); return;
      } catch { void this.load(entry).catch(this.failed); return; }
    }
    entry.frame = frame;
    this.changed(frame);
  }
  /** Workspace/session changes invalidate replicas before any more events can be applied. */
  reconcile(targets: CompanionTarget[]) {
    for (const entry of [...this.entries.values()]) {
      const target = targets.find((target) => target.agentId === entry.target.agentId);
      if (!target) { this.drop(entry); continue; }
      if (!same(entry.target, target)) {
        clearTimeout(entry.timer);
        const replacement: Entry = { target, frame: null, expiresAt: entry.expiresAt };
        this.entries.set(target.agentId, replacement);
        if (replacement.expiresAt !== undefined) replacement.timer = setTimeout(() => this.drop(replacement), Math.max(0, replacement.expiresAt - Date.now()));
        if (target.sessionId) void this.load(replacement).catch(this.failed);
      }
    }
  }
  close() {
    for (const entry of this.entries.values()) clearTimeout(entry.timer);
    this.entries.clear(); this.selected = '';
  }
  private load(entry: Entry): Promise<CompanionReset | null> {
    if (entry.loading) return entry.loading;
    // Reset first: a recovery snapshot may use the same revision after a provider restart.
    entry.frame = null; entry.replica = undefined;
    const pending = this.request('conversation.subscribe', entry.target).then(() => {
      if (this.entries.get(entry.target.agentId) !== entry) return null;
      if (!entry.frame) throw new Error('Conversation reset missing.');
      return entry.frame;
    }).catch((error) => {
      if (this.entries.get(entry.target.agentId) !== entry) return null;
      throw error;
    });
    entry.loading = pending.finally(() => { if (entry.loading === loading) entry.loading = undefined; });
    const loading = entry.loading;
    return loading;
  }
  private drop(entry: Entry) {
    clearTimeout(entry.timer);
    if (this.entries.get(entry.target.agentId) !== entry) return;
    this.entries.delete(entry.target.agentId);
    if (entry.target.sessionId) void this.request('conversation.unsubscribe', entry.target).catch(this.failed);
  }
}
