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

/**
 * Saved settings used to hold the permission as `approvalPreset` (Codex) or `permissionMode` (other harnesses).
 * Settings saved or sent that way read as `permission`; a `permission` already present wins.
 */
export function withPermission(value: unknown): unknown {
  if (!isRecord(value) || typeof value.permission === 'string') return value;
  const { approvalPreset, permissionMode, ...rest } = value;
  const permission = typeof approvalPreset === 'string' ? approvalPreset : permissionMode;
  return typeof permission === 'string' ? { ...rest, permission } : value;
}

/** An agent from an earlier build, with its conversation and permission read under their current names; unchanged otherwise. */
export function withLegacyAgentFields<T extends Record<string, unknown>>(agent: T): T {
  const providerSession = withConversationId(agent.providerSession);
  const providerDefaults = withPermission(agent.providerDefaults);
  return providerSession === agent.providerSession && providerDefaults === agent.providerDefaults ? agent : { ...agent, providerSession, providerDefaults };
}
