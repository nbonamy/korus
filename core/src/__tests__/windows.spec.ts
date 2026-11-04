import { describe, expect, it } from 'vitest';
import { isEmptyComposerDraft, isWindowViewState } from '../windows';

describe('window view state', () => {
  it.each([
    {},
    { agentId: 'agent-1' },
    { scope: 'workspace' },
    { agentId: 'agent-1', scope: 'agent' },
    { teamId: 'team-1', scope: 'team' },
    { agentIds: ['agent-1', 'agent-2'], scope: 'feature' },
  ])('accepts %j', (value) => expect(isWindowViewState(value)).toBe(true));

  it.each([
    null, 'agent', [], { agentId: 1 }, { teamId: 3 }, { scope: 'bogus' },
    { scope: 'agent' }, { scope: 'team' }, { scope: 'feature' }, { scope: 'feature', agentIds: [] },
    { scope: 'feature', agentIds: [1] }, { scope: 'feature', agentIds: Array.from({ length: 17 }, (_, index) => `agent-${index}`) },
  ])('rejects %j', (value) => {
    expect(isWindowViewState(value)).toBe(false);
  });
});

describe('composer drafts', () => {
  const state = { text: '', selectionStart: 0, selectionEnd: 0 };
  it('are empty without text, content or attachments', () => {
    expect(isEmptyComposerDraft({ state, attachments: [] })).toBe(true);
    expect(isEmptyComposerDraft({ state: { ...state, text: 'hi' }, attachments: [] })).toBe(false);
    expect(isEmptyComposerDraft({ state, attachments: [{ id: 'a', type: 'file', reference: 'r', name: 'n', mimeType: 'text/plain', size: 1 }] })).toBe(false);
  });
});
