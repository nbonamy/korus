import type { CodexSurfaceClientRequest } from '@codex-app-sdk/core/surface';
import type { AntigravityConversationSnapshot } from '@workspace/core/contracts/antigravity-conversation';

export function antigravityPaneClientRequests(snapshot: AntigravityConversationSnapshot): CodexSurfaceClientRequest[] {
  return snapshot.clientRequests.map(request => request.kind === 'ask_user'
    ? { ...request, conversationId: snapshot.sessionId, turnId: snapshot.activeTurnId ?? '', itemId: request.payload.request.itemId,
      payload: { request: { ...request.payload.request, delivery: request.payload.request.delivery ?? 'tool', blocking: request.payload.request.blocking ?? true } } }
    : { ...request, conversationId: snapshot.sessionId, turnId: snapshot.activeTurnId, itemId: request.id });
}
