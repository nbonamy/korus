import { approvalAgentRequest } from '@workspace/core/agent-request';
import { diffUpdated, fileActivity, toolUpdated, turnCompleted, turnOutput } from './support/conversation-activity';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentProviderDriver, BackendEvent } from '@workspace/core/provider-driver';
import { codexProviderCapabilities } from '@workspace/core/provider-capabilities';
import { AppBackendServer } from '../server';
import { ProviderDriverRpc } from '../driver-rpc';
import type { AgentGitService } from '../git/agent-git-service';
import { scriptedDriver } from './support/scripted-driver';
import {
  createTestSnapshot,
} from './server-test-fixtures';

describe('AppBackendServer', () => {
  afterEach(() => vi.useRealTimers());

  it('preserves released-client cancellation reasons when SDK host names change', async () => {
    const events: unknown[] = [];
    const server = new AppBackendServer({ version: 'test', snapshot: createTestSnapshot(), onEvent: event => events.push(event) });
    try {
      server.emitEvent({ agentId: 'agent-dina', provider: 'codex', type: 'agentRequest.resolved',
        payload: { id: 'approval', outcome: { kind: 'cancelled', reason: 'host_disconnected' } } });
      const wire = JSON.parse(JSON.stringify(events));
      expect(wire).toContainEqual(expect.objectContaining({ type: 'agentRequest.resolved',
        payload: { id: 'approval', outcome: { kind: 'cancelled', reason: 'surface_disconnected' } } }));
    } finally { await server.close(); }
  });

  it('coalesces active workspace changes during a turn and refreshes again at completion', async () => {
    vi.useFakeTimers();
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina', 'agent-jesse'];
    snapshot.activeAgentId = 'agent-dina';
    snapshot.agents = [
      {
        id: 'agent-dina',
        teamId: 'team-test',
        name: 'Dina',
        folder: '/Users/nbonamy/src/agent-workspace',
        workspace: {
          kind: 'git', folder: '/Users/nbonamy/src/agent-workspace', repositoryName: 'agent-workspace',
          repositoryRoot: '/Users/nbonamy/src/agent-workspace', branch: 'main', isLinkedWorktree: false,
          primaryWorktreeRoot: '/Users/nbonamy/src/agent-workspace', updatedAt: '',
        },
        provider: 'codex',
        status: { type: 'working' },
        providerSession: { kind: 'codex', threadId: 'thread-dina' },
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
      {
        id: 'agent-jesse',
        teamId: 'team-test',
        name: 'Jesse',
        folder: '/Users/nbonamy/src/multi-llm-ts',
        provider: 'codex',
        status: { type: 'working' },
        providerSession: { kind: 'codex', threadId: 'thread-jesse' },
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
    ];
    let emitEvent: (event: BackendEvent) => void = () => undefined;
    const getGitStatus = vi.fn().mockResolvedValue({
      folder: '/Users/nbonamy/src/agent-workspace',
      branch: 'main',
      ahead: 0,
      behind: 0,
      changedFiles: 1,
      addedLines: 3,
      removedLines: 1,
      hasUntracked: false,
      state: 'dirty',
      updatedAt: '2026-06-13T00:00:01.000Z',
    });
    const driver: AgentProviderDriver = {
      provider: 'codex',
      getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }),
      getCapabilities: () => codexProviderCapabilities,
      sendPrompt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-test' } }),
      interrupt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      onEvent: (listener) => {
        emitEvent = listener;
        return () => undefined;
      },
      close: async () => undefined,
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])),
      agentGitService: { status: getGitStatus } as unknown as AgentGitService,
    });

    emitEvent({
      provider: 'codex',
      agentId: 'agent-dina',
      conversationId: 'thread-dina',
      turnId: 'turn-test',
      type: 'workspace.fileActivityDetected',
      payload: {
        messageId: 'assistant-turn-test',
        itemId: 'edit-file',
        path: '/Users/nbonamy/src/agent-workspace/README.md',
        action: 'edit',
        status: 'completed',
      },
    });
    emitEvent({
      provider: 'codex',
      agentId: 'agent-dina',
      conversationId: 'thread-dina',
      turnId: 'turn-test',
      type: 'conversation.turnDiffUpdated',
      payload: { addedLines: 3, removedLines: 1, diff: 'diff --git a/README.md b/README.md\n' },
    });
    emitEvent(turnCompleted('agent-jesse', 'turn-jesse', { conversationId: 'thread-jesse' }));
    await Promise.resolve();
    expect(getGitStatus).toHaveBeenCalledWith('/Users/nbonamy/src/multi-llm-ts');
    await vi.advanceTimersByTimeAsync(500);
    expect(getGitStatus).toHaveBeenCalledTimes(2);
    expect(snapshot.agentGitStatuses['agent-dina']).toMatchObject({ addedLines: 3, removedLines: 1 });
    getGitStatus.mockClear();

    for (const action of ['edit', 'create']) {
      emitEvent(fileActivity('agent-dina', { path: '/repo/file', action, status: 'completed' }, { turnId: 'turn-test', conversationId: 'thread-dina' }));
      await vi.advanceTimersByTimeAsync(500);
      expect(getGitStatus).toHaveBeenCalledOnce();
      getGitStatus.mockClear();
    }
    emitEvent(diffUpdated('agent-dina', { turnId: 'turn-test', conversationId: 'thread-dina' }));
    await vi.advanceTimersByTimeAsync(500);
    expect(getGitStatus).toHaveBeenCalledOnce();
    getGitStatus.mockClear();

    for (const kind of ['command', 'fileChange']) {
      emitEvent(toolUpdated('agent-dina', { id: kind, kind, status: 'completed' }, { turnId: 'turn-test', conversationId: 'thread-dina' }));
      await vi.advanceTimersByTimeAsync(500);
      expect(getGitStatus).toHaveBeenCalledOnce();
      getGitStatus.mockClear();
    }
    emitEvent(toolUpdated('agent-dina', { id: 'search', kind: 'webSearch', status: 'completed' }, { turnId: 'turn-test', conversationId: 'thread-dina' }));
    for (const [action, status] of [['read', 'completed'], ['edit', 'running'], ['edit', 'failed']]) {
      emitEvent(fileActivity('agent-dina', { path: '/repo/file', action: action!, status: status! }, { turnId: 'turn-test', conversationId: 'thread-dina' }));
    }
    await vi.advanceTimersByTimeAsync(500);
    expect(getGitStatus).not.toHaveBeenCalled();

    emitEvent(turnCompleted('agent-dina', 'turn-test', { conversationId: 'thread-dina' }));

    await vi.waitFor(() => {
      expect(getGitStatus).toHaveBeenCalledOnce();
      expect(snapshot.agentGitStatuses['agent-dina']).toMatchObject({
        addedLines: 3,
        removedLines: 1,
        state: 'dirty',
      });
    });
    await server.close();
  });

  it('refreshes git status when a Claude shell command finishes, because its completion carries no tool kind', async () => {
    vi.useFakeTimers();
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.activeAgentId = 'agent-dina';
    snapshot.agents = [{
      id: 'agent-dina', teamId: 'team-test', name: 'Dina', folder: '/Users/nbonamy/src/agent-workspace',
      provider: 'codex', status: { type: 'working' }, providerSession: { kind: 'codex', threadId: 'thread-dina' },
      createdAt: '2026-06-13T00:00:00.000Z', updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    let emitEvent: (event: BackendEvent) => void = () => undefined;
    const getGitStatus = vi.fn().mockResolvedValue({
      folder: '/Users/nbonamy/src/agent-workspace', branch: 'main', ahead: 0, behind: 0, changedFiles: 1,
      addedLines: 5, removedLines: 0, hasUntracked: true, state: 'dirty', updatedAt: '2026-06-13T00:00:01.000Z',
    });
    const driver: AgentProviderDriver = {
      provider: 'codex', getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }), getCapabilities: () => codexProviderCapabilities,
      sendPrompt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-test' } }),
      interrupt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      onEvent: (listener) => { emitEvent = listener; return () => undefined; },
      close: async () => undefined,
    };
    const server = new AppBackendServer({
      version: 'test-version', pid: 123, snapshot, driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])),
      agentGitService: { status: getGitStatus } as unknown as AgentGitService,
    });
    const started = (id: string, kind: string) => emitEvent(toolUpdated('agent-dina', { id, kind, status: 'running' }, { turnId: 'turn-test', conversationId: 'thread-dina' }));
    const finished = (id: string, status: 'completed' | 'failed' = 'completed') => emitEvent(toolUpdated('agent-dina', { id, status }, { turnId: 'turn-test', conversationId: 'thread-dina' }));

    // A Bash or python3 call: started as a command, finished by a bare status update.
    started('python', 'command');
    await vi.advanceTimersByTimeAsync(500);
    expect(getGitStatus).not.toHaveBeenCalled();
    finished('python');
    await vi.advanceTimersByTimeAsync(500);
    expect(getGitStatus).toHaveBeenCalledOnce();
    getGitStatus.mockClear();

    // A failed command may still have changed files, and a status update that is not a finish changes nothing.
    started('failing', 'command');
    emitEvent(toolUpdated('agent-dina', { id: 'failing', status: 'running' }, { turnId: 'turn-test', conversationId: 'thread-dina' }));
    await vi.advanceTimersByTimeAsync(500);
    expect(getGitStatus).not.toHaveBeenCalled();
    finished('failing', 'failed');
    await vi.advanceTimersByTimeAsync(500);
    expect(getGitStatus).toHaveBeenCalledOnce();
    getGitStatus.mockClear();

    // Tools that cannot touch the workspace, and finishes of items never seen starting, stay quiet; one finish refreshes once.
    started('search', 'webSearch');
    finished('search');
    finished('never-started');
    finished('python');
    await vi.advanceTimersByTimeAsync(500);
    expect(getGitStatus).not.toHaveBeenCalled();
    await server.close();
  });

  it('owns client request response routing', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      provider: 'codex',
      status: { type: 'working' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    let emitEvent: (event: BackendEvent) => void = () => undefined;
    const respondToAgentRequest = vi.fn().mockResolvedValue(undefined);
    const driver: AgentProviderDriver = {
      provider: 'codex',
      getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }),
      getCapabilities: () => codexProviderCapabilities,
      sendPrompt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-test' } }),
      interrupt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-test' } }),
      respondToAgentRequest,
      onEvent: (listener) => {
        emitEvent = listener;
        return () => undefined;
      },
      close: async () => undefined,
    };
    const events: unknown[] = [];
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])),
      onEvent: (event) => events.push(event),
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'unknown-response',
      method: 'agent/request/respond',
      params: { response: { id: 'approval-missing', outcome: { kind: 'decision', decision: 'allow' } } },
    })).rejects.toThrow("Agent request 'approval-missing' is no longer pending.");

    emitEvent({ agentId: 'agent-dina', provider: 'codex', type: 'agentRequest.created', payload: { request: {
      id: 'approval-1', conversationId: 'thread-dina', turnId: 'turn-1', kind: 'toolConfirmation',
      confirmation: { integrationId: 'test', integrationName: 'Test', toolName: 'Bash', summary: 'Run tool', argumentsPreview: 'npm test', allowConversation: false, allowAlways: false },
    } } });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'known-response',
      method: 'agent/request/respond',
      params: { response: { id: 'approval-1', outcome: { kind: 'decision', decision: 'allow' } } },
    })).resolves.toMatchObject({
      result: snapshot,
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'agentRequest.created', agentId: 'agent-dina' }),
    ]));
    expect(respondToAgentRequest).toHaveBeenCalledWith({ agentId: 'agent-dina', id: 'approval-1', outcome: { kind: 'decision', decision: 'allow' } });
    await server.close();
  });

  it('routes native SDK approval responses through the Codex driver to the provider', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      provider: 'codex',
      status: { type: 'working' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const { driver, script } = scriptedDriver('codex');
    await driver.loadConversation!(snapshot.agents[0]!);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])),
    });

    script.emit({
      agentId: 'agent-dina',
      provider: 'codex',
      threadId: 'thread-test',
      turnId: 'turn-test',
      type: 'agentRequest.created',
      payload: { request: approvalAgentRequest({
          id: 'approval-native-1',
          kind: 'command',
          conversationId: 'thread-test',
          turnId: 'turn-test',
          itemId: 'item-test',
          title: 'Run command',
          command: 'npm test',
          allowedScopes: ['once', 'session'],
          canDeny: true,
        }) },
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'native-approval-response',
      method: 'agent/request/respond',
      params: {
        response: {
          id: 'approval-native-1',
          outcome: { kind: 'decision', decision: 'allow_conversation' },
        },
      },
    })).resolves.toMatchObject({ result: snapshot });

    expect(script.calls('respondToAgentRequest')).toHaveLength(1);
    expect(script.calls('respondToAgentRequest')[0]!.args[0]).toMatchObject({
      id: 'approval-native-1',
      agentId: 'agent-dina',
      outcome: { kind: 'decision', decision: 'allow_conversation' },
    });
    await server.close();
  });

  it('persists backend-owned snapshot changes for stateful events', async () => {
    const snapshot = createTestSnapshot();
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const onEvent = vi.fn();
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
      onEvent,
    });

    server.emitEvent({
      agentId: 'agent-dina',
      type: 'snapshot.updated',
      payload: snapshot,
    });
    server.emitEvent({
      agentId: 'agent-dina',
      type: 'client.markdownDisplayRequested',
      payload: {
        kind: 'markdown',
        title: 'Readme',
        content: '# Readme',
      },
    });
    await Promise.resolve();

    expect(saveSnapshot).toHaveBeenCalledOnce();
    expect(saveSnapshot).toHaveBeenCalledWith(snapshot);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'snapshot.updated',
      payload: snapshot,
    }));
  });

  it('defers high-frequency turn metadata persistence until completion', async () => {
    const snapshot = createTestSnapshot();
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
    });

    server.emitEvent({
      agentId: 'agent-dina',
      threadId: 'thread-dina',
      turnId: 'turn-dina',
      type: 'conversation.contextUsageUpdated',
      payload: { contextUsage: { totalTokens: 100 } },
    } as unknown as BackendEvent);
    server.emitEvent(turnOutput('agent-dina', { turnId: 'turn-dina', conversationId: 'thread-dina' }));
    expect(saveSnapshot).not.toHaveBeenCalled();

    server.emitEvent(turnCompleted('agent-dina', 'turn-dina', { conversationId: 'thread-dina' }));
    await Promise.resolve();
    expect(saveSnapshot).toHaveBeenCalledOnce();
  });

  it('persists subagent state as soon as semantic activity arrives', async () => {
    const snapshot = createTestSnapshot();
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({ version: 'test-version', pid: 123, snapshot, saveSnapshot });

    server.emitEvent({
      agentId: 'agent-dina',
      provider: 'codex',
      conversationId: 'thread-root',
      turnId: 'turn-1',
      type: 'subagent.operationChanged',
      payload: {
        rootConversationId: 'thread-root',
        operation: {
          id: 'spawn-1',
          lifecycle: 'started',
          kind: 'spawnAgent',
          status: 'inProgress',
          senderConversationId: 'thread-root',
          receiverConversationIds: ['thread-child'],
          occurredAt: '2026-06-05T00:00:00.000Z',
        },
        agentStates: { 'thread-child': { status: 'running' } },
      },
    });
    await Promise.resolve();

    expect(snapshot.subagentTrees['agent-dina']?.nodes['thread-child']?.status).toBe('running');
    expect(saveSnapshot).toHaveBeenCalledOnce();

    server.emitEvent({
      agentId: 'agent-dina',
      provider: 'codex',
      conversationId: 'thread-root',
      type: 'subagent.identityChanged',
      payload: {
        rootConversationId: 'thread-root',
        conversationId: 'thread-child',
        agentNickname: 'Harvey',
        agentRole: 'worker',
      },
    });
    await Promise.resolve();

    expect(snapshot.subagentTrees['agent-dina']?.nodes['thread-child']).toMatchObject({
      agentNickname: 'Harvey',
      agentRole: 'worker',
    });
    expect(saveSnapshot).toHaveBeenCalledTimes(2);

    server.emitEvent({
      agentId: 'agent-dina',
      provider: 'codex',
      conversationId: 'thread-root',
      type: 'subagent.statusChanged',
      payload: {
        rootConversationId: 'thread-root',
        conversationId: 'thread-child',
        status: 'completed',
      },
    });
    await Promise.resolve();

    expect(snapshot.subagentTrees['agent-dina']?.nodes['thread-child']?.status).toBe('completed');
    expect(saveSnapshot).toHaveBeenCalledTimes(3);
  });

  it('announces review-ready plans with unmodified content instead of presentation instructions', () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      provider: 'codex',
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const events: unknown[] = [];
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      onEvent: (event) => events.push(event),
    });

    server.emitEvent({ type: 'plan.readyForReview', agentId: 'agent-dina', provider: 'codex', turnId: 'turn-proposed-plan', conversationId: 'thread-dina',
      payload: { itemId: 'turn-proposed-plan-plan', markdown: '# Proposed plan\n\n- Build it' } });

    expect(events.filter((event) => (
      typeof event === 'object' &&
      event !== null &&
      'type' in event &&
      event.type === 'plan.readyForReview'
    ))).toStrictEqual([expect.objectContaining({
      agentId: 'agent-dina',
      conversationId: 'thread-dina',
      turnId: 'turn-proposed-plan',
      payload: {
        itemId: 'turn-proposed-plan-plan',
        markdown: '# Proposed plan\n\n- Build it',
      },
    })]);
  });

  it('publishes turn diff data without deriving presentation events', () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      provider: 'codex',
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const events: unknown[] = [];
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      onEvent: (event) => events.push(event),
    });
    const diff = 'diff --git a/a.ts b/a.ts\n';

    server.emitEvent({
      agentId: 'agent-dina',
      provider: 'codex',
      conversationId: 'thread-dina',
      turnId: 'turn-diff',
      type: 'conversation.turnDiffUpdated',
      payload: {
        addedLines: 1,
        diff,
        removedLines: 0,
      },
    });

    expect(snapshot.turnGitDiffs['turn-diff']).toMatchObject({ diff });
    expect(events).toContainEqual(expect.objectContaining({
      agentId: 'agent-dina',
      conversationId: 'thread-dina',
      turnId: 'turn-diff',
      type: 'conversation.turnDiffUpdated',
      payload: {
        addedLines: 1,
        removedLines: 0,
        diff,
      },
    }));
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'sidePanel.gitDiffRequested' }));
  });
});
