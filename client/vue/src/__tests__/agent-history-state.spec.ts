import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AppSnapshot, AppApi } from '@workspace/core/contracts';
import { createAgentHistoryState } from '../agent-history-state';
import { stubElectronTestWindow } from '../../tests/support/client';
import { deferred } from '../../tests/support/app-state-test-harness';

describe('createAgentHistoryState', () => {
  it('does not infer an empty transcript from a successful request before its provider frame arrives', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.backendSession = { kind: 'codex', threadId: 'delayed-frame' };
    let hasFrame = false;
    stubElectronTestWindow({ app: { loadConversationHistory: vi.fn().mockResolvedValue(snapshot) } satisfies Partial<AppApi> });
    const state = createAgentHistoryState({ adoptSnapshot: vi.fn(), getSnapshot: () => snapshot,
      synchronizeComposerSelection: vi.fn(), hasHistory: () => hasFrame });
    await state.hydrate(agent.id);
    expect(state.statusFor(agent.id).hydrating).toBe(true);
    hasFrame = true;
    expect(state.statusFor(agent.id).hydrating).toBe(false);
  });
  it('shows pending history in a late renderer and reports a lost-event failure through the request', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.backendSession = { kind: 'codex', threadId: 'thread-restored' };
    let loadedThread: string | undefined;
    const loadConversationHistory = vi.fn().mockRejectedValueOnce(new Error('Unable to load conversation history.')).mockImplementation(async () => {
      if (agent.backendSession?.kind === 'codex') loadedThread = agent.backendSession.threadId;
      return snapshot;
    });
    stubElectronTestWindow({ app: { loadConversationHistory } satisfies Partial<AppApi> });
    const state = createAgentHistoryState({ adoptSnapshot: vi.fn(), getSnapshot: () => snapshot, synchronizeComposerSelection: vi.fn(),
      hasHistory: () => agent.backendSession?.kind === 'codex' && agent.backendSession.threadId === loadedThread });
    expect(state.statusFor(agent.id).hydrating).toBe(true);
    await expect(state.hydrate(agent.id)).rejects.toThrow('Unable to load');
    expect(state.statusFor(agent.id)).toMatchObject({ failed: true, hydrating: false });
    await state.hydrate(agent.id);
    expect(state.statusFor(agent.id)).toMatchObject({ failed: false, hydrating: false });
    agent.backendSession = { kind: 'codex', threadId: 'another-thread' };
    expect(state.statusFor(agent.id).hydrating).toBe(true);
  });
  it('preserves an event-before-RPC failure until a later successful retry', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'thread-dina' };
    const first = deferred<AppSnapshot>();
    const second = deferred<AppSnapshot>();
    let hasFrame = false;
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
      hasHistory: () => hasFrame,
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
    expect(state.isHydratingActiveAgentHistory.value).toBe(true);

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

    hasFrame = true;
    second.resolve(snapshot);
    await retry;

    expect(state.isActiveAgentHistoryFailed.value).toBe(false);
    expect(state.isHydratingActiveAgentHistory.value).toBe(false);
  });
});
