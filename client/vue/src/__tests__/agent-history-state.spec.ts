import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AppSnapshot, AppApi } from '@workspace/core/contracts';
import { createAgentHistoryState } from '../agent-history-state';
import { stubElectronTestWindow } from '../test/client';
import { deferred } from './app-state-test-harness';

describe('createAgentHistoryState', () => {
  it('preserves an event-before-RPC failure until a later successful retry', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'thread-dina' };
    const first = deferred<AppSnapshot>();
    const second = deferred<AppSnapshot>();
    const loadConversationHistory = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    stubElectronTestWindow({
      app: { loadConversationHistory } satisfies Partial<AppApi>,
    });
    const state = createAgentHistoryState({
      adoptSnapshot: vi.fn(),
      getSnapshot: () => snapshot,
      synchronizeComposerSelection: vi.fn(),
    });

    const initialHydration = state.hydrateActive();
    expect(state.isHydratingActiveAgentHistory.value).toBe(true);

    state.handleMainEvent({
      seq: 1,
      occurredAt: '2026-09-05T00:00:00.000Z',
      agentId: 'agent-dina',
      type: 'conversation.historyLoadFailed',
      payload: { error: 'Unable to load conversation history.' },
    });
    first.resolve(snapshot);
    await initialHydration;

    expect(state.isActiveAgentHistoryFailed.value).toBe(true);
    expect(state.isHydratingActiveAgentHistory.value).toBe(false);

    state.reset('agent-dina');
    expect(state.isActiveAgentHistoryFailed.value).toBe(false);
    expect(state.isHydratingActiveAgentHistory.value).toBe(false);

    state.handleMainEvent({
      seq: 2,
      occurredAt: '2026-09-05T00:00:00.500Z',
      agentId: 'agent-dina',
      type: 'conversation.historyLoadFailed',
      payload: { error: 'Unable to load conversation history.' },
    });

    const retry = state.retryActive();
    void state.retryActive();
    expect(state.isActiveAgentHistoryFailed.value).toBe(false);
    expect(state.isHydratingActiveAgentHistory.value).toBe(true);
    expect(loadConversationHistory).toHaveBeenCalledTimes(2);

    second.resolve(snapshot);
    await retry;

    expect(state.isActiveAgentHistoryFailed.value).toBe(false);
    expect(state.isHydratingActiveAgentHistory.value).toBe(false);
  });
});
