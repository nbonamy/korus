import type { AgentStatus } from '@workspace/core/contracts';
import type { CodexConversationSnapshot } from '@codex-app-sdk/core/surface';

/**
 * What a person should see for the conversation. An error with a turn still running is a retry in progress, not a failure:
 * the turn is working until it ends, and only then does its error become the agent's state.
 */
export function statusFromSnapshot(snapshot: CodexConversationSnapshot): AgentStatus {
  if (snapshot.threadStatus?.type === 'active') {
    if (snapshot.threadStatus.activeFlags.includes('waitingOnApproval')) {
      return { type: 'awaitingInput', detail: { key: 'backend.awaitingApproval' } };
    }
    if (snapshot.threadStatus.activeFlags.includes('waitingOnUserInput')) {
      return { type: 'awaitingInput', detail: { key: 'backend.awaitingUserInput' } };
    }
  }
  if (snapshot.clientRequests.some((request) => (
    request.kind !== 'ask_user' || request.payload.request.blocking !== false
  )) || snapshot.approvals.length > 0) {
    return { type: 'awaitingInput', detail: { key: 'backend.awaitingUserInput' } };
  }
  if (snapshot.busy) return { type: 'working' };
  if (snapshot.error) return { type: 'error', message: snapshot.error };
  return snapshot.goal?.status === 'active' ? { type: 'working' } : { type: 'idle' };
}
