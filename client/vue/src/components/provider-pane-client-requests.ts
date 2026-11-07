import type { CodexSurfaceClientRequest } from '@codex-app-sdk/core/surface';
import type { ClientRequest } from '@workspace/core/contracts';

export function providerPaneClientRequests(snapshot: { sessionId: string; activeTurnId: string | null; clientRequests: ClientRequest[] }): CodexSurfaceClientRequest[] {
  return snapshot.clientRequests.filter(request => !(request.kind === 'confirm_tool' && request.payload.confirmation.integrationId === 'cursor' && request.payload.confirmation.toolName === 'create_plan')).map(request => request.kind === 'ask_user'
    ? { ...request, conversationId: snapshot.sessionId, turnId: snapshot.activeTurnId ?? '', itemId: request.payload.request.itemId,
      payload: { request: { ...request.payload.request, delivery: request.payload.request.delivery ?? 'tool', blocking: request.payload.request.blocking ?? true } } }
    : { ...request, conversationId: snapshot.sessionId, turnId: snapshot.activeTurnId, itemId: request.id });
}
