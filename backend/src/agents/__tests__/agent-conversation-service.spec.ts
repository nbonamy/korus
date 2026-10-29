import { describe, expect, it, vi } from 'vitest';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { createEmptySnapshot } from '@workspace/core/snapshot';
import type { Agent } from '@workspace/core/contracts';
import { AgentConversationService } from '../agent-conversation-service';

describe('AgentConversationService', () => {
  it.each([
    ['deleteTurn', backendMethods.driverTurnDelete, ['turn-1'], null],
    ['editTurn', backendMethods.driverTurnEdit, ['turn-1', 'edited'], 'turn-new'],
    ['retryTurn', backendMethods.driverTurnRetry, ['turn-1'], 'turn-new'],
  ] as const)('keeps the Codex transcript provider-owned while applying %s status', async (method, driverMethod, args, activeTurnId) => {
    const { agent, driverRequest, events, persistSnapshot, service, snapshot } = createService();
    driverRequest.mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-updated' },
      activeTurnId,
    });

    await expect((service[method] as (...input: string[]) => Promise<unknown>)(agent.id, ...args)).resolves.toBe(snapshot);

    expect(driverRequest).toHaveBeenCalledWith(agent, driverMethod, {
      agent,
      turnId: 'turn-1',
      ...(method === 'editTurn' ? { content: 'edited' } : {}),
    });
    expect(agent.backendSession).toStrictEqual({ kind: 'codex', threadId: 'thread-updated' });
    expect(events).toStrictEqual([
      {
        agentId: agent.id,
        threadId: 'thread-updated',
        type: 'agent.statusChanged',
        payload: { type: activeTurnId ? 'working' : 'idle' },
      },
    ]);
    expect(persistSnapshot).toHaveBeenCalledOnce();
  });

  it('adopts Claude turn-operation results without adding Codex thread metadata', async () => {
    const { agent, driverRequest, events, service } = createService();
    driverRequest.mockResolvedValue({
      backendSession: { kind: 'claude', sessionId: 'session-updated', transport: 'stdio' },
      activeTurnId: null,
    });

    await service.deleteTurn(agent.id, 'turn-1');

    expect(agent.backendSession).toStrictEqual({
      kind: 'claude', sessionId: 'session-updated', transport: 'stdio',
    });
    expect(events).toStrictEqual([{
      agentId: agent.id,
      type: 'agent.statusChanged',
      payload: { type: 'idle' },
    }]);
  });

  it.each([
    ['deleteTurn', ['turn-1']],
    ['editTurn', ['turn-1', 'edited']],
    ['retryTurn', ['turn-1']],
  ] as const)('does not invoke the provider for missing agents during %s', async (method, args) => {
    const { driverRequest, service } = createService();

    await expect((service[method] as (...input: string[]) => Promise<unknown>)('missing-agent', ...args)).resolves.toBeNull();
    expect(driverRequest).not.toHaveBeenCalled();
  });

  it('accepts only conversations owned by stored automation or subagent state', () => {
    const { agent, service, snapshot } = createService();
    snapshot.subagentTrees[agent.id] = {
      rootConversationId: 'thread-root',
      nodes: {
        'thread-child': {
          conversationId: 'thread-child',
          parentConversationId: 'thread-root',
          createdAt: '2026-09-02T00:00:00.000Z',
          status: 'completed',
          updatedAt: '2026-09-02T00:00:00.000Z',
        },
      },
      operations: {},
      activities: {},
    };
    snapshot.automations = [{
      id: 'automation-1',
      name: 'Automation',
      enabled: true,
      prompt: 'Check tasks', target: { kind: 'newQuickChat' as const, teamId: 'team-1', selection: { backend: 'codex' as const, model: null, reasoningEffort: null, serviceTier: null } },

      schedule: { intervalMinutes: 60 },
      executionLog: [{
        id: 'execution-1',
        automationId: 'automation-1',
        startedAt: '2026-09-02T00:00:00.000Z',
        status: 'completed',

        agentId: agent.id, agentName: 'Dina', conversationRef: { backend: 'claude', folder: '/repo', sessionId: 'session-1' },
      }],
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    }];

    expect(service.isStoredConversationRef({ backend: 'codex', threadId: 'thread-child' }, agent.id)).toBe(true);
    expect(service.isStoredConversationRef({ backend: 'claude', folder: '/repo', sessionId: 'session-1' }, agent.id)).toBe(true);
    expect(service.isStoredConversationRef({ backend: 'claude', folder: '/repo', sessionId: 'session-1', subagentId: 'unknown-child' }, agent.id)).toBe(false);
    expect(service.isStoredConversationRef({ backend: 'codex', threadId: 'thread-unknown' }, agent.id)).toBe(false);
  });

  it('hydrates the session, refreshes workspace metadata, and synchronizes a generated title', async () => {
    const { agent, driverRequest, persistSnapshot, refreshGitStatus, refreshWorkspaceIdentity, service } = createService();
    driverRequest.mockImplementation(async (_agent, method) => (
      method === backendMethods.driverConversationLoad
        ? { kind: 'codex', threadId: 'thread-hydrated' }
        : undefined
    ));

    await service.hydrateAndRefresh(agent.id);
    service.setTitle(agent.id);
    await Promise.resolve();

    expect(agent.backendSession).toStrictEqual({ kind: 'codex', threadId: 'thread-hydrated' });
    expect(persistSnapshot).toHaveBeenCalledOnce();
    expect(refreshWorkspaceIdentity).toHaveBeenCalledWith(agent.id);
    expect(refreshGitStatus).toHaveBeenCalledWith(agent.id);
    expect(agent.conversationTitle).toBe('Dina');
    expect(driverRequest).toHaveBeenCalledWith(
      agent,
      backendMethods.driverConversationTitleUpdate,
      { agent, title: 'Dina' },
    );
  });

  it('reports hydration failures without exposing diagnostics and deduplicates concurrent requests', async () => {
    vi.useFakeTimers();
    try {
      const { agent, driverRequest, events, service } = createService();
      driverRequest.mockRejectedValue(new Error('thread thread-root already has an active writer: sensitive provider detail'));

      const first = service.hydrate(agent.id);
      const second = service.hydrate(agent.id);
      await vi.runAllTimersAsync();

      await expect(Promise.all([first, second])).resolves.toStrictEqual([undefined, undefined]);
      expect(driverRequest).toHaveBeenCalledTimes(2);
      expect(events).toContainEqual({
        agentId: agent.id,
        type: 'conversation.historyLoadFailed',
        conversationId: 'thread-root',
        payload: { error: 'Unable to load conversation history.' },
      });
      expect(JSON.stringify(events)).not.toContain('active writer');
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    'Codex app-server request timed out: thread/resume',
    'thread thread-root already has an active writer',
  ])('retries a transient history hydration failure before reporting it: %s', async (message) => {
    vi.useFakeTimers();
    try {
      const { agent, driverRequest, events, service } = createService();
      driverRequest
        .mockRejectedValueOnce(new Error(message))
        .mockResolvedValueOnce({ kind: 'codex', threadId: 'thread-root' });

      const hydration = service.hydrate(agent.id);
      await vi.runAllTimersAsync();
      await hydration;

      expect(driverRequest).toHaveBeenCalledTimes(2);
      expect(events).not.toContainEqual({
        agentId: agent.id,
        type: 'conversation.historyLoadFailed',
        conversationId: 'thread-root',
        payload: { error: 'Unable to load conversation history.' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a permanent history hydration failure', async () => {
    const { agent, driverRequest, events, service } = createService();
    driverRequest.mockRejectedValue(new Error('session thread-root is archived'));

    await service.hydrate(agent.id);

    expect(driverRequest).toHaveBeenCalledOnce();
    expect(events).toContainEqual({
      agentId: agent.id,
      type: 'conversation.historyLoadFailed',
      conversationId: 'thread-root',
      payload: { error: 'Unable to load conversation history.' },
    });
  });
});

function createService() {
  const snapshot = createEmptySnapshot();
  const agent: Agent = {
    id: 'agent-dina',
    teamId: 'team-1',
    name: 'Dina',
    folder: '/repo',
    backend: 'codex',
    backendSession: { kind: 'codex', threadId: 'thread-root' },
    status: { type: 'idle' },
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  };
  snapshot.agents = [agent];
  snapshot.teams = [{
    id: 'team-1', name: 'Team', color: '#1B4FB2', agentIds: [agent.id],
  }];
  const driverRequest = vi.fn();
  const events: unknown[] = [];
  const persistSnapshot = vi.fn(async () => snapshot);
  const refreshGitStatus = vi.fn(async () => undefined);
  const refreshWorkspaceIdentity = vi.fn(async () => undefined);
  const service = new AgentConversationService({
    applyEvent: (event) => events.push(event),
    driverRequest,
    getSnapshot: () => snapshot,
    persistSnapshot,
    refreshGitStatus,
    refreshWorkspaceIdentity,
  });
  return { agent, driverRequest, events, persistSnapshot, refreshGitStatus, refreshWorkspaceIdentity, service, snapshot };
}
