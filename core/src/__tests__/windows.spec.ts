import { describe, expect, it } from 'vitest';
import { isEmptyComposerDraft, isWindowViewState } from '../windows';

describe('window view state', () => {
  it.each([
    {},
    { agentId: 'agent-1' },
    { scope: 'workspace' },
    { agentId: 'agent-1', scope: 'agent' },
  ])('accepts %j', (value) => expect(isWindowViewState(value)).toBe(true));

  it.each([null, 'agent', [], { agentId: 1 }, { scope: 'team' }, { scope: 'agent' }])('rejects %j', (value) => {
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
