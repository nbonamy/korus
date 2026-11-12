import { describe, expect, it } from 'vitest';
import { agentResponseFromClientResponse, approvalAgentRequest, approvalOutcome, clientResponseFromAgentResponse, isAgentRequestResponse, requestFromClientRequest } from '../agent-request';
import type { ProviderApprovalRequest, ClientRequest, ClientRequestResponse } from '../contracts';

describe('normalized agent input contracts', () => {
  it.each([
    { answers: { choice: { answers: ['Yes'] } } },
    { decision: 'allow' as const },
    { cancelled: true },
  ])('round-trips an explicit response outcome without forwarding app routing metadata: %j', (payload) => {
    const input: ClientRequestResponse = { id: '0', agentId: 'agent-1', payload };
    const response = agentResponseFromClientResponse(input);
    expect(isAgentRequestResponse(response)).toBe(true);
    expect(response.agentId).toBe('agent-1');
    expect(clientResponseFromAgentResponse(response)).toStrictEqual({ id: '0', payload });
  });

  it.each([null, false, [], {}, { id: ' ' }, { id: '0', outcome: null },
    { id: '0', agentId: 42, outcome: { kind: 'cancelled' } },
    { id: '0', agentId: ' ', outcome: { kind: 'cancelled' } },
    { id: '0', outcome: { kind: 'completed' } },
    { id: '0', outcome: { kind: 'decision', decision: 'approve' } },
    { id: '0', outcome: { kind: 'cancelled', reason: 42 } },
    { id: '0', outcome: { kind: 'answered', answers: [] } },
    { id: '0', outcome: { kind: 'answered', answers: { x: null } } },
    { id: '0', outcome: { kind: 'answered', answers: { x: { answers: [4] } } } },
  ])('rejects malformed or non-response input: %j', (value) => {
    expect(isAgentRequestResponse(value)).toBe(false);
  });

  it('requires an outcome and preserves cancellation and approval scope semantics', () => {
    expect(() => agentResponseFromClientResponse({ id: '0' })).toThrow('must contain');
    expect(() => agentResponseFromClientResponse({ id: '0', payload: {} })).toThrow('must contain');
    expect(approvalOutcome('approve', 'session')).toStrictEqual({ kind: 'decision', decision: 'allow_conversation' });
    expect(approvalOutcome('approve', 'once')).toStrictEqual({ kind: 'decision', decision: 'allow' });
    expect(approvalOutcome('deny', null)).toStrictEqual({ kind: 'decision', decision: 'deny' });
    expect(approvalOutcome(null, null)).toStrictEqual({ kind: 'completed' });
    expect(approvalOutcome(null, null, 'server')).toStrictEqual({ kind: 'completed', reason: 'server' });
    for (const reason of ['conversation_closed', 'conversation_removed', 'surface_disconnected']) expect(approvalOutcome(null, null, reason)).toStrictEqual({ kind: 'cancelled', reason });
  });

  it('projects approvals without sharing mutable permission lists', () => {
    const approval: ProviderApprovalRequest = { id: 'approval', itemId: 'item', kind: 'command', conversationId: 'conversation', title: 'Run tests', allowedScopes: ['once'], requestedPermissions: [{ kind: 'network', enabled: true }] };
    const request = approvalAgentRequest(approval);
    expect(request).toMatchObject({ id: approval.id, conversationId: approval.conversationId, kind: 'approval', approval });
    if (request.kind !== 'approval') throw new Error('Expected approval');
    expect(request.approval.allowedScopes).not.toBe(approval.allowedScopes);
    expect(request.approval.requestedPermissions).not.toBe(approval.requestedPermissions);
    expect(approvalAgentRequest({ id: 'empty', itemId: 'item', kind: 'command', conversationId: 'c', title: 'Approve' })).toMatchObject({ kind: 'approval' });
  });

  it('preserves question targeting and delivery while applying defaults only for legacy tool questions', () => {
    const legacy: ClientRequest = { id: '0', kind: 'ask_user', payload: { request: { itemId: 'item', questions: [] } } };
    expect(requestFromClientRequest(legacy, { conversationId: 'fallback', turnId: 'turn' })).toMatchObject({
      conversationId: 'fallback', turnId: 'turn', itemId: 'item', question: { delivery: 'tool', blocking: true },
    });
    const targeted: ClientRequest = { ...legacy, conversationId: 'actual', turnId: 'actual-turn', itemId: 'actual-item', payload: { request: { itemId: 'actual-item', delivery: 'async', blocking: false, questions: [] } } };
    expect(requestFromClientRequest(targeted, { conversationId: 'fallback' })).toMatchObject({ conversationId: 'actual', turnId: 'actual-turn', itemId: 'actual-item', question: { delivery: 'async', blocking: false } });
    const confirmation = { integrationId: 'test', integrationName: 'Test', toolName: 'command', summary: 'Run tests', argumentsPreview: '{}', allowConversation: true, allowAlways: false };
    expect(requestFromClientRequest({ id: 'tool', kind: 'confirm_tool', payload: { confirmation } }, { conversationId: 'c' })).toStrictEqual({ id: 'tool', kind: 'toolConfirmation', conversationId: 'c', confirmation });
  });
});
