import { afterEach, expect, it, vi } from 'vitest';
import type { Agent, AccountRateLimits } from '@workspace/core/contracts';
import { decodeAppBackendEvent } from '@workspace/core/backend-protocol/events';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import { AppBackendServer } from '../server';
import { BackendDriverRpc } from '../driver-rpc';
import { createTestSnapshot } from './server-test-fixtures';
import { persistedStateFromSnapshot, snapshotFromPersistedState } from '../state-persistence';

const servers: AppBackendServer[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); vi.useRealTimers(); });
function host(snapshot = createTestSnapshot()) {
  snapshot.providerConnections ??= createTestSnapshot().providerConnections;
  const send = vi.fn(async (agent: Agent, _prompt: string) => ({ backendSession: agent.backendSession! }));
  const driver = (backend: Agent['backend']) => ({ backend, getRuntimeStatus: () => ({ backend, status: 'running' as const }), getCapabilities: () => codexBackendCapabilities,
    sendPrompt: send, interrupt: vi.fn(), respondToAgentRequest: vi.fn(), onEvent: () => () => {}, close: async () => {} });
  const events: unknown[] = [];
  const saved: ReturnType<typeof persistedStateFromSnapshot>[] = [];
  const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: async value => { saved.push(persistedStateFromSnapshot(value)); },
    driverRpc: new BackendDriverRpc(new Map([['codex', driver('codex')], ['claude', driver('claude')]])), onEvent: event => events.push(event) });
  servers.push(server);
  const limit = (agent: Agent, message: string) => agent.backend === 'codex' ? server.emitEvent({ type: 'codex.conversationEventReceived', agentId: agent.id, backend: 'codex', threadId: agent.backendSession?.kind === 'codex' ? agent.backendSession.threadId : '',
    payload: { revision: 1, event: { seq: 1, origin: 'notification', occurredAt: new Date().toISOString(), type: 'turn.error', conversationId: agent.backendSession?.kind === 'codex' ? agent.backendSession.threadId : '', turnId: 'blocked',
      payload: { error: { message, additionalDetails: null, codexErrorInfo: 'usageLimitExceeded' }, willRetry: false } } } }) : server.emitEvent({ type: 'agent.statusChanged', agentId: agent.id, backend: agent.backend,
    conversationId: agent.backendSession?.kind === 'codex' ? agent.backendSession.threadId : agent.backendSession?.sessionId, payload: { type: 'error', message } });
  const toggle = (agent: Agent, enabled: boolean) => server.handleMessage({ jsonrpc: '2.0', id: 'toggle', method: 'agent/autoResume/set', params: { agentId: agent.id, enabled } });
  return { server, snapshot, send, limit, toggle, events, saved };
}
function agents(): Agent[] {
  return (['codex', 'claude'] as const).map(backend => ({ id: backend, backend, name: backend, folder: '/tmp/project', teamId: 'team-test',
    backendSession: backend === 'codex' ? { kind: backend, threadId: backend } : { kind: backend, sessionId: backend, transport: 'stdio' },
    status: { type: 'idle' }, createdAt: '', updatedAt: '' }));
}
function quota(resumeAt: number, weekly = false): AccountRateLimits {
  return { limitId: null, limitName: null, primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: resumeAt / 1000 },
    secondary: weekly ? { usedPercent: 100, windowDurationMins: 10_080, resetsAt: resumeAt / 1000 } : null,
    credits: null, individualLimit: null, planType: null, rateLimitReachedType: null };
}
it('resumes each provider once at its reset, including a weekly quota', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T06:25:00Z'));
  const snapshot = createTestSnapshot(); snapshot.agents = agents();
  const { server, send, limit, events } = host(snapshot);
  const reset = Date.now() + 300_000, weeklyReset = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const weekly = quota(reset, true); weekly.secondary!.resetsAt = weeklyReset / 1000;
  server.emitEvent({ type: 'account.rateLimitsUpdated', backend: 'codex', payload: { rateLimits: weekly } });
  limit(snapshot.agents[0]!, 'Usage limit reached');
  expect(snapshot.agents[0]!.rateLimitPause).toMatchObject({ resumeAt: weeklyReset });
  limit(snapshot.agents[1]!, "You've hit your session limit · resets 1:30am (America/Chicago)");
  expect(snapshot.agents[1]!.rateLimitPause).toMatchObject({ conversationId: 'claude', resumeAt: reset, enabled: true });
  await vi.advanceTimersByTimeAsync(299_999); expect(send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5_001);
  expect(send.mock.calls.map(([agent, prompt]) => [agent.id, prompt])).toEqual([['claude', 'continue']]);
  await vi.advanceTimersByTimeAsync(weeklyReset - reset);
  expect(send.mock.calls.map(([agent, prompt]) => [agent.id, prompt]).sort()).toEqual([['claude', 'continue'], ['codex', 'continue']]);
  expect(snapshot.agents.every(agent => !agent.rateLimitPause)).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000); expect(send).toHaveBeenCalledTimes(2);
  for (const event of events) expect(() => decodeAppBackendEvent(JSON.parse(JSON.stringify(event)))).not.toThrow();
});
it('persists the off preference, restores pending resets and cancels stale or manually resumed conversations', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T06:25:00Z'));
  const snapshot = createTestSnapshot(); snapshot.agents = agents();
  const first = host(snapshot), reset = Date.now() + 300_000;
  first.limit(snapshot.agents[1]!, "You've hit your session limit · resets 1:30am (America/Chicago)");
  expect(first.saved.at(-1)?.agents[1]?.rateLimitPause).toMatchObject({ resumeAt: reset });
  await first.toggle(snapshot.agents[1]!, false);
  const restored = snapshotFromPersistedState(JSON.parse(JSON.stringify(persistedStateFromSnapshot(snapshot))));
  expect(restored.general.autoResumeAfterLimit).toBe(false);
  expect(restored.agents[1]!.rateLimitPause).toMatchObject({ resumeAt: reset, enabled: false });
  await first.server.close(); servers.splice(servers.indexOf(first.server), 1);
  const next = host(restored);
  await vi.advanceTimersByTimeAsync(360_000); expect(next.send).not.toHaveBeenCalled();
  // A later short reset is armed when re-enabled, but a user prompt owns continuation.
  next.limit(restored.agents[1]!, "You've hit your session limit · resets 1:35am (America/Chicago)");
  await next.toggle(restored.agents[1]!, true);
  await next.server.handleMessage({ jsonrpc: '2.0', id: 'manual', method: 'agent/prompt/send', params: { agentId: 'claude', prompt: 'Do something else' } });
  expect(restored.agents[1]!.rateLimitPause).toBeUndefined();
  restored.agents[0]!.status = { type: 'idle' };
  next.server.emitEvent({ type: 'account.rateLimitsUpdated', backend: 'codex', payload: { rateLimits: quota(Date.now() + 60_000) } });
  next.limit(restored.agents[0]!, 'Usage limit reached');
  restored.agents[0]!.backendSession = { kind: 'codex', threadId: 'different' };
  await vi.advanceTimersByTimeAsync(600_000);
  expect(next.send.mock.calls.map(([, prompt]) => prompt)).toEqual(['Do something else']);
});
