import type { ClaudeConversationSnapshot } from '@workspace/core/contracts';
import type { CodexSurfaceClientRequest } from '@codex-app-sdk/core/surface';

/** Read-only presentation of Claude's existing normalized permission parts. */
export function claudePaneClientRequests(snapshot: ClaudeConversationSnapshot | null | undefined): CodexSurfaceClientRequest[] {
  if (!snapshot) return [];
  const seen = new Set(snapshot.answeredClientRequestIds);
  const requests: CodexSurfaceClientRequest[] = [];
  for (const message of snapshot.messages) {
    for (const part of message.parts) {
      if (part.type !== 'tool' || part.status !== 'running') continue;
      const id = part.metadata?.confirmationRequestId;
      const integrationId = part.metadata?.server;
      const toolName = part.metadata?.tool;
      if (typeof id !== 'string' || seen.has(id) || typeof integrationId !== 'string' || typeof toolName !== 'string') continue;
      let params: Record<string, unknown> | undefined;
      try { params = JSON.parse(part.statusText ?? '').params; } catch { continue; }
      if (!params || typeof params !== 'object' || typeof params.confirmationSummary !== 'string' || typeof params.argumentsPreview !== 'string') continue;
      seen.add(id);
      requests.push({
        id, kind: 'confirm_tool', conversationId: snapshot.sessionId ?? snapshot.agentId,
        turnId: message.turnId ?? snapshot.activeTurnId, itemId: part.id,
        payload: { confirmation: {
          integrationId, integrationName: integrationId === 'claude' ? 'Claude' : integrationId,
          toolName, summary: params.confirmationSummary, argumentsPreview: params.argumentsPreview,
          allowConversation: params.allowConversation === true, allowAlways: params.allowAlways === true,
        } },
      });
    }
  }
  return requests;
}
