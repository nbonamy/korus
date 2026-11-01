import { describe, expect, it, vi } from 'vitest';
import type { Agent, BackendPublishedEvent, RendererMessage } from '@workspace/core/contracts';
import { requestHandoffNote } from '../agents/handoff-note';

const agent: Agent = { id: 'one', name: 'Worker', backend: 'codex', folder: '/repo', status: { type: 'idle' }, createdAt: '', updatedAt: '' };
const message = (turnId: string, text: string): RendererMessage => ({ id: turnId, agentId: agent.id, turnId, role: 'assistant', status: 'complete', parts: [{ type: 'text', text }], createdAt: '' });
function completion(turnId: string, status: 'completed' | 'interrupted' = 'completed'): BackendPublishedEvent {
  return { agentId: 'one', backend: 'codex', threadId: 'thread', type: 'codex.conversationEventReceived', seq: 1, occurredAt: '', payload: { revision: 1, event: { type: 'turn.completed', conversationId: 'thread', origin: 'notification', turnId, seq: 1, occurredAt: '', payload: { status, error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null } } } };
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
        return { backendSession: { kind: 'codex', threadId: 'thread' }, turnId: 'accepted' };
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
      send: async () => { listener(completion('accepted', 'interrupted')); return { backendSession: { kind: 'codex', threadId: 'thread' }, turnId: 'accepted' }; },
      read,
    })).rejects.toThrow('did not complete');
    expect(read).not.toHaveBeenCalled();
  });

  it('times out and unsubscribes when the completed note cannot be read', async () => {
    vi.useFakeTimers();
    let listener!: (event: BackendPublishedEvent) => void;
    const unsubscribe = vi.fn();
    try {
      const operation = requestHandoffNote(agent, 'write a note', {
        subscribe: callback => { listener = callback; return unsubscribe; },
        send: async () => { listener(completion('accepted')); return { backendSession: { kind: 'codex', threadId: 'thread' }, turnId: 'accepted' }; },
        read: () => new Promise(() => undefined), timeoutMs: 100,
      });
      const failed = expect(operation).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(101);
      await failed;
      expect(unsubscribe).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
