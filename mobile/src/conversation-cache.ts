import { CompanionJournal, type CompanionCheckpoint, type CompanionSync } from '@workspace/core/companion-journal';
import { createCodexConversationReplica } from '@codex-app-sdk/core/conversation-replica';
import { createClaudeConversationReplica } from '@workspace/core/claude-conversation-replica';
import { createAntigravityConversationReplica } from '@workspace/core/antigravity-conversation-replica';
import type { ProviderConversationFrame } from '@workspace/core/contracts';
import { isConversationReset, type CompanionReset, type CompanionTarget } from '@workspace/core/companion-protocol';
import { connectionDiagnostic, connectionError } from './connection-diagnostics';

type Replica = { apply(event: never): unknown; getSnapshot(): unknown };
type Entry = { target: CompanionTarget; frame: CompanionReset | null; replica?: Replica; timer?: ReturnType<typeof setTimeout>; expiresAt?: number; loading?: Promise<CompanionReset | null>; subscribed?: boolean; resetting?: boolean; checkpoint?: CompanionCheckpoint; bytes?: number };
type Request = (method: string, target: CompanionTarget, checkpoint?: CompanionCheckpoint | null) => Promise<unknown>;
export function createCompanionReplica(frame: CompanionReset): Replica {
  if (frame.type === 'codex.conversationSnapshotChanged') return createCodexConversationReplica(frame.payload.snapshot);
  if (frame.type === 'claude.conversationSnapshotChanged') return createClaudeConversationReplica(frame.payload.snapshot);
  return createAntigravityConversationReplica(frame.payload.snapshot);
}
const graceMs = 5 * 60_000;
const same = (a: CompanionTarget, b: CompanionTarget) => JSON.stringify(a) === JSON.stringify(b);

/** A provider-owned replica per viewed chat; hidden subscriptions expire after five minutes. */
export class ConversationCache {
  private readonly entries = new Map<string, Entry>();
  private selected = '';
  private readonly journal = new CompanionJournal();
  private epoch = 0;
  private online = true;
  constructor(private request: Request, private changed: (frame: CompanionReset) => void, private failed: () => void) {}
  reconnect(request: Request, changed = this.changed, failed = this.failed) { this.disconnect(); this.request = request; this.changed = changed; this.failed = failed; this.online = true; }
  disconnect() {
    ++this.epoch; this.online = false;
    for (const entry of this.entries.values()) { clearTimeout(entry.timer); entry.timer = undefined; entry.subscribed = false; entry.loading = undefined; }
  }
  current(target: CompanionTarget): boolean {
    const entry = this.entries.get(target.agentId);
    return this.online && Boolean(entry && same(entry.target, target) && entry.subscribed && !entry.loading && (!target.sessionId || entry.frame));
  }
  updates(target: CompanionTarget, since: CompanionCheckpoint | null): CompanionSync | null {
    const entry = this.entries.get(target.agentId);
    if (!entry?.frame || !same(entry.target, target)) return null;
    const resumed = since && this.journal.resume(target.agentId, since);
    if (resumed) return resumed;
    const checkpoint = this.journal.checkpoint(target.agentId);
    return checkpoint ? { checkpoint, frames: [entry.frame] } : null;
  }
  peek(target: CompanionTarget): CompanionReset | null | undefined {
    const entry = this.entries.get(target.agentId);
    return entry && same(entry.target, target) && (!target.sessionId || entry.frame) ? entry.frame : undefined;
  }
  async select(target: CompanionTarget | null): Promise<CompanionReset | null> {
    if (this.selected !== target?.agentId) {
      const previous = this.entries.get(this.selected);
      if (previous) {
        clearTimeout(previous.timer);
        previous.expiresAt = Date.now() + graceMs;
        previous.timer = setTimeout(() => this.expire(previous), graceMs);
      }
    }
    this.selected = target?.agentId ?? '';
    if (!target) return null;
    let entry = this.entries.get(target.agentId);
    if (entry && !same(entry.target, target)) { this.drop(entry); entry = undefined; }
    if (!entry) { entry = { target, frame: null }; this.entries.set(target.agentId, entry); }
    this.entries.delete(target.agentId); this.entries.set(target.agentId, entry);
    clearTimeout(entry.timer); entry.timer = undefined; entry.expiresAt = undefined;
    if (!target.sessionId) return null;
    if (!this.online) return entry.frame;
    return entry.loading ?? (entry.subscribed && entry.frame ? entry.frame : this.load(entry));
  }
  receive(frame: ProviderConversationFrame) {
    const entry = this.entries.get(frame.agentId);
    if (!entry?.subscribed) return;
    if (frame.backend === 'codex' && entry.target.sessionId !== JSON.stringify({ kind: 'codex', threadId: frame.threadId })) return;
    const current = entry.frame;
    if (current && current.backend !== frame.backend) return;
    const reset = isConversationReset(frame);
    if (current && frame.payload.revision <= current.payload.revision && !(reset && entry.resetting)) return;
    if (reset) { entry.resetting = false; entry.checkpoint = undefined; }
    this.journal.observe(frame);
    if (reset) entry.replica = createCompanionReplica(frame as CompanionReset);
    else {
      if (!current || !entry.replica || frame.payload.revision !== current.payload.revision + 1) { void this.load(entry).catch(this.failed); return; }
      try {
        entry.replica.apply(frame.payload.event as never);
        const snapshot = entry.replica.getSnapshot();
        // A peer can run a newer SDK. Some replicas return undefined for an unknown
        // event; recover from its authoritative reset before touching renderer state.
        if (!snapshot) throw new Error('Provider event did not produce a snapshot.');
        entry.frame = { ...current, payload: { revision: frame.payload.revision, snapshot } } as CompanionReset;
        if (entry.checkpoint) entry.checkpoint = { ...entry.checkpoint, revision: frame.payload.revision };
        entry.bytes = (entry.bytes ?? 0) + new TextEncoder().encode(JSON.stringify(frame)).byteLength; this.trim();
        this.changed(entry.frame); return;
      } catch { void this.load(entry).catch(this.failed); return; }
    }
    entry.frame = frame;
    entry.bytes = new TextEncoder().encode(JSON.stringify(frame)).byteLength;
    this.trim();
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
        if (replacement.expiresAt !== undefined) replacement.timer = setTimeout(() => this.expire(replacement), Math.max(0, replacement.expiresAt - Date.now()));
        if (target.sessionId) void this.load(replacement).catch(this.failed);
      }
    }
  }
  close() {
    for (const entry of this.entries.values()) clearTimeout(entry.timer);
    ++this.epoch; this.journal.clear(); this.entries.clear(); this.selected = '';
  }
  private load(entry: Entry): Promise<CompanionReset | null> {
    if (entry.loading) return entry.loading;
    const epoch = this.epoch;
    entry.resetting = true; entry.subscribed = true;
    const pending = this.request('conversation.subscribe', entry.target, entry.checkpoint ?? null).then((result) => {
      if (this.entries.get(entry.target.agentId) !== entry || epoch !== this.epoch) return null;
      if ((entry.resetting && !(result as { checkpoint?: unknown } | undefined)?.checkpoint) || !entry.frame) throw new Error('Conversation reset missing.');
      const checkpoint = (result as { checkpoint?: CompanionCheckpoint } | undefined)?.checkpoint;
      if (checkpoint && entry.frame.payload.revision < checkpoint.revision) throw new Error('Conversation catch-up incomplete.');
      if (checkpoint) entry.checkpoint = { ...checkpoint, revision: entry.frame.payload.revision };
      entry.resetting = false;
      return entry.frame;
    }).catch((error) => {
      if (this.entries.get(entry.target.agentId) !== entry || epoch !== this.epoch) return null;
      entry.subscribed = false;
      connectionDiagnostic('conversation.load-error', { agentId: entry.target.agentId, stage: this.selected === entry.target.agentId ? 'selected' : 'hidden', ...connectionError(error) });
      throw error;
    });
    entry.loading = pending.finally(() => { if (entry.loading === loading) entry.loading = undefined; });
    const loading = entry.loading;
    return loading;
  }
  private trim() {
    let bytes = [...this.entries.values()].reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
    for (const entry of this.entries.values()) {
      if (this.entries.size <= 8 && bytes <= 64 * 1024 * 1024) break;
      if (entry.target.agentId === this.selected || entry.loading) continue;
      bytes -= entry.bytes ?? 0; this.drop(entry);
    }
  }
  private expire(entry: Entry) {
    clearTimeout(entry.timer); entry.timer = undefined;
    if (this.entries.get(entry.target.agentId) !== entry) return;
    entry.subscribed = false;
    if (entry.target.sessionId && this.online) void this.request('conversation.unsubscribe', entry.target).catch(this.failed);
  }
  private drop(entry: Entry) {
    clearTimeout(entry.timer);
    if (this.entries.get(entry.target.agentId) !== entry) return;
    this.entries.delete(entry.target.agentId); this.journal.forget(entry.target.agentId);
    if (entry.target.sessionId && entry.subscribed && this.online) void this.request('conversation.unsubscribe', entry.target).catch(this.failed);
  }
}
