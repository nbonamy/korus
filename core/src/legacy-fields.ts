import { isRecord } from './snapshot-guard-primitives';

/**
 * Session data and conversation references used to name the conversation `threadId` (Codex) or `sessionId`
 * (other harnesses), and Claude's transcript `transcriptSessionId`. Records saved or sent that way read as
 * `conversationId` and `transcriptConversationId`; anything else is returned unchanged.
 */
export function withConversationId(value: unknown): unknown {
  if (!isRecord(value) || 'conversationId' in value) return value;
  const { threadId, sessionId, transcriptSessionId, ...rest } = value;
  const conversationId = typeof threadId === 'string' ? threadId : sessionId;
  if (typeof conversationId !== 'string') return value;
  return { ...rest, conversationId, ...(typeof transcriptSessionId === 'string' ? { transcriptConversationId: transcriptSessionId } : {}) };
}
