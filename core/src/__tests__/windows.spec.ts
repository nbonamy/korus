import { describe, expect, it } from 'vitest';
import { isEmptyComposerDraft, isWindowSetup, isWindowViewState } from '../windows';

describe('window view state', () => {
  it.each([
    {},
    { agentId: 'agent-1' },
    { scope: 'workspace' },
    { agentId: 'agent-1', scope: 'agent' },
    { teamId: 'team-1', scope: 'team' },
    { teamId: 'team-1', branch: 'feat1', scope: 'feature' },
  ])('accepts %j', (value) => expect(isWindowViewState(value)).toBe(true));

  it.each([
    null, 'agent', [], { agentId: 1 }, { teamId: 3 }, { scope: 'bogus' },
    { scope: 'agent' }, { scope: 'team' }, { scope: 'feature' },
    { teamId: 'team-1', scope: 'feature' }, { branch: 'feat1', scope: 'feature' }, { teamId: 'team-1', branch: '', scope: 'feature' }, { branch: 3 },
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

describe('window setup', () => {
  const pane = { open: true, width: 420, activeTab: 'browser', tabs: ['review', 'browser'] };
  it('accepts the panes of several agents, with the pages of their browsers', () => {
    expect(isWindowSetup({})).toBe(true);
    expect(isWindowSetup({ 'agent-1': pane, 'agent-2': { ...pane, activeTab: null, tabs: [], open: false, browserUrl: 'https://example.com/', browserPanels: { 'browser:one': { browserId: 'one', url: 'https://a.test/', title: 'a.test' } } } })).toBe(true);
    expect(isWindowViewState({ agentId: 'agent-1', setup: { 'agent-1': pane } })).toBe(true);
  });

  it.each([
    ['not an object', 'x'],
    ['an array', []],
    ['a pane that is not an object', { 'agent-1': 'x' }],
    ['a missing field', { 'agent-1': { open: true, width: 420, activeTab: null } }],
    ['a bad width', { 'agent-1': { ...pane, width: Number.NaN } }],
    ['tabs that are not text', { 'agent-1': { ...pane, tabs: [1] } }],
    ['too many tabs', { 'agent-1': { ...pane, tabs: Array.from({ length: 33 }, (_, index) => `t${index}`) } }],
    ['an oversized page', { 'agent-1': { ...pane, browserUrl: 'x'.repeat(5000) } }],
    ['a panel without a url', { 'agent-1': { ...pane, browserPanels: { 'browser:a': { browserId: 'a', title: 't' } } } }],
    ['too many agents', Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`agent-${index}`, pane]))],
  ])('rejects %s', (_name, value) => {
    expect(isWindowSetup(value)).toBe(false);
    expect(isWindowViewState({ setup: value })).toBe(false);
  });
});
