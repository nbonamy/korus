import type { AskUserRequest,BackendApprovalRequest,ClientRequest,ConfirmToolRequest,ClientRequestResponse } from './contracts';

type RequestIdentity = { id: string; conversationId: string; turnId?: string; itemId?: string };
export type AgentRequest = RequestIdentity & (
  | { kind: 'approval'; approval: BackendApprovalRequest }
  | { kind: 'question'; question: AskUserRequest & { delivery: 'tool' | 'async'; blocking: boolean } }
  | { kind: 'toolConfirmation'; confirmation: ConfirmToolRequest }
);
export type AgentRequestOutcome =
  | { kind: 'answered'; answers: NonNullable<NonNullable<ClientRequestResponse['payload']>['answers']> }
  | { kind: 'decision'; decision: NonNullable<NonNullable<ClientRequestResponse['payload']>['decision']>; feedback?: string }
  | { kind: 'cancelled'; reason?: string }
  | { kind: 'completed'; reason?: string };
export type AgentRequestResponse = { id: string; agentId?: string; outcome: Exclude<AgentRequestOutcome, { kind: 'completed' }> };

export function isAgentRequestResponse(value: unknown): value is AgentRequestResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Record<string, unknown>;
  if (response.agentId !== undefined && (typeof response.agentId !== 'string' || !response.agentId.trim())) return false;
  if (typeof response.id !== 'string' || !response.id.trim() || !response.outcome || typeof response.outcome !== 'object') return false;
  const outcome = response.outcome as Record<string, unknown>;
  if (outcome.kind === 'cancelled') return outcome.reason === undefined || typeof outcome.reason === 'string';
  if (outcome.kind === 'decision') return ['allow', 'allow_conversation', 'always_allow', 'deny'].includes(outcome.decision as string) && (outcome.feedback === undefined || (typeof outcome.feedback === 'string' && outcome.feedback.length <= 100_000));
  return outcome.kind === 'answered' && Boolean(outcome.answers && typeof outcome.answers === 'object' && !Array.isArray(outcome.answers)
    && Object.values(outcome.answers).every((answer) => answer && Array.isArray(answer.answers) && answer.answers.every((text: unknown) => typeof text === 'string')));
}

export function approvalAgentRequest(approval: Omit<BackendApprovalRequest, 'requestedPermissions' | 'allowedScopes'> & {
  requestedPermissions?: readonly import('./contracts').BackendRequestedPermission[];
  allowedScopes?: readonly import('./contracts').BackendApprovalScope[];
}): AgentRequest {
  const { requestedPermissions, allowedScopes, ...fields } = approval;
  return { id: approval.id, conversationId: approval.conversationId, turnId: approval.turnId, itemId: approval.itemId, kind: 'approval', approval: {
    ...fields,
    ...(requestedPermissions ? { requestedPermissions: [...requestedPermissions] } : {}),
    ...(allowedScopes ? { allowedScopes: [...allowedScopes] } : {}),
  } };
}

export function approvalOutcome(decision: 'approve' | 'deny' | null, scope: 'once' | 'session' | null, reason?: string): AgentRequestOutcome {
  if (!decision && reason && ['conversation_closed', 'conversation_removed', 'surface_disconnected'].includes(reason)) return { kind: 'cancelled', reason };
  return decision ? { kind: 'decision', decision: decision === 'deny' ? 'deny' : scope === 'session' ? 'allow_conversation' : 'allow' }
    : { kind: 'completed', ...(reason ? { reason } : {}) };
}

export function requestFromClientRequest(request: ClientRequest, identity: { conversationId: string; turnId?: string }): AgentRequest {
  if (request.kind === 'confirm_tool') return { ...identity, id: request.id, kind: 'toolConfirmation', confirmation: request.payload.confirmation };
  const question = request.payload.request;
  return {
    ...identity, id: request.id, kind: 'question',
    conversationId: request.conversationId ?? identity.conversationId,
    ...(request.turnId ? { turnId: request.turnId } : {}),
    itemId: request.itemId ?? question.itemId,
    question: { ...question, delivery: question.delivery ?? 'tool', blocking: question.blocking ?? true },
  };
}

export function agentResponseFromClientResponse(response: ClientRequestResponse): AgentRequestResponse {
  const payload = response.payload;
  const identity = { id: response.id, ...(response.agentId ? { agentId: response.agentId } : {}) };
  if (payload?.cancelled) return { ...identity, outcome: { kind: 'cancelled' } };
  if (payload?.answers) return { ...identity, outcome: { kind: 'answered', answers: payload.answers } };
  if (payload?.decision) return { ...identity, outcome: { kind: 'decision', decision: payload.decision } };
  throw new Error('An agent request response must contain answers, a decision, or cancellation.');
}

export function clientResponseFromAgentResponse(response: AgentRequestResponse): ClientRequestResponse {
  switch (response.outcome.kind) {
    case 'answered': return { id: response.id, payload: { answers: response.outcome.answers } };
    case 'decision': return { id: response.id, payload: { decision: response.outcome.decision } };
    case 'cancelled': return { id: response.id, payload: { cancelled: true } };
  }
}
