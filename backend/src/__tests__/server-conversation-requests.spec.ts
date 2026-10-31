import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import type { AppSnapshot } from '@workspace/core/contracts';
import type { AgentBackendDriver } from '@workspace/core/backend-driver';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import { AppBackendServer } from '../server';
import { BackendDriverRpc } from '../driver-rpc';
import { MISSION_COMMAND_PROMPT } from '../agents/mission-command';
import { PROPOSED_WORK_DELEGATION_PROMPT, WORKTREE_DELEGATION_PROMPT } from '../agents/worktree-delegation';
import {
  createTestSnapshot,
  flushMicrotasks,
} from './server-test-fixtures';

function emitTurnStarted(server: AppBackendServer, agentId: string, turnId: string, backend: 'codex' | 'claude' = 'codex', conversationId = 'thread-dina') {
  server.emitEvent(backend === 'codex' ? {
    agentId, backend, threadId: conversationId, type: 'codex.conversationEventReceived',
    payload: { revision: 1, event: { seq: 1, occurredAt: '', origin: 'notification', conversationId, turnId, type: 'turn.started', payload: { startedAt: '' } } },
  } : {
    agentId, backend, backendSessionId: conversationId, type: 'claude.conversationEventReceived',
    payload: { revision: 1, event: { seq: 1, occurredAt: '', backend, agentId, backendSessionId: conversationId, turnId, type: 'turn.started', payload: { turn: { id: turnId, backend } } } },
  });
}

describe('AppBackendServer', () => {

  it.each([
    { action: 'implement', prompt: 'Implement the proposed work in this conversation using the current agent and workspace.' },
    { action: 'delegate', prompt: PROPOSED_WORK_DELEGATION_PROMPT },
    { action: 'create_mission', prompt: MISSION_COMMAND_PROMPT },
  ] as const)('routes proposal $action to its source and persists only after provider acceptance', async ({ action, prompt }) => {
    const snapshot = createTestSnapshot();
    const source = {
      id: 'proposal-source', teamId: snapshot.teams[0]!.id, name: 'Source', folder: '/workspace/source', backend: 'codex' as const,
      backendSession: { kind: 'codex' as const, threadId: 'source-thread' }, status: { type: 'idle' as const },
      threadFlags: { work_proposed: true as const, ready_for_review: true as const },
      createdAt: '2026-06-13T00:00:00.000Z', updatedAt: '2026-06-13T00:00:00.000Z',
    };
    const other = { ...source, id: 'other-agent', threadFlags: { work_proposed: true as const } };
    snapshot.agents = [other, source];
    snapshot.teams[0]!.agentIds = [other.id, source.id];
    snapshot.activeAgentId = other.id;
    let rejectPrompt!: (error: Error) => void;
    let acceptPrompt!: (result: { backendSession: { kind: 'codex'; threadId: string }; turnId: string }) => void;
    const sendPrompt = vi.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPrompt = reject; }))
      .mockImplementationOnce(() => new Promise(resolve => { acceptPrompt = resolve; }));
    const driver: AgentBackendDriver = {
      backend: 'codex', getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities, sendPrompt,
      interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'source-thread' } }),
      respondToAgentRequest: async () => undefined, onEvent: () => () => undefined, close: async () => undefined,
    };
    const persisted: AppSnapshot[] = [];
    const server = new AppBackendServer({
      version: 'test-version', snapshot, driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
      saveSnapshot: async value => { persisted.push(structuredClone(value)); },
    });
    const respond = (id = 'work_proposed', choice: string = action) => server.handleMessage({
      jsonrpc: '2.0', id: 'respond', method: 'agent/threadFlag/respond',
      params: { agentId: source.id, response: { id, action: choice } },
    });
    try {
      const failed = respond();
      await flushMicrotasks();
      expect(source.threadFlags.work_proposed).toBe(true);
      expect(sendPrompt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: source.id }), prompt, undefined);
      await expect(respond('work_proposed', 'dismiss')).rejects.toThrow('already being handled');
      const rejection = expect(failed).rejects.toThrow('provider unavailable');
      rejectPrompt(new Error('provider unavailable'));
      await rejection;
      expect(source.threadFlags.work_proposed).toBe(true);
      const retry = respond();
      await flushMicrotasks();
      expect(sendPrompt).toHaveBeenCalledTimes(2);
      expect(source.threadFlags.work_proposed).toBe(true);
      emitTurnStarted(server, source.id, 'accepted', 'codex', 'source-thread');
      expect(source.threadFlags).toBeUndefined();
      // A fresh flag published before the admission reply must survive that reply.
      source.threadFlags = { ready_for_review: true } as typeof source.threadFlags;
      acceptPrompt({ backendSession: { kind: 'codex', threadId: 'source-thread' }, turnId: 'accepted' });
      expect(await retry).toMatchObject({ result: { agents: [
        { id: other.id, threadFlags: { work_proposed: true } },
        { id: source.id, threadFlags: { ready_for_review: true } },
      ] } });
      expect(persisted.at(-1)!.agents.find(agent => agent.id === source.id)!.threadFlags).toStrictEqual({ ready_for_review: true });
      await expect(respond()).rejects.toThrow('no longer active');
    } finally { await server.close(); }
  });

  it.each([true, false])('clears all prompt hints when a user turn starts (review readiness: %s) and assigns the conversation title', async (reviewReady) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 15, 42));
    try {
      const snapshot = createTestSnapshot();
      snapshot.teams[0]!.agentIds = ['agent-dina'];
      snapshot.agents = [{
        id: 'agent-dina',
        teamId: 'team-test',
        name: 'Dina',
        folder: '/Users/nbonamy/src/agent-workspace',
        backend: 'codex',
        status: { type: 'idle' },
        threadFlags: { ...(reviewReady ? { ready_for_review: true as const } : {}), work_proposed: true },
        suggestedPrompt: 'Review the diff',
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
      }];
      const sendPrompt = vi.fn().mockImplementation(async () => {
        emitTurnStarted(server, 'agent-dina', 'turn-1');
        return { backendSession: { kind: 'codex' as const, threadId: 'thread-dina' }, turnId: 'turn-1' };
      });
      const setConversationTitle = vi.fn().mockResolvedValue(undefined);
      const driver: AgentBackendDriver = {
        backend: 'codex',
        getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
        getCapabilities: () => codexBackendCapabilities,
        sendPrompt,
        interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
        respondToAgentRequest: async () => undefined,
        setConversationTitle,
        onEvent: () => () => undefined,
        close: async () => undefined,
      };
      const events: unknown[] = [];
      const saveSnapshot = vi.fn().mockResolvedValue(undefined);
      const server = new AppBackendServer({
        version: 'test-version',
        pid: 123,
        snapshot,
        saveSnapshot,
        onEvent: (event) => events.push(event),
        driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
      });

      const response = await server.handleMessage({
        jsonrpc: '2.0',
        id: 'send',
        method: 'agent/prompt/send',
        params: { agentId: 'agent-dina', prompt: ' revert everything ' },
      });
      expect(response).toMatchObject({
        result: {
          agents: [{ id: 'agent-dina', status: { type: 'working' } }],
        },
      });
      expect((response as { result: AppSnapshot }).result.agents[0]?.threadFlags).toBeUndefined();
      expect((response as { result: Record<string, unknown> }).result).not.toHaveProperty('messages');
      await flushMicrotasks();

      expect(sendPrompt).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), 'revert everything', undefined);
      expect(snapshot.agents[0]?.backendSession).toStrictEqual({ kind: 'codex', threadId: 'thread-dina' });
      expect(snapshot.agents[0]?.conversationTitle).toBe('Dina');
      expect(snapshot.agents[0]?.suggestedPrompt).toBeUndefined();
      expect(snapshot.agents[0]?.status).toStrictEqual({ type: 'working' });
      expect(setConversationTitle).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'agent-dina', backendSession: { kind: 'codex', threadId: 'thread-dina' } }),
        'Dina',
      );
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'agent.statusChanged', payload: { type: 'working' } }),
        expect.objectContaining({ type: 'agent.updated', payload: expect.objectContaining({ id: 'agent-dina', threadFlags: null }) }),
        expect.objectContaining({ type: 'backend.statusChanged', payload: expect.objectContaining({ backend: 'codex', status: 'starting' }) }),
      ]));
      await server.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('updates review readiness and binds delegation controls only after a successful steer', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina', teamId: 'team-test', name: 'Dina', folder: '/workspace/dina', backend: 'codex',
      backendSession: { kind: 'codex', threadId: 'thread-dina' }, status: { type: 'working' },
      threadFlags: { ready_for_review: true },
      suggestedPrompt: 'Review the diff',
      userDelegationOverrides: { startingContext: 'conversation', instructions: 'Existing user directions', execution: { backend: 'codex', conversationId: 'thread-dina', turnId: 'turn-original' } },
      createdAt: '2026-06-13T00:00:00.000Z', updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const steerPrompt = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ backendSession: { kind: 'codex', threadId: 'thread-dina' }, turnId: 'turn-steered' });
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      sendPrompt: vi.fn(),
      steerPrompt,
      interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-dina' } }),
      respondToAgentRequest: async () => undefined,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const events: Array<{ type: string; payload: unknown }> = [];
    const server = new AppBackendServer({
      version: 'test-version', pid: 123, snapshot,
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
      onEvent: event => events.push(event),
    });
    const request = (id: string) => ({
      jsonrpc: '2.0' as const, id, method: 'agent/prompt/steer',
      params: { agentId: 'agent-dina', prompt: 'revert everything', options: { delegation: { startingContext: 'handoff', instructions: 'New user directions' } } },
    });

    await expect(server.handleMessage(request('failed'))).rejects.toThrow('offline');
    expect(snapshot.agents[0]?.threadFlags).toStrictEqual({ ready_for_review: true });
    expect(snapshot.agents[0]?.suggestedPrompt).toBe('Review the diff');
    expect(snapshot.agents[0]?.userDelegationOverrides?.instructions).toBe('Existing user directions');
    expect(events.some(event => event.type === 'agent.updated')).toBe(false);

    const response = await server.handleMessage(request('accepted'));
    expect((response as { result: AppSnapshot }).result.agents[0]?.threadFlags).toBeUndefined();
    expect((response as { result: AppSnapshot }).result.agents[0]?.suggestedPrompt).toBeUndefined();
    expect(snapshot.agents[0]?.userDelegationOverrides).toStrictEqual({ startingContext: 'handoff', instructions: 'New user directions', execution: { backend: 'codex', conversationId: 'thread-dina', turnId: 'turn-steered' } });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'agent.updated', payload: expect.objectContaining({ id: 'agent-dina', threadFlags: null }),
    }));
    await server.close();
  });

  it.each(['codex', 'claude'] as const)('clears hints on an internal %s turn, persists them, and ignores duplicate starts', async backend => {
    const snapshot = createTestSnapshot();
    const agent = { id: 'agent-dina', teamId: 'team-test', name: 'Dina', folder: '/workspace/dina', backend,
      backendSession: backend === 'codex' ? { kind: 'codex' as const, threadId: 'thread-dina' } : { kind: 'claude' as const, sessionId: 'thread-dina', transport: 'stdio' as const },
      status: { type: 'idle' as const }, threadFlags: { work_proposed: true as const, ready_for_review: true as const }, suggestedPrompt: 'Old suggestion', createdAt: '', updatedAt: '' };
    snapshot.agents = [agent];
    let stored: AppSnapshot | undefined;
    const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: async value => { stored = structuredClone(value); } });
    try {
      emitTurnStarted(server, agent.id, 'next', backend, 'old-conversation');
      expect(agent.suggestedPrompt).toBe('Old suggestion');
      emitTurnStarted(server, agent.id, 'next', backend);
      expect(agent.threadFlags).toBeUndefined();
      expect(agent.suggestedPrompt).toBeUndefined();
      expect(stored!.agents[0]!.threadFlags).toBeUndefined();
      agent.threadFlags = { work_proposed: true } as typeof agent.threadFlags;
      agent.suggestedPrompt = 'New suggestion';
      emitTurnStarted(server, agent.id, 'next', backend);
      expect(agent.suggestedPrompt).toBe('New suggestion');
      expect(agent.threadFlags).toStrictEqual({ work_proposed: true });
      emitTurnStarted(server, agent.id, 'following', backend);
      expect(agent.threadFlags).toBeUndefined();
      expect(agent.suggestedPrompt).toBeUndefined();
    } finally { await server.close(); }
  });

  it(`renames the active conversation when the ${product.name} agent name changes`, async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      workspace: {
        kind: 'git',
        folder: '/Users/nbonamy/src/agent-workspace-work-routing',
        repositoryName: 'agent-workspace',
        repositoryRoot: '/Users/nbonamy/src/agent-workspace-work-routing',
        branch: 'agent-workspace-work-routing',
        isLinkedWorktree: true,
        primaryWorktreeRoot: '/Users/nbonamy/src/agent-workspace',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
      backend: 'codex',
      backendSession: { kind: 'codex', threadId: 'thread-dina' },
      status: { type: 'working' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const titleSyncResolves: Array<() => void> = [];
    const setConversationTitle = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      titleSyncResolves.push(resolve);
    }));
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      sendPrompt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-dina' } }),
      interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-dina' } }),
      respondToAgentRequest: async () => undefined,
      setConversationTitle,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
    });

    const renameResponse = server.handleMessage({
      jsonrpc: '2.0',
      id: 'rename-agent',
      method: 'agent/update',
      params: {
        input: {
          id: 'agent-dina',
          name: 'Dina Renamed',
        },
      },
    });
    await flushMicrotasks();
    expect(saveSnapshot).toHaveBeenCalledOnce();
    await expect(renameResponse).resolves.toMatchObject({
      result: {
        agents: [{ id: 'agent-dina', name: 'Dina Renamed', conversationTitle: 'Dina Renamed' }],
      },
    });

    const clearResponse = server.handleMessage({
      jsonrpc: '2.0',
      id: 'clear-agent-name',
      method: 'agent/update',
      params: { input: { id: 'agent-dina', name: null } },
    });
    await flushMicrotasks();
    expect(saveSnapshot).toHaveBeenCalledTimes(2);
    await expect(clearResponse).resolves.toMatchObject({
      result: {
        agents: [{ id: 'agent-dina', name: null, conversationTitle: 'work-routing' }],
      },
    });

    expect(setConversationTitle).toHaveBeenCalledTimes(2);
    expect(setConversationTitle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'agent-dina' }),
      'Dina Renamed',
    );
    expect(setConversationTitle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'agent-dina', name: null }),
      'work-routing',
    );
    expect(saveSnapshot).toHaveBeenCalledWith(snapshot);
    for (const resolveTitleSync of titleSyncResolves) resolveTitleSync();
    await flushMicrotasks();
    await server.close();
  });

  it('keeps slash command prompts hidden while starting the backend turn', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      backend: 'codex',
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const commandResult = Promise.resolve({
      backendSession: { kind: 'codex' as const, threadId: 'thread-command' },
      turnId: 'turn-command',
    });
    const tryHandlePromptCommand = vi.fn().mockReturnValue(commandResult);
    const sendPrompt = vi.fn();
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      sendPrompt,
      tryHandlePromptCommand,
      interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 'send',
      method: 'agent/prompt/send',
      params: { agentId: 'agent-dina', prompt: '/compact' },
    });
    await flushMicrotasks();

    expect(tryHandlePromptCommand).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), '/compact');
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(snapshot.agents[0]?.backendSession).toStrictEqual({ kind: 'codex', threadId: 'thread-command' });
    await server.close();
  });

  it.each([
    { prompt: 'run next', delivered: 'run next', clientId: 'desktop' },
    { prompt: '/worktree', delivered: WORKTREE_DELEGATION_PROMPT, clientId: 'mobile-test' },
  ])('owns queued prompt draining and dequeues $prompt only after backend acceptance', async ({ prompt, delivered, clientId }) => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina', teamId: 'team-test', name: 'Dina', folder: '/workspace/dina', backend: 'codex',
      backendSession: { kind: 'codex', threadId: 'thread-dina' }, status: { type: 'working' },
      threadFlags: { ready_for_review: true, work_proposed: true },
      suggestedPrompt: 'Previous turn suggestion',
      createdAt: '2026-06-13T00:00:00.000Z', updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    let acceptPrompt!: (value: { backendSession: { kind: 'codex'; threadId: string }; turnId: string }) => void;
    const sendPrompt = vi.fn().mockReturnValue(new Promise((resolve) => { acceptPrompt = resolve; }));
    const onPromptStarting = vi.fn();
    const onPromptSource = vi.fn();
    const delegation = prompt === 'run next' ? { delegation: { startingContext: 'handoff' as const, instructions: 'Queued user directions' } } : {};
    const events: Array<{ type: string; snapshot?: AppSnapshot; payload: unknown }> = [];
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      sendPrompt,
      interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-dina' } }),
      respondToAgentRequest: async () => undefined,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const server = new AppBackendServer({
      version: 'test-version', pid: 123, snapshot,
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
      onEvent: (event) => events.push(event),
      onPromptStarting,
      onPromptSource,
    });

    await server.handleMessage({
      jsonrpc: '2.0', id: 'queue', method: 'agent/prompt/send',
      params: {
        _clientId: clientId,
        agentId: 'agent-dina',
        prompt,
        options: { attachments: [{ type: 'file', path: '/tmp/queue.txt', name: 'queue.txt' }], inputMethod: 'dictated', ...delegation, selection: { model: 'sol', reasoningEffort: 'high', serviceTier: 'fast' } },
      },
    });
    expect(onPromptSource).not.toHaveBeenCalled();
    expect(snapshot.queuedPrompts).toEqual([expect.objectContaining({
      agentId: 'agent-dina',
      text: prompt,
      options: { attachments: [{ type: 'file', path: '/tmp/queue.txt', name: 'queue.txt' }], inputMethod: 'dictated', ...delegation, selection: { model: 'sol', reasoningEffort: 'high', serviceTier: 'fast' } },
    })]);
    expect(snapshot.agents[0]?.threadFlags).toStrictEqual({ ready_for_review: true, work_proposed: true });
    expect(snapshot.agents[0]?.suggestedPrompt).toBe('Previous turn suggestion');
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(onPromptStarting).not.toHaveBeenCalled();
    expect(snapshot.agents[0]?.userDelegationOverrides).toBeUndefined();

    // The provider conversation may already be idle before its completion event reaches App.
    snapshot.agents[0]!.status = { type: 'idle' };
    server.emitEvent({
      agentId: 'agent-dina', backend: 'codex', threadId: 'thread-dina',
      type: 'codex.conversationEventReceived',
      payload: {
        revision: 2,
        event: {
          seq: 2,
          occurredAt: '2026-06-13T00:00:01.000Z',
          origin: 'notification',
          conversationId: 'thread-dina',
          turnId: 'turn-old',
          type: 'turn.completed',
          payload: {
            status: 'completed', error: null, willRetry: false,
            startedAt: null, completedAt: '2026-06-13T00:00:01.000Z', durationMs: null,
          },
        },
      },
    });
    server.emitEvent({
      agentId: 'agent-dina',
      type: 'agent.statusChanged',
      payload: { type: 'idle' },
    });
    await flushMicrotasks();
    expect(onPromptSource).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), clientId);
    expect(sendPrompt).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), delivered, {
      selection: { model: 'sol', reasoningEffort: 'high', serviceTier: 'fast' },
      attachments: [{ type: 'file', path: '/tmp/queue.txt', name: 'queue.txt' }],
      inputMethod: 'dictated',
      ...delegation,
    });
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(onPromptStarting).toHaveBeenCalledWith('agent-dina', {
      selection: { model: 'sol', reasoningEffort: 'high', serviceTier: 'fast' },
      attachments: [{ type: 'file', path: '/tmp/queue.txt', name: 'queue.txt' }],
      inputMethod: 'dictated',
      ...delegation,
    });
    expect(snapshot.queuedPrompts).toHaveLength(1);

    expect(snapshot.agents[0]?.suggestedPrompt).toBe('Previous turn suggestion');
    emitTurnStarted(server, 'agent-dina', 'turn-next');
    expect(snapshot.agents[0]?.threadFlags).toBeUndefined();
    expect(snapshot.agents[0]?.suggestedPrompt).toBeUndefined();
    acceptPrompt({ backendSession: { kind: 'codex', threadId: 'thread-dina' }, turnId: 'turn-next' });
    await vi.waitFor(() => expect(snapshot.queuedPrompts).toStrictEqual([]));
    if (delegation.delegation) expect(snapshot.agents[0]?.userDelegationOverrides).toStrictEqual({ ...delegation.delegation, execution: { backend: 'codex', conversationId: 'thread-dina', turnId: 'turn-next' } });
    await server.close();
  });

  it('updates queued prompt text in place and steers edited text atomically', async () => {
    const content = [{ type: 'mention', kind: 'skill', id: '/skills/review/SKILL.md', value: 'review', label: 'edited second' }];
    const steeredContent = [{ ...content[0]!, label: 'edited steer' }];
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina', teamId: 'team-test', name: 'Dina', folder: '/workspace/dina', backend: 'codex',
      backendSession: { kind: 'codex', threadId: 'thread-dina' }, status: { type: 'working' },
      createdAt: '2026-06-13T00:00:00.000Z', updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    snapshot.queuedPrompts = [
      { id: 'queued-1', agentId: 'agent-dina', text: 'first', createdAt: '2026-06-13T00:00:01.000Z' },
      {
        id: 'queued-2',
        agentId: 'agent-dina',
        text: 'second',
        createdAt: '2026-06-13T00:00:02.000Z',
        options: { attachments: [{ type: 'file', path: '/tmp/queue.txt', name: 'queue.txt' }] },
      },
    ];
    const steerPrompt = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex' as const, threadId: 'thread-dina' },
      turnId: 'turn-steered',
    });
    const events: Array<{ type: string; payload: unknown }> = [];
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      sendPrompt: vi.fn(),
      steerPrompt,
      interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-dina' } }),
      respondToAgentRequest: async () => undefined,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const server = new AppBackendServer({
      version: 'test-version', pid: 123, snapshot,
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
      onEvent: (event) => events.push(event),
    });

    await server.handleMessage({
      jsonrpc: '2.0', id: 'update', method: 'agent/queuedPrompt/update',
      params: { agentId: 'agent-dina', promptId: 'queued-2', prompt: 'edited second', options: { content } },
    });

    expect(snapshot.queuedPrompts).toStrictEqual([
      expect.objectContaining({ id: 'queued-1', text: 'first' }),
      expect.objectContaining({
        id: 'queued-2',
        text: 'edited second',
        options: { content, attachments: [{ type: 'file', path: '/tmp/queue.txt', name: 'queue.txt' }] },
      }),
    ]);

    const steer = () => server.handleMessage({
      jsonrpc: '2.0', id: 'steer', method: 'agent/queuedPrompt/steer',
      params: { agentId: 'agent-dina', promptId: 'queued-2', prompt: 'edited steer', options: { content: steeredContent } },
    });
    steerPrompt.mockRejectedValueOnce(new Error('Transport failed'));
    await expect(steer()).rejects.toThrow('Transport failed');
    expect(snapshot.queuedPrompts?.[1]?.options?.content).toStrictEqual(content);
    await steer();

    expect(steerPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-dina' }),
      'edited steer',
      { content: steeredContent, attachments: [{ type: 'file', path: '/tmp/queue.txt', name: 'queue.txt' }] },
    );
    expect(snapshot.queuedPrompts).toEqual([
      expect.objectContaining({ id: 'queued-1', text: 'first' }),
    ]);
    await server.close();
  });

  it('retries failed queue drains without losing the item', async () => {
    vi.useFakeTimers();
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina', teamId: 'team-test', name: 'Dina', folder: '/workspace/dina', backend: 'codex',
      backendSession: { kind: 'codex', threadId: 'thread-dina' }, status: { type: 'working' },
      createdAt: '2026-06-13T00:00:00.000Z', updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const sendPrompt = vi.fn()
      .mockRejectedValueOnce(new Error('transport disconnected'))
      .mockResolvedValueOnce({ backendSession: { kind: 'codex', threadId: 'thread-dina' }, turnId: 'turn-retry' });
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      sendPrompt,
      interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-dina' } }),
      respondToAgentRequest: async () => undefined,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const server = new AppBackendServer({
      version: 'test-version', pid: 123, snapshot,
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
    });

    await server.handleMessage({
      jsonrpc: '2.0', id: 'queue', method: 'agent/prompt/send',
      params: { agentId: 'agent-dina', prompt: 'retry safely' },
    });
    server.emitEvent({
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-dina',
      type: 'agent.statusChanged',
      payload: { type: 'idle' },
    });
    await vi.waitFor(() => {
      expect(snapshot.queuedPrompts).toHaveLength(1);
      expect(snapshot.queuedPrompts?.[0]).toMatchObject({
        text: 'retry safely',
        attempts: 1,
        lastError: 'transport disconnected',
      });
    });
    expect(snapshot.agents[0]?.status).toStrictEqual({ type: 'error', message: 'transport disconnected' });
    await vi.runOnlyPendingTimersAsync();
    await flushMicrotasks();
    expect(sendPrompt).toHaveBeenCalledTimes(2);
    expect(snapshot.queuedPrompts).toStrictEqual([]);
    await server.close();
    vi.useRealTimers();
  });

  it('routes turn retry and edit through the backend driver', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      backend: 'codex',
      backendSession: { kind: 'codex', threadId: 'thread-old' },
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const retryTurn = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex' as const, threadId: 'thread-dina' },
      activeTurnId: 'turn-new',
    });
    const continueInterruptedTurn = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex' as const, threadId: 'thread-dina' },
      activeTurnId: 'turn-continued',
    });
    const editTurn = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex' as const, threadId: 'thread-dina' },
      activeTurnId: 'turn-edited',
    });
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      sendPrompt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
      interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      editTurn,
      retryTurn,
      continueInterruptedTurn,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 'retry',
      method: 'agent/turn/retry',
      params: { agentId: 'agent-dina', turnId: 'turn-1' },
    });

    expect(retryTurn).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), 'turn-1');

    snapshot.agents[0]!.status = { type: 'idle' };
    const continued = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'continue-interrupted',
      method: 'agent/turn/continueInterrupted',
      params: { agentId: 'agent-dina' },
    });
    expect(continueInterruptedTurn).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }));
    expect(continued).toMatchObject({ result: { agents: [{ status: { type: 'working' } }] } });

    snapshot.agents[0]!.status = { type: 'idle' };
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 'edit',
      method: 'agent/turn/edit',
      params: { agentId: 'agent-dina', turnId: 'turn-1', content: ' edited prompt ', options: { content: [{ type: 'mention', kind: 'file', id: 'docs/edit.md', value: 'docs/edit.md', label: 'edited prompt' }] } },
    });

    expect(editTurn).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), 'turn-1', 'edited prompt', { content: [{ type: 'mention', kind: 'file', id: 'docs/edit.md', value: 'docs/edit.md', label: 'edited prompt' }] });
    await server.close();
  });
});
