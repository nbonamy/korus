import { randomUUID } from 'node:crypto';
import { product } from '@workspace/core/product';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SDKAssistantMessage, SDKPartialAssistantMessage, SDKTaskStartedMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Agent } from '@workspace/core/contracts';
import { createClaudeConversationReplica, type ClaudeConversationReplica } from '@workspace/core/claude-conversation-replica';
import { decodeAppBackendEvent, type AppBackendEvent } from '@workspace/core/backend-protocol/events';
import { getLocalClaudeAuthentication } from '../authentication';
import { ClaudeBackendDriver } from '../claude-driver';
import { ClaudeAgentSdkTransport } from '../agent-sdk-transport';
import { createQueryHarness } from './sdk-query-fixture';
import { AppBackendServer } from '../../server';
import { BackendDriverRpc } from '../../driver-rpc';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';
import { UsageLedger } from '../../usage/usage-ledger';
import { UsageService } from '../../usage/usage-service';
import { TurnClock } from '../../usage/turn-clock';
import { loadPricingHistory } from '../../pricing/catalog';
import type { RequestObservation } from '@workspace/core/usage';
import type { AgentBackendDriver } from '@workspace/core/backend-driver';
import { DatabaseSync } from 'node:sqlite';

vi.mock('@workspace/core/runtime-discovery', () => ({
  resolveRuntimeLaunch: (command: string, env: NodeJS.ProcessEnv | undefined) => ({ command, env: { ...process.env, ...env } }),
}));
vi.mock('../authentication', () => ({ getLocalClaudeAuthentication: vi.fn() }));

function agent(id = 'claude-a'): Agent {
  return { id, name: id, folder: '/tmp/project', teamId: 'team-test', backend: 'claude', status: { type: 'idle' }, createdAt: '', updatedAt: '' };
}

// SDK assistant output is a message-start placeholder; only the stream delta
// below supplies the measured output. Multiple blocks share one message ID.
function requestFixture(id: string, input = 10, read = 199990, write5 = 0, write1 = 0, output = 100,
  model = 'claude-sonnet-4-5', parent: string | null = null, speed: 'standard' | 'fast' = 'standard', region = 'global') {
  const usage: SDKAssistantMessage['message']['usage'] = {
    input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: write5 + write1,
    cache_creation: { ephemeral_5m_input_tokens: write5, ephemeral_1h_input_tokens: write1 },
    output_tokens: 1, service_tier: 'standard', speed, inference_geo: region,
    output_tokens_details: null, server_tool_use: null, iterations: null, fallback_credit: null,
  };
  const message: SDKAssistantMessage['message'] = {
    id, type: 'message', role: 'assistant', model, usage, content: [],
    container: null, context_management: null, diagnostics: null, stop_details: null, stop_reason: null, stop_sequence: null,
  };
  const envelope = { session_id: 'requests', parent_tool_use_id: parent, uuid: randomUUID() };
  const assistant = { ...envelope, type: 'assistant', request_id: `req-${id}`, message } satisfies SDKAssistantMessage;
  const start = { ...envelope, type: 'stream_event', event: { type: 'message_start', message } } satisfies SDKPartialAssistantMessage;
  const delta = { ...envelope, type: 'stream_event', event: {
    type: 'message_delta', context_management: null,
    delta: { stop_reason: 'end_turn' as SDKAssistantMessage['message']['stop_reason'], stop_sequence: null, stop_details: null, container: null },
    usage: { input_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null,
      output_tokens: output, output_tokens_details: { thinking_tokens: Math.min(20, output) } as SDKAssistantMessage['message']['usage']['output_tokens_details'],
      iterations: null, server_tool_use: null, fallback_credit: null },
  } } satisfies SDKPartialAssistantMessage;
  const stop = { ...envelope, type: 'stream_event', event: { type: 'message_stop' } } satisfies SDKPartialAssistantMessage;
  return { assistant, start, delta, stop };
}

describe(`Claude Agent SDK → ${product.name} backend`, () => {
  const servers: AppBackendServer[] = [];
  const homes: string[] = [];
  function setup(withConnections = false, usage?: UsageService, models: Array<Record<string, unknown>> = [], homeDir?: string, env?: NodeJS.ProcessEnv) {
    const sdk = createQueryHarness(models);
    const driver = new ClaudeBackendDriver(new ClaudeAgentSdkTransport({ createQuery: sdk.createQuery, env }), undefined, { homeDir });
    const snapshot = createTestSnapshot();
    snapshot.general.claudeCodeEnabled = true;
    snapshot.agents = [agent(), agent('claude-b')];
    snapshot.teams[0]!.agentIds = snapshot.agents.map((item) => item.id);
    const events: AppBackendEvent[] = [];
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot, usage,
      driverRpc: new BackendDriverRpc(new Map([['claude', driver]])), onEvent: (event) => events.push(event),
      ...(withConnections ? { providerSetup: { isChanging: () => false, list: () => [{ backend: 'claude', installed: true, homePath: '/app/claude' }] } as never } : {}),
    });
    servers.push(server);
    return { sdk, driver, server, snapshot, events, send: (agentId: string, prompt: string) => server.handleMessage({ jsonrpc: '2.0', id: `${agentId}-${prompt}`, method: 'agent/prompt/send', params: { agentId, prompt } }) };
  }
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })));
    vi.unstubAllEnvs();
  });

  it('keeps selected mention identities across submission and native history reload', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'claude-mentions-')); homes.push(home);
    const { sdk, driver, snapshot, events } = setup(false, undefined, [], home);
    const owner = snapshot.agents[0]!;
    const content = [{ type: 'text' as const, text: '$cp vs ' }, { type: 'mention' as const, kind: 'skill' as const, id: '/skills/cp/SKILL.md', label: 'Commit and push', value: 'cp' }];
    const pending = driver.sendPrompt(owner, '$cp vs Commit and push\n\n<context>Keep this host context.</context>', { content });
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    const input = sdk.inputs[0]!;
    expect(input.uuid).toBeTypeOf('string');
    expect(input.message.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text', text: expect.stringContaining('$cp vs [$cp](/skills/cp/SKILL.md)\n\n<context>Keep this host context.</context>') })]));
    const sessionId = randomUUID(); sdk.emit({ type: 'system', subtype: 'init', session_id: sessionId });
    owner.backendSession = (await pending).backendSession;
    const submitted = events.find(event => event.type === 'claude.conversationEventReceived' && event.payload.event.type === 'message.userSubmitted');
    expect(submitted?.type === 'claude.conversationEventReceived' && submitted.payload.event.type === 'message.userSubmitted' && submitted.payload.event.payload.message.metadata?.promptContent).toStrictEqual(content);
    sdk.emit({ type: 'result', subtype: 'success', session_id: sessionId, is_error: false });
    await vi.waitFor(() => expect(events.some(event => event.type === 'claude.conversationEventReceived' && event.payload.event.type === 'turn.completed')).toBe(true));
    await driver.releaseConversation(owner.id);
    const project = path.join(home, '.claude', 'projects', '-tmp-project'); await mkdir(project, { recursive: true });
    await writeFile(path.join(project, `${sessionId}.jsonl`), JSON.stringify({ type: 'user', uuid: input.uuid, message: input.message }) + '\n');
    events.splice(0); await driver.loadConversation(owner);
    const restored = events.find(event => event.type === 'claude.conversationSnapshotChanged');
    expect(restored?.type === 'claude.conversationSnapshotChanged' && restored.payload.snapshot.messages[0]?.metadata?.promptContent).toStrictEqual(content);
    expect(restored?.type === 'claude.conversationSnapshotChanged' && restored.payload.snapshot.messages[0]?.parts).toStrictEqual([{ type: 'text', text: '$cp vs Commit and push' }]);
  });

  it('restores turn timing from native history and preserves a running turn when reloaded', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'korus-claude-timing-'));
    homes.push(home);
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const project = path.join(home, '.claude', 'projects', '-tmp-project');
    await mkdir(project, { recursive: true });
    const startedAt = '2026-10-24T12:00:00.000Z';
    const completedAt = '2026-10-24T12:04:38.000Z';
    const history = [
      { type: 'user', uuid: 'prompt', timestamp: startedAt, message: { content: 'Inspect the project' } },
      { type: 'assistant', uuid: 'work', timestamp: '2026-10-24T12:00:01.000Z', message: { content: 'Looking now.' } },
      { type: 'assistant', uuid: 'answer', timestamp: completedAt, message: { content: 'Finished.' } },
      { type: 'assistant', uuid: 'sidechain', isSidechain: true, timestamp: '2026-10-24T13:00:00.000Z', message: { content: 'Child work' } },
    ];
    await writeFile(path.join(project, `${sessionId}.jsonl`), history.map(row => JSON.stringify(row)).join('\n'));
    const { sdk, driver, snapshot, events, send } = setup(false, undefined, [], home);
    const owner = snapshot.agents[0]!;
    owner.backendSession = { kind: 'claude', sessionId, transport: 'stdio' };
    const read = () => {
      let replica: ClaudeConversationReplica | undefined;
      for (const raw of events) {
        const frame = decodeAppBackendEvent(JSON.parse(JSON.stringify(raw)));
        if (frame.agentId !== owner.id) continue;
        if (frame.type === 'claude.conversationSnapshotChanged') replica = createClaudeConversationReplica(frame.payload.snapshot);
        if (frame.type === 'claude.conversationEventReceived') replica?.apply(frame.payload.event);
      }
      return replica!.getSnapshot();
    };
    await driver.loadConversation(owner);
    expect(read().turns).toStrictEqual([{
      id: 'claude-prompt', status: 'completed', error: null, willRetry: false,
      startedAt, completedAt, durationMs: 278_000,
    }]);
    expect(read().turnIds).toStrictEqual(['claude-prompt']);

    const pending = send(owner.id, 'Continue');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: sessionId });
    await pending;
    const live = read();
    expect(live.turns.at(-1)).toMatchObject({ status: 'inProgress', completedAt: null, durationMs: null });
    await driver.loadConversation(owner);
    expect(read()).toStrictEqual(live);
  });

  it.each([
    ['missing start', undefined, '2026-10-24T12:04:38.000Z'],
    ['invalid start', 'invalid', '2026-10-24T12:04:38.000Z'],
    ['non-string start', 0, '2026-10-24T12:04:38.000Z'],
    ['missing end', '2026-10-24T12:00:00.000Z', undefined],
    ['invalid end', '2026-10-24T12:00:00.000Z', 'invalid'],
    ['non-string end', '2026-10-24T12:00:00.000Z', 2027],
    ['negative duration', '2026-10-24T12:04:38.000Z', '2026-10-24T12:00:00.000Z'],
  ])('leaves restored timing unavailable for %s', async (_label, startedAt, completedAt) => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'korus-claude-timing-'));
    homes.push(home);
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const project = path.join(home, '.claude', 'projects', '-tmp-project');
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, `${sessionId}.jsonl`), [
      { type: 'user', uuid: 'prompt', timestamp: startedAt, message: { content: 'Work' } },
      { type: 'assistant', uuid: 'answer', timestamp: completedAt, message: { content: 'Done' } },
    ].map(row => JSON.stringify(row)).join('\n'));
    const { driver, snapshot, events } = setup(false, undefined, [], home);
    snapshot.agents[0]!.backendSession = { kind: 'claude', sessionId, transport: 'stdio' };
    await driver.loadConversation(snapshot.agents[0]!);
    const restored = [...events].reverse().find(frame => frame.type === 'claude.conversationSnapshotChanged');
    expect(restored?.type === 'claude.conversationSnapshotChanged' && restored.payload.snapshot.turns[0]?.durationMs).toBeNull();
  });

  it.each(['tasks', 'todos'])('projects confirmed native %s into execution plans across completion and history reload', async format => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'korus-claude-tasks-'));
    homes.push(home);
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const { sdk, driver, snapshot, events, send } = setup(false, undefined, [], home);
    const history: object[] = [{ type: 'user', uuid: 'prompt', message: { content: 'Implement login' } }];
    const readPlan = (frames = events) => {
      let replica: ClaudeConversationReplica | undefined;
      for (const raw of frames) {
        const frame = decodeAppBackendEvent(JSON.parse(JSON.stringify(raw)));
        if (frame.agentId !== 'claude-a') continue;
        if (frame.type === 'claude.conversationSnapshotChanged') replica = createClaudeConversationReplica(frame.payload.snapshot);
        if (frame.type === 'claude.conversationEventReceived') replica?.apply(frame.payload.event);
      }
      return replica?.getSnapshot().plan;
    };
    const pending = send('claude-a', 'Implement login');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: sessionId });
    await pending;
    let index = 0;
    const tool = async (name: string, input: object, result: object, failed = false) => {
      const id = `task-tool-${++index}`;
      const call = { type: 'assistant', uuid: `call-${index}`, session_id: sessionId, message: { content: [{ type: 'tool_use', id, name, input }] } };
      const reply = { type: 'user', uuid: `reply-${index}`, session_id: sessionId, tool_use_result: result,
        message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'Native task result', is_error: failed }] } };
      history.push(call, { ...reply, tool_use_result: undefined, toolUseResult: result });
      sdk.emit(call); sdk.emit(reply);
      await vi.waitFor(() => expect(events.some(frame => frame.type === 'claude.conversationEventReceived' && frame.payload.event.type === 'item.updated'
        && frame.payload.event.payload.itemId === id && frame.payload.event.payload.status === (failed ? 'failed' : 'completed'))).toBe(true));
    };
    const todos = (status: string) => ({ todos: [{ content: 'Implement login', status, activeForm: 'Implementing login' }] });
    if (format === 'tasks') await tool('TaskCreate', { subject: 'Implement login', description: 'Login', activeForm: 'Implementing login' }, { task: { id: '7', subject: 'Implement login' } });
    else await tool('TodoWrite', todos('pending'), { newTodos: todos('pending').todos });
    expect(readPlan()).toMatchObject({ kind: 'execution', status: 'inProgress', steps: [{ step: 'Implement login', status: 'pending' }] });
    expect(sdk.options[0]!.env).toMatchObject({ CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' });
    if (format === 'tasks') {
      await tool('TaskList', {}, { tasks: [{ id: '7', subject: 'Implement login', status: 'pending' }, { id: '8', subject: 'Verify login', status: 'pending' }] });
      await tool('TaskGet', { taskId: '8' }, { task: { id: '8', subject: 'Verify login', status: 'completed' } });
      expect(readPlan()?.steps).toStrictEqual([{ step: 'Implement login', status: 'pending' }, { step: 'Verify login', status: 'completed' }]);
      await tool('TaskUpdate', { taskId: '8', status: 'deleted' }, { success: true, taskId: '8', updatedFields: ['status'] });
    }
    if (format === 'tasks') await tool('TaskUpdate', { task_id: '7', status: 'in_progress' }, { success: true, taskId: '7', updatedFields: ['status'] });
    else await tool('TodoWrite', todos('in_progress'), { newTodos: todos('in_progress').todos });
    expect(readPlan()?.steps).toStrictEqual([{ step: 'Implementing login', status: 'inProgress' }]);
    if (format === 'tasks') await tool('TaskUpdate', { taskId: '7', status: 'completed' }, { success: false, taskId: '7', updatedFields: [], error: 'Task locked' });
    else await tool('TodoWrite', todos('completed'), {}, true);
    expect(readPlan()?.steps).toStrictEqual([{ step: 'Implementing login', status: 'inProgress' }]);
    const previousTurnId = readPlan()!.turnId;
    sdk.emit({ type: 'result', subtype: 'success', session_id: sessionId, is_error: false });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    const continuing = send('claude-a', 'Continue login');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(2));
    sdk.emit({ type: 'system', subtype: 'init', session_id: sessionId });
    await continuing;
    history.push({ type: 'user', uuid: 'continue', message: { content: 'Continue login' } });
    expect(readPlan()).toMatchObject({ turnId: expect.not.stringMatching(previousTurnId), steps: [{ step: 'Implementing login', status: 'inProgress' }] });
    const project = path.join(home, '.claude', 'projects', '-tmp-project');
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, `${sessionId}.jsonl`), history.map(entry => JSON.stringify({ timestamp: '2026-10-23T12:00:00Z', ...entry })).join('\n'));
    const restored = setup(false, undefined, [], home);
    restored.snapshot.agents[0]!.backendSession = { kind: 'claude', sessionId, transport: 'stdio' };
    await restored.driver.loadConversation(restored.snapshot.agents[0]!);
    expect(readPlan(restored.events)).toMatchObject({ turnId: 'claude-continue', steps: [{ step: 'Implementing login', status: 'inProgress' }] });
    if (format === 'tasks') await tool('TaskUpdate', { taskId: '7', subject: 'Ship login', status: 'completed' }, { success: true, taskId: '7', updatedFields: ['subject', 'status'] });
    else await tool('TodoWrite', todos('completed'), { newTodos: todos('completed').todos });
    expect(readPlan()).toMatchObject({ status: 'completed', steps: [{ step: format === 'tasks' ? 'Ship login' : 'Implement login', status: 'completed' }] });
    sdk.emit({ type: 'result', subtype: 'success', session_id: sessionId, is_error: false });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    await writeFile(path.join(project, `${sessionId}.jsonl`), history.map(entry => JSON.stringify({ timestamp: '2026-10-23T12:00:00Z', ...entry })).join('\n'));
    await driver.releaseConversation('claude-a');
    events.length = 0;
    await driver.loadConversation(snapshot.agents[0]!);
    expect(readPlan()).toMatchObject({ kind: 'execution', status: 'completed', steps: [{ step: format === 'tasks' ? 'Ship login' : 'Implement login', status: 'completed' }] });
    const next = send('claude-a', 'Clear finished tasks');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(3));
    sdk.emit({ type: 'system', subtype: 'init', session_id: sessionId });
    await next;
    if (format === 'tasks') await tool('TaskUpdate', { taskId: '7', status: 'deleted' }, { success: true, taskId: '7', updatedFields: ['status'] });
    else await tool('TodoWrite', { todos: [] }, { newTodos: [] });
    expect(readPlan()).toBeNull();
  });

  it('discovers native subagents, reads their own sidechain, and retains completion after the parent turn and reload', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'korus-claude-subagents-'));
    homes.push(home);
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const childId = 'a1234567';
    const project = path.join(home, '.claude', 'projects', '-tmp-project');
    await mkdir(path.join(project, sessionId, 'subagents'), { recursive: true });
    const tool = { type: 'tool_use', id: 'spawn-review', name: 'Agent', input: { description: 'Simplify review: reuse', subagent_type: 'general-purpose', prompt: 'Review reuse.' } };
    const line = (entry: object) => JSON.stringify({ sessionId, timestamp: '2026-10-16T12:00:00Z', ...entry });
    await writeFile(path.join(project, `${sessionId}.jsonl`), [
      line({ type: 'user', uuid: 'parent-prompt', message: { content: 'Parent prompt' } }),
      line({ type: 'assistant', uuid: 'parent-call', message: { content: [tool] } }),
      line({ type: 'user', uuid: 'parent-result', toolUseResult: { agentId: childId, status: 'completed' }, message: { content: [{ type: 'tool_result', tool_use_id: tool.id, content: 'Done' }] } }),
    ].join('\n'));
    await writeFile(path.join(project, sessionId, 'subagents', `agent-${childId}.jsonl`), [
      line({ type: 'user', uuid: 'child-prompt', isSidechain: true, message: { content: 'Review reuse.' } }),
      line({ type: 'assistant', uuid: 'child-reply', isSidechain: true, message: { content: [{ type: 'text', text: 'Child-only finding' }] } }),
    ].join('\n'));
    const { sdk, driver, server, snapshot, events, send } = setup(false, undefined, [], home);
    const sending = send('claude-a', 'Parent prompt');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: sessionId });
    await sending;
    sdk.emit({ type: 'assistant', session_id: sessionId, message: { content: [tool] } });
    sdk.emit({ type: 'system', subtype: 'task_started', task_id: childId, tool_use_id: tool.id, description: 'Simplify review: reuse', subagent_type: 'general-purpose', task_type: 'local_agent', session_id: sessionId, uuid: '22222222-2222-4222-8222-222222222222' } satisfies SDKTaskStartedMessage);
    sdk.emit({ type: 'system', subtype: 'task_started', task_id: 'shell-task', tool_use_id: 'shell', description: 'Build project', task_type: 'local_bash', session_id: sessionId, uuid: '33333333-3333-4333-8333-333333333333' } satisfies SDKTaskStartedMessage);
    await vi.waitFor(() => expect(snapshot.subagentTrees['claude-a']?.nodes[childId]).toMatchObject({ status: 'running', agentNickname: 'Simplify review: reuse' }));
    expect(Object.keys(snapshot.subagentTrees['claude-a']!.nodes)).toStrictEqual([childId]);
    expect(snapshot.subagentTrees['claude-b']).toBeUndefined();
    const ref = { backend: 'claude' as const, folder: '/tmp/project', sessionId, subagentId: childId };
    const read = () => server.handleMessage({ jsonrpc: '2.0', id: 'child-history', method: 'agent/conversation/messages/get', params: { agentId: 'claude-a', ref } });
    const history = await read();
    expect(history).toMatchObject({ result: [expect.objectContaining({ role: 'user', parts: [{ type: 'text', text: 'Review reuse.' }] }), expect.objectContaining({ role: 'assistant', parts: [{ type: 'text', text: 'Child-only finding' }] })] });
    expect(await server.handleMessage({ jsonrpc: '2.0', id: 'other-agent', method: 'agent/conversation/messages/get', params: { agentId: 'claude-b', ref } })).toMatchObject({ error: { code: -32603 } });
    for (const subagentId of ['', '../outside']) {
      await expect(driver.readConversationMessages({ ...ref, subagentId }, 'claude-a')).rejects.toThrow('Invalid Claude subagent reference.');
    }
    sdk.emit({ type: 'assistant', session_id: sessionId, parent_tool_use_id: tool.id, message: { content: [{ type: 'text', text: 'Child-only live text' }] } });
    sdk.emit({ type: 'result', subtype: 'success', session_id: sessionId, is_error: false });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    expect(JSON.stringify(await driver.readConversationMessages({ backend: 'claude', folder: '/tmp/project', sessionId }, 'claude-a'))).not.toContain('Child-only live text');
    const lastUpdate = snapshot.subagentTrees['claude-a']!.nodes[childId]!.updatedAt;
    sdk.emit({ type: 'system', subtype: 'task_progress', task_id: childId, tool_use_id: tool.id, description: 'Reviewing files', usage: { total_tokens: 4, tool_uses: 1, duration_ms: 20 }, session_id: sessionId });
    await vi.waitFor(() => expect(snapshot.subagentTrees['claude-a']!.nodes[childId]!.updatedAt).not.toBe(lastUpdate));
    sdk.emit({ type: 'system', subtype: 'task_notification', task_id: childId, tool_use_id: tool.id, status: 'completed', summary: 'Review done', session_id: sessionId });
    await vi.waitFor(() => expect(snapshot.subagentTrees['claude-a']?.nodes[childId]?.status).toBe('completed'));
    for (const event of events.filter(event => event.type.startsWith('subagent.'))) expect(() => decodeAppBackendEvent(JSON.parse(JSON.stringify(event)))).not.toThrow();
    const reloaded = setup(false, undefined, [], home);
    reloaded.snapshot.agents[0]!.backendSession = { kind: 'claude', sessionId, transport: 'stdio' };
    await reloaded.driver.loadConversation(reloaded.snapshot.agents[0]!);
    expect(reloaded.snapshot.subagentTrees['claude-a']?.nodes[childId]).toMatchObject({ status: 'completed', agentNickname: 'Simplify review: reuse' });
    expect(reloaded.sdk.inputs).toHaveLength(0);
  });

  it.each([false, true])('times live Claude output and excludes tools (tool first: %s)', async (toolFirst) => {
    const ledger = new UsageLedger(':memory:');
    await ledger.load();
    let now = 1000;
    const usage = new UsageService(ledger, () => undefined, new TurnClock(() => now), () => now);
    const { sdk, driver, snapshot, events } = setup(false, usage);
    const received = (type: string) => events.some(event => event.type === 'claude.conversationEventReceived' && event.payload.event.type === type);
    const sending = driver.sendPrompt(snapshot.agents[0]!, 'Inspect the project');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'timing', model: 'sonnet' });
    await sending;
    if (!toolFirst) {
      now = 2000;
      sdk.emit({ type: 'assistant', session_id: 'timing', message: { content: [{ type: 'text', text: 'Checking' }] } });
      await vi.waitFor(() => expect(received('message.delta')).toBe(true));
    }
    now = 3000;
    sdk.emit({ type: 'assistant', session_id: 'timing', message: { content: [{ type: 'tool_use', id: 'tool', name: 'Bash', input: { command: 'sleep 10' } }] } });
    await vi.waitFor(() => expect(received('item.started')).toBe(true));
    now = 13000;
    sdk.emit({ type: 'user', session_id: 'timing', message: { content: [{ type: 'tool_result', tool_use_id: 'tool', content: 'done' }] } });
    await vi.waitFor(() => expect(received('item.updated')).toBe(true));
    now = 16000;
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'timing', is_error: false, usage: { input_tokens: 10, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    await vi.waitFor(() => expect(received('turn.completed')).toBe(true));
    await usage.drain();
    expect(ledger.query().rows[0]?.speed).toStrictEqual({
      turns: 1, outputTokens: 40, generationMs: toolFirst ? 3000 : 4000,
      ttftMs: toolFirst ? 2000 : 1000, ttftTurns: 1,
    });
  });

  // Owner-boundary regressions: cache semantics/lifetimes, stream replacement,
  // output placeholders, reroutes, tier/context composition, and durable costs.
  it('prices streamed Claude requests by actual model, context and cache lifetime without charging result totals', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'claude-request-ledger-')); homes.push(folder);
    const file = path.join(folder, 'usage.sqlite');
    const prices = structuredClone(loadPricingHistory());
    prices[0]!.anthropic.find(m => m.id === 'claude-sonnet-4-5')!.cost!.text!.input!.overrides = [
      { when: { context: { gt: 200000 } }, price: 6 },
    ];
    const ledger = new UsageLedger(file, Date.now, prices); await ledger.load();
    const usage = new UsageService(ledger, () => undefined);
    const { sdk, driver, server, snapshot } = setup(false, usage);
    const requests: RequestObservation[] = [];
    (driver as AgentBackendDriver).onRequestUsage?.(e => requests.push(e));
    const sending = driver.sendPrompt(snapshot.agents[0]!, 'CANARY private input', { model: 'selected-alias' });
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'requests', model: 'selected-alias' }); await sending;
    const fixtures = [requestFixture('boundary'), requestFixture('above', 11),
      requestFixture('fast', 100, 8000, 50, 100, 200, 'claude-opus-5-5', null, 'fast', 'us')];
    for (const f of fixtures) { sdk.emit(f.start); sdk.emit(f.assistant); sdk.emit(f.delta); sdk.emit(f.delta); sdk.emit(f.stop); sdk.emit(f.assistant);
      const stale = structuredClone(f.delta); stale.event.usage.output_tokens = 1; stale.event.usage.output_tokens_details = { thinking_tokens: 0 }; sdk.emit(stale); }
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'requests', is_error: false,
      usage: { input_tokens: 121, cache_read_input_tokens: 407980, cache_creation_input_tokens: 150, output_tokens: 400 } });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle')); await usage.drain();
    const cost = { usd: 0.1386, coverage: 'complete', requests: 3, pricedRequests: 3, unpricedRequests: 0, unknownRequestExecutions: 0, reasons: [] };
    expect(ledger.query().cost).toStrictEqual(cost);
    expect(ledger.query().rows[0]!.tokens).toStrictEqual({ input: 408251, output: 400, cacheRead: 407980, cacheWrite: 150, reasoning: null, total: 408651 });
    expect(ledger.query({ group: 'model' }).rows.map(r => [r.label, r.cost?.usd]).sort()).toStrictEqual([
      ['claude-opus-5-5', 0.01551], ['claude-sonnet-4-5', 0.12309], ['selected-alias', null],
    ]);
    const final = requests.filter(r => r.requestId === 'fast').at(-1)!;
    expect(final).toMatchObject({ model: 'claude-opus-5-5', upstreamRequestId: 'req-fast', parentToolUseId: null,
      status: 'final', reportedServiceTier: 'standard', reportedMode: 'fast', requestedServiceTier: null,
      pricingContext: { context: 8250, region: 'us' }, tokens: { input: 100, cacheRead: 8000, cacheWrite: { '5m': 50, '1h': 100 },
        output: 200, reasoning: 20, inputIncludesCacheRead: false, inputIncludesCacheWrite: false, outputIncludesReasoning: true } });
    expect(new Set(requests.filter(r => r.requestId === 'fast').map(r => r.at)).size).toBe(1);
    const db = new DatabaseSync(file); const persisted = db.prepare('SELECT observation FROM requests ORDER BY request_id').all().map(r => JSON.parse(String(r.observation))); db.close();
    expect(persisted).toStrictEqual(['above','boundary','fast'].map(id => requests.filter(r => r.requestId === id).at(-1)));
    expect(JSON.stringify(persisted)).not.toContain('CANARY');
    const response = await server.handleMessage({ jsonrpc: '2.0', id: 'cost', method: 'usage/get', params: {} });
    expect(response).toMatchObject({ result: { cost } });
    const summary = ledger.query(); await usage.close();
    const reopened = new UsageLedger(file, Date.now, prices); await reopened.load();
    expect(reopened.query()).toStrictEqual(summary); await reopened.close();
  });

  it('retains missing SDK evidence instead of pricing placeholders, cache guesses or unreported billing conditions', async () => {
    const ledger = new UsageLedger(':memory:'); await ledger.load();
    const usage = new UsageService(ledger, () => undefined);
    const { sdk, driver, snapshot } = setup(false, usage);
    const requests: RequestObservation[] = []; (driver as AgentBackendDriver).onRequestUsage?.(e => requests.push(e));
    const sending = driver.sendPrompt(snapshot.agents[0]!, 'Work');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1)); sdk.emit({ type: 'system', subtype: 'init', session_id: 'requests' }); await sending;
    sdk.emit(requestFixture('placeholder').assistant);
    const missingCache = requestFixture('missing-cache'); missingCache.start.event.message.usage.cache_creation = null;
    missingCache.start.event.message.usage.cache_creation_input_tokens = 5;
    const missingMode = requestFixture('missing-speed', 0, 0, 0, 0, 0, 'claude-opus-5-5'); missingMode.start.event.message.usage.speed = null;
    const missingTier = requestFixture('missing-tier'); missingTier.start.event.message.usage.service_tier = null;
    for (const f of [missingCache, missingMode, missingTier]) { sdk.emit(f.start); sdk.emit(f.delta); sdk.emit(f.stop); }
    sdk.emit({ type: 'assistant', session_id: 'requests', message: { usage: { input_tokens: 999, output_tokens: 999 } } });
    sdk.emit({ type: 'result', subtype: 'error_during_execution', session_id: 'requests', is_error: true,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    await vi.waitFor(async () => { await usage.drain(); expect(ledger.query().rows[0]?.failed).toBe(1); });
    expect(ledger.query().cost).toStrictEqual({ usd: null, coverage: 'unavailable', requests: 4, pricedRequests: 0, unpricedRequests: 4,
      unknownRequestExecutions: 1, reasons: [ { reason: 'missing-billing-mode', count: 1 }, { reason: 'missing-cache-usage', count: 1 },
        { reason: 'missing-service-tier', count: 1 }, { reason: 'missing-token-usage', count: 1 }, { reason: 'unknown-request-coverage', count: 1 } ] });
    expect(requests.filter(r => r.requestId === 'placeholder').at(-1)?.tokens.output).toBeNull();
    expect(requests.filter(r => r.requestId === 'missing-cache').at(-1)?.tokens.cacheWrite).toBeNull();
    await usage.close();
  });

  it.each([
    ['unknown reasoning split', null],
    ['unknown reasoning category discount', null],
    ['unknown differently priced reasoning', 'missing-token-usage'],
    ['unknown adjusted reasoning', 'missing-token-usage'],
    ['measured zero', null],
    ['contradictory zero cache', 'missing-cache-usage'],
    ['zero cache without lifetime object', null],
    ['inconsistent lifetimes', 'missing-cache-usage'],
    ['unknown model', 'unknown-model'],
    ['missing region', 'missing-pricing-context'],
    ['multiple server iterations', 'unsupported-request-iterations'],
    ['rerouted server iteration', 'unsupported-request-iterations'],
    ['single matching server iteration', null],
    ['unsupported batch tier', 'unsupported-service-tier'],
    ['unsupported priority tier', 'unsupported-service-tier'],
    ['third-party route', 'unknown-provider'],
  ] as const)('keeps %s evidence precise through SDK transport and analytics', async (scenario, reason) => {
    const prices = structuredClone(loadPricingHistory());
    const cost = prices[0]!.anthropic.find(m => m.id === 'claude-sonnet-4-5')!.cost!;
    if (scenario === 'unknown reasoning category discount') cost.multipliers = [{ when: { region: { equals: 'global' } }, factor: { text: { output: { price: 0.5 } } } }];
    if (scenario === 'unknown differently priced reasoning') cost.text!.output!.reasoning = 30;
    if (scenario === 'unknown adjusted reasoning') { cost.text!.output!.reasoning = 15; cost.multipliers = [{ when: { region: { equals: 'global' } }, factor: { text: { output: { reasoning: 2 } } } }]; }
    const ledger = new UsageLedger(':memory:', Date.now, prices); await ledger.load(); const usage = new UsageService(ledger, () => undefined);
    const { sdk, driver, snapshot } = setup(false, usage, [], undefined, scenario === 'third-party route' ? { ANTHROPIC_BASE_URL: 'https://proxy.invalid' } : undefined);
    const requests: RequestObservation[] = []; (driver as AgentBackendDriver).onRequestUsage?.(e => requests.push(e));
    const sending = driver.sendPrompt(snapshot.agents[0]!, 'Work'); await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'requests' }); await sending;
    const f = requestFixture('evidence', scenario === 'measured zero' ? 0 : 10, 0, 0, 0, scenario === 'measured zero' ? 0 : 20);
    if (scenario.startsWith('unknown reasoning') || scenario === 'unknown differently priced reasoning' || scenario === 'unknown adjusted reasoning') f.delta.event.usage.output_tokens_details = null;
    if (scenario === 'contradictory zero cache') f.start.event.message.usage.cache_creation!.ephemeral_1h_input_tokens = 100;
    if (scenario === 'zero cache without lifetime object') f.start.event.message.usage.cache_creation = null;
    if (scenario === 'inconsistent lifetimes') f.start.event.message.usage.cache_creation_input_tokens = 100;
    if (scenario === 'unknown model') f.start.event.message.model = 'unknown-exact-id';
    if (scenario === 'missing region') { f.start.event.message.model = 'claude-sonnet-4-6'; f.start.event.message.usage.inference_geo = null; }
    if (scenario === 'unsupported priority tier') f.start.event.message.usage.service_tier = 'priority';
    if (scenario === 'unsupported batch tier') f.start.event.message.usage.service_tier = 'batch';
    if (scenario === 'multiple server iterations') f.start.event.message.usage.iterations = [
      { type: 'message', model: 'claude-sonnet-4-5', input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
      { type: 'message', model: 'claude-sonnet-4-5', input_tokens: 500000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
    ];
    if (scenario === 'rerouted server iteration' || scenario === 'single matching server iteration') f.start.event.message.usage.iterations = [
      { type: 'message', model: scenario === 'rerouted server iteration' ? 'claude-haiku-4-5' : 'claude-sonnet-4-5', input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
    ];
    // A duplicate/reordered replay of the stream must not reset measured output.
    for (const m of [f.start, f.delta, f.stop, f.start, f.assistant, f.stop]) sdk.emit(m);
    await vi.waitFor(() => expect(requests.at(-1)?.status).toBe('final')); await usage.drain();
    expect(ledger.query().cost).toStrictEqual({ usd: reason ? null : scenario === 'measured zero' ? 0 : scenario === 'unknown reasoning category discount' ? 0.00018 : 0.00033, coverage: reason ? 'unavailable' : 'partial',
      requests: 1, pricedRequests: reason ? 0 : 1, unpricedRequests: reason ? 1 : 0, unknownRequestExecutions: 1,
      reasons: [...(reason ? [{ reason, count: 1 }] : []), { reason: 'unknown-request-coverage', count: 1 }].sort((a,b) => a.reason.localeCompare(b.reason)) });
    if (scenario === 'unknown reasoning split') expect(requests.at(-1)?.tokens.reasoning).toBeNull();
    await usage.close();
  });

  it.each([
    ['project proxy', 'project', { ANTHROPIC_BASE_URL: 'https://proxy.invalid' }, null],
    ['user proxy', 'user', { ANTHROPIC_BASE_URL: 'https://proxy.invalid' }, null],
    ['local Bedrock', 'local', { CLAUDE_CODE_USE_BEDROCK: '1' }, null],
    ['local Vertex', 'local', { CLAUDE_CODE_USE_VERTEX: '1' }, null],
    ['local Foundry', 'local', { CLAUDE_CODE_USE_FOUNDRY: '1' }, null],
    ['direct Anthropic', 'project', { ANTHROPIC_BASE_URL: 'https://api.anthropic.com/' }, 'anthropic'],
  ] as const)('prices %s from SDK settings without assuming a direct provider', async (_name, source, env, provider) => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'claude-pricing-settings-'));
    homes.push(home);
    const config = path.join(home, 'config');
    const cwd = path.join(home, 'project');
    await mkdir(config, { recursive: true });
    await mkdir(path.join(cwd, '.claude'), { recursive: true });
    vi.stubEnv('CLAUDE_CONFIG_DIR', config);
    const settings = source === 'user' ? path.join(config, 'settings.json')
      : path.join(cwd, '.claude', source === 'local' ? 'settings.local.json' : 'settings.json');
    await writeFile(settings, JSON.stringify({ env }));
    const ledger = new UsageLedger(':memory:');
    await ledger.load();
    const usage = new UsageService(ledger, () => undefined);
    try {
      const { sdk, driver, snapshot } = setup(false, usage, [], undefined, {
        ANTHROPIC_BASE_URL: undefined, CLAUDE_CODE_USE_BEDROCK: undefined,
        CLAUDE_CODE_USE_VERTEX: undefined, CLAUDE_CODE_USE_FOUNDRY: undefined,
      });
      snapshot.agents[0]!.folder = cwd;
      const requests: RequestObservation[] = [];
      driver.onRequestUsage(e => requests.push(e));
      const sending = driver.sendPrompt(snapshot.agents[0]!, 'Work');
      await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
      sdk.emit({ type: 'system', subtype: 'init', session_id: 'requests' });
      await sending;
      const fixture = requestFixture('settings-route', 10, 1000, 50, 100, 100);
      for (const event of [fixture.start, fixture.delta, fixture.stop]) sdk.emit(event);
      sdk.emit({ type: 'result', subtype: 'success', session_id: 'requests', is_error: false,
        usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 150, output_tokens: 100 } });
      await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
      await usage.drain();
      expect(requests.at(-1)?.apiProvider).toBe(provider);
      expect(ledger.query().cost).toStrictEqual({
        usd: provider ? 0.0026175 : null, coverage: provider ? 'complete' : 'unavailable',
        requests: 1, pricedRequests: provider ? 1 : 0, unpricedRequests: provider ? 0 : 1,
        unknownRequestExecutions: 0, reasons: provider ? [] : [{ reason: 'unknown-provider', count: 1 }],
      });
    } finally { await usage.close(); }
  });

  it('retains measured streamed usage when interrupted without promoting incomplete output to a final count', async () => {
    const ledger = new UsageLedger(':memory:'); await ledger.load(); const usage = new UsageService(ledger, () => undefined);
    const { sdk, driver, snapshot } = setup(false, usage);
    const requests: RequestObservation[] = []; (driver as AgentBackendDriver).onRequestUsage?.(e => requests.push(e));
    const sending = driver.sendPrompt(snapshot.agents[0]!, 'Work'); await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'requests' }); await sending;
    const measured = requestFixture('measured', 10, 1000, 0, 0, 20);
    for (const m of [measured.start, measured.delta, measured.stop]) sdk.emit(m);
    const incomplete = requestFixture('incomplete', 10, 1000, 0, 0, 5); incomplete.delta.event.delta.stop_reason = null;
    sdk.emit(incomplete.start); sdk.emit(incomplete.delta); sdk.emit(incomplete.assistant);
    await vi.waitFor(() => expect(requests.at(-1)?.upstreamRequestId).toBe('req-incomplete'));
    expect(requests.at(-1)?.tokens.output).toBe(5);
    await driver.interrupt(snapshot.agents[0]!); await usage.drain();
    expect(ledger.query().cost).toStrictEqual({ usd: 0.00063, coverage: 'partial', requests: 2, pricedRequests: 1, unpricedRequests: 1,
      unknownRequestExecutions: 1, reasons: [{ reason: 'provisional-usage', count: 1 }, { reason: 'unknown-request-coverage', count: 1 }] });
    expect(ledger.query().rows[0]).toMatchObject({ started: 1, interrupted: 1, tokens: null });
    await usage.close();
  });

  it('counts measured retries and late subagent requests once under their original parent across a later turn', async () => {
    const ledger = new UsageLedger(':memory:'); await ledger.load(); const usage = new UsageService(ledger, () => undefined);
    const { sdk, driver, snapshot } = setup(false, usage);
    const requests: RequestObservation[] = []; (driver as AgentBackendDriver).onRequestUsage?.(e => requests.push(e));
    const sending = driver.sendPrompt(snapshot.agents[0]!, 'Work'); await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'requests' }); await sending;
    const root = requestFixture('root', 10, 1000, 0, 0, 20);
    root.assistant.message.content = [{ type: 'tool_use', id: 'child-tool', name: 'Agent', input: { description: 'Child' }, caller: { type: 'direct' } }];
    for (const m of [root.start, root.assistant, root.delta, root.stop]) sdk.emit(m);
    const retry = requestFixture('retry', 10, 1000, 0, 0, 20);
    for (const m of [retry.start, retry.delta, retry.stop]) sdk.emit(m);
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'requests', is_error: false,
      usage: { input_tokens: 20, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0, output_tokens: 40 } });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    const firstTurn = requests[0]?.turnId;
    const second = driver.sendPrompt(snapshot.agents[0]!, 'Continue'); await vi.waitFor(() => expect(sdk.inputs).toHaveLength(2));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'requests' }); await second;
    const child = requestFixture('child', 10, 1000, 0, 0, 20, 'claude-haiku-4-5', 'child-tool');
    for (const m of [child.start, child.delta, child.stop, child.assistant, child.assistant, root.assistant]) sdk.emit(m);
    const last = requestFixture('last', 10, 1000, 0, 0, 20); for (const m of [last.start, last.delta, last.stop]) sdk.emit(m);
    sdk.emit({ type: 'result', subtype: 'error_during_execution', session_id: 'requests', is_error: true,
      usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 20 } });
    await vi.waitFor(async () => { await usage.drain(); expect(ledger.query().rows[0]?.failed).toBe(1); });
    expect(ledger.query().cost).toStrictEqual({ usd: 0.0021, coverage: 'partial', requests: 4, pricedRequests: 4, unpricedRequests: 0,
      unknownRequestExecutions: 1, reasons: [{ reason: 'unknown-request-coverage', count: 1 }] });
    expect(requests.filter(r => r.requestId === 'child').at(-1)).toMatchObject({ turnId: firstTurn, parentToolUseId: 'child-tool' });
    expect(ledger.query().rows[0]).toMatchObject({ started: 2, completed: 1, failed: 1, tokens: { input: 3030, output: 60, cacheRead: 3000, cacheWrite: 0 } });
    // An uncorrelated late child cannot be assigned to the latest user execution.
    const orphan = requestFixture('unknown-parent', 10, 1000, 0, 0, 20, 'claude-sonnet-4-5', 'unobserved-tool');
    for (const m of [orphan.start, orphan.delta, orphan.stop]) sdk.emit(m);
    await vi.waitFor(async () => { await usage.drain(); expect(ledger.query().cost?.unknownRequestExecutions).toBe(2); });
    expect(ledger.query().cost?.usd).toBe(0.0021);
    expect(ledger.query().cost?.requests).toBe(4);
    expect(requests.some(r => r.requestId === 'unknown-parent')).toBe(false);

    await usage.close();
  });

  it('observes actual SDK executions once, ignoring chunks and steering, with per-turn main-loop consumption', async()=>{
    const {sdk,driver,snapshot}=setup(false, undefined, [{ value: 'opus', displayName: 'Opus', supportsFastMode: true }]);const observations:import('@workspace/core/usage').ExecutionObservation[]=[];driver.onUsage(o=>observations.push(o));
    const sending=driver.sendPrompt(snapshot.agents[0]!, 'CANARY prompt', { model: 'opus', reasoningEffort: 'high', serviceTier: 'fast' });
    await vi.waitFor(()=>expect(sdk.inputs).toHaveLength(1));
    sdk.emit({type:'system',subtype:'init',session_id:'usage-session',model:'claude-sonnet-4-6'});await sending;
    sdk.emit({type:'assistant',session_id:'usage-session',message:{content:[{type:'text',text:'chunk'}],usage:{input_tokens:9999}}});
    await driver.steerPrompt(snapshot.agents[0]!, 'steering');
    await vi.waitFor(()=>expect(sdk.inputs).toHaveLength(2));
    sdk.emit({type:'user',uuid:sdk.inputs[1]!.uuid,session_id:'usage-session',message:{content:'steering'}});
    sdk.emit({type:'result',subtype:'success',session_id:'usage-session',is_error:false,usage:{input_tokens:10,output_tokens:20,cache_read_input_tokens:30,cache_creation_input_tokens:5}});
    await vi.waitFor(()=>expect(observations).toHaveLength(2));
    expect(observations.map(o=>o.phase)).toStrictEqual(['started','completed']);
    expect(observations[1]?.tokens).toStrictEqual({input:45,output:20,cacheRead:30,cacheWrite:5,total:65});
    expect(observations[0]?.model).toBe('claude-sonnet-4-6');
    expect(observations[0]?.reasoningEffort).toBe('high');
    expect(observations[0]?.serviceTier).toBe('fast');
    expect(sdk.options[0]?.settings).toEqual({ fastMode: true });
    expect(observations[1]?.model).toBe('claude-sonnet-4-6');
  });

  it('preserves actual model attribution across SDK blocks and suppressed steering results without inventing a second user turn',async()=>{
    const {sdk,driver,snapshot}=setup();const observations:import('@workspace/core/usage').ExecutionObservation[]=[];driver.onUsage(o=>observations.push(o));
    const sending=driver.sendPrompt(snapshot.agents[0]!, 'CANARY prompt');await vi.waitFor(()=>expect(sdk.inputs).toHaveLength(1));
    sdk.emit({type:'system',subtype:'init',session_id:'behavior-session',model:'claude-sonnet-4-6'});await sending;
    expect(observations[0]?.serviceTier).toBe('normal');
    sdk.emit({type:'assistant',session_id:'behavior-session',parent_tool_use_id:null,message:{id:'response-a',model:'claude-sonnet-4-6',content:[{type:'text',text:'CANARY'}]}});
    await driver.steerPrompt(snapshot.agents[0]!, 'steering');await vi.waitFor(()=>expect(sdk.inputs).toHaveLength(2));
    sdk.emit({type:'result',subtype:'success',session_id:'behavior-session',is_error:false});
    sdk.emit({type:'assistant',session_id:'behavior-session',parent_tool_use_id:null,message:{id:'response-b',model:'claude-sonnet-4-6',content:[{type:'tool_use',id:'tool',name:'CANARY',input:{text:'CANARY'}}]}});
    sdk.emit({type:'assistant',session_id:'behavior-session',parent_tool_use_id:null,message:{id:'response-b',model:'claude-sonnet-4-6',content:[{type:'text',text:'CANARY'}]}});
    sdk.emit({type:'user',uuid:sdk.inputs[1]!.uuid,session_id:'behavior-session',message:{content:'steering'}});
    sdk.emit({type:'result',subtype:'success',session_id:'behavior-session',is_error:false});
    await vi.waitFor(()=>expect(observations).toHaveLength(2));
    expect(observations[1]!.model).toBe('claude-sonnet-4-6');
    expect(JSON.stringify(observations)).not.toContain('CANARY');
  });

  it('marks a Claude reviewer working for its turn and idle only after completion', async () => {
    const { sdk, driver, snapshot, events } = setup();
    const reviewer = snapshot.agents[0]!;
    const reviewing = driver.runCodeReview(reviewer, {
      cwd: reviewer.folder!, prompt: 'Review the current diff.',
      reviewMcpServerUrl: 'http://review.test/mcp',
    });
    // Keep cleanup safe when an assertion fails before the SDK completes the turn.
    void reviewing.catch(() => undefined);
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    expect(reviewer.status.type).toBe('working');
    expect(snapshot.agents[1]!.status.type).toBe('idle');

    sdk.emit({ type: 'system', subtype: 'init', session_id: 'review-session' });
    sdk.emit({ type: 'assistant', session_id: 'review-session', message: { content: [{ type: 'text', text: 'Still reviewing.' }] } });
    await vi.waitFor(() => expect(events.some(event => event.type === 'claude.conversationEventReceived'
      && event.payload.event.type === 'message.delta')).toBe(true));
    expect(reviewer.status.type).toBe('working');

    sdk.emit({ type: 'result', subtype: 'success', session_id: 'review-session', is_error: false });
    await reviewing;
    expect(reviewer.status.type).toBe('idle');
    expect(events.filter(event => event.agentId === reviewer.id && event.type === 'agent.statusChanged')
      .map(event => event.payload)).toEqual([{ type: 'working' }, { type: 'idle' }]);
  });

  it('keeps a failed turn readable across the backend wire after refreshing its conversation', async () => {
    const { sdk, send, driver, snapshot, events } = setup();
    const pending = send('claude-a', 'keep my prompt');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await pending;
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: true, result: 'Service unavailable' });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    await driver.loadConversation(snapshot.agents[0]!);
    const frame = events.filter(event => event.type === 'claude.conversationSnapshotChanged').at(-1)!;
    expect(frame.payload.snapshot).toMatchObject({ busy: false, activeTurnId: null, turns: [{ status: 'failed' }], error: 'Service unavailable' });
    expect(frame.payload.snapshot.messages).toContainEqual(expect.objectContaining({ role: 'user', parts: expect.arrayContaining([expect.objectContaining({ text: 'keep my prompt' })]) }));
    expect(() => decodeAppBackendEvent(JSON.parse(JSON.stringify(frame)))).not.toThrow();
  });

  it.each([
    ['authentication_failed', 'Failed to authenticate: OAuth session expired and could not be refreshed', false],
    ['authentication_failed', 'Credentials rejected', false],
    [null, 'Failed to authenticate: OAuth session expired and could not be refreshed', false],
    ['server_error', 'Service unavailable', true],
    ['rate_limit', 'Usage limit reached', true],
  ])('updates engine connection after %s without changing enablement or losing the conversation', async (error, text, connected) => {
    vi.mocked(getLocalClaudeAuthentication).mockResolvedValue({ loggedIn: true, account: { type: 'subscription', email: 'user@example.com' } });
    const { sdk, send, server, snapshot, events } = setup(true);
    const pending = send('claude-a', 'hello');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await pending;
    expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: true, enabled: true });
    if (error) sdk.emit({ type: 'assistant', session_id: 'session-a', error, message: { content: [{ type: 'text', text }] } });
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: true, result: text });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    expect(snapshot.providerConnections?.[0]).toMatchObject({ connected, enabled: true, authentication: { kind: 'claude', connected, state: { loggedIn: connected } } });
    expect(snapshot.agents[0]!.backendSession).toMatchObject({ sessionId: 'session-a' });
    for (const event of events) expect(() => decodeAppBackendEvent(JSON.parse(JSON.stringify(event)))).not.toThrow();
    if (!connected) {
      expect(events.filter(event => event.type === 'provider.authenticationChanged')).toHaveLength(1);
      expect(events).toContainEqual(expect.objectContaining({ type: 'snapshot.updated', payload: expect.objectContaining({
        providerConnections: expect.arrayContaining([expect.objectContaining({ backend: 'claude', connected: false })]),
      }) }));
      expect(snapshot.providerConnections?.[0]?.authentication?.state).not.toHaveProperty('account');
      vi.mocked(getLocalClaudeAuthentication).mockResolvedValue({ loggedIn: false });
      expect(await send('claude-a', 'blocked until login')).toMatchObject({ error: { message: expect.stringContaining('not connected') } });
      vi.mocked(getLocalClaudeAuthentication).mockResolvedValue({ loggedIn: true });
      await server.handleMessage({ jsonrpc: '2.0', id: 'reconnect', method: 'claude/authentication/get' });
      expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: true });
    }
  });

  it('admits a retried prompt after an external login without a manual authentication check', async () => {
    vi.mocked(getLocalClaudeAuthentication).mockResolvedValue({ loggedIn: true, account: { type: 'subscription', email: 'user@example.com' } });
    const { sdk, send, snapshot } = setup(true);
    const pending = send('claude-a', 'hello');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await pending;
    sdk.emit({ type: 'assistant', session_id: 'session-a', error: 'authentication_failed', message: { content: [{ type: 'text', text: 'x' }] } });
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: true, result: 'x' });
    await vi.waitFor(() => expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: false }));
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    vi.mocked(getLocalClaudeAuthentication).mockResolvedValue({ loggedIn: true });
    const retry = await send('claude-a', 'try again');
    expect(retry).not.toHaveProperty('error');
    expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: true });
  });

  it('marks Claude disconnected when authentication fails before session initialization', async () => {
    vi.mocked(getLocalClaudeAuthentication).mockResolvedValue({ loggedIn: true });
    const { sdk, send, snapshot } = setup(true);
    sdk.createQuery.mockImplementationOnce(() => { throw new Error('Failed to authenticate: OAuth session expired and could not be refreshed'); });
    await send('claude-a', 'hello');
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('error'));
    expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: false, enabled: true });
    expect(snapshot.agents).toHaveLength(2);
  });

  it('does not let a late interrupt callback settle or release the next turn', async () => {
    const { sdk, send, driver, snapshot, events } = setup();
    const started = send('claude-a', 'first');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await started;
    let finishInterrupt!: () => void;
    sdk.runtimes[0]!.interrupt.mockImplementationOnce(() => new Promise<void>(resolve => { finishInterrupt = resolve; }));
    const stopping = driver.interrupt(snapshot.agents[0]!);
    sdk.emit({ type: 'result', subtype: 'error_during_execution', session_id: 'session-a', is_error: true, errors: ['Stopped'] });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    const next = send('claude-a', 'next');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(2));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await next;
    finishInterrupt();
    await stopping;
    await expect(driver.sendPrompt(snapshot.agents[0]!, 'must not overlap', {})).rejects.toThrow('active turn');
    expect(snapshot.agents[0]!.status.type).toBe('working');
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: false });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    expect(events.filter(event => event.type === 'claude.conversationEventReceived' && event.payload.event.type === 'turn.completed').map(event => event.type === 'claude.conversationEventReceived' && event.payload.event.type === 'turn.completed' ? event.payload.event.payload.turn.status : undefined)).toEqual(['interrupted', 'completed']);
  });

  it('keeps the agent working until a steered follow-up is consumed and answered', async () => {
    const { sdk, send, server, snapshot, events } = setup();
    const started = send('claude-a', 'first');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await started;
    sdk.emit({ type: 'assistant', session_id: 'session-a', message: { content: 'Before' } });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'steer', method: 'agent/prompt/steer', params: { agentId: 'claude-a', prompt: 'Change it' } })).resolves.not.toHaveProperty('error');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(2));
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: false });
    sdk.emit({ type: 'user', uuid: sdk.inputs[1]!.uuid, isReplay: true, session_id: 'session-a', message: { content: 'Change it' } });
    sdk.emit({ type: 'assistant', session_id: 'session-a', message: { content: 'After' } });
    await vi.waitFor(() => expect(events.some((event) => event.type === 'claude.conversationEventReceived' && event.payload.event.type === 'message.delta' && event.payload.event.payload.delta === 'After')).toBe(true));
    expect(snapshot.agents[0]!.status.type).toBe('working');
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: false });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    const conversationEvents = events.filter((event) => event.type === 'claude.conversationEventReceived').map((event) => event.payload.event);
    expect(conversationEvents.filter((event) => event.type === 'turn.completed')).toHaveLength(1);
    expect(conversationEvents.filter((event) => event.type === 'message.userSubmitted')).toHaveLength(2);
  });

  it('projects Claude quota windows separately from Codex and retains the other reported window', async () => {
    const { sdk, send, snapshot, events } = setup();
    const pending = send('claude-a', 'hello');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await pending;
    const quota = (rateLimitType: string, utilization?: number) => sdk.emit({
      type: 'rate_limit_event', session_id: 'session-a',
      rate_limit_info: { status: 'allowed', rateLimitType, utilization, resetsAt: 1_800_000_000 },
    });
    quota('five_hour', 0.2);
    quota('seven_day', 0.1);
    await vi.waitFor(() => expect(snapshot.backendAccountRateLimits?.claude).toMatchObject({
      primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1_800_000_000 },
      secondary: { usedPercent: 10, windowDurationMins: 10_080, resetsAt: 1_800_000_000 },
    }));
    expect(snapshot.accountRateLimits).toBeUndefined();
    quota('seven_day_opus', 0.9);
    quota('five_hour');
    quota('five_hour', -1);
    quota('five_hour', 0.3);
    await vi.waitFor(() => expect(snapshot.backendAccountRateLimits?.claude?.primary?.usedPercent).toBe(30));
    expect(snapshot.backendAccountRateLimits?.claude?.secondary?.usedPercent).toBe(10);
    expect(events.filter(event => event.type === 'account.rateLimitsUpdated')).toHaveLength(3);
  });

  it('retains a blocked session reset even when Claude reports no utilization or a success result envelope', async () => {
    const { sdk, send, snapshot, events } = setup();
    const pending = send('claude-a', 'Work');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' }); await pending;
    const resetsAt = Math.floor(Date.now() / 1000) + 60;
    sdk.emit({ type: 'rate_limit_event', session_id: 'session-a', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt } });
    sdk.emit({ type: 'assistant', session_id: 'session-a', error: 'rate_limit', message: { content: [{ type: 'text', text: "You've hit your session limit" }] } });
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: false });
    await vi.waitFor(() => expect(snapshot.agents[0]!.rateLimitPause).toMatchObject({ resumeAt: resetsAt * 1000, enabled: true }));
    expect(snapshot.agents[0]!.status.type).toBe('idle');
    for (const event of events) expect(() => decodeAppBackendEvent(JSON.parse(JSON.stringify(event)))).not.toThrow();
  });

  it('turns an SDK ExitPlanMode item into a durable review without UI semantics', async () => {
    const { sdk, driver, server, snapshot, events } = setup();
    const pending = driver.sendPrompt(agent(), 'plan it', { planMode: true });
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    expect(sdk.options[0]!.permissionMode).toBe('plan');
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await pending;
    sdk.emit({ type: 'assistant', session_id: 'session-a', message: { content: [
      { type: 'tool_use', id: 'proposal', name: 'ExitPlanMode', input: { plan: '# Claude plan\n\nShip it.' } },
    ] } });
    await vi.waitFor(() => expect(snapshot.agents[0]!.planReview).toMatchObject({ status: 'pending', markdown: '# Claude plan\n\nShip it.' }));
    expect(events.filter((event) => event.type === 'plan.readyForReview')).toMatchObject([{ agentId: 'claude-a', payload: { markdown: '# Claude plan\n\nShip it.' } }]);
    expect(events.map((event) => event.type)).not.toContain('sidePanel.markdownRequested');
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: false });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    const accepted = server.handleMessage({ jsonrpc: '2.0', id: 'accept', method: 'agent/planReview/respond', params: { agentId: 'claude-a', response: { reviewId: snapshot.agents[0]!.planReview!.id, resolution: 'accept' } } });
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(2));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await expect(accepted).resolves.not.toHaveProperty('error');
    expect(sdk.inputs[1]!.message.content).toEqual([{ type: 'text', text: 'implement the plan' }]);
    expect(snapshot.agents[0]!.planReview!.status).toBe('accept');
  });

  it('isolates SDK query streams and completion status across two concurrent agents', async () => {
    const { sdk, send, snapshot } = setup();
    const a = send('claude-a', 'first');
    const b = send('claude-b', 'second');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(2));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' }, 0);
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-b' }, 1);
    await Promise.all([a, b]);
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-b', is_error: false }, 1);
    await vi.waitFor(() => expect(snapshot.agents[1]!.status.type).toBe('idle'));
    expect(snapshot.agents[0]!.status.type).toBe('working');
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: false }, 0);
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
  });

  it.each([
    { toolName: 'Edit', input: { file_path: 'src/main.ts', old_string: 'obsolete();', new_string: '' }, summary: 'Edit file src/main.ts?', preview: 'Before:\nobsolete();\n\nAfter:\n(empty)' },
    { toolName: 'Edit', input: { file_path: 'src/main.ts', old_string: 'const enabled = false;\nstart();', new_string: 'const enabled = true;\nstart();', replace_all: true }, summary: 'Replace all matches in src/main.ts?', preview: 'Before:\nconst enabled = false;\nstart();\n\nAfter:\nconst enabled = true;\nstart();' },
    { toolName: 'Write', input: { file_path: 'src/main.ts', content: 'const enabled = true;\nstart();' }, summary: 'Write file src/main.ts?', preview: 'New contents (replaces any existing file contents):\nconst enabled = true;\nstart();' },
    { toolName: 'NotebookEdit', input: { notebook_path: 'notebook.ipynb', new_source: 'print(1)' }, summary: 'Edit notebook notebook.ipynb?', preview: '{\n  "notebook_path": "notebook.ipynb",\n  "new_source": "print(1)"\n}' },
    { toolName: `mcp__${product.mcpServerName}__set-status`, input: { status: 'Working' }, summary: 'Provider title', preview: '{\n  "status": "Working"\n}' },
  ])('preserves $toolName approval context and leaves Input only after the last response', async ({ toolName, input, summary, preview }) => {
    const { sdk, driver, server, snapshot, events } = setup();
    const pending = driver.sendPrompt(agent(), 'edit');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await pending;
    const permission = sdk.options[0]!.canUseTool!(toolName, input, {
      signal: new AbortController().signal, toolUseID: 'edit-item', requestId: 'permission', title: toolName.startsWith('mcp__') ? 'Provider title' : 'src/main.ts',
    });
    await vi.waitFor(() => expect(events.some((event) => event.type === 'agentRequest.created')).toBe(true));
    expect(snapshot.agentRequests?.['claude-a']).toMatchObject([{ id: 'permission', kind: 'toolConfirmation', conversationId: 'session-a' }]);
    const isMcp = toolName.startsWith('mcp__');
    expect(events).toContainEqual(expect.objectContaining({ type: 'claude.conversationEventReceived', payload: expect.objectContaining({ event: expect.objectContaining({
      type: 'approval.requested', payload: expect.objectContaining({ payload: { confirmation: expect.objectContaining({
        integrationId: isMcp ? product.mcpServerName : 'claude', toolName: isMcp ? 'set-status' : toolName,
        summary, argumentsPreview: preview,
      }) } }),
    }) }) }));
    const secondPermission = sdk.options[0]!.canUseTool!('Read', { file_path: '/tmp/project/another.ts' }, {
      signal: new AbortController().signal, toolUseID: 'read-item', requestId: 'permission-2',
    });
    await vi.waitFor(() => expect(snapshot.agentRequests?.['claude-a']).toHaveLength(2));
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'answer', method: 'agent/request/respond', params: { response: { agentId: 'claude-a', id: 'permission', outcome: { kind: 'decision', decision: 'deny' } } } })).resolves.not.toHaveProperty('error');
    await expect(permission).resolves.toMatchObject({ behavior: 'deny' });
    await vi.waitFor(() => expect(events.some((event) => event.type === 'agentRequest.resolved')).toBe(true));
    expect(snapshot.agents[0]!.status.type).toBe('awaitingInput');
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'answer-2', method: 'agent/request/respond', params: { response: { agentId: 'claude-a', id: 'permission-2', outcome: { kind: 'decision', decision: 'allow' } } } })).resolves.not.toHaveProperty('error');
    await expect(secondPermission).resolves.toMatchObject({ behavior: 'allow' });
    expect(snapshot.agents[0]!.status.type).toBe('working');
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: false });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
  });

  it.each([false, true])('removes an SDK-cancelled permission before turn completion (already aborted: %s)', async (alreadyAborted) => {
    const { sdk, send, snapshot, events, driver } = setup();
    const started = send('claude-a', 'edit');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await started;
    const cancellation = new AbortController();
    if (alreadyAborted) cancellation.abort();
    const permission = sdk.options[0]!.canUseTool!('Edit', { file_path: '/tmp/project/file.ts' }, {
      signal: cancellation.signal, toolUseID: 'edit-item', requestId: 'cancelled',
    });
    if (!alreadyAborted) expect(snapshot.agentRequests?.['claude-a']).toHaveLength(1);
    cancellation.abort();
    await expect(permission).resolves.toMatchObject({ behavior: 'deny' });
    expect(snapshot.agentRequests?.['claude-a'] ?? []).toHaveLength(0);
    expect(snapshot.agents[0]!.status.type).toBe('working');
    expect(events.filter((event) => event.type === 'agentRequest.resolved')).toMatchObject([
      { agentId: 'claude-a', payload: { id: 'cancelled', outcome: { kind: 'cancelled' } } },
    ]);
    await expect(driver.respondToAgentRequest({ agentId: 'claude-a', id: 'cancelled', outcome: { kind: 'decision', decision: 'allow' } })).rejects.toThrow('no longer pending');
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: false });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    expect(events.filter((event) => event.type === 'agentRequest.resolved')).toHaveLength(1);
  });

  it('reports SDK startup failure as an error and allows another attempt', async () => {
    const { sdk, send, snapshot } = setup();
    sdk.createQuery.mockImplementationOnce(() => { throw new Error('sdk unavailable'); });
    await send('claude-a', 'hello');
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('error'));
    const retry = send('claude-a', 'retry');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'retry-session' });
    await retry;
    await vi.waitFor(() => expect(snapshot.agents[0]!.backendSession).toMatchObject({ sessionId: 'retry-session' }));
  });
});
