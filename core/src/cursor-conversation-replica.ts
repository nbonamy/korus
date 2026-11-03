import type { CursorConversationEvent, CursorConversationSnapshot } from './contracts/cursor-conversation';

/** Cursor owns this replica; the app coordination reducer never contains its transcript. */
export function createCursorConversationReplica(initial: CursorConversationSnapshot) {
  let snapshot = structuredClone(initial);
  return {
    getSnapshot: () => snapshot,
    apply(event: CursorConversationEvent): CursorConversationSnapshot {
      if (event.agentId !== snapshot.agentId || event.sessionId !== snapshot.sessionId) throw new Error('Cursor conversation identity mismatch.');
      const next = structuredClone(snapshot);
      switch (event.type) {
        case 'message.upsert': {
          if (event.turnId !== next.activeTurnId) return snapshot;
          const index = next.messages.findIndex(message => message.id === event.payload.message.id);
          if (index === -1) next.messages.push(structuredClone(event.payload.message));
          else next.messages[index] = structuredClone(event.payload.message);
          break;
        }
        case 'turn.started':
          if (next.busy) throw new Error('Cursor prompts must be serialized.');
          next.activeTurnId = event.turnId;
          next.busy = true;
          next.error = null;
          next.turns.push({ id: event.turnId, status: 'inProgress', error: null, willRetry: false, startedAt: event.occurredAt, completedAt: null, durationMs: null });
          break;
        case 'turn.completed': {
          const turn = next.turns.find(value => value.id === event.turnId);
          if (!turn || turn.status !== 'inProgress') return snapshot;
          turn.status = event.payload.turn.status; turn.completedAt = event.occurredAt;
          turn.durationMs = turn.startedAt ? Math.max(0, Date.parse(event.occurredAt) - Date.parse(turn.startedAt)) : null;
          if (next.activeTurnId === event.turnId) {
            next.activeTurnId = null; next.busy = false; next.error = event.payload.error ?? null;
          }
          next.messages.filter(message => message.turnId === event.turnId && message.status === 'streaming')
            .forEach(message => { message.status = event.payload.turn.status === 'failed' ? 'error' : 'complete'; });
          break;
        }
      }
      snapshot = next;
      return snapshot;
    },
  };
}

export function emptyCursorSnapshot(agentId: string, sessionId: string): CursorConversationSnapshot {
  return { agentId, sessionId, activeTurnId: null, turns: [], messages: [], clientRequests: [],
    answeredClientRequestIds: [], busy: false, historyLoading: false,
    historyState: { hasOlder: false, loadingOlder: false }, contextUsage: null, error: null };
}
