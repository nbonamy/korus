import { describe, expect, it } from 'vitest';
import { withInferredWorkPhases, withInferredTurnWorkPhases } from '../conversation-work-phases';

const tool = { type: 'tool', id: 't1', kind: 'shell', title: 'ls', status: 'completed' } as const;
const assistant = (parts: unknown[]) => ({ id: 'a1', role: 'assistant', status: 'complete', turnId: 'turn-1', parts }) as never;
const phases = (message: { parts: Array<{ type: string; phase?: string }> }) =>
  message.parts.map(part => (part.type === 'text' ? part.phase ?? 'none' : part.type));

describe('withInferredWorkPhases', () => {
  it('marks text before the last tool as commentary and trailing text as the final answer', () => {
    const result = withInferredWorkPhases(assistant([
      { type: 'text', text: 'Let me look.' }, tool, { type: 'text', text: 'Now editing.' }, tool, { type: 'text', text: 'All done.' },
    ])) as never;
    expect(phases(result)).toEqual(['commentary', 'tool', 'commentary', 'tool', 'final_answer']);
  });

  it('keeps earlier answers and steering inside Working across assistant message boundaries', () => {
    const messages = [
      { role: 'assistant', parts: [{ type: 'text', text: 'First attempt' }] },
      { role: 'user', kind: 'steer', parts: [{ type: 'text', text: 'Try another approach' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'Final result' }] },
    ];
    const result = withInferredTurnWorkPhases(messages);
    expect(phases(result[0] as never)).toStrictEqual(['commentary']);
    expect(phases(result[2] as never)).toStrictEqual(['final_answer']);
    expect(result[1]).toBe(messages[1]);
  });

  it('handles chat messages whose text parts carry content', () => {
    const result = withInferredWorkPhases({ id: 'a1', role: 'assistant', content: '', turnId: 'turn-1', parts: [tool, { type: 'text', content: 'Done.' }] } as never) as never;
    expect(phases(result)).toEqual(['tool', 'final_answer']);
  });

  it('leaves work without trailing text as work only', () => {
    expect(phases(withInferredWorkPhases(assistant([tool, { type: 'text', text: 'Thinking out loud' }, tool])) as never)).toEqual(['tool', 'commentary', 'tool']);
  });

  it.each([
    ['a message without tools', [{ type: 'text', text: 'Hello' }]],
    ['a message that already has phases', [tool, { type: 'text', text: 'x', phase: 'final_answer' }]],
    ['a message with reasoning parts', [{ type: 'reasoning', summary: 's', itemId: 'i', summaryIndex: 0 }, tool, { type: 'text', text: 'x' }]],
  ])('returns %s untouched', (_name, parts) => {
    const message = assistant(parts);
    expect(withInferredWorkPhases(message)).toBe(message);
  });

  it('ignores user messages and blank trailing text', () => {
    const user = { id: 'u', role: 'user', status: 'complete', parts: [tool, { type: 'text', text: 'x' }] } as never;
    expect(withInferredWorkPhases(user)).toBe(user);
    expect(phases(withInferredWorkPhases(assistant([tool, { type: 'text', text: '  ' }])) as never)).toEqual(['tool', 'commentary']);
  });
});
