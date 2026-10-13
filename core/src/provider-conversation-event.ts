import type { MainToRendererEvent } from './contracts';

export type ProviderConversationEventView = {
  type: string;
  agentId?: string;
  turnId?: string;
  conversationId?: string;
  payload: unknown;
};

/** Unwraps provider-owned conversation frames without exposing provider details to callers. */
export function providerConversationEventView(
  event: MainToRendererEvent,
): ProviderConversationEventView {
  let conversationId = event.conversationId ?? event.threadId ?? event.backendSessionId;
  if (
    event.type === 'antigravity.conversationEventReceived' ||
    event.type === 'codex.conversationEventReceived' ||
    event.type === 'claude.conversationEventReceived'
  ) {
    const frame = event.payload.event;
    const frameId = 'conversationId' in frame && typeof frame.conversationId === 'string' ? frame.conversationId
      : 'backendSessionId' in frame && typeof frame.backendSessionId === 'string' ? frame.backendSessionId
        : 'sessionId' in frame && typeof frame.sessionId === 'string' ? frame.sessionId : undefined;
    if (frameId) conversationId = frameId;
    return {
      type: event.payload.event.type,
      agentId: event.agentId,
      ...(conversationId ? { conversationId } : {}),
      ...('turnId' in event.payload.event && typeof event.payload.event.turnId === 'string'
        ? { turnId: event.payload.event.turnId }
        : {}),
      payload: event.payload.event.payload,
    };
  }
  return {
    type: event.type,
    ...(event.agentId ? { agentId: event.agentId } : {}),
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(conversationId ? { conversationId } : {}),
    payload: event.payload,
  };
}
