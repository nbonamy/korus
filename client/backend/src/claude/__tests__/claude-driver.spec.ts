import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import { homedir } from 'node:os';
import { ClaudeBackendDriver } from '../claude-driver';
import type { ClaudeSdkMessage } from '../protocol';
import type { ClaudeTurnHandle, ClaudeTurnParams, ClaudeTurnTransport } from '../transport';
import type { Agent } from '@workspace/core/contracts';
import type { BackendEvent } from '@workspace/core/backend-driver';
import { createClaudeConversationReplica, type ClaudeConversationReplica } from '@workspace/core/claude-conversation-replica';
import { claudeTranscriptToRendererMessages } from '../transcript-history-adapter';

const agent: Agent = {
  id: 'agent-claude',
  name: 'Claude Pal',
  folder: '/Users/nbonamy/src/agent-workspace',
  backend: 'claude',
  backendDefaults: { kind: 'claude' },
  status: { type: 'idle' },
  createdAt: '2026-06-05T00:00:00.000Z',
  updatedAt: '2026-06-05T00:00:00.000Z',
};

function unwrapClaudeConversationEvent(event: BackendEvent) {
  return event.type === 'claude.conversationEventReceived'
    ? event.payload.event
    : event;
}

describe('ClaudeBackendDriver', () => {
  it('uses Haiku for utility drafts without changing the selected model or starting a conversation turn', async () => {
    const transport = createFakeTransport();
    const generateText = vi.fn().mockResolvedValue({ text: 'feat: improve drafts' });
    const discoverModels = vi.fn().mockResolvedValue(['haiku','sonnet','opus'].map(value=>({value,displayName:value,supportsEffort:true,supportedEffortLevels:['low','medium','high']})));
    const driver = new ClaudeBackendDriver({ ...transport, generateText, discoverModels });
    const selected = { ...agent, backendDefaults: { kind: 'claude' as const, model: 'opus', reasoningEffort: 'high' } };
    const input = { cwd: '/repo', prompt: 'Write a draft' };
    try {
      await expect(driver.generateText(selected, input)).resolves.toStrictEqual({ text: 'feat: improve drafts' });
      expect(generateText).toHaveBeenCalledExactlyOnceWith(input, { model: 'haiku', effort: 'low' });
      await driver.generateText(selected, {...input,complexity:'normal'});
      expect(generateText).toHaveBeenLastCalledWith({...input,complexity:'normal'}, {model:'sonnet',effort:'medium'});
      await driver.generateText(selected, {...input,complexity:'complex'});
      expect(generateText).toHaveBeenLastCalledWith({...input,complexity:'complex'}, {model:'opus',effort:'high'});
      expect(transport.startTurn).not.toHaveBeenCalled();
      expect(selected.backendDefaults).toStrictEqual({ kind: 'claude', model: 'opus', reasoningEffort: 'high' });
    } finally { await driver.close(); }
  });

  it('delegates from a running source at its completed native boundary and rebinds the child query', async () => {
    const transport = createConcurrentFakeTransport();
    const forkWorktreeSession = vi.fn().mockResolvedValue('child-native');
    const startTurn = vi.fn(transport.startTurn);
    const driver = new ClaudeBackendDriver({ ...transport, startTurn, forkWorktreeSession }, async () => null, { appMcpServerUrl: 'http://127.0.0.1:4321/mcp' });
    const parent = { ...agent, backendSession: { kind: 'claude' as const, sessionId: 'source', transport: 'stdio' as const } };
    const worker: Agent = { ...agent, id: 'worker', folder: '/tmp/worker', backendDefaults: { kind: 'claude', model: 'haiku', reasoningEffort: 'low', permissionMode: 'default' } };
    try {
      const seed = driver.sendPrompt(parent, 'Design seed');
      transport.emit(parent.id, { type: 'system', subtype: 'init', session_id: 'source' });
      await seed;
      transport.emit(parent.id, { type: 'assistant', uuid: 'native-completed', message: { content: 'Seed' } });
      transport.emit(parent.id, { type: 'result', subtype: 'success', session_id: 'source', is_error: false });
      const running = driver.sendPrompt(parent, 'Delegate');
      transport.emit(parent.id, { type: 'system', subtype: 'init', session_id: 'source' });
      await running;
      transport.emit(parent.id, { type: 'assistant', uuid: 'active-tool-boundary', message: { content: 'Creating worker' } });
      worker.backendSession = (await driver.forkWorktreeConversation(parent, worker))!.backendSession;
      expect(forkWorktreeSession).toHaveBeenCalledExactlyOnceWith('source', parent.folder, 'native-completed', undefined);
      expect(parent.backendSession.sessionId).toBe('source');
      const assignment = driver.sendPrompt(worker, 'Worker task');
      expect(startTurn.mock.calls.at(-1)?.[0]).toMatchObject({ ownerId: worker.id, cwd: worker.folder, sessionId: 'child-native', model: 'haiku', effort: 'low', permissionMode: 'default', mcpServerUrl: 'http://127.0.0.1:4321/mcp?agentId=worker', appendSystemPrompt: expect.stringContaining('worker') });
      transport.emit(worker.id, { type: 'system', subtype: 'init', session_id: 'child-native' });
      expect((await assignment).backendSession).toMatchObject({ transcriptFolder: parent.folder });
    } finally { await driver.close(); }
  });













  it('starts Claude turns and adapts stream-json messages into backend events', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const events: unknown[] = [];
    driver.onEvent((event) => events.push(unwrapClaudeConversationEvent(event)));

    const sendResult = driver.sendPrompt(agent, 'hello claude', { backendOptions: { kind: 'claude', permissionMode: 'acceptEdits' }, selection: { model: 'claude-sonnet-4-5' } });
    expect(transport.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/Users/nbonamy/src/agent-workspace',
      prompt: 'hello claude',
      sessionId: undefined,
      model: 'claude-sonnet-4-5',
      permissionMode: 'acceptEdits',
      appendSystemPrompt: expect.stringContaining(`Your ${product.name} agent ID is agent-claude.`),
    }), expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function));

    transport.emit({ type: 'system', subtype: 'init', session_id: 'claude-session-1' });
    await expect(sendResult).resolves.toStrictEqual({
      backendSession: {
        kind: 'claude',
        sessionId: 'claude-session-1',
        transport: 'stdio',
        model: 'claude-sonnet-4-5',
      },
      turnId: expect.stringMatching(/^claude-turn-/),
    });
    const turnId = (await sendResult).turnId;

    transport.emit({
      type: 'assistant',
      session_id: 'claude-session-1',
      message: {
        content: [
          { type: 'text', text: 'Working on it.' },
          { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'npm test' } },
        ],
      },
    });
    transport.emit({
      type: 'user',
      session_id: 'claude-session-1',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: 'pass' },
        ],
      },
    });
    transport.emit({ type: 'result', subtype: 'success', session_id: 'claude-session-1', is_error: false });

    expect(events).toContainEqual(expect.objectContaining({
      agentId: 'agent-claude',
      backend: 'claude',
      backendSessionId: 'claude-session-1',
      type: 'agent.conversationAttached',
      conversationId: 'claude-session-1',
      payload: {},
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'conversation.settingsUpdated',
      payload: { settings: { model: 'claude-sonnet-4-5', serviceTier: null } },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      agentId: 'agent-claude',
      backend: 'claude',
      backendSessionId: 'claude-session-1',
      turnId,
      type: 'message.delta',
      payload: { delta: 'Working on it.' },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      turnId,
      type: 'item.started',
      payload: {
        toolPart: expect.objectContaining({
          id: 'tool-1',
          kind: 'command',
          title: 'npm test',
          status: 'running',
          input: { command: 'npm test', cwd: '/Users/nbonamy/src/agent-workspace' },
        }),
      },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      turnId,
      type: 'item.updated',
      payload: expect.objectContaining({
        itemId: 'tool-1',
        status: 'completed',
        output: 'pass',
      }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      turnId,
      type: 'turn.completed',
    }));
  });





















  it('exposes capabilities and rejects operations that have no valid Claude session context', async () => {
    const transport = createFakeTransport();
    const historyLoader = vi.fn().mockResolvedValue(null);
    const driver = new ClaudeBackendDriver(transport, historyLoader);

    expect(driver.getRuntimeStatus()).toStrictEqual({
      backend: 'claude',
      status: 'notConfigured',
      detail: { key: 'backend.claudeNotStarted' },
    });
    expect(driver.getCapabilities(agent)).toMatchObject({ attachments: true, approvals: true });
    await expect(driver.interrupt(agent)).rejects.toThrow('No active Claude turn');
    await expect(driver.respondToAgentRequest({ id: 'request-1', outcome: { kind: 'cancelled' } })).rejects.toThrow('no longer pending');
    await expect(driver.loadConversation(agent)).resolves.toBeNull();
    await expect(driver.resumeConversation(agent, { ref: { backend: 'codex', threadId: 'thread-1' }, storageState: 'active' })).rejects.toThrow('non-Claude');
    await expect(driver.readConversationMessages({ backend: 'codex', threadId: 'thread-1' }, agent.id)).rejects.toThrow('non-Claude');

    const first = driver.sendPrompt(agent, 'first');
    await expect(driver.sendPrompt(agent, 'second')).rejects.toThrow('already has an active turn');
    transport.emit({ type: 'system', subtype: 'init', session_id: 'claude-session-first' });
    await first;
    await driver.interrupt(agent);
  });





  it(`passes ${product.name} MCP config and allows ${product.name} MCP tools by default`, async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport, async () => null, {
      appMcpServerUrl: 'http://127.0.0.1:4321/mcp',
      hostedMcpServerUrls: () => ({
        github: 'http://127.0.0.1:4321/mcp/providers/github',
        gitlab: 'http://127.0.0.1:4321/mcp/providers/gitlab',
      }),
      celebrationsEnabled: () => false,
      additionalDeveloperInstructions: () => '<context>\nMission contract\n</context>',
    });

    const sendResult = driver.sendPrompt(agent, 'coordinate with the team');

    expect(transport.startTurn.mock.calls[0]?.[0]).toMatchObject({
      mcpServerUrl: 'http://127.0.0.1:4321/mcp?agentId=agent-claude',
      hostedMcpServerUrls: {
        github: 'http://127.0.0.1:4321/mcp/providers/github?agentId=agent-claude',
        gitlab: 'http://127.0.0.1:4321/mcp/providers/gitlab?agentId=agent-claude',
      },
      allowedTools: [`mcp__${product.mcpServerName}__*`],
      appendSystemPrompt: expect.stringContaining(`Use the ${product.mcpServerName} MCP server for agent collaboration.`),
    });
    expect(transport.startTurn.mock.calls[0]?.[0].appendSystemPrompt).not.toContain('celebration: true');
    expect(transport.startTurn.mock.calls[0]?.[0].appendSystemPrompt).toContain('<context>\nMission contract\n</context>');
    const developerInstructions = transport.startTurn.mock.calls[0]![0].appendSystemPrompt!;
    expect(developerInstructions.indexOf(`Use the ${product.mcpServerName} MCP server`))
      .toBeLessThan(developerInstructions.indexOf('<context>'));
    transport.emit({ type: 'system', subtype: 'init', session_id: 'claude-session-mcp' });
    await expect(sendResult).resolves.toMatchObject({
      backendSession: { kind: 'claude', sessionId: 'claude-session-mcp', transport: 'stdio' },
    });
  });

  it('uses the review tool context for a reviewer chat follow-up', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport, async () => null, {
      appMcpServerUrl: 'http://127.0.0.1:4321/mcp',
    });
    const reviewer: Agent = {
      ...agent,
      backendSession: { kind: 'claude', sessionId: 'review-thread', transport: 'stdio' },
      codeReview: {
        id: 'review-1', targetAgentId: 'target', reviewerAgentId: agent.id,
        scope: { type: 'uncommitted' }, threadMode: 'independent', status: 'ready',
        activeRoundId: 'round-1', rounds: [{ id: 'round-1', number: 1, status: 'ready', findings: [], startedAt: '' }],
        createdAt: '', updatedAt: '',
      },
    };
    const result = driver.sendPrompt(reviewer, 'I found another issue');
    expect(transport.startTurn.mock.calls[0]?.[0]).toMatchObject({
      mcpServerUrl: 'http://127.0.0.1:4321/mcp?agentId=agent-claude&reviewContextId=review-1',
      allowedTools: [`mcp__${product.mcpServerName}__*`],
    });
    transport.resolveDone();
    await result;
  });

  it('runs review in a fresh context with only review-domain MCP tools added', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const reviewerAgent: Agent = {
      ...agent,
      backendDefaults: { kind: 'claude', model: 'opus', reasoningEffort: 'xhigh' },
    };
    const events: Array<{ type?: string; turnId?: string; payload?: unknown }> = [];
    driver.onEvent((event) => events.push(unwrapClaudeConversationEvent(event)));

    const review = driver.runCodeReview(reviewerAgent, {
      cwd: '/Users/nbonamy/src/agent-workspace',
      prompt: 'Review the current diff.',
      reviewMcpServerUrl: 'http://127.0.0.1:4321/mcp?agentId=agent-claude&reviewContextId=review-1',
    });

    expect(transport.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Review the current diff.',
      mcpServerUrl: 'http://127.0.0.1:4321/mcp?agentId=agent-claude&reviewContextId=review-1',
      appendSystemPrompt: expect.stringContaining(`Use the ${product.mcpServerName} MCP server`),
      allowedTools: [
        `mcp__${product.mcpServerName}__report_finding`,
        `mcp__${product.mcpServerName}__update_finding`,
        `mcp__${product.mcpServerName}__delete_finding`,
        `mcp__${product.mcpServerName}__finish_review_round`,
        `mcp__${product.mcpServerName}__send-message`,
        `mcp__${product.mcpServerName}__set-status`,
        `mcp__${product.mcpServerName}__finish_turn`,
      ],
      model: 'opus',
      effort: 'xhigh',
    }), expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function));
    expect(transport.startTurn.mock.calls[0]?.[0].sessionId).toBeUndefined();
    transport.emit({ type: 'assistant', session_id: 'review-session-1', message: { content: [{ type: 'text', text: 'The finding is reachable.' }] } });
    transport.resolveDone();
    const result = await review;
    expect(result).toEqual({
      text: 'The finding is reachable.',
      reviewerSession: { kind: 'claude', sessionId: 'review-session-1', transport: 'stdio' },
    });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'turn.started' }),
      expect.objectContaining({ type: 'message.userSubmitted' }),
      expect.objectContaining({ type: 'message.delta' }),
      expect.objectContaining({ type: 'turn.completed' }),
    ]));

    const clarification = driver.runCodeReview(reviewerAgent, {
      cwd: '/Users/nbonamy/src/agent-workspace',
      prompt: 'Clarify this finding.',
      reviewMcpServerUrl: 'http://127.0.0.1:4321/mcp?agentId=agent-claude&reviewContextId=review-2',
      reviewerSession: result.reviewerSession,
    });
    expect(transport.startTurn.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      prompt: 'Clarify this finding.',
      sessionId: 'review-session-1',
    }));
    transport.emit({ type: 'assistant', session_id: 'review-session-1', message: { content: [{ type: 'text', text: 'Clarified.' }] } });
    await expect(clarification).resolves.toMatchObject({ text: 'Clarified.', reviewerSession: result.reviewerSession });

    expect(transport.deleteSession).not.toHaveBeenCalled();
  });











  it('reads historical conversation messages from Claude transcript refs', async () => {
    const transport = createFakeTransport();
    const messages = [{
      id: 'user-claude-session-existing-user-1',
      agentId: 'agent-claude',
      role: 'user' as const,
      status: 'complete' as const,
      turnId: 'claude-prompt-1',
      createdAt: '2026-06-06T22:33:42.809Z',
      parts: [{ type: 'text' as const, text: 'hello' }],
    }];
    const historyLoader = vi.fn().mockResolvedValue({
      backendSession: { kind: 'claude', sessionId: 'claude-session-existing', transcriptSessionId: 'claude-session-existing', transport: 'stdio' },
      messages,
    });
    const driver = new ClaudeBackendDriver(transport, historyLoader);

    await expect(driver.readConversationMessages({
      backend: 'claude',
      folder: '/Users/nbonamy/src/id8',
      sessionId: 'claude-session-existing',
    }, 'agent-claude')).resolves.toStrictEqual(messages);
    expect(historyLoader).toHaveBeenCalledWith(expect.objectContaining({
      id: 'agent-claude',
      folder: '/Users/nbonamy/src/id8',
      backend: 'claude',
      backendSession: {
        kind: 'claude',
        sessionId: 'claude-session-existing',
        transport: 'stdio',
      },
    }), { recent: false });
  });


















});

function createFakeTransport(): ClaudeTurnTransport & {
  emit(message: ClaudeSdkMessage): void;
  emitPermissionRequest(request: import('../transport').ClaudePermissionRequest): void;
  rejectDone(error: Error): void;
  resolveDone(): void;
  lastHandle: ClaudeTurnHandle & { interrupt: ReturnType<typeof vi.fn> };
  startTurn: ReturnType<typeof vi.fn<(params: ClaudeTurnParams, onMessage: (message: ClaudeSdkMessage) => void) => ClaudeTurnHandle>>;
  respondToPermissionRequest: ReturnType<typeof vi.fn>;
  closeSession: ReturnType<typeof vi.fn>;
  deleteSession: ReturnType<typeof vi.fn>;
  discoverModels: ReturnType<typeof vi.fn>;
  listModels: ReturnType<typeof vi.fn>;
  getContextUsage: ReturnType<typeof vi.fn>;
  readContextUsage: ReturnType<typeof vi.fn>;
} {
  let onMessage: (message: ClaudeSdkMessage) => void = () => undefined;
  let onPermissionRequest: (request: import('../transport').ClaudePermissionRequest) => void = () => undefined;
  let rejectDone: (error: Error) => void = () => undefined;
  let resolveDone: () => void = () => undefined;
  const lastHandle = {
    done: new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    }),
    interrupt: vi.fn().mockResolvedValue(undefined),
  };
  return {
    lastHandle,
    startTurn: vi.fn((
      _: ClaudeTurnParams,
      listener: (message: ClaudeSdkMessage) => void,
      permissionListener?: (request: import('../transport').ClaudePermissionRequest) => void,
    ) => {
      onMessage = listener;
      onPermissionRequest = permissionListener ?? (() => undefined);
      return lastHandle;
    }),
    emit: (message: ClaudeSdkMessage) => {
      onMessage(message);
    },
    emitPermissionRequest: (request) => {
      onPermissionRequest(request);
    },
    rejectDone: (error: Error) => {
      rejectDone(error);
    },
    resolveDone: () => {
      resolveDone();
    },
    respondToPermissionRequest: vi.fn().mockRejectedValue(new Error("Claude permission request 'request-1' is no longer pending.")),
    closeSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    discoverModels: vi.fn().mockResolvedValue(null),
    listModels: vi.fn().mockResolvedValue(null),
    getContextUsage: vi.fn().mockResolvedValue(null),
    readContextUsage: vi.fn().mockResolvedValue(null),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createConcurrentFakeTransport(): ClaudeTurnTransport & {
  emit(ownerId: string, message: ClaudeSdkMessage): void;
} {
  const listeners = new Map<string, (message: ClaudeSdkMessage) => void>();
  return {
    startTurn: (params, listener) => {
      if (!params.ownerId) throw new Error('Concurrent Claude tests require an owner id.');
      listeners.set(params.ownerId, listener);
      return {
        done: new Promise<void>(() => undefined),
        interrupt: vi.fn().mockResolvedValue(undefined),
      };
    },
    emit: (ownerId, message) => {
      const listener = listeners.get(ownerId);
      if (!listener) throw new Error(`No Claude turn for ${ownerId}.`);
      listener(message);
    },
    close: vi.fn().mockResolvedValue(undefined),
  };
}

it('exposes and persists Claude permission modes without creating a session', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const configuredAgent: Agent = {
      ...agent,
      backendDefaults: { kind: 'claude', model: 'sonnet', reasoningEffort: 'high' },
    };

    expect(driver.getCapabilities(configuredAgent).permissionModes).toStrictEqual([
      expect.objectContaining({ id: 'default', label: { key: 'permissions.claude.default.label' } }),
      expect.objectContaining({ id: 'acceptEdits', label: { key: 'permissions.claude.acceptEdits.label' } }),
      expect.objectContaining({ id: 'dontAsk', label: { key: 'permissions.claude.dontAsk.label' } }),
      expect.objectContaining({ id: 'auto', label: { key: 'permissions.claude.auto.label' } }),
      expect.objectContaining({ id: 'bypassPermissions', dangerous: true }),
    ]);
    await expect(driver.setPermissionMode(configuredAgent, 'acceptEdits')).resolves.toStrictEqual({
      backendDefaults: {
        kind: 'claude',
        model: 'sonnet',
        reasoningEffort: 'high',
        permissionMode: 'acceptEdits',
      },
    });
    expect(transport.startTurn).not.toHaveBeenCalled();
  });
