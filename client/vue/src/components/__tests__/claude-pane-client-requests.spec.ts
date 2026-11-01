import { describe, expect, it } from 'vitest';
import type { RendererToolPart } from '@workspace/core/contracts';
import { claudeConversationSnapshot } from '../../test/claude-conversation-fixtures';
import { claudePaneClientRequests } from '../claude-pane-client-requests';

describe('Claude pane client requests', () => {
  it('ignores malformed and ordinary tools and deduplicates pending approval identities without mutating history', () => {
    const permission: RendererToolPart = { type: 'tool', id: 'tool-1', kind: 'mcp', title: 'server.edit', status: 'running',
      metadata: { confirmationRequestId: 'permission', server: 'server', tool: 'edit' },
      statusText: JSON.stringify({ params: { confirmationSummary: 'Edit file?', argumentsPreview: '{}' } }),
    };
    const snapshot = claudeConversationSnapshot([{ id: 'assistant', agentId: 'agent-dina', role: 'assistant', status: 'streaming', createdAt: '', parts: [
      { type: 'text', text: 'Working' },
      { ...permission, id: 'ordinary', metadata: {} },
      { ...permission, id: 'broken-json', metadata: { ...permission.metadata, confirmationRequestId: 'invalid' }, statusText: 'not json' },
      { ...permission, id: 'broken-payload', metadata: { ...permission.metadata, confirmationRequestId: 'missing-preview' }, statusText: '{"params":{}}' },
      { ...permission, id: 'completed', status: 'completed' },
      permission, { ...permission, id: 'replayed-tool' },
    ] }], { sessionId: null, activeTurnId: 'turn-1' });
    const original = structuredClone(snapshot);
    expect(claudePaneClientRequests(snapshot)).toEqual([{
      id: 'permission', kind: 'confirm_tool', conversationId: 'agent-dina', turnId: 'turn-1', itemId: 'tool-1',
      payload: { confirmation: { integrationId: 'server', integrationName: 'server', toolName: 'edit', summary: 'Edit file?', argumentsPreview: '{}', allowConversation: false, allowAlways: false } },
    }]);
    expect(snapshot).toEqual(original);
    snapshot.answeredClientRequestIds = ['permission'];
    expect(claudePaneClientRequests(snapshot)).toEqual([]);
  });
});
