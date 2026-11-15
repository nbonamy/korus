import { describe, expect, it } from 'vitest';
import { agentConversationId, isPlanReview, isPlanReviewDraft, planReviewDelivery, planReviewFeedback, planReviewFeedbackSummary, planReviewFromEvent } from '../plan-review';
import { createInitialSnapshot } from '../snapshot';

describe('plan review identity', () => {
  it('keeps provider identity opaque and derives stable proposal identity', () => {
    const agent = createInitialSnapshot().agents[0]!;
    delete agent.providerSession;
    expect(agentConversationId(agent)).toBeNull();
    const event = { type: 'plan.readyForReview' as const, agentId: agent.id, turnId: 'turn', seq: 1, occurredAt: 'now', payload: { markdown: '# Plan' } };
    const draft = planReviewFromEvent(agent, event);
    expect(draft.conversationId).toBeNull();
    expect(isPlanReview(draft)).toBe(true);
    expect(planReviewDelivery(draft)).toStrictEqual({ kind: 'prompt' });
    expect(planReviewDelivery({ ...draft, requestId: 'native-request' })).toStrictEqual({ kind: 'request', requestId: 'native-request', lifetime: 'process' });
    agent.providerSession = { kind: 'claude', conversationId: 'session', transport: 'stdio' };
    expect(planReviewFromEvent(agent, event).conversationId).toBe('session');
    agent.providerSession = { kind: 'codex', conversationId: 'thread' };
    expect(agentConversationId(agent)).toBe('thread');
    const targeted = planReviewFromEvent(agent, { ...event, conversationId: 'explicit', payload: { markdown: '# Plan', itemId: 'item' } });
    expect(targeted).toMatchObject({ conversationId: 'explicit', itemId: 'item', status: 'pending' });
    expect(planReviewFromEvent(agent, { ...event, conversationId: 'explicit', payload: { markdown: '# Plan', itemId: 'item' } }).id).toBe(targeted.id);
    for (const value of [null, 'plan', {}, { ...targeted, status: 'unknown' }, { ...targeted, conversationId: 1 }, { ...targeted, itemId: 1 }, { ...targeted, markdown: null }, { ...targeted, turnId: 1 }]) expect(isPlanReview(value)).toBe(false);
  });
});


it('validates persisted feedback bounds and rejects ambiguous duplicate identities', () => {
  const comment = { id: 's0', sectionId: 's0', quote: 'Plan', body: 'Add cancellation.' };
  const choice = { id: 's0-g0', quote: 'Platforms', selected: ['macOS'] };
  expect(isPlanReviewDraft({ comments: [comment], choices: [choice] })).toBe(true);
  expect(isPlanReviewDraft({ comments: [], choices: [{ ...choice, selected: [] }] })).toBe(true);
  for (const draft of [null, {}, { comments: [comment, comment], choices: [] }, { comments: [], choices: [choice, choice] }, { comments: [{ ...comment, quote: '' }], choices: [] }, { comments: [], choices: [{ ...choice, selected: [42] }] }, { comments: [], choices: [{ ...choice, confirmed: 'yes' }] }, { comments: Array.from({ length: 101 }, (_, i) => ({ ...comment, id: String(i) })), choices: [] }, { comments: Array.from({ length: 20 }, (_, i) => ({ ...comment, id: String(i), body: 'x'.repeat(4000) })), choices: [] }]) expect(isPlanReviewDraft(draft)).toBe(false);
});

it('accepts the text anchor of a selection comment but keeps it out of the feedback sent to the agent', () => {
  const comment = { id: 'c1', sectionId: 's0', quote: 'selected context', body: 'Retain this.', textStart: 12 };
  expect(isPlanReviewDraft({ comments: [comment], choices: [] })).toBe(true);
  expect(isPlanReviewDraft({ comments: [{ ...comment, textStart: -1 }], choices: [] })).toBe(false);
  const feedback = planReviewFeedback({ id: 'r1', conversationId: null, turnId: 't1', markdown: '# Plan', status: 'pending', draft: { comments: [comment], choices: [] } });
  expect(feedback).toContain('Retain this.');
  expect(feedback).not.toContain('textStart');
});

it('summarizes feedback as a readable numbered list that matches the comment numbers shown beside the text', () => {
  const draft = {
    comments: [
      { id: 'c1', sectionId: 's0', quote: 'let users export reports', body: 'Which formats?', textStart: 4 },
      { id: 'c2', sectionId: 's1', quote: 'Diagram 1: Flow\n\ngraph TD; A-->B', body: 'Add the failure path.' },
    ],
    choices: [
      { id: 'q1', quote: 'Platforms', selected: ['macOS', 'Linux'], confirmed: true },
      { id: 'q2', quote: 'Billing', selected: ['Monthly'] },
    ],
  };
  expect(planReviewFeedbackSummary(draft)).toBe([
    '1. “let users export reports” — Which formats?',
    '2. “Diagram 1: Flow” — Add the failure path.',
    '   ```',
    '   graph TD; A-->B',
    '   ```',
    '',
    'Decisions:',
    '- Platforms: macOS, Linux',
  ].join('\n'));
  expect(planReviewFeedbackSummary(undefined)).toBe('');
});
