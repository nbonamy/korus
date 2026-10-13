import { product } from '@workspace/core/product';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AgentBackendDriver } from '@workspace/core/backend-driver';
import type { DelegatedTask } from '@workspace/core/delegated-task';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { DurableTaskService } from '../../agents/durable-task-service';
import { AppStateStore } from '../../persistence/store';
import { BackendDriverRpc } from '../../driver-rpc';
import { AppBackendServer } from '../../server';
import { AppMcpService } from '../service';
import { createTaskToolModuleProvider } from '../task-tools';
import { codexSdkFixture, sdkSnapshot } from '../../codex/__tests__/sdk-surface-fixture';
import { ClaudeBackendDriver } from '../../claude/claude-driver';
import { ClaudeAgentSdkTransport } from '../../claude/agent-sdk-transport';
import { createQueryHarness } from '../../claude/__tests__/sdk-query-fixture';

vi.mock('@workspace/core/runtime-discovery', () => ({ resolveRuntimeLaunch: (command: string, env: NodeJS.ProcessEnv | undefined) => ({ command, env: { ...process.env, ...env } }) }));

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function setup(parentBackend: 'codex' | 'claude') {
  const home = await mkdtemp(path.join(os.tmpdir(), 'app-task-mcp-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const store = new AppStateStore(home);
  const snapshot = createInitialSnapshot();
  snapshot.general.claudeCodeEnabled = true;
  snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
  const parent = snapshot.agents[0]!;
  parent.backend = parentBackend;
  parent.backendSession = parentBackend === 'codex' ? { kind: 'codex', threadId: 'codex-parent' } : { kind: 'claude', sessionId: 'claude-parent', transport: 'stdio' };
  parent.status = { type: 'idle' };
  const codex = codexSdkFixture();
  const claudeSdk = createQueryHarness();
  const claude = new ClaudeBackendDriver(new ClaudeAgentSdkTransport({ createQuery: claudeSdk.createQuery }));
  const rpc = new BackendDriverRpc(new Map< 'codex' | 'claude', AgentBackendDriver>([['codex', codex.driver], ['claude', claude]]));
  const metadata = { seq: 1, origin: 'notification' as const, occurredAt: '2026-10-04T00:00:00Z', conversationId: 'codex-worker', turnId: 'codex-turn' };
  codex.surface.createConversation.mockResolvedValue(sdkSnapshot('codex-worker'));
  for (const id of ['codex-worker', 'codex-parent']) {
    const conversation = codex.conversation(id);
    conversation.handle.sendMessage.mockImplementation(async () => {
      conversation.setSnapshot({ activeTurnId: 'codex-turn', busy: true });
      conversation.emit({ ...metadata, conversationId: id, type: 'turn.started', payload: { turn: { id: 'codex-turn', status: 'inProgress', items: [], error: null } } } as never);
      return conversation.handle.getSnapshot();
    });
  }
  let mcp!: AppMcpService;
  let server!: AppBackendServer;
  const tasks = new DurableTaskService({ tasks: [], save: data => store.saveTasks(data), agent: id => snapshot.agents.find(agent => agent.id === id), send: async (agent, prompt) => {
    const receipt = await server.sendTaskPrompt(agent, prompt);
    await store.save(snapshot);
    return receipt;
  }, interrupt: (agent, expectedTurnId) => rpc.handle(backendMethods.driverInterrupt, { agent, expectedTurnId }), onError: error => { throw error; } });
  mcp = new AppMcpService({ snapshot, tasks, persistSnapshot: () => store.save(snapshot), toolModuleProviders: [createTaskToolModuleProvider(tasks)] });
  server = new AppBackendServer({ version: 'test', snapshot, tasks, driverRpc: rpc, onBackendEventApplied: event => tasks.handleEvent(event) });
  mcp.setDriverRpc(rpc);
  mcp.setEventSink(event => server.emitEvent(event));
  const url = await mcp.start();
  cleanup.push(async () => { tasks.close(); await mcp.stop(); await server.close(); await store.save(snapshot); });
  async function call(agentId: string, name: string, args: unknown) {
    const target = new URL(url); target.searchParams.set('agentId', agentId);
    const response = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'request', method: 'tools/call', params: { name, arguments: args } }) });
    const text = await response.text();
    return JSON.parse(text.startsWith('event:') ? text.split('\n').find(line => line.startsWith('data: '))!.slice(6) : text).result;
  }
  return { tasks, store, snapshot, parent, server, call, codex, claudeSdk, metadata, rpc };
}

describe('durable tasks through authenticated MCP and real provider adapters', () => {
  it.each([
    { durable: false, parent: 'codex', permissionMode: 'auto' },
    { durable: true, parent: 'codex', permissionMode: 'auto' },
    { durable: true, parent: 'claude', permissionMode: 'default' },
  ] as const)('applies saved $permissionMode permissions and the explicit model before startup ($parent parent, durable: $durable)', async ({ durable, parent, permissionMode }) => {
    const f = await setup(parent);
    f.snapshot.general.providerApprovalDefaults = { claude: permissionMode };
    f.snapshot.general.providerModelDefaults = { claude: { model: 'opus', reasoningEffort: 'low', serviceTier: null } };
    f.parent.backendDefaults = parent === 'codex'
      ? { kind: 'codex', model: 'codex-parent-model', reasoningEffort: 'max' }
      : { kind: 'claude', model: 'opus', reasoningEffort: 'max', permissionMode: 'bypassPermissions' };
    const creating = f.call(f.parent.id, 'create-agent', {
      repoPath: '/repo', backend: 'claude', prompt: 'Perform the assignment',
      model: 'claude-sonnet-5-5', reasoningEffort: 'high',
      ...(durable ? { requestId: 'configured-worker', task: { title: 'Configured worker', doneWhen: 'Verified' } } : {}),
    });
    await vi.waitFor(() => expect(f.claudeSdk.inputs).toHaveLength(1));
    f.claudeSdk.emit({ type: 'system', subtype: 'init', session_id: 'claude-worker', model: 'claude-sonnet-5-5' });
    const created = await creating;
    expect(created.isError).toBe(false);
    expect(f.claudeSdk.options[0]).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'high', permissionMode });
    const worker = f.snapshot.agents.find(agent => agent.id === created.structuredContent.agentId)!;
    expect(worker.backendDefaults).toStrictEqual({
      kind: 'claude', model: 'claude-sonnet-5-5', reasoningEffort: 'high', userSelectedModel: true, permissionMode,
    });
    if (durable) expect((await f.store.load()).agents.find(agent => agent.id === worker.id)?.backendDefaults).toStrictEqual(worker.backendDefaults);
  });

  it('honors Stop while automatic parent delivery is awaiting a turn identity', async () => {
    const f = await setup('codex');
    const created = await f.call(f.parent.id, 'create-agent', { repoPath: '/repo', backend: 'codex', prompt: 'Perform the assignment', requestId: 'stopped-delivery', task: { title: 'Assignment', doneWhen: 'Verified' } });
    const task = created.structuredContent.task as DelegatedTask;
    await f.call(task.workerAgentId, 'complete-task', { summary: 'Verified', evidence: ['Checked'], artifacts: [], caveats: [] });
    const parent = f.codex.conversation('codex-parent');
    let accept!: () => void;
    const acceptance = new Promise<void>(resolve => { accept = resolve; });
    parent.handle.sendMessage.mockImplementationOnce(async () => {
      parent.setSnapshot({ activeTurnId: null, busy: true });
      await acceptance;
      parent.setSnapshot({ activeTurnId: 'delivery-turn', busy: true });
      parent.emit({ ...f.metadata, conversationId: 'codex-parent', turnId: 'delivery-turn', type: 'turn.started', payload: { turn: { id: 'delivery-turn', status: 'inProgress', items: [], error: null } } } as never);
      return parent.handle.getSnapshot();
    });
    const worker = f.codex.conversation('codex-worker');
    worker.setSnapshot({ activeTurnId: null, busy: false });
    worker.emit({ ...f.metadata, type: 'turn.completed', payload: { status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null } });
    await vi.waitFor(() => expect(parent.handle.sendMessage).toHaveBeenCalledOnce());
    await f.server.handleMessage({ jsonrpc: '2.0', id: 1, method: backendMethods.agentInterrupt, params: { agentId: f.parent.id } });
    expect(parent.handle.interrupt).not.toHaveBeenCalled();
    expect((await f.store.loadTasks())[0]!.parentStopRequested).toBe(true);
    accept();
    await vi.waitFor(() => expect(parent.handle.interrupt).toHaveBeenCalledOnce());
    expect(f.tasks.mayStartAutomatedPrompt(f.parent.id)).toBe(false);
    expect((await f.store.loadTasks())[0]).toMatchObject({ state: 'completed', parentStopRequested: true, parentWakeBlocked: true, delivery: { state: 'accepted', acceptance: { turnId: 'delivery-turn' } } });

    // A duplicate late start is still the stopped automatic turn, not user consent.
    parent.emit({ ...f.metadata, conversationId: 'codex-parent', turnId: 'delivery-turn', type: 'turn.started', payload: { turn: { id: 'delivery-turn', status: 'inProgress', items: [], error: null } } } as never);
    expect(f.tasks.mayStartAutomatedPrompt(f.parent.id)).toBe(false);
    parent.setSnapshot({ activeTurnId: null, busy: false });
    parent.emit({ ...f.metadata, conversationId: 'codex-parent', turnId: 'delivery-turn', type: 'turn.completed', payload: { status: 'interrupted', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null } });
    await f.server.handleMessage({ jsonrpc: '2.0', id: 2, method: backendMethods.agentPromptSend, params: { agentId: f.parent.id, prompt: 'Continue with my next request' } });
    await vi.waitFor(() => expect(f.tasks.mayStartAutomatedPrompt(f.parent.id)).toBe(true));
    await vi.waitFor(async () => expect((await f.store.loadTasks())[0]!.parentStopRequested).toBe(false));
    expect(parent.handle.interrupt).toHaveBeenCalledOnce();
  });

  it.each(['error result', 'unexpected iterator end', 'explicit interruption'] as const)('retains the provisional Claude result without delivering success after %s', async outcome => {
    const f = await setup('codex');
    const creating = f.call(f.parent.id, 'create-agent', { repoPath: '/repo', backend: 'claude', prompt: 'Write bonjour', requestId: 'claude-outcome', task: { title: 'French readme', doneWhen: 'Verified' } });
    await vi.waitFor(() => expect(f.claudeSdk.inputs).toHaveLength(1));
    f.claudeSdk.emit({ type: 'system', subtype: 'init', session_id: 'claude-worker' });
    const task = (await creating).structuredContent.task as DelegatedTask;
    expect((await f.call(task.workerAgentId, 'complete-task', { summary: 'Created README.fr.md', evidence: ['Exact bytes verified'], artifacts: ['README.fr.md'], caveats: [] })).isError).toBe(false);
    const submission = (await f.store.loadTasks())[0]!.submission;
    expect(submission).toBeDefined();
    const waiting = f.tasks.wait(f.parent.id, { taskIds: [task.id], mode: 'all', timeoutMs: 1000 });
    if (outcome === 'error result') f.claudeSdk.emit({ type: 'result', subtype: 'error_during_execution', session_id: 'claude-worker', is_error: true, errors: ['Execution failed'] });
    else if (outcome === 'unexpected iterator end') f.claudeSdk.runtimes[0]!.close();
    else {
      const worker = f.snapshot.agents.find(agent => agent.id === task.workerAgentId)!;
      await f.rpc.handle(backendMethods.driverInterrupt, { agent: worker, expectedTurnId: task.acceptance!.turnId });
    }
    const result = await waiting;
    expect(result.timedOut).toBe(false);
    expect(result.tasks[0]).toMatchObject({ state: outcome === 'explicit interruption' ? 'interrupted' : 'failed', attemptId: task.attemptId, submission });
    expect((await f.store.loadTasks())[0]).toMatchObject({ state: result.tasks[0]!.state, submission });
    expect(f.tasks.list(f.parent.id)[0]!.delivery).toBeUndefined();
    expect(f.codex.conversation('codex-parent').handle.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    { outcome: 'completed', followUp: false },
    { outcome: 'interrupted', followUp: false },
    { outcome: 'completed', followUp: true },
    { outcome: 'interrupted', followUp: true },
    { outcome: 'failed', followUp: true },
  ] as const)('settles the submitting turn as $outcome after idle (newer turn: $followUp)', async ({ outcome, followUp }) => {
    const f = await setup('codex');
    const created = await f.call(f.parent.id, 'create-agent', { repoPath: '/repo', backend: 'codex', prompt: 'Write bonjour', requestId: 'outcome-order', task: { title: 'French readme', doneWhen: 'Verified' } });
    const task = created.structuredContent.task as DelegatedTask;
    await f.call(task.workerAgentId, 'complete-task', { summary: 'Created README.fr.md', evidence: ['Exact bytes verified'], artifacts: ['README.fr.md'], caveats: [] });
    const submission = f.tasks.list(f.parent.id)[0]!.submission;
    const worker = f.codex.conversation('codex-worker');
    const waiting = f.tasks.wait(f.parent.id, { taskIds: [task.id], mode: 'all', timeoutMs: 30 });
    worker.setSnapshot({ activeTurnId: null, busy: false });
    worker.emit({ ...f.metadata, type: 'conversation.activityChanged', payload: { threadStatus: { type: 'idle' }, busy: false, error: null } });
    const pending = await waiting;
    expect(pending.timedOut).toBe(true);
    expect(pending.tasks[0]).toMatchObject({ state: 'running', attemptId: task.attemptId, submission });
    if (followUp) {
      worker.handle.sendMessage.mockImplementationOnce(async () => {
        worker.setSnapshot({ activeTurnId: 'follow-up-turn', busy: true });
        worker.emit({ ...f.metadata, turnId: 'follow-up-turn', type: 'turn.started', payload: { turn: { id: 'follow-up-turn', status: 'inProgress', items: [], error: null } } } as never);
        return worker.handle.getSnapshot();
      });
      const sent = await f.server.handleMessage({ jsonrpc: '2.0', id: 2, method: backendMethods.agentPromptSend, params: { agentId: task.workerAgentId, prompt: 'Inspect the result' } });
      expect(sent).not.toHaveProperty('error');
      await vi.waitFor(() => expect(f.tasks.list(f.parent.id)[0]!.executionTurnId).toBe('follow-up-turn'));
    }
    const terminal = f.tasks.wait(f.parent.id, { taskIds: [task.id], mode: 'all', timeoutMs: 1000 });
    worker.emit({ ...f.metadata, type: 'turn.completed', payload: { status: outcome, error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null } });
    const settled = await terminal;
    expect(settled.timedOut).toBe(false);
    expect(settled.tasks[0]).toMatchObject({ state: outcome, attemptId: task.attemptId, submission });
    if (followUp) {
      expect(settled.tasks[0]!.executionTurnId).toBe('follow-up-turn');
      expect(f.snapshot.agents.find(agent => agent.id === task.workerAgentId)!.status.type).toBe('working');
    }
    expect((await f.store.loadTasks())[0]).toMatchObject({ state: outcome, submission });
    if (outcome === 'completed') await vi.waitFor(() => expect(f.tasks.list(f.parent.id)[0]!.delivery?.state).toBe('accepted'));
    else expect(f.tasks.list(f.parent.id)[0]!.delivery).toBeUndefined();
  });

  it('rejects task prompt admission after the target agent is removed', async () => {
    const f = await setup('codex');
    f.snapshot.agents.splice(f.snapshot.agents.indexOf(f.parent), 1);
    await expect(f.server.sendTaskPrompt(f.parent, 'Saved results')).rejects.toThrow('removed');
    expect(f.codex.conversation('codex-parent').handle.sendMessage).not.toHaveBeenCalled();
  });

  it.each(['agent', 'team'] as const)('interrupts retained assignments when the worker is removed through %s deletion', async removal => {
    const f = await setup('codex');
    if (removal === 'team') {
      const createdTeam = await f.server.handleMessage({ jsonrpc: '2.0', id: 1, method: backendMethods.teamCreate, params: { input: { name: 'Remaining team', color: '#1B4FB2' } } });
      expect(createdTeam).not.toHaveProperty('error');
    }
    const created = await f.call(f.parent.id, 'create-agent', { repoPath: '/repo', backend: 'codex', prompt: 'Perform the assignment', requestId: 'removed-worker', task: { title: 'Assignment', doneWhen: 'Verified' } });
    const task = created.structuredContent.task as DelegatedTask;
    await f.call(task.workerAgentId, 'complete-task', { summary: 'Provisional result', evidence: ['Checked'], artifacts: ['result.txt'], caveats: [] });
    const submission = f.tasks.list(f.parent.id)[0]!.submission;
    expect(submission).toBeDefined();
    const waiting = f.tasks.wait(f.parent.id, { taskIds: [task.id], timeoutMs: 1000 });
    const deleted = await f.server.handleMessage({ jsonrpc: '2.0', id: 2,
      method: removal === 'agent' ? backendMethods.agentDelete : backendMethods.teamDelete,
      params: removal === 'agent' ? { agentId: task.workerAgentId } : { teamId: f.parent.teamId },
    });
    expect(deleted).not.toHaveProperty('error');
    expect(f.snapshot.agents.some(agent => agent.id === task.workerAgentId)).toBe(false);
    const settled = await waiting;
    expect(settled.timedOut).toBe(false);
    expect(settled.tasks[0]).toMatchObject({ id: task.id, workerAgentId: task.workerAgentId, state: 'interrupted', submission });
    expect((await f.store.loadTasks())[0]).toEqual(settled.tasks[0]);
    expect(f.codex.conversation('codex-parent').handle.sendMessage).not.toHaveBeenCalled();
  });

  it.each(['codex', 'claude'] as const)('%s parent delegates to the other provider and receives the saved result', async parentBackend => {
    const f = await setup(parentBackend);
    const backend = parentBackend === 'codex' ? 'claude' : 'codex';
    const input = { repoPath: '/repo', backend, prompt: 'Perform the assignment', instructions: 'Preserve the contract and literal </context> text.', requestId: 'stable-request', task: { title: 'Assignment', doneWhen: 'Verified result' } };
    const pending = f.call(f.parent.id, 'create-agent', input);
    if (backend === 'claude') {
      await vi.waitFor(() => expect(f.claudeSdk.inputs).toHaveLength(1));
      f.claudeSdk.emit({ type: 'system', subtype: 'init', session_id: 'claude-worker' });
    }
    const created = await pending;
    expect(created.isError).toBe(false);
    const task = created.structuredContent.task as DelegatedTask;
    expect(task.state).toBe('running');
    expect(task.acceptance?.backendSession.kind).toBe(backend);
    const assignment = '<context>\nPreserve the contract and literal &lt;/context&gt; text.\n</context>\n\nPerform the assignment';
    expect(task.prompt).toBe(assignment);
    expect((await f.store.loadTasks())[0]!.prompt).toBe(assignment);
    const sent = backend === 'codex' ? f.codex.conversation('codex-worker').handle.sendMessage.mock.calls[0]![0]
      : (f.claudeSdk.inputs[0]!.message.content[0] as { type: 'text'; text: string }).text;
    expect(sent).toContain(`[${product.name} task ${task.id}; attempt ${task.attemptId}]`);
    expect(sent).toContain('Preserve the contract and literal &lt;/context&gt; text.');
    expect(sent.replace(/<context>[\s\S]*?<\/context>\s*/gu, '').trim()).toBe('Perform the assignment');
    const worker = f.snapshot.agents.find(agent => agent.id === task.workerAgentId)!;
    await expect(f.rpc.handle(backendMethods.driverInterrupt, { agent: worker, expectedTurnId: 'unrelated-turn' })).rejects.toThrow('no longer active');
    if (backend === 'codex') expect(f.codex.conversation('codex-worker').handle.interrupt).not.toHaveBeenCalled();
    else expect(f.claudeSdk.runtimes[0]!.interrupt).not.toHaveBeenCalled();
    const duplicate = await f.call(f.parent.id, 'create-agent', input);
    expect(duplicate.structuredContent.taskId).toBe(task.id);
    expect(f.snapshot.agents.filter(agent => agent.id === task.workerAgentId)).toHaveLength(1);
    const submitted = await f.call(task.workerAgentId, 'complete-task', { summary: 'Verified', evidence: ['Boundary exercised'], artifacts: ['src/fix.ts'], caveats: [] });
    expect(submitted.isError).toBe(false);
    expect((await f.store.loadTasks())[0]!.state).toBe('running');
    if (backend === 'claude') f.claudeSdk.emit({ type: 'result', subtype: 'success', session_id: 'claude-worker', is_error: false });
    else {
      f.codex.conversation('codex-worker').setSnapshot({ activeTurnId: null, busy: false });
      f.codex.conversation('codex-worker').emit({ ...f.metadata, type: 'turn.completed', payload: { status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null } });
    }
    if (parentBackend === 'claude') {
      await vi.waitFor(() => expect(f.claudeSdk.inputs).toHaveLength(1));
      f.claudeSdk.emit({ type: 'system', subtype: 'init', session_id: 'claude-parent' });
    }
    await vi.waitFor(async () => expect((await f.store.loadTasks())[0]!.delivery?.state).toBe('accepted'));
    const read = await f.server.handleMessage({ jsonrpc: '2.0', id: 1, method: backendMethods.agentTasksList, params: { agentId: f.parent.id } });
    expect(read).toMatchObject({ result: [{ id: task.id, state: 'completed', submission: { summary: 'Verified' } }] });
    expect((await f.call(f.parent.id, 'wait-tasks', { taskIds: [task.id] })).structuredContent.tasks[0].state).toBe('completed');
    const stranger = f.snapshot.agents.find(agent => agent.id !== f.parent.id && agent.id !== task.workerAgentId)!;
    expect((await f.call(stranger.id, 'cancel-task', { taskId: task.id })).isError).toBe(true);
  });
});
