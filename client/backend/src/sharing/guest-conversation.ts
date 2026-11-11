import { applySessionPatch, type SessionPatch, type SessionSnapshot } from '@korus-dev/multi-agent-sdk/contracts';
import type { Message, SessionState } from '@korus-dev/multi-agent-sdk';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import type { GuestConversationSession, GuestConversationUpdate } from '@workspace/core/guest-conversation';

export type SessionConversationEvent = Extract<AppBackendEvent, { type: 'conversation.sessionSnapshot' | 'conversation.sessionPatch' }>;
export const isSessionConversationEvent = (event: AppBackendEvent): event is SessionConversationEvent =>
  event.type === 'conversation.sessionSnapshot' || event.type === 'conversation.sessionPatch';

/**
 * The transcript fields a guest sees. Execution settings, permissions, plan mode, the title and the owner's pending
 * requests and answers stay with the owner; the required ones reach guests empty.
 */
const guestFields = new Set<string>(['busy', 'activeTurnId', 'turns', 'historyLoading', 'historyState', 'error', 'goal', 'contextUsage', 'plan'] satisfies (keyof SessionState)[]);

function guestState({ messages, busy, activeTurnId, turns, historyLoading, historyState, error, goal, contextUsage, plan }: SessionState): SessionState {
  return { messages, busy, activeTurnId, turns, error, goal, contextUsage, plan, requests: [], title: null,
    ...(historyLoading === undefined ? {} : { historyLoading }), ...(historyState === undefined ? {} : { historyState }) };
}
function guestPatch(patch: SessionPatch): SessionPatch {
  // A patch keeps its revision with no visible change, so the guest's revisions stay contiguous.
  return { revision: patch.revision, ops: patch.ops.filter(op => op.op === 'spliceMessages' || guestFields.has(op.key)) };
}

/** Keep only the routing envelope and the guest-visible transcript. App snapshots, proposals and owner state never cross this boundary. */
export function guestConversationUpdate(event: SessionConversationEvent | GuestConversationUpdate): GuestConversationUpdate {
  const { agentId, provider } = event; const { conversation, epoch } = event.payload;
  return event.type === 'conversation.sessionSnapshot'
    ? { type: event.type, agentId, provider, payload: { conversation, epoch, snapshot: { revision: event.payload.snapshot.revision, state: guestState(event.payload.snapshot.state) } } }
    : { type: event.type, agentId, provider, payload: { conversation, epoch, patch: guestPatch(event.payload.patch) } };
}
export function guestSnapshotUpdate(session: GuestConversationSession): GuestConversationUpdate {
  const { agentId, provider, conversation, epoch, snapshot } = session;
  return guestConversationUpdate({ type: 'conversation.sessionSnapshot', agentId, provider, payload: { conversation, epoch, snapshot } });
}
/** The messages an update delivers, which the guest may then ask the owner to expand or preview. */
export function deliveredMessages(update: GuestConversationUpdate): Message[] {
  return update.type === 'conversation.sessionSnapshot' ? update.payload.snapshot.state.messages
    : update.payload.patch.ops.flatMap(op => op.op === 'spliceMessages' ? op.messages : []);
}

/**
 * Applies one conversation stream: a snapshot replaces unless it is a late one from the current stream, and a patch
 * applies in revision order within its stream. Returns false when the holder needs a fresh snapshot.
 */
function follow(current: GuestConversationSession | null, update: GuestConversationUpdate | SessionConversationEvent): { session: GuestConversationSession | null; ok: boolean } {
  const { agentId, provider } = update; const { conversation, epoch } = update.payload;
  const sameStream = current !== null && current.agentId === agentId && current.provider === provider && current.epoch === epoch && current.conversation === conversation;
  if (update.type === 'conversation.sessionSnapshot') {
    if (sameStream && update.payload.snapshot.revision < current.snapshot.revision) return { session: current, ok: true };
    return { session: { agentId, provider, conversation, epoch, snapshot: update.payload.snapshot }, ok: true };
  }
  if (!sameStream) return { session: current, ok: false };
  if (update.payload.patch.revision <= current.snapshot.revision) return { session: current, ok: true };
  try { return { session: { ...current, snapshot: applySessionPatch(current.snapshot, update.payload.patch) }, ok: true }; }
  catch { return { session: current, ok: false }; }
}

/** The guest's copy of the shared conversation. A missed revision or another stream asks the owner for a fresh snapshot. */
export class GuestConversationCache {
  session: GuestConversationSession | null = null;
  /** Set when an update could not be applied, until a snapshot replaces the state. */
  stale = false;
  clear() { this.session = null; this.stale = false; }
  receive(update: GuestConversationUpdate): boolean {
    const next = follow(this.session, update);
    this.session = next.session;
    if (update.type === 'conversation.sessionSnapshot') this.stale = false;
    if (!next.ok) this.stale = true;
    return next.ok;
  }
}

/**
 * The owner's shared conversations, as the daemon publishes them. Only conversations a guest session watches are
 * retained, and another conversation the agent shows meanwhile never replaces them; a missed revision drops the copy,
 * so the next read loads the conversation again.
 */
export class SessionConversationSource {
  private readonly sessions = new Map<string, GuestConversationSession>();
  private readonly watchers = new Map<string, number>();
  constructor(private readonly load: (agentId: string) => Promise<void>) {}
  private static key(agentId: string, conversation: string | null) { return JSON.stringify([agentId, conversation]); }
  watch(agentId: string, conversation: string): () => void {
    const key = SessionConversationSource.key(agentId, conversation);
    this.watchers.set(key, (this.watchers.get(key) ?? 0) + 1);
    let active = true;
    return () => {
      if (!active) return; active = false;
      const count = (this.watchers.get(key) ?? 1) - 1;
      if (count > 0) { this.watchers.set(key, count); return; }
      this.watchers.delete(key); this.sessions.delete(key);
    };
  }
  /** Safe to call once per listener: a repeated event changes nothing. */
  observe(event: AppBackendEvent): void {
    if (event.type === 'conversation.historyLoadFailed') { this.forget(id => id === event.agentId); return; }
    if (event.type === 'snapshot.updated') {
      const agents = new Set(event.payload.agents.map(agent => agent.id));
      this.forget(id => !agents.has(id)); return;
    }
    if (!isSessionConversationEvent(event)) return;
    const key = SessionConversationSource.key(event.agentId, event.payload.conversation);
    if (!this.watchers.has(key)) return;
    const next = follow(this.sessions.get(key) ?? null, event);
    if (next.ok && next.session) this.sessions.set(key, next.session); else this.sessions.delete(key);
  }
  clear(): void { this.sessions.clear(); }
  async read(agentId: string, conversation: string): Promise<GuestConversationSession> {
    const key = SessionConversationSource.key(agentId, conversation);
    // Loading publishes a fresh snapshot, which observe() retains before the load resolves. A revision missed
    // while it was loading drops that copy again, so the load is tried once more.
    for (let attempt = 0; ; attempt++) {
      const current = this.sessions.get(key);
      if (current) return current;
      if (attempt === 2) throw new Error('Authoritative conversation is unavailable.');
      await this.load(agentId);
    }
  }
  private forget(matches: (agentId: string) => boolean) {
    for (const [key, session] of this.sessions) if (matches(session.agentId)) this.sessions.delete(key);
  }
}
