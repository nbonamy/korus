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
  it.each([
    ...['', 'clear', 'stop', 'off', 'reset', 'none', 'cancel'].map(objective => ({ label: objective || 'empty', objective })),
    { label: 'oversized', objective: 'x'.repeat(4001) },
  ])('rejects invalid native goal conditions before starting work ($label)', async ({ objective }) => {
    const transport = createFakeTransport();
    vi.mocked(transport.startTurn).mockImplementation(() => { throw new Error('Unexpected provider execution'); });
    const driver = new ClaudeBackendDriver(transport);
    try {
      await expect(driver.setGoal(agent, objective)).rejects.toThrow('goal condition');
      expect(transport.startTurn).not.toHaveBeenCalled();
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

  it('refuses a running worktree fork without a completed boundary and leaves the source active', async () => {
    const transport = createConcurrentFakeTransport();
    const forkWorktreeSession = vi.fn();
    const driver = new ClaudeBackendDriver({ ...transport, forkWorktreeSession });
    try {
      const parent = { ...agent, backendSession: { kind: 'claude' as const, sessionId: 'source', transport: 'stdio' as const } };
      const running = driver.sendPrompt(parent, 'First task');
      transport.emit(parent.id, { type: 'system', subtype: 'init', session_id: 'source' });
      await running;
      await expect(driver.forkWorktreeConversation(parent, { ...agent, id: 'worker', folder: '/tmp/worker' })).rejects.toThrow('completed native boundary');
      expect(forkWorktreeSession).not.toHaveBeenCalled();
      await expect(driver.assertHandoffReady(parent)).rejects.toThrow('Claude turn');
    } finally { await driver.close(); }
  });
  it.each([false, true])('waits for native goal clear and reports failure honestly (error: %s)', async (isError) => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const settled = vi.fn();
    const clearing = driver.clearGoal({ ...agent, backendSession: { kind: 'claude', sessionId: 'session', transport: 'stdio' } });
    const observed = clearing.then(settled, (error) => { settled(error); });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(transport.startTurn).toHaveBeenCalledWith(expect.objectContaining({ prompt: '/goal clear' }), expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function));
    transport.emit({ type: 'result', subtype: 'success', session_id: 'session', is_error: isError, ...(isError ? { result: 'quota exhausted' } : {}) });
    transport.resolveDone();
    await observed;
    if (isError) expect(settled.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    else expect(settled.mock.calls[0]?.[0]).toMatchObject({ cleared: true });
    await driver.close();
  });

  it('starts native goals and publishes completion from provider history rather than assistant text', async () => {
    const transport = createFakeTransport();
    const completedGoal = { threadId: 'goal-session', objective: 'Ship it', status: 'complete', tokenBudget: null, tokensUsed: 55, timeUsedSeconds: 1.8, createdAt: Date.now() / 1000 + 1, updatedAt: Date.now() / 1000 + 2 };
    const history = vi.fn()
      .mockResolvedValueOnce({ backendSession: { kind: 'claude', sessionId: 'goal-session', transport: 'stdio' }, messages: [], goal: { ...completedGoal, status: 'active' } })
      .mockResolvedValue({ backendSession: { kind: 'claude', sessionId: 'goal-session', transport: 'stdio' }, messages: [], goal: completedGoal });
    const driver = new ClaudeBackendDriver(transport, history);
    const events: BackendEvent[] = [];
    driver.onEvent((event) => events.push(event));
    const setting = driver.setGoal(agent, 'Ship it');
    expect(transport.startTurn).toHaveBeenCalledWith(expect.objectContaining({ prompt: '/goal Ship it' }), expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function));
    transport.emit({ type: 'system', subtype: 'init', session_id: 'goal-session' });
    await expect(setting).resolves.toMatchObject({ goal: { objective: 'Ship it', status: 'active' } });
    transport.emit({ type: 'assistant', message: { content: 'Goal complete!' } });
    expect(events.filter((event) => event.type === 'conversation.goalUpdated')).toHaveLength(0);
    transport.emit({ type: 'result', subtype: 'success', session_id: 'goal-session', is_error: false });
    transport.resolveDone();
    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ type: 'conversation.goalUpdated', payload: { goal: completedGoal } })));
    await driver.close();
  });

  it('forks a selected completed turn using its native boundary and returns an independent child reference', async () => {
    const transport = createFakeTransport();
    const forkSession = vi.fn().mockResolvedValue('child-session');
    const history = vi.fn().mockResolvedValue({
      backendSession: { kind: 'claude', sessionId: 'parent-session', transport: 'stdio' },
      messages: [], turnBoundaries: { 'claude-user-1': 'native-answer-1' },
    });
    const driver = new ClaudeBackendDriver({ ...transport, forkSession }, history);
    const parent: Agent = { ...agent, backendSession: { kind: 'claude', sessionId: 'parent-session', transport: 'stdio' } };
    const child: Agent = { ...agent, id: 'child' };
    await expect(driver.forkConversation(parent, child, 'unknown')).rejects.toThrow('boundary');
    expect(forkSession).not.toHaveBeenCalled();
    const result = await driver.forkConversation(parent, child, 'claude-user-1');
    expect(forkSession).toHaveBeenCalledExactlyOnceWith('parent-session', agent.folder, 'native-answer-1');
    expect(result.backendSession).toMatchObject({ kind: 'claude', sessionId: 'child-session' });
    expect(parent.backendSession?.kind === 'claude' && parent.backendSession.sessionId).toBe('parent-session');
    await expect(driver.forkConversation(parent, { ...child, folder: '/other' })).rejects.toThrow('folder');
    await driver.close();
  });

  it('reads the completed handoff turn from its live replica and waits for session closure', async () => {
    const transport = createFakeTransport();
    const historyLoader = vi.fn().mockResolvedValue(null);
    const driver = new ClaudeBackendDriver(transport, historyLoader);
    const started = driver.sendPrompt(agent, 'write a handoff note');
    transport.emit({ type: 'system', subtype: 'init', session_id: 'handoff-session' });
    const result = await started;
    await expect(driver.assertHandoffReady(agent)).rejects.toThrow('Claude turn');
    transport.emit({ type: 'assistant', session_id: 'handoff-session', message: { content: [{ type: 'text', text: 'Continue the fix.' }] } });
    transport.emit({ type: 'result', subtype: 'success', session_id: 'handoff-session', is_error: false });
    await expect(driver.assertHandoffReady(agent)).resolves.toBeUndefined();
    const messages = await driver.readConversationMessages({ backend: 'claude', sessionId: 'handoff-session', folder: agent.folder }, agent.id);
    expect(messages).toContainEqual(expect.objectContaining({ turnId: result.turnId, role: 'assistant', status: 'complete', parts: expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'Continue the fix.' })]) }));
    expect(historyLoader).not.toHaveBeenCalled();
    let finishClose!: () => void;
    transport.closeSession.mockImplementationOnce(() => new Promise<void>(resolve => { finishClose = resolve; }));
    let released = false;
    const closed = driver.releaseConversation(agent.id).then(() => { released = true; });
    await Promise.resolve();
    expect(released).toBe(false);
    finishClose();
    await closed;
    expect(released).toBe(true);
    await driver.close();
  });
  it('loads models and starts a folderless Quick Chat', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const quickChat: Agent = { ...agent, folder: null, sessionKind: 'quickChat' };
    const models = await driver.listModels(quickChat);
    expect(models.length).toBeGreaterThan(0);
    expect(transport.discoverModels).toHaveBeenCalledWith({ cwd: homedir() });
    const started = driver.sendPrompt(quickChat, 'hello claude');
    expect(transport.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      cwd: homedir(), prompt: 'hello claude',
    }), expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function));
    transport.emit({ type: 'system', subtype: 'init', session_id: 'quick-chat-session' });
    await expect(started).resolves.toEqual(expect.objectContaining({
      backendSession: expect.objectContaining({ kind: 'claude', sessionId: 'quick-chat-session' }),
    }));
    expect(quickChat.folder).toBeNull();
    transport.resolveDone();
    await driver.close();
  });

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

  it('keeps concurrent Claude conversations isolated by agent and session', async () => {
    const transport = createConcurrentFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const secondAgent: Agent = {
      ...agent,
      id: 'agent-claude-second',
      name: 'Claude Second',
      folder: '/Users/nbonamy/src/second',
    };
    const events: Array<{ agentId?: string; backendSessionId?: string; type: string; payload: unknown }> = [];
    driver.onEvent((event) => events.push(unwrapClaudeConversationEvent(event)));

    const firstSend = driver.sendPrompt(agent, 'first prompt');
    const secondSend = driver.sendPrompt(secondAgent, 'second prompt');
    transport.emit(agent.id, { type: 'system', subtype: 'init', session_id: 'session-first' });
    transport.emit(secondAgent.id, { type: 'system', subtype: 'init', session_id: 'session-second' });
    await Promise.all([firstSend, secondSend]);
    events.length = 0;

    transport.emit(agent.id, {
      type: 'assistant',
      session_id: 'session-first',
      message: { content: [{ type: 'text', text: 'first answer' }] },
    });
    transport.emit(secondAgent.id, {
      type: 'assistant',
      session_id: 'session-second',
      message: { content: [{ type: 'text', text: 'second answer' }] },
    });

    expect(events.filter((event) => event.type === 'message.delta')).toStrictEqual([
      expect.objectContaining({
        agentId: agent.id,
        backendSessionId: 'session-first',
        payload: { delta: 'first answer' },
      }),
      expect.objectContaining({
        agentId: secondAgent.id,
        backendSessionId: 'session-second',
        payload: { delta: 'second answer' },
      }),
    ]);
  });

  it('does not create another user row when delivery marks the prompt as already submitted', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const events: unknown[] = [];
    driver.onEvent((event) => events.push(unwrapClaudeConversationEvent(event)));

    const send = driver.sendPrompt(agent, 'retry me', { recordUserMessage: false });
    transport.emit({ type: 'system', subtype: 'init', session_id: 'claude-session-retry' });
    await send;

    expect(events).not.toContainEqual(expect.objectContaining({ type: 'message.userSubmitted' }));
  });

  it('routes Claude compact commands and publishes context usage and compaction lifecycle', async () => {
    const transport = createFakeTransport();
    transport.getContextUsage.mockResolvedValue({
      totalTokens: 44_000,
      maxTokens: 200_000,
      percentage: 22,
    });
    const driver = new ClaudeBackendDriver(transport);
    const events: Array<{ type?: string; turnId?: string; payload?: unknown }> = [];
    driver.onEvent((event) => events.push(unwrapClaudeConversationEvent(event)));

    const compactResult = driver.tryHandlePromptCommand(agent, '/compact keep the decisions');
    expect(compactResult).not.toBeNull();
    expect(transport.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '/compact keep the decisions',
    }), expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function));
    expect(driver.tryHandlePromptCommand(agent, '/review')).toBeNull();

    transport.emit({ type: 'system', subtype: 'init', session_id: 'claude-context-session' });
    await compactResult;
    transport.emit({
      type: 'system',
      subtype: 'status',
      status: 'compacting',
      session_id: 'claude-context-session',
    });
    transport.emit({
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: { trigger: 'manual', pre_tokens: 180_000, post_tokens: 44_000 },
      session_id: 'claude-context-session',
    });
    transport.emit({
      type: 'system',
      subtype: 'status',
      status: null,
      compact_result: 'success',
      session_id: 'claude-context-session',
    });
    transport.emit({ type: 'result', subtype: 'success', session_id: 'claude-context-session', is_error: false });

    await vi.waitFor(() => expect(transport.getContextUsage).toHaveBeenCalled());
    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
      type: 'conversation.contextUsageUpdated',
      payload: {
        contextUsage: {
          totalTokens: 44_000,
          inputTokens: 44_000,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          lastTotalTokens: 44_000,
          modelContextWindow: 200_000,
          usedPercent: 22,
        },
      },
    })));
    expect(events.filter((event) => event.type === 'context.compactionStarted')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'context.compactionCompleted')).toHaveLength(1);
  });

  it('resumes persisted Claude sessions and interrupts active turns', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const events: unknown[] = [];
    driver.onEvent((event) => events.push(unwrapClaudeConversationEvent(event)));
    const persistedAgent: Agent = {
      ...agent,
      backendSession: { kind: 'claude', sessionId: 'claude-session-existing', transport: 'stdio' },
    };

    const sendResult = await driver.sendPrompt(persistedAgent, 'continue');
    expect(transport.startTurn.mock.calls[0]?.[0]).toMatchObject({
      sessionId: 'claude-session-existing',
    });
    expect(sendResult.backendSession).toStrictEqual({ kind: 'claude', sessionId: 'claude-session-existing', transport: 'stdio' });
    transport.emitPermissionRequest({
      kind: 'confirm_tool',
      id: 'request-interrupted',
      toolName: 'Bash',
      input: { command: 'npm test' },
      allowConversation: false,
      allowAlways: false,
    });

    await expect(driver.interrupt(persistedAgent)).resolves.toStrictEqual({
      backendSession: { kind: 'claude', sessionId: 'claude-session-existing', transport: 'stdio' },
      turnId: sendResult.turnId,
    });
    expect(transport.lastHandle.interrupt).toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({
      agentId: persistedAgent.id,
      turnId: sendResult.turnId,
      type: 'clientRequest.resolved',
      payload: { id: 'request-interrupted' },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      turnId: sendResult.turnId,
      type: 'turn.completed',
      payload: { turn: { id: sendResult.turnId, status: 'interrupted' } },
    }));
  });

  it('uses persisted Claude model and effort defaults and keeps them on the session', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const configuredAgent: Agent = {
      ...agent,
      backendDefaults: {
        kind: 'claude',
        model: 'haiku',
        reasoningEffort: 'low',
      },
    };

    const sendResult = driver.sendPrompt(configuredAgent, 'use my defaults');
    expect(transport.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      model: 'haiku',
      effort: 'low',
    }), expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function));

    transport.emit({ type: 'system', subtype: 'init', session_id: 'claude-session-defaults' });
    await expect(sendResult).resolves.toStrictEqual({
      backendSession: {
        kind: 'claude',
        sessionId: 'claude-session-defaults',
        transport: 'stdio',
        model: 'haiku',
        reasoningEffort: 'low',
      },
      turnId: expect.stringMatching(/^claude-turn-/),
    });
  });

  it('lists the Claude model aliases used by the CLI', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);

    await expect(driver.listModels(agent)).resolves.toStrictEqual([
      {
        id: 'opus',
        model: 'opus',
        displayName: 'Opus',
      },
      {
        id: 'sonnet',
        model: 'sonnet',
        displayName: 'Sonnet',
        isDefault: true,
      },
      {
        id: 'haiku',
        model: 'haiku',
        displayName: 'Haiku',
      },
    ]);
  });

  it('discovers the available Claude models before the first prompt', async () => {
    const transport = createFakeTransport();
    transport.discoverModels.mockResolvedValue([{
      value: 'claude-fable-1',
      resolvedModel: 'claude-fable-1-20260810',
      displayName: 'Fable',
      description: 'Experimental coding model',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium'],
      supportsFastMode: true,
    }]);
    const driver = new ClaudeBackendDriver(transport);

    await expect(driver.listModels(agent)).resolves.toEqual([expect.objectContaining({
      id: 'claude-fable-1',
      displayName: 'Fable',
      providerMetadata: { resolvedModel: 'claude-fable-1-20260810' },
      serviceTiers: [{ id: 'fast', name: 'Fast', description: expect.any(String) }],
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: expect.any(String) },
        { reasoningEffort: 'medium', description: expect.any(String) },
      ],
    })]);
    expect(transport.discoverModels).toHaveBeenCalledWith({ cwd: agent.folder });
    expect(driver.getCapabilities(agent)).toMatchObject({ reasoningEffort: true, serviceTier: true });
  });

  it('publishes the live Agent SDK model catalog and supported reasoning efforts after initialization', async () => {
    const transport = createFakeTransport();
    transport.listModels.mockResolvedValue([{
      value: 'claude-sonnet-4-5',
      displayName: 'Sonnet 4.5',
      description: 'Balanced for coding',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'high'],
    }]);
    const driver = new ClaudeBackendDriver(transport);
    const events: unknown[] = [];
    driver.onEvent((event) => events.push(unwrapClaudeConversationEvent(event)));

    const started = driver.sendPrompt(agent, 'hello', { selection: { reasoningEffort: 'high' } });
    expect(transport.startTurn).toHaveBeenCalledWith(expect.objectContaining({ effort: 'high' }), expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function));
    transport.emit({ type: 'system', subtype: 'init', session_id: 'claude-session-catalog' });
    await started;
    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
      type: 'models.changed',
      payload: {
        models: [expect.objectContaining({
          id: 'claude-sonnet-4-5',
          supportedReasoningEfforts: [
            { reasoningEffort: 'low', description: expect.any(String) },
            { reasoningEffort: 'high', description: expect.any(String) },
          ],
          defaultReasoningEffort: 'high',
        })],
      },
    })));
    expect(driver.getCapabilities(agent)).toMatchObject({ reasoningEffort: true });
    await expect(driver.listModels(agent)).resolves.toEqual([expect.objectContaining({ id: 'claude-sonnet-4-5' })]);
  });

  it('releases an idle live query when the agent starts a different conversation', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);

    const first = driver.sendPrompt(agent, 'first conversation');
    transport.emit({ type: 'system', subtype: 'init', session_id: 'claude-session-first' });
    await first;
    transport.emit({ type: 'result', subtype: 'success', session_id: 'claude-session-first', is_error: false });

    const second = driver.sendPrompt(agent, 'new conversation');
    expect(transport.closeSession).toHaveBeenCalledWith('claude-session-first');
    await vi.waitFor(() => expect(transport.startTurn).toHaveBeenCalledTimes(2));
    transport.emit({ type: 'system', subtype: 'init', session_id: 'claude-session-second' });
    await second;
    transport.emit({ type: 'result', subtype: 'success', session_id: 'claude-session-second', is_error: false });
    driver.releaseConversation(agent.id);
    expect(transport.closeSession).toHaveBeenLastCalledWith('claude-session-second');
  });

  it(`preserves Claude transcripts when a ${product.name} agent retires its conversation`, async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);

    expect(transport.closeSession).not.toHaveBeenCalled();
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

  it('normalizes startup failures and an early clean exit before Claude reports a session', async () => {
    const missingTransport = createFakeTransport();
    const missingDriver = new ClaudeBackendDriver(missingTransport);
    const missing = missingDriver.sendPrompt(agent, 'missing executable');
    missingTransport.rejectDone(new Error('spawn claude ENOENT'));
    await expect(missing).rejects.toThrow('Claude Code CLI was not found');

    const earlyTransport = createFakeTransport();
    const earlyDriver = new ClaudeBackendDriver(earlyTransport);
    const early = earlyDriver.sendPrompt(agent, 'exit early');
    earlyTransport.resolveDone();
    await expect(early).rejects.toThrow('exited before reporting a session id');
  });

  it('unsubscribes listeners and closes active persisted turns', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const listener = vi.fn();
    const unsubscribe = driver.onEvent(listener);
    unsubscribe();
    const persistedAgent: Agent = {
      ...agent,
      backendSession: { kind: 'claude', sessionId: 'claude-session-existing', transport: 'stdio' },
    };

    await driver.sendPrompt(persistedAgent, 'keep working');
    await driver.close();

    expect(transport.lastHandle.interrupt).toHaveBeenCalledOnce();
    expect(transport.close).toHaveBeenCalledOnce();
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

  it('deletes the stored Claude session of an agent, from its own folder, and ignores an agent without one', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const chat = {
      id: 'agent-chat', name: null, folder: null, sessionKind: 'quickChat', backend: 'claude',
      backendSession: { kind: 'claude', sessionId: 'session-chat', transport: 'stdio' },
      status: { type: 'idle' }, createdAt: 'now', updatedAt: 'now',
    } as unknown as Agent;

    await driver.deleteAgentConversation(chat);
    expect(transport.deleteSession).toHaveBeenCalledExactlyOnceWith('session-chat', homedir());

    await driver.deleteAgentConversation({ ...chat, backendSession: undefined });
    expect(transport.deleteSession).toHaveBeenCalledOnce();
  });

  it('maps Agent SDK permission requests through the app-owned approval contract', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const events: Array<{ type?: string; turnId?: string; payload?: unknown }> = [];
    driver.onEvent((event) => events.push(unwrapClaudeConversationEvent(event)));

    const sendResult = driver.sendPrompt(agent, 'edit the file');
    transport.emit({ type: 'system', subtype: 'init', session_id: 'claude-session-approval' });
    const turnId = (await sendResult).turnId;
    transport.emitPermissionRequest({
      kind: 'confirm_tool',
      id: 'tool-edit-1',
      toolName: 'Edit',
      input: { file_path: '/tmp/project/a.ts' },
      title: 'Claude wants to edit a.ts',
      displayName: 'Edit file',
      description: 'Claude will modify a.ts.',
      allowConversation: true,
      allowAlways: false,
    });

    expect(events).toContainEqual(expect.objectContaining({
      type: 'approval.requested',
      turnId,
      payload: {
        id: 'tool-edit-1',
        kind: 'confirm_tool',
        payload: {
          confirmation: {
            argumentsPreview: '{\n  "file_path": "/tmp/project/a.ts"\n}',
            integrationId: 'claude',
            integrationName: 'Claude',
            summary: 'Edit file /tmp/project/a.ts?',
            toolName: 'Edit',
            allowConversation: true,
            allowAlways: false,
          },
        },
      },
    }));

    transport.respondToPermissionRequest.mockResolvedValueOnce(undefined);
    await driver.respondToAgentRequest({
      id: 'tool-edit-1',
      outcome: { kind: 'decision', decision: 'allow_conversation' },
    });
    expect(transport.respondToPermissionRequest).toHaveBeenCalledWith('tool-edit-1', { decision: 'allow_conversation' }, agent.id);
    expect(events).toContainEqual(expect.objectContaining({
      agentId: 'agent-claude',
      backendSessionId: 'claude-session-approval',
      type: 'clientRequest.resolved',
      turnId,
      payload: { id: 'tool-edit-1' },
    }));
  });

  it('maps Claude AskUserQuestion through the app-owned question contract', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const events: Array<{ type?: string; turnId?: string; payload?: unknown }> = [];
    driver.onEvent((event) => events.push(unwrapClaudeConversationEvent(event)));

    const sendResult = driver.sendPrompt(agent, 'clarify first');
    transport.emit({ type: 'system', subtype: 'init', session_id: 'claude-session-question' });
    const turnId = (await sendResult).turnId;
    transport.emitPermissionRequest({
      kind: 'ask_user',
      id: 'request-question-1',
      toolName: 'AskUserQuestion',
      input: { questions: [] },
      allowConversation: false,
      allowAlways: false,
      questions: [{
        id: 'Which approach?',
        header: 'Approach',
        question: 'Which approach?',
        isOther: true,
        isSecret: false,
        options: [{ label: 'Simple', description: 'Small change.' }],
      }],
    });

    expect(events).toContainEqual(expect.objectContaining({
      type: 'toolInput.requested',
      turnId,
      payload: {
        id: 'request-question-1',
        kind: 'ask_user',
        payload: {
          request: {
            itemId: 'request-question-1',
            questions: [{
              id: 'Which approach?',
              header: 'Approach',
              question: 'Which approach?',
              isOther: true,
              isSecret: false,
              options: [{ label: 'Simple', description: 'Small change.' }],
            }],
          },
        },
      },
    }));

    transport.respondToPermissionRequest.mockResolvedValueOnce(undefined);
    const answers = { 'Which approach?': { answers: ['Simple'] } };
    await driver.respondToAgentRequest({ id: 'request-question-1', outcome: { kind: 'answered', answers } });
    expect(transport.respondToPermissionRequest).toHaveBeenCalledWith('request-question-1', { answers }, agent.id);
  });

  it.each(['before', 'during'] as const)('keeps live tool calls and answer together when history loading starts %s the turn', async (loadTiming) => {
    const transport = createFakeTransport();
    const session = { kind: 'claude' as const, sessionId: 'claude-session-existing', transport: 'stdio' as const };
    const persistedAgent = { ...agent, backendSession: session };
    const tool = { type: 'tool_use' as const, id: 'git-log', name: 'Bash', input: { command: 'git log -10' } };
    const messages = claudeTranscriptToRendererMessages([
      { type: 'user', uuid: 'prompt-history', message: { content: 'Summarize commits' } },
      { type: 'assistant', message: { content: [tool] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: tool.id, content: '10 commits' }] } },
    ].map((message) => JSON.stringify(message)).join('\n'), agent.id, session.sessionId);
    let resolveHistory!: (history: { backendSession: typeof session; messages: typeof messages }) => void;
    const history = new Promise<{ backendSession: typeof session; messages: typeof messages }>((resolve) => { resolveHistory = resolve; });
    const driver = new ClaudeBackendDriver(transport, () => history);
    let replica: ClaudeConversationReplica | undefined;
    driver.onEvent((event) => {
      if (event.type === 'claude.conversationSnapshotChanged') replica = createClaudeConversationReplica(event.payload.snapshot);
      if (event.type === 'claude.conversationEventReceived') replica!.apply(event.payload.event);
    });

    try {
      let loading = loadTiming === 'before' ? driver.loadConversation(persistedAgent) : undefined;
      const started = await driver.sendPrompt(persistedAgent, 'Summarize commits');
      transport.emit({ type: 'assistant', session_id: session.sessionId, message: { content: [tool] } });
      transport.emit({ type: 'user', session_id: session.sessionId, message: { content: [{ type: 'tool_result', tool_use_id: tool.id, content: '10 commits' }] } });
      loading ??= driver.loadConversation(persistedAgent);
      resolveHistory({ backendSession: session, messages });
      await loading;

      transport.emit({ type: 'stream_event', session_id: session.sessionId, event: {
        type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'All 10 commits landed today.' },
      } });
      expect(replica!.getSnapshot().messages.filter((message) => message.role === 'assistant')).toMatchObject([{
        turnId: started.turnId,
        status: 'streaming',
        parts: [{ type: 'tool', id: tool.id, status: 'completed' }, { type: 'text', text: 'All 10 commits landed today.' }],
      }]);
      expect(replica!.getSnapshot()).toMatchObject({ busy: true, activeTurnId: started.turnId });
      transport.emit({ type: 'result', subtype: 'success', session_id: session.sessionId, is_error: false });
      expect(replica!.getSnapshot().messages.filter((message) => message.role === 'assistant')).toMatchObject([{
        turnId: started.turnId, status: 'complete', parts: [{ type: 'tool', id: tool.id }, { type: 'text', text: 'All 10 commits landed today.' }],
      }]);
      const completed = replica!.getSnapshot();
      await driver.loadConversation(persistedAgent);
      expect(replica!.getSnapshot()).toStrictEqual(completed);
    } finally {
      await driver.close();
    }
  });

  it('hydrates persisted Claude transcript history through the driver', async () => {
    const transport = createFakeTransport();
    transport.readContextUsage.mockResolvedValueOnce({
      totalTokens: 33_120,
      maxTokens: 200_000,
      percentage: 16.56,
    });
    const driver = new ClaudeBackendDriver(transport, async () => ({
      backendSession: { kind: 'claude', sessionId: 'claude-session-existing', transcriptSessionId: 'claude-session-existing', transport: 'stdio' },
      messages: [
        {
          id: 'user-claude-session-existing-user-1',
          agentId: 'agent-claude',
          role: 'user',
          status: 'complete',
          turnId: 'claude-prompt-1',
          createdAt: '2026-06-06T22:33:42.809Z',
          parts: [{ type: 'text', text: 'hello' }],
        },
      ],
    }));
    const events: unknown[] = [];
    driver.onEvent((event) => events.push(unwrapClaudeConversationEvent(event)));
    const persistedAgent: Agent = {
      ...agent,
      backendSession: { kind: 'claude', sessionId: 'claude-session-existing', transport: 'stdio' },
    };

    await expect(driver.loadConversation(persistedAgent)).resolves.toStrictEqual({
      kind: 'claude',
      sessionId: 'claude-session-existing',
      transcriptSessionId: 'claude-session-existing',
      transport: 'stdio',
    });
    await vi.waitFor(() => expect(transport.readContextUsage).toHaveBeenCalledOnce());
    expect(transport.readContextUsage).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'agent-claude',
      cwd: '/Users/nbonamy/src/agent-workspace',
      sessionId: 'claude-session-existing',
    }));
    expect(transport.readContextUsage.mock.calls[0]?.[0]).not.toHaveProperty('prompt');
    await vi.waitFor(() => expect(events).toHaveLength(3));
    expect(events).toStrictEqual([
      expect.objectContaining({
        agentId: 'agent-claude',
        backend: 'claude',
        type: 'claude.conversationSnapshotChanged',
        payload: {
          revision: 1,
          snapshot: expect.objectContaining({
            sessionId: 'claude-session-existing',
            messages: [expect.objectContaining({
              id: 'user-claude-session-existing-user-1',
              parts: [{ type: 'text', text: 'hello' }],
            })],
          }),
        },
      }),
      expect.objectContaining({
        agentId: 'agent-claude',
        backend: 'claude',
        backendSessionId: 'claude-session-existing',
        threadId: 'claude-session-existing',
        type: 'conversation.contextUsageUpdated',
        payload: {
          contextUsage: {
            totalTokens: 33_120,
            inputTokens: 33_120,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            lastTotalTokens: 33_120,
            modelContextWindow: 200_000,
            usedPercent: 16.56,
          },
        },
      }),
      expect.objectContaining({
        agentId: 'agent-claude',
        backend: 'claude',
        type: 'context.usageUpdated',
        backendSessionId: 'claude-session-existing',
        payload: { contextUsage: expect.objectContaining({ totalTokens: 33_120 }) },
      }),
    ]);
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

  it('resumes Claude conversations from transcript refs', async () => {
    const transport = createFakeTransport();
    transport.readContextUsage.mockResolvedValueOnce({
      totalTokens: 12_000,
      maxTokens: 200_000,
      percentage: 6,
    });
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
    const events: unknown[] = [];
    driver.onEvent((event) => events.push(unwrapClaudeConversationEvent(event)));

    await expect(driver.resumeConversation(agent, {
      ref: {
        backend: 'claude',
        folder: '/Users/nbonamy/src/agent-workspace',
        sessionId: 'claude-session-existing',
      },
      storageState: 'active',
    })).resolves.toStrictEqual({
      backendSession: { kind: 'claude', sessionId: 'claude-session-existing', transcriptSessionId: 'claude-session-existing', transport: 'stdio' },
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'claude.conversationSnapshotChanged',
      payload: expect.objectContaining({
        snapshot: expect.objectContaining({ messages }),
      }),
    }));
    expect(historyLoader).toHaveBeenCalledWith(expect.objectContaining({
      id: 'agent-claude',
      folder: '/Users/nbonamy/src/agent-workspace',
      backendSession: {
        kind: 'claude',
        sessionId: 'claude-session-existing',
        transport: 'stdio',
      },
    }), { recent: true });
    await vi.waitFor(() => expect(transport.readContextUsage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'claude-session-existing',
    })));
    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
      type: 'conversation.contextUsageUpdated',
      threadId: 'claude-session-existing',
      payload: { contextUsage: expect.objectContaining({ totalTokens: 12_000, usedPercent: 6 }) },
    })));
  });

  it('rejects Claude conversation refs from another folder', async () => {
    const transport = createFakeTransport();
    const historyLoader = vi.fn();
    const driver = new ClaudeBackendDriver(transport, historyLoader);

    await expect(driver.resumeConversation(agent, {
      ref: {
        backend: 'claude',
        folder: '/Users/nbonamy/src/id8',
        sessionId: 'claude-session-existing',
      },
      storageState: 'active',
    })).rejects.toThrow('Claude conversation folder does not match the agent folder.');
    expect(historyLoader).not.toHaveBeenCalled();
  });

  it('maps plan mode to the Agent SDK plan permission mode without changing the prompt text', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const sendResult = driver.sendPrompt(agent, 'build the thing', { planMode: true });

    expect(transport.startTurn.mock.calls[0]?.[0]).toMatchObject({
      prompt: 'build the thing',
      permissionMode: 'plan',
    });

    transport.emit({ type: 'system', subtype: 'init', session_id: 'claude-session-plan' });
    await expect(sendResult).resolves.toMatchObject({
      backendSession: { kind: 'claude', sessionId: 'claude-session-plan', transport: 'stdio' },
    });
  });

  it('passes provider-neutral attachment descriptors to the Claude transport', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const attachments = [{ type: 'file' as const, path: '/tmp/report.txt', name: 'report.txt' }];

    const sendResult = driver.sendPrompt(agent, 'review this', { attachments });

    expect(transport.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'review this', attachments }),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    );
    transport.emit({ type: 'system', subtype: 'init', session_id: 'claude-session-attachments' });
    await expect(sendResult).resolves.toMatchObject({
      backendSession: { kind: 'claude', sessionId: 'claude-session-attachments' },
    });
  });

  it('maps Claude plan-mode tool flow into app-owned proposed plan events', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const events: Array<{ type?: string; turnId?: string; threadId?: string; payload?: unknown }> = [];
    driver.onEvent((event) => events.push(unwrapClaudeConversationEvent(event)));

    const sendResult = driver.sendPrompt(agent, 'draft the plan', { planMode: true });
    transport.emit({ type: 'system', subtype: 'init', session_id: 'claude-session-plan' });
    const turnId = (await sendResult).turnId;

    transport.emit({
      type: 'system',
      subtype: 'status',
      session_id: 'claude-session-plan',
      permissionMode: 'plan',
    });
    transport.emit({
      type: 'stream_event',
      session_id: 'claude-session-plan',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tool-search-plan', name: 'ToolSearch', input: {} },
      },
    });
    transport.emit({
      type: 'stream_event',
      session_id: 'claude-session-plan',
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'write-plan', name: 'Write', input: {} },
      },
    });
    const writeInput = JSON.stringify({
      file_path: '/Users/nbonamy/.claude/plans/test-plan.md',
      content: '# Draft Plan\n\n- inspect\n',
    });
    transport.emit({
      type: 'stream_event',
      session_id: 'claude-session-plan',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: writeInput.slice(0, 30) },
      },
    });
    transport.emit({
      type: 'stream_event',
      session_id: 'claude-session-plan',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: writeInput.slice(30) },
      },
    });
    transport.emit({
      type: 'assistant',
      session_id: 'claude-session-plan',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'exit-plan',
            name: 'ExitPlanMode',
            input: {
              plan: '# Final Plan\n\n- inspect\n- implement\n',
              planFilePath: '/Users/nbonamy/.claude/plans/test-plan.md',
            },
          },
        ],
      },
    });

    expect(events).toContainEqual(expect.objectContaining({
      type: 'conversation.modeUpdated',
      turnId,
      threadId: 'claude-session-plan',
      payload: {
        mode: 'plan',
        permissionMode: 'plan',
      },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'turn.proposedPlanDelta',
      turnId,
      threadId: 'claude-session-plan',
      payload: {
        itemId: 'write-plan',
        delta: '# Draft Plan\n\n- inspect\n',
      },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'turn.proposedPlanCompleted',
      turnId,
      threadId: 'claude-session-plan',
      payload: {
        itemId: 'exit-plan',
        markdown: '# Final Plan\n\n- inspect\n- implement',
      },
    }));
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'item.started',
      payload: expect.objectContaining({
        toolPart: expect.objectContaining({
          title: expect.stringMatching(/EnterPlanMode|ExitPlanMode|ToolSearch|Write/),
        }),
      }),
    }));
  });

  it('streams partial text deltas and suppresses the duplicate final assistant text', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const events: Array<{ type?: string; payload?: unknown }> = [];
    driver.onEvent((event) => events.push(unwrapClaudeConversationEvent(event)));

    const sendResult = driver.sendPrompt(agent, 'stream please');
    transport.emit({ type: 'system', subtype: 'init', session_id: 'claude-session-stream' });
    const turnId = (await sendResult).turnId;

    transport.emit({
      type: 'stream_event',
      session_id: 'claude-session-stream',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hello' },
      },
    });
    transport.emit({
      type: 'stream_event',
      session_id: 'claude-session-stream',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: ' world' },
      },
    });
    transport.emit({
      type: 'assistant',
      session_id: 'claude-session-stream',
      message: {
        content: [{ type: 'text', text: 'Hello world' }],
      },
    });

    expect(events.filter((event) => event.type === 'message.delta')).toStrictEqual([
      expect.objectContaining({
        turnId,
        payload: { delta: 'Hello' },
      }),
      expect.objectContaining({
        turnId,
        payload: { delta: ' world' },
      }),
    ]);
  });

  it('streams tool-use starts and input deltas before final assistant messages', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const events: Array<{ type?: string; turnId?: string; payload?: unknown }> = [];
    driver.onEvent((event) => events.push(unwrapClaudeConversationEvent(event)));

    const sendResult = driver.sendPrompt(agent, 'run tests');
    transport.emit({ type: 'system', subtype: 'init', session_id: 'claude-session-tools' });
    const turnId = (await sendResult).turnId;

    transport.emit({
      type: 'stream_event',
      session_id: 'claude-session-tools',
      event: {
        type: 'content_block_start',
        index: 2,
        content_block: {
          type: 'tool_use',
          id: 'tool-streamed',
          name: 'Bash',
          input: {},
        },
      },
    });
    transport.emit({
      type: 'stream_event',
      session_id: 'claude-session-tools',
      event: {
        type: 'content_block_delta',
        index: 2,
        delta: {
          type: 'input_json_delta',
          partial_json: '{"command":"npm test"}',
        },
      },
    });
    transport.emit({
      type: 'assistant',
      session_id: 'claude-session-tools',
      message: {
        content: [
          { type: 'tool_use', id: 'tool-streamed', name: 'Bash', input: { command: 'npm test' } },
        ],
      },
    });

    expect(events).toContainEqual(expect.objectContaining({
      turnId,
      type: 'item.started',
      payload: {
        toolPart: expect.objectContaining({
          id: 'tool-streamed',
          kind: 'command',
          title: 'Bash',
          status: 'running',
          input: { cwd: '/Users/nbonamy/src/agent-workspace' },
        }),
      },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      turnId,
      type: 'item.updated',
      payload: expect.objectContaining({
        itemId: 'tool-streamed',
        title: 'npm test',
        statusText: JSON.stringify({
          source: 'claude',
          action: 'run',
          phase: 'running',
          params: { target: 'npm test' },
        }),
        input: { command: 'npm test', cwd: '/Users/nbonamy/src/agent-workspace' },
      }),
    }));
  });

  it('emits semantic file activity and completes file tool status', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const events: Array<{ type?: string; turnId?: string; payload?: unknown }> = [];
    driver.onEvent((event) => events.push(unwrapClaudeConversationEvent(event)));

    const sendResult = driver.sendPrompt(agent, 'edit the readme');
    transport.emit({ type: 'system', subtype: 'init', session_id: 'claude-session-files' });
    const turnId = (await sendResult).turnId;

    transport.emit({
      type: 'assistant',
      session_id: 'claude-session-files',
      message: {
        content: [{
          type: 'tool_use',
          id: 'tool-edit',
          name: 'Edit',
          input: {
            file_path: '/workspace/project/README.md',
            old_string: 'Old title',
            new_string: 'New title\nNew subtitle',
          },
        }],
      },
    });
    transport.emit({
      type: 'user',
      session_id: 'claude-session-files',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-edit',
          content: 'Updated README.md',
        }],
      },
    });

    expect(events).toContainEqual(expect.objectContaining({
      type: 'item.started',
      turnId,
      payload: {
        toolPart: expect.objectContaining({
          id: 'tool-edit',
          kind: 'fileChange',
          title: '1 file change',
          statusText: JSON.stringify({
            source: 'claude',
            action: 'edit',
            phase: 'running',
            params: { target: 'README.md', addedLines: 2, removedLines: 1 },
          }),
        }),
      },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'item.updated',
      turnId,
      payload: expect.objectContaining({
        itemId: 'tool-edit',
        status: 'completed',
        statusText: JSON.stringify({
          source: 'claude',
          action: 'edit',
          phase: 'completed',
          params: { target: 'README.md', addedLines: 2, removedLines: 1 },
        }),
      }),
    }));
    expect(events.filter((event) => event.type === 'workspace.fileActivityDetected')).toStrictEqual([
      expect.objectContaining({
        turnId,
        payload: {
          messageId: `assistant-${turnId}`,
          itemId: 'tool-edit',
          path: '/workspace/project/README.md',
          action: 'edit',
          status: 'running',
        },
      }),
      expect.objectContaining({
        turnId,
        payload: {
          messageId: `assistant-${turnId}`,
          itemId: 'tool-edit',
          path: '/workspace/project/README.md',
          action: 'edit',
          status: 'completed',
        },
      }),
    ]);
  });

  it('surfaces Claude result errors once when the process exits non-zero after result', async () => {
    const transport = createFakeTransport();
    const driver = new ClaudeBackendDriver(transport);
    const events: Array<{ type?: string; payload?: unknown }> = [];
    driver.onEvent((event) => events.push(unwrapClaudeConversationEvent(event)));

    const sendResult = driver.sendPrompt(agent, 'hello claude');
    transport.emit({ type: 'system', subtype: 'init', session_id: 'claude-session-1' });
    await sendResult;
    transport.emit({
      type: 'assistant',
      session_id: 'claude-session-1',
      error: 'authentication_failed',
      message: {
        content: [{ type: 'text', text: 'Not logged in · Please run /login' }],
      },
    });
    transport.emit({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'Not logged in · Please run /login',
      session_id: 'claude-session-1',
    });
    transport.rejectDone(new Error('Claude exited (1): Not logged in'));

    const errorEvents = events.filter((event) => event.type === 'error');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]?.payload).toStrictEqual({ message: 'Claude Code is not logged in. Open Claude Code and run /login, then try again.' });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'backend.statusChanged',
      payload: {
        backend: 'claude',
        status: 'error',
        detail: 'Claude Code is not logged in. Open Claude Code and run /login, then try again.',
      },
    }));
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'message.delta',
      payload: { delta: 'Not logged in · Please run /login' },
    }));
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
