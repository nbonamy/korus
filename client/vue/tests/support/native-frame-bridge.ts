import { createScriptedHarness } from '@korus-dev/multi-agent-sdk/testing';
import type { SessionPatch, SessionSnapshot } from '@korus-dev/multi-agent-sdk';
import type { HarnessProvider, MainToRendererEvent } from '@workspace/core/contracts';
import { codexEventFromWire } from '@workspace/core/codex-event-wire';

const nativeFrame = /^(codex|claude|cursor|antigravity)\.conversation(SnapshotChanged|EventReceived)$/;
type Native = {
  type: string; agentId: string; provider: HarnessProvider; threadId?: string; seq?: number; occurredAt?: string;
  payload: { revision: number; snapshot?: { sessionId?: string | null; activeConversationId?: string }; event?: unknown };
};
type Conversation = { provider: HarnessProvider; conversation: string | null; nativeRevision: number; apply(frame: unknown): SessionPatch[]; snapshot(): SessionSnapshot };

function conversationFor(agentId: string, provider: HarnessProvider, conversation: string | null): Conversation {
  const { harness, script } = createScriptedHarness(provider);
  const session = harness.open({ id: agentId, folder: '/work' });
  let patches: SessionPatch[] = [];
  harness.onEvent(event => { if (event.type === 'session.patch') patches.push(event.patch); });
  return {
    provider, conversation, nativeRevision: 0,
    apply(frame) { patches = []; script.emit(frame as never); return patches; },
    // The browser receives session state as JSON.
    snapshot: () => JSON.parse(JSON.stringify(harness.readSessionSnapshot(session))) as SessionSnapshot,
  };
}

/**
 * Tests describe conversations as native provider frames. The daemon turns those into neutral session state before
 * the browser sees them; this does the same through the SDK's own harness: a native snapshot becomes a session
 * snapshot, a native event becomes patches, and a skipped native revision reaches the browser as a skipped patch.
 */
export function withNativeFrameBridge(listener: (event: MainToRendererEvent) => void): (event: MainToRendererEvent) => void {
  const conversations = new Map<string, Conversation>();
  return event => {
    const match = nativeFrame.exec(event.type);
    if (!match) { listener(event); return; }
    // The daemon still delivers the native frame next to the session state derived from it.
    listener(event);
    const frame = event as unknown as Native;
    const envelope = { agentId: frame.agentId, provider: frame.provider, seq: frame.seq ?? 0, occurredAt: frame.occurredAt ?? '' };
    const send = (type: string, payload: unknown) => listener({ ...envelope, type, payload } as MainToRendererEvent);
    if (match[2] === 'SnapshotChanged') {
      const snapshot = frame.payload.snapshot ?? {};
      const id = frame.threadId ?? snapshot.activeConversationId ?? snapshot.sessionId ?? null;
      const existing = conversations.get(frame.agentId)?.provider === frame.provider ? conversations.get(frame.agentId) : undefined;
      // The owner keeps one harness per agent, which ignores a snapshot older than the one it holds,
      // and publishes its current state after every load.
      const current = existing ?? conversationFor(frame.agentId, frame.provider, id);
      if (!existing || frame.payload.revision > existing.nativeRevision) {
        current.apply(frame);
        current.conversation = id;
        current.nativeRevision = frame.payload.revision;
      }
      conversations.set(frame.agentId, current);
      send('conversation.sessionSnapshot', { conversation: current.conversation, snapshot: current.snapshot() });
      return;
    }
    const current = conversations.get(frame.agentId);
    const conversation = frame.threadId ?? current?.conversation ?? null;
    if (current && current.conversation === conversation && frame.payload.revision <= current.nativeRevision) return;
    if (!current || current.provider !== frame.provider || current.conversation !== conversation || frame.payload.revision !== current.nativeRevision + 1) {
      // A patch the browser cannot apply sends it back to the conversation owner for a fresh snapshot.
      send('conversation.sessionPatch', { conversation, patch: { revision: (current?.snapshot().revision ?? 0) + 2, ops: [] } });
      return;
    }
    current.nativeRevision = frame.payload.revision;
    const native = frame.provider === 'codex' ? { ...frame, payload: { ...frame.payload, event: codexEventFromWire(frame.payload.event as never) } } : frame;
    for (const patch of current.apply(native)) send('conversation.sessionPatch', { conversation, patch });
  };
}
