import { describe, expect, it } from 'vitest';
import { withConversationId } from '../legacy-conversation-id';

describe('saved conversation ids', () => {
  it('reads sessions and references saved under their former names', () => {
    expect(withConversationId({ kind: 'codex', threadId: 't1' })).toEqual({ kind: 'codex', conversationId: 't1' });
    expect(withConversationId({ kind: 'cursor', sessionId: 's1' })).toEqual({ kind: 'cursor', conversationId: 's1' });
    expect(withConversationId({ kind: 'claude', sessionId: 's2', transport: 'stdio', transcriptSessionId: 'root', transcriptFolder: '/work' }))
      .toEqual({ kind: 'claude', conversationId: 's2', transport: 'stdio', transcriptConversationId: 'root', transcriptFolder: '/work' });
    expect(withConversationId({ provider: 'antigravity', folder: null, sessionId: 's3' })).toEqual({ provider: 'antigravity', folder: null, conversationId: 's3' });
  });

  it('leaves current and unrelated values alone', () => {
    const current = { kind: 'codex', conversationId: 't1' };
    expect(withConversationId(current)).toBe(current);
    expect(withConversationId({ kind: 'codex' })).toEqual({ kind: 'codex' });
    expect(withConversationId(null)).toBeNull();
  });
});
