import type { CursorConversationEvent, CursorConversationSnapshot } from './contracts/cursor-conversation';
import { isAgentRequestResponse } from './agent-request';
import { isRendererMessage } from './snapshot-guard-collections';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const nullableString = (value: unknown) => value === null || typeof value === 'string';
const strings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string');
function request(value: unknown): boolean {
  if (!record(value) || typeof value.id !== 'string' || !record(value.payload)) return false;
  if (value.kind === 'confirm_tool') {
    const confirmation = value.payload.confirmation;
    return record(confirmation) && ['argumentsPreview', 'integrationId', 'integrationName', 'summary', 'toolName'].every(key => typeof confirmation[key] === 'string');
  }
  const question = value.payload.request;
  return value.kind === 'ask_user' && record(question) && typeof question.itemId === 'string' && Array.isArray(question.questions)
    && question.questions.every(item => record(item) && ['id', 'header', 'question'].every(key => typeof item[key] === 'string')
      && typeof item.isOther === 'boolean' && typeof item.isSecret === 'boolean'
      && (item.options === null || (Array.isArray(item.options) && item.options.every(option => record(option) && typeof option.label === 'string' && typeof option.description === 'string'))));
}

export function isCursorSnapshot(value: unknown): value is CursorConversationSnapshot {
  return record(value) && typeof value.agentId === 'string' && typeof value.sessionId === 'string'
    && nullableString(value.activeTurnId) && nullableString(value.error) && typeof value.busy === 'boolean' && typeof value.historyLoading === 'boolean'
    && strings(value.answeredClientRequestIds) && record(value.historyState) && value.historyState.hasOlder === false && value.historyState.loadingOlder === false
    && value.contextUsage === null
    && Array.isArray(value.messages) && value.messages.every(message => isRendererMessage(message) && record(message) && message.agentId === value.agentId)
    && Array.isArray(value.clientRequests) && value.clientRequests.every(request)
    && Array.isArray(value.turns) && value.turns.every(turn => record(turn) && typeof turn.id === 'string'
      && ['inProgress', 'completed', 'interrupted', 'failed'].includes(String(turn.status))
      && turn.error === null && turn.willRetry === false && nullableString(turn.startedAt) && nullableString(turn.completedAt)
      && (turn.durationMs === null || typeof turn.durationMs === 'number'));
}

export function isCursorEvent(value: unknown): value is CursorConversationEvent {
  if (!record(value) || !['agentId', 'sessionId', 'turnId', 'occurredAt'].every(key => typeof value[key] === 'string') || !record(value.payload)) return false;
  const payload = value.payload;
  switch (value.type) {
    case 'request.created': return request(payload.request);
    case 'request.resolved': return isAgentRequestResponse(payload);
    case 'turn.started': return record(payload.turn) && payload.turn.id === value.turnId;
    case 'turn.completed': return record(payload.turn) && payload.turn.id === value.turnId && ['completed', 'interrupted', 'failed'].includes(String(payload.turn.status)) && (payload.error === undefined || typeof payload.error === 'string');
    case 'message.upsert': return isRendererMessage(payload.message) && record(payload.message) && payload.message.agentId === value.agentId && payload.message.turnId === value.turnId;
    default: return false;
  }
}
