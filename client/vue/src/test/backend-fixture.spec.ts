import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { installBackendFixture } from './backend-fixture';
import { useAppState } from '../app-state';
import { createClientApiMock } from './client-api-mock';

describe('complete UI client boundary', () => {
  it('supplies production snapshot state rather than the legacy snapshot fallback', async () => {
    const snapshot = createInitialSnapshot();
    const { api } = installBackendFixture(snapshot);
    expect(api).toHaveProperty('getSnapshotState', expect.any(Function));
    expect(api).toHaveProperty('getDaemonStatus', expect.any(Function));
  });

  it('boots real app state through the connection and sequence contract and ignores already-applied events', async () => {
    const snapshot = createInitialSnapshot();
    const { api, emit, emitSequenced } = installBackendFixture(snapshot, { lastBackendEventSeq: 70, connection: { status: 'reconnecting', detail: 'Test reconnect' } });
    const state = useAppState();
    await state.loadSnapshot();
    expect(api.getSnapshotState).toHaveBeenCalledOnce();
    expect(api.onEvent.mock.invocationCallOrder[0]).toBeLessThan(api.getSnapshotState.mock.invocationCallOrder[0]!);
    expect(state.connectionState.value).toMatchObject({ status: 'reconnecting' });
    const agentId = snapshot.activeAgentId!;
    emitSequenced({ type: 'agent.statusChanged', agentId, seq: 70, occurredAt: '2026-09-17T00:00:00Z', payload: { type: 'error', message: 'stale failure' } });
    expect(state.activeAgent.value?.status.type).not.toBe('error');
    emit({ type: 'agent.statusChanged', agentId, payload: { type: 'working' } });
    expect(state.activeAgent.value?.status.type).toBe('working');
    expect(api.getSnapshotState).toHaveBeenCalledOnce();
    await state.loadDaemonStatus();
    expect(api.getDaemonStatus).toHaveBeenCalled();
    expect(state.daemonStatus.value).toMatchObject({ supported: true, running: false });
  });

  it('isolates instances and disposes all three subscription channels', async () => {
    const first = createClientApiMock();
    const second = createClientApiMock();
    const event = { type: 'agent.statusChanged' as const, agentId: 'agent', seq: 1, occurredAt: '', payload: { type: 'idle' as const } };
    const eventListener = vi.fn();
    const commandListener = vi.fn();
    const updateListener = vi.fn();
    const unsubscribe = first.api.onEvent(eventListener);
    first.api.onAppCommand(commandListener);
    first.api.onUpdateStatusChanged(updateListener);
    second.emit(event);
    expect(eventListener).not.toHaveBeenCalled();
    first.emit(event);
    expect(eventListener).toHaveBeenCalledOnce();
    unsubscribe();
    first.emit(event);
    expect(eventListener).toHaveBeenCalledOnce();
    first.dispose();
    first.emitAppCommand({ type: 'close-active-agent' });
    first.emitUpdateStatus({ state: 'idle' });
    // Disposed channels cannot deliver callbacks even if an old fixture is retained.
    expect(updateListener).not.toHaveBeenCalled();
    expect(commandListener).not.toHaveBeenCalled();
    expect(() => first.api.sendPrompt('agent', 'unscripted')).toThrow("Script the UI client method 'sendPrompt'");
    const copy = await first.api.getSnapshot();
    copy.agents.length = 0;
    expect((await first.api.getSnapshot()).agents.length).toBeGreaterThan(0);
    second.dispose();
  });
});
