import { product } from '@workspace/core/product';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SDKTaskStartedMessage } from '@anthropic-ai/claude-agent-sdk';
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

vi.mock('@workspace/core/runtime-discovery', () => ({
  resolveRuntimeLaunch: (command: string, env: NodeJS.ProcessEnv | undefined) => ({ command, env: { ...process.env, ...env } }),
}));
vi.mock('../authentication', () => ({ getLocalClaudeAuthentication: vi.fn() }));

function agent(id = 'claude-a'): Agent {
  return { id, name: id, folder: '/tmp/project', teamId: 'team-test', backend: 'claude', status: { type: 'idle' }, createdAt: '', updatedAt: '' };
}

describe(`Claude Agent SDK → ${product.name} backend`, () => {
  const servers: AppBackendServer[] = [];
  const homes: string[] = [];
  function setup(withConnections = false, usage?: UsageService, models: Array<Record<string, unknown>> = [], homeDir?: string) {
    const sdk = createQueryHarness(models);
    const driver = new ClaudeBackendDriver(new ClaudeAgentSdkTransport({ createQuery: sdk.createQuery }), undefined, { homeDir });
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
