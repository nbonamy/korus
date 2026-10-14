import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import type { CompanionReset, CompanionTarget, CompanionWorkspace } from '@workspace/core/companion-protocol';
import { CompanionSubscription } from '../subscription';
const target: CompanionTarget = { hostId: 'host', locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: JSON.stringify({ kind: 'codex', threadId: 'thread' }) };
const workspace = (): CompanionWorkspace => ({ teams: [{ id: 'team', name: 'Team', agentIds: ['agent'] }], agents: [{ id: 'agent', teamId: 'team', backend: 'codex', backendSession: { kind: 'codex', threadId: 'thread' } }] }) as CompanionWorkspace;
const frame = (revision: number, reset = false) => ({ type: reset ? 'codex.conversationSnapshotChanged' : 'codex.conversationEventReceived', backend: 'codex', agentId: 'agent', threadId: 'thread', seq: revision, occurredAt: 'now', payload: { revision, ...(reset ? { snapshot: {} } : { event: { type: 'test' } }) } }) as AppBackendEvent;
afterEach(() => vi.useRealTimers());
function fixture() {
  let listener: ((event: AppBackendEvent) => void) | undefined;
  let allowed = true;
  let current = workspace();
  const request = vi.fn(async (method: string): Promise<unknown> => method === 'snapshot.get' ? current : frame(1, true));
  const emit = vi.fn(); const failed = vi.fn(); const unlisten = vi.fn(() => { listener = undefined; });
  const subscription = new CompanionSubscription({ request, authorized: () => allowed, onEvent: (next) => { listener = next; return unlisten; } }, emit, failed);
  return { subscription, emit, failed, unlisten, request, event: (event: AppBackendEvent) => listener?.(event), revoke: () => { allowed = false; }, workspace: (next: CompanionWorkspace) => { current = next; } };
}
describe('companion event subscriptions', () => {
  it('ignores transcript-side metrics and file activity while still refreshing status and approvals', async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      await f.subscription.request('snapshot.get', {});
      for (let index = 0; index < 20; index++) {
        f.event({ type: 'conversation.contextUsageUpdated', agentId: 'agent', backend: 'codex', payload: { contextUsage: {} } } as AppBackendEvent);
        f.event({ type: 'conversation.turnDiffUpdated', agentId: 'agent', turnId: 'turn', payload: { addedLines: 1, removedLines: 0 } } as AppBackendEvent);
        f.event({ type: 'workspace.fileActivityDetected', agentId: 'agent', turnId: 'turn', payload: {} } as AppBackendEvent);
        await vi.advanceTimersByTimeAsync(60);
      }
      expect(f.request).toHaveBeenCalledTimes(1);
      const next = workspace(); next.agents[0]!.status = { type: 'working' };
      f.workspace(next);
      f.event({ type: 'agent.statusChanged', agentId: 'agent', payload: { type: 'working' } } as AppBackendEvent);
      await vi.advanceTimersByTimeAsync(50);
      expect(f.emit).toHaveBeenLastCalledWith({ type: 'workspace', workspace: next });
      f.event({ type: 'agentRequest.created', agentId: 'agent', payload: {} } as AppBackendEvent);
      await vi.advanceTimersByTimeAsync(50);
      expect(f.request).toHaveBeenCalledTimes(3);
    } finally { f.subscription.close(); }
  });
  it('buffers events during the reset and streams only newer selected-agent frames without app-private envelopes', async () => {
    const f = fixture();
    try {
      await f.subscription.request('snapshot.get', {});
      let resolve!: (frame: CompanionReset) => void;
      f.request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
      const loading = f.subscription.request('conversation.subscribe', target);
      f.event(frame(1)); f.event({ ...frame(2), clientState: { secret: true }, snapshot: { secret: true } } as unknown as AppBackendEvent);
      resolve({ ...frame(1, true), snapshot: { private: true }, clientState: { private: true } } as unknown as CompanionReset); await loading;
      expect(f.emit.mock.calls.map(([value]) => value.type === 'conversation' ? value.frame.payload.revision : value.type)).toStrictEqual(['workspace', 1, 2]);
      expect(f.emit.mock.calls[1]![0].frame).not.toHaveProperty('clientState');
      expect(f.emit.mock.calls[1]![0].frame).not.toHaveProperty('snapshot');
      expect(f.emit.mock.calls[2]![0].frame).not.toHaveProperty('clientState');
      expect(f.emit.mock.calls[2]![0].frame).not.toHaveProperty('snapshot');
      f.event({ ...frame(3), agentId: 'other' } as AppBackendEvent);
      await f.subscription.request('conversation.unsubscribe', target);
      f.event(frame(4));
      expect(f.emit).toHaveBeenCalledTimes(3);
    } finally { f.subscription.close(); }
    expect(f.unlisten).toHaveBeenCalledOnce();
  });
  it('pushes changed workspace state without polling and stops a subscription when its session disappears', async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      await f.subscription.request('snapshot.get', {}); await f.subscription.request('conversation.subscribe', target);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(f.request).toHaveBeenCalledTimes(2);
      const update = { type: 'agent.updated', payload: { id: 'agent' } } as AppBackendEvent;
      f.event(update); await vi.advanceTimersByTimeAsync(50);
      expect(f.emit).toHaveBeenCalledTimes(2); // Identical projection isn't sent again.
      f.workspace({ teams: [], agents: [] }); f.event(update); await vi.advanceTimersByTimeAsync(50);
      expect(f.emit).toHaveBeenLastCalledWith({ type: 'workspace', workspace: { teams: [], agents: [] } });
      f.event(frame(2)); expect(f.emit).toHaveBeenCalledTimes(3);
      await expect(f.subscription.request('prompt.submit', {})).rejects.toThrow('Unsupported');
    } finally { f.subscription.close(); }
  });
  it('does not deliver or finish an in-flight reset after revocation', async () => {
    const f = fixture();
    try {
      await f.subscription.request('snapshot.get', {});
      let resolve!: (value: unknown) => void;
      f.request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
      const loading = f.subscription.request('conversation.subscribe', target);
      f.revoke(); f.event(frame(2)); resolve(frame(1, true));
      await expect(loading).rejects.toThrow('changed');
      expect(f.emit).toHaveBeenCalledTimes(1); expect(f.failed).toHaveBeenCalledOnce();
    } finally { f.subscription.close(); }
  });
});
