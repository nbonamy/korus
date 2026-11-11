import { describe, expect, it } from 'vitest';
import { projectAntigravityConversation, projectClaudeConversation, projectCodexConversation, projectCursorConversation } from '../../conversation-presentation/presentation';
import { emptyCursorSnapshot, emptyAntigravitySnapshot } from '@korus-dev/multi-agent-sdk/contracts';
import { claudeConversationSnapshot } from './claude-conversation-fixtures';
import { codexConversationSnapshot as codex } from './codex-conversation-fixtures';

describe('native conversation presentation', () => {
  it('handles absent snapshots and projects shared identity, requests and plans without changing native state', () => {
    for (const project of [projectCodexConversation, projectClaudeConversation, projectCursorConversation, projectAntigravityConversation]) expect(project(null)).toBeNull();
    const snapshot = codex([], { approvalPreset: 'ask-for-approval', selectedModelId: 'terra', selectedReasoningEffort: 'high', selectedServiceTier: 'fast', turnIds: ['last'], executionPlan: { turnId: 'last', steps: [{ step: 'Done', status: 'completed' }], explanation: 'Ready', markdown: 'Done', updatedAt: 'today' } });
    const original = structuredClone(snapshot);
    expect(projectCodexConversation(snapshot)).toMatchObject({ latestTurnId: 'last', clientRequests: [], approvals: [], goal: null, permission: 'ask-for-approval', selection: { model: 'terra', reasoningEffort: 'high', serviceTier: 'fast' }, plan: { kind: 'execution', status: 'completed', explanation: 'Ready' } });
    expect(snapshot).toEqual(original);
    expect(projectCodexConversation(codex([], { executionPlan: { ...snapshot.executionPlan!, steps: [] } }))?.plan?.status).toBe('inProgress');
    expect(projectCodexConversation(codex())?.plan).toBeNull();
    expect(projectClaudeConversation(claudeConversationSnapshot([], { turnIds: ['last'] }))?.latestTurnId).toBe('last');
  });
  it('keeps Cursor native reasoning while presenting text and normalizing pending questions', () => {
    const snapshot = emptyCursorSnapshot('a', 'session');
    snapshot.messages = [{ id: 'mixed', agentId: 'a', role: 'assistant', createdAt: '', status: 'complete', parts: [{ type: 'reasoning', itemId: 'r', summary: 'Thought', summaryIndex: 0 }, { type: 'text', text: 'Answer' }] }, { id: 'reasoning', agentId: 'a', role: 'assistant', createdAt: '', status: 'complete', parts: [{ type: 'reasoning', itemId: 'r2', summary: 'Thought', summaryIndex: 0 }] }];
    snapshot.clientRequests = [{ id: 'ask', kind: 'ask_user', payload: { request: { itemId: 'tool', questions: [] } } }];
    const original = structuredClone(snapshot);
    const presentation = projectCursorConversation(snapshot)!;
    expect(presentation.messages).toHaveLength(1);
    expect(presentation.messages[0]!.parts).toEqual([{ type: 'text', text: 'Answer' }]);
    expect(presentation.clientRequests[0]).toMatchObject({ conversationId: 'session', turnId: '', itemId: 'tool', payload: { request: { delivery: 'tool', blocking: true } } });
    expect(snapshot).toEqual(original);
    expect(projectCursorConversation(emptyCursorSnapshot('a', 's'))?.latestTurnId).toBeNull();
  });
  it('maps Antigravity confirmation requests without importing product policy', () => {
    const snapshot = emptyAntigravitySnapshot('a', 's');
    snapshot.activeTurnId = 'turn';
    snapshot.clientRequests = [{ id: 'confirm', kind: 'confirm_tool', payload: { confirmation: { integrationId: 'mcp', integrationName: 'Tools', toolName: 'write', summary: 'Write?', argumentsPreview: '{}', allowConversation: true, allowAlways: false } } }];
    expect(projectAntigravityConversation(snapshot)?.clientRequests[0]).toMatchObject({ id: 'confirm', conversationId: 's', turnId: 'turn', itemId: 'confirm' });
  });
});
