import type { ClientRequest, ProviderClientRequest as BackendClientRequest } from '@korus-dev/multi-agent-sdk';

export function providerPaneClientRequests(snapshot: { sessionId: string; activeTurnId: string | null; clientRequests: BackendClientRequest[] }): ClientRequest[] {
  return snapshot.clientRequests.map(request => request.kind === 'ask_user'
    ? { ...request, conversationId: snapshot.sessionId, turnId: snapshot.activeTurnId ?? '', itemId: request.payload.request.itemId,
      payload: { request: { ...request.payload.request, delivery: request.payload.request.delivery ?? 'tool', blocking: request.payload.request.blocking ?? true } } }
    : { ...request, conversationId: snapshot.sessionId, turnId: snapshot.activeTurnId, itemId: request.id });
}
