import { describe, expect, it, vi } from 'vitest';
import type { Agent, BackendPublishedEvent, RendererMessage } from '@workspace/core/contracts';
import { turnCompleted } from './support/conversation-activity';
import { requestHandoffNote } from '../agents/handoff-note';

const agent: Agent = { id: 'one', name: 'Worker', provider: 'codex', folder: '/repo', status: { type: 'idle' }, createdAt: '', updatedAt: '' };
const message = (turnId: string, text: string): RendererMessage => ({ id: turnId, agentId: agent.id, turnId, role: 'assistant', status: 'complete', parts: [{ type: 'text', text }], createdAt: '' });
function completion(turnId: string, status: 'completed' | 'interrupted' = 'completed'): BackendPublishedEvent {
  return { ...turnCompleted('one', turnId, { conversationId: 'thread', status }), seq: 1, occurredAt: '' } as BackendPublishedEvent;
}

describe('handoff note capture', () => {
  it('captures only the accepted turn, even if completion arrives before send acceptance', async () => {
    let listener!: (event: BackendPublishedEvent) => void;
    const unsubscribe = vi.fn();
    const note = await requestHandoffNote(agent, 'write a note', {
      subscribe: callback => { listener = callback; return unsubscribe; },
      send: async () => {
        listener(completion('old'));
        listener(completion('accepted'));
        return { providerSession: { kind: 'codex', conversationId: 'thread' }, turnId: 'accepted' };
      },
      read: async () => [message('accepted', 'The handoff.'), message('unrelated', 'Wrong note.')],
    });
    expect(note).toBe('The handoff.');
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('refuses interrupted turns and never substitutes an earlier assistant response', async () => {
    let listener!: (event: BackendPublishedEvent) => void;
    const read = vi.fn(async () => [message('old', 'Do not forward')]);
    await expect(requestHandoffNote(agent, 'write a note', {
      subscribe: callback => { listener = callback; return () => undefined; },
      send: async () => { listener(completion('accepted', 'interrupted')); return { providerSession: { kind: 'codex', conversationId: 'thread' }, turnId: 'accepted' }; },
      read,
    })).rejects.toThrow('stopped before finishing');
    expect(read).not.toHaveBeenCalled();
  });

  it('times out and unsubscribes when the completed note cannot be read', async () => {
    vi.useFakeTimers();
    let listener!: (event: BackendPublishedEvent) => void;
    const unsubscribe = vi.fn();
    try {
      const operation = requestHandoffNote(agent, 'write a note', {
        subscribe: callback => { listener = callback; return unsubscribe; },
        send: async () => { listener(completion('accepted')); return { providerSession: { kind: 'codex', conversationId: 'thread' }, turnId: 'accepted' }; },
        read: () => new Promise(() => undefined), timeoutMs: 100,
      });
      const failed = expect(operation).rejects.toThrow('didn’t finish');
      await vi.advanceTimersByTimeAsync(101);
      await failed;
      expect(unsubscribe).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
