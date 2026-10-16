import { approvalAgentRequest } from '@workspace/core/agent-request';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentBackendDriver, BackendEvent } from '@workspace/core/backend-driver';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import { AppBackendServer } from '../server';
import { BackendDriverRpc } from '../driver-rpc';
import type { AgentGitService } from '../git/agent-git-service';
import { CodexBackendDriver } from '../codex/codex-driver';
import type { CodexSurfaceAgentAdapter } from '../codex/codex-surface-adapter';
import {
  createTestSnapshot,
} from './server-test-fixtures';

describe('AppBackendServer', () => {
  afterEach(() => vi.useRealTimers());

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
        backend: 'codex',
        status: { type: 'working' },
        backendSession: { kind: 'codex', threadId: 'thread-dina' },
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
      {
        id: 'agent-jesse',
        teamId: 'team-test',
        name: 'Jesse',
        folder: '/Users/nbonamy/src/multi-llm-ts',
        backend: 'codex',
        status: { type: 'working' },
        backendSession: { kind: 'codex', threadId: 'thread-jesse' },
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
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      sendPrompt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
      interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
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
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
      agentGitService: { status: getGitStatus } as unknown as AgentGitService,
    });

    emitEvent({
      backend: 'codex',
      agentId: 'agent-dina',
      threadId: 'thread-dina',
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
      backend: 'codex',
      agentId: 'agent-dina',
      threadId: 'thread-dina',
      turnId: 'turn-test',
      type: 'conversation.turnDiffUpdated',
      payload: { addedLines: 3, removedLines: 1, diff: 'diff --git a/README.md b/README.md\n' },
    });
    emitEvent(codexConversationEvent(
      'agent-jesse',
      'thread-jesse',
      'turn-jesse',
      'turn.completed',
      { status: 'completed' },
    ));
    await Promise.resolve();
    expect(getGitStatus).toHaveBeenCalledWith('/Users/nbonamy/src/multi-llm-ts');
    await vi.advanceTimersByTimeAsync(500);
    expect(getGitStatus).toHaveBeenCalledTimes(2);
    expect(snapshot.agentGitStatuses['agent-dina']).toMatchObject({ addedLines: 3, removedLines: 1 });
    getGitStatus.mockClear();

    for (const action of ['edit', 'create']) {
      emitEvent(codexConversationEvent('agent-dina', 'thread-dina', 'turn-test', 'file.activity', {
        messageId: 'assistant-turn-test', itemId: 'file', path: '/repo/file', action, status: 'completed',
      }));
      await vi.advanceTimersByTimeAsync(500);
      expect(getGitStatus).toHaveBeenCalledOnce();
      getGitStatus.mockClear();
    }
    emitEvent(codexConversationEvent('agent-dina', 'thread-dina', 'turn-test', 'conversation.diffUpdated', { diff: null }));
    await vi.advanceTimersByTimeAsync(500);
    expect(getGitStatus).toHaveBeenCalledOnce();
    getGitStatus.mockClear();

    for (const kind of ['command', 'fileChange']) {
      emitEvent(codexConversationEvent('agent-dina', 'thread-dina', 'turn-test', 'tool.completed', {
        messageId: 'assistant-turn-test',
        toolPart: { type: 'tool', id: kind, title: kind, kind, status: 'completed' },
      }));
      await vi.advanceTimersByTimeAsync(500);
      expect(getGitStatus).toHaveBeenCalledOnce();
      getGitStatus.mockClear();
    }
    emitEvent(codexConversationEvent('agent-dina', 'thread-dina', 'turn-test', 'tool.completed', {
      messageId: 'assistant-turn-test',
      toolPart: { type: 'tool', id: 'search', title: 'search', kind: 'webSearch', status: 'completed' },
    }));
    for (const [action, status] of [['read', 'completed'], ['edit', 'running'], ['edit', 'failed']]) {
      emitEvent(codexConversationEvent('agent-dina', 'thread-dina', 'turn-test', 'file.activity', {
        messageId: 'assistant-turn-test', itemId: 'file', path: '/repo/file', action, status,
      }));
    }
    await vi.advanceTimersByTimeAsync(500);
    expect(getGitStatus).not.toHaveBeenCalled();

    emitEvent({
      backend: 'codex',
      agentId: 'agent-dina',
      threadId: 'thread-dina',
      type: 'codex.conversationEventReceived',
      payload: {
        revision: 4,
        event: {
          seq: 4,
          occurredAt: '2026-06-13T00:00:02.000Z',
          origin: 'notification',
          conversationId: 'thread-dina',
          turnId: 'turn-test',
          type: 'turn.completed',
          payload: {
            status: 'completed', error: null, willRetry: false,
            startedAt: null, completedAt: '2026-06-13T00:00:02.000Z', durationMs: null,
          },
        },
      },
    });

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

  it('owns client request response routing', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      backend: 'codex',
      status: { type: 'working' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    let emitEvent: (event: BackendEvent) => void = () => undefined;
    const respondToAgentRequest = vi.fn().mockResolvedValue(undefined);
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      sendPrompt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
      interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
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
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
      onEvent: (event) => events.push(event),
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'unknown-response',
      method: 'agent/request/respond',
      params: { response: { id: 'approval-missing', outcome: { kind: 'decision', decision: 'allow' } } },
    })).rejects.toThrow("Agent request 'approval-missing' is no longer pending.");

    emitEvent({ agentId: 'agent-dina', backend: 'codex', type: 'agentRequest.created', payload: { request: {
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

  it('routes native SDK approval responses through the Codex driver into its surface adapter', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      backend: 'codex',
      status: { type: 'working' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    let emitAdapterEvent: (event: BackendEvent) => void = () => undefined;
    const respondToClientRequest = vi.fn().mockResolvedValue(undefined);
    const adapter = {
      onUsage: () => () => undefined,
      onEvent: (listener: (event: BackendEvent) => void) => {
        emitAdapterEvent = listener;
        return () => undefined;
      },
      respondToClientRequest,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as CodexSurfaceAgentAdapter;
    const driver = new CodexBackendDriver(adapter);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
    });

    emitAdapterEvent({
      agentId: 'agent-dina',
      backend: 'codex',
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

    expect(respondToClientRequest).toHaveBeenCalledOnce();
    expect(respondToClientRequest).toHaveBeenCalledWith({
      id: 'approval-native-1',
      agentId: 'agent-dina',
      payload: { decision: 'allow_conversation' },
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
    server.emitEvent(codexConversationEvent(
      'agent-dina', 'thread-dina', 'turn-dina', 'turn.planUpdated',
      { explanation: 'working', plan: [] },
    ));
    expect(saveSnapshot).not.toHaveBeenCalled();

    server.emitEvent(codexConversationEvent(
      'agent-dina', 'thread-dina', 'turn-dina', 'turn.completed',
      { status: 'completed' },
    ));
    await Promise.resolve();
    expect(saveSnapshot).toHaveBeenCalledOnce();
  });

  it('persists subagent state as soon as semantic activity arrives', async () => {
    const snapshot = createTestSnapshot();
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({ version: 'test-version', pid: 123, snapshot, saveSnapshot });

    server.emitEvent({
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-root',
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
      backend: 'codex',
      threadId: 'thread-root',
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
      backend: 'codex',
      threadId: 'thread-root',
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
      backend: 'codex',
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

    server.emitEvent(codexConversationEvent(
      'agent-dina', 'thread-dina', 'turn-proposed-plan', 'plan.completed',
      { itemId: 'turn-proposed-plan-plan', markdown: '# Proposed plan\n\n- Build it' },
    ));

    expect(events.filter((event) => (
      typeof event === 'object' &&
      event !== null &&
      'type' in event &&
      event.type === 'plan.readyForReview'
    ))).toStrictEqual([expect.objectContaining({
      agentId: 'agent-dina',
      threadId: 'thread-dina',
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
      backend: 'codex',
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
      backend: 'codex',
      threadId: 'thread-dina',
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
      threadId: 'thread-dina',
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

function codexConversationEvent(
  agentId: string,
  conversationId: string,
  turnId: string,
  type: string,
  payload: unknown,
): BackendEvent {
  return {
    agentId,
    backend: 'codex',
    threadId: conversationId,
    type: 'codex.conversationEventReceived',
    payload: {
      revision: 1,
      event: {
        seq: 1,
        occurredAt: '2026-06-13T00:00:00.000Z',
        origin: 'notification',
        conversationId,
        turnId,
        type,
        payload,
      },
    },
  } as BackendEvent;
}
