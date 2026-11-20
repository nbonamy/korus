import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { Agent } from '@workspace/core/contracts';
import type { DelegatedTask } from '@workspace/core/delegated-task';
import { codexSdkFixture, sdkSnapshot } from '../../codex/__tests__/sdk-host-fixture';
import { ProviderDriverRpc } from '../../driver-rpc';
import { AppStateStore } from '../../persistence/store';
import { AppBackendServer } from '../../server';
import { WorktreeManager } from '../../worktrees/worktree-manager';
import { DurableTaskService } from '../../agents/durable-task-service';
import { AppMcpService } from '../service';

const execute = promisify(execFile);
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function harness(taskState?: DelegatedTask['state']) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'close-agent-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const snapshot = createInitialSnapshot();
  snapshot.providerConnections = [{ provider: 'codex', installed: true, connected: true, checking: false }];
  const [parent, other] = snapshot.agents;
  parent!.status = { type: 'working' };
  const worker: Agent = { ...parent!, id: 'worker', name: 'Worker', delegatedByAgentId: parent!.id, status: { type: 'idle' }, providerSession: { kind: 'codex', conversationId: 'worker-thread' } };
  snapshot.agents.push(worker);
  snapshot.teams[0]!.agentIds.push(worker.id);
  const task: DelegatedTask = {
    id: 'task', requestId: 'request', requestFingerprint: 'fingerprint', parentAgentId: parent!.id, workerAgentId: worker.id,
    provider: 'codex', assignment: { title: 'Work', doneWhen: 'Done' }, prompt: 'Work', attemptId: 'attempt',
    state: taskState ?? 'completed', createdAt: 'now', updatedAt: 'now', parentWakeBlocked: true,
  };
  const store = new AppStateStore(path.join(home, 'state'));
  const tasks = new DurableTaskService({ tasks: taskState ? [task] : [], save: data => store.saveTasks(data),
    agent: id => snapshot.agents.find(agent => agent.id === id), send: vi.fn(), interrupt: vi.fn(), onError: error => { throw error; } });
  cleanup.push(async () => { tasks.close(); await tasks.flush(); });
  const codex = codexSdkFixture();
  const rpc = new ProviderDriverRpc(new Map([['codex', codex.driver]]));
  let server!: AppBackendServer;
  const mcp = new AppMcpService({ snapshot, worktreeManager: new WorktreeManager({ getInitializationMode: () => 'off' }),
    closeAgent: (callerId, agentId) => server.closeAgentFromMcp(callerId, agentId), isAgentClosing: agentId => server.isAgentClosing(agentId) });
  const url = await mcp.start();
  cleanup.push(() => mcp.stop());
  server = new AppBackendServer({ version: 'test', snapshot, tasks, driverRpc: rpc, saveSnapshot: value => store.save(value),
    onBackendEventApplied: event => mcp.handleBackendEvent(event) });
  mcp.setEventSink(event => server.emitEvent(event));
  mcp.setDriverRpc(rpc);
  cleanup.push(async () => { await server.close(); await store.save(snapshot); });
  const call = async (callerId: string, args: Record<string, unknown>, name = 'close-agent') => {
    const response = await fetch(`${url}?agentId=${callerId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    return (await response.json() as { result: CallToolResult }).result;
  };
  const git = async (cwd: string, ...args: string[]) => (await execute('git', args, { cwd })).stdout.trim();
  return { home, snapshot, parent: parent!, other: other!, worker, tasks, store, codex, mcp, server, call, git };
}

it('closes a creator-owned worker through MCP, persists removal, and preserves dirty worktree and branch', async () => {
  const f = await harness('completed');
  const repo = path.join(f.home, 'repo');
  await f.git(f.home, 'init', '-b', 'main', repo);
  await f.git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'base');
  const created = await f.call(f.parent.id, { repoPath: repo, createWorktree: true, branchName: 'work' }, 'create-agent');
  expect(created.isError).toBe(false);
  const child = f.snapshot.agents.find(agent => agent.id === created.structuredContent!.agentId)!;
  expect(child.delegatedByAgentId).toBe(f.parent.id);
  child.providerSession = { kind: 'codex', conversationId: 'child-thread' };
  await writeFile(path.join(child.folder!, 'uncommitted.txt'), 'keep my work');
  expect((await f.call(f.parent.id, { agentId: child.id })).structuredContent).toMatchObject({ success: true, agentId: child.id });
  expect((await f.store.load()).agents.some(agent => agent.id === child.id)).toBe(false);
  expect(f.snapshot.teams.flatMap(team => team.agentIds)).not.toContain(child.id);
  expect(await readFile(path.join(child.folder!, 'uncommitted.txt'), 'utf8')).toBe('keep my work');
  expect(await f.git(repo, 'worktree', 'list', '--porcelain')).toContain(child.folder);
  expect(await f.git(repo, 'show-ref', '--verify', 'refs/heads/work')).toContain('refs/heads/work');
  expect((await f.call(f.parent.id, { agentId: f.worker.id })).isError).toBe(false);
  expect(f.tasks.list(f.parent.id)[0]!.state).toBe('completed');
});

it('lets the creator close a co-agent after its initial prompt fails', async () => {
  const f = await harness();
  f.codex.surface.createConversation.mockRejectedValueOnce(new Error('Provider startup rejected'));
  const result = await f.call(f.parent.id, { targets: [{ repoPath: f.home, prompt: 'Review performance.' }] }, 'create-agent');
  expect(result.structuredContent).toMatchObject({ success: false, results: [{ success: false, agentId: expect.any(String), message: 'Provider startup rejected' }] });
  const [failed] = result.structuredContent!.results as Array<{ agentId: string }>;
  expect(f.snapshot.agents.find(agent => agent.id === failed!.agentId)?.status).toMatchObject({ type: 'error' });
  expect((await f.call(f.other.id, { agentId: failed!.agentId })).isError).toBe(true);
  expect((await f.call(f.parent.id, { agentId: failed!.agentId })).structuredContent).toMatchObject({ success: true });
  expect((await f.store.load()).agents.some(agent => agent.id === failed!.agentId)).toBe(false);
});

it.each(['working', 'awaitingInput'] as const)('lets the creator close a co-agent with status %s without delivering its queued prompt', async type => {
  const f = await harness();
  const conversation = f.codex.conversation('worker-thread');
  conversation.setSnapshot({ busy: true, activeTurnId: 'worker-turn' });
  f.worker.status = { type };
  f.snapshot.queuedPrompts = [{ id: 'queued', agentId: f.worker.id, text: 'Do not start during closure', createdAt: 'now' }];
  if (type === 'awaitingInput') {
    f.server.emitEvent({ type: 'agentRequest.created', agentId: f.worker.id, provider: 'codex', payload: { request: {
      id: 'question', kind: 'question', conversationId: 'worker-thread',
      question: { itemId: 'item', delivery: 'tool', blocking: true, questions: [] },
    } } });
  }
  conversation.handle.interrupt.mockImplementationOnce(async () => {
    conversation.setSnapshot({ busy: false, activeTurnId: null });
    f.server.emitEvent({ type: 'agent.statusChanged', agentId: f.worker.id, payload: { type: 'idle' } });
    f.mcp.sendMessage(f.other.id, f.worker.id, 'Message arriving during shutdown');
    return sdkSnapshot('worker-thread');
  });

  expect((await f.call(f.other.id, { agentId: f.worker.id })).isError).toBe(true);
  expect(conversation.handle.interrupt).not.toHaveBeenCalled();
  expect((await f.call(f.parent.id, { agentId: f.worker.id })).structuredContent).toMatchObject({ success: true });

  expect(conversation.handle.interrupt).toHaveBeenCalledOnce();
  expect(f.codex.surface.archiveConversation).toHaveBeenCalledOnce();
  expect(conversation.handle.interrupt).toHaveBeenCalledBefore(f.codex.surface.archiveConversation);
  expect(conversation.handle.sendMessage).not.toHaveBeenCalled();
  expect(f.snapshot.queuedPrompts).toStrictEqual([]);
  expect(f.snapshot.agentRequests?.[f.worker.id]).toBeUndefined();
  expect((await f.store.load()).agents.some(agent => agent.id === f.worker.id)).toBe(false);
});

it('rejects unauthorized closure, in-flight submissions and handoffs, and preserves the agent if archiving fails', async () => {
  const f = await harness();
  const denied = async (callerId: string, args: Record<string, unknown>) => {
    expect((await f.call(callerId, args)).isError).toBe(true);
    expect(f.snapshot.agents).toContain(f.worker);
  };
  await denied(f.other.id, { agentId: f.worker.id });
  await denied(f.parent.id, { agentId: f.parent.id });
  await denied(f.parent.id, { agentId: f.other.id });
  await denied(f.parent.id, { agentId: 'missing' });
  await denied(f.other.id, { agentId: f.worker.id, callerId: f.parent.id });
  await denied(f.parent.id, { agentId: f.worker.id, deleteWorktree: true, deleteRemoteBranch: true });
  f.worker.status = { type: 'error', message: 'Startup failed' };
  f.worker.pendingPrompts = [{ id: 'pending', text: 'Still submitting', createdAt: 'now' }];
  await denied(f.parent.id, { agentId: f.worker.id });
  delete f.worker.pendingPrompts;
  f.worker.status = { type: 'idle' };
  f.worker.handoff = { operationId: 'handoff', sourceAgentId: f.worker.id, sourceTitle: 'Worker', sourceRef: { provider: 'codex', conversationId: 'worker-thread' }, phase: 'preparing', selection: {model: null, reasoningEffort: null, serviceTier: null,  provider: 'claude' } };
  await denied(f.parent.id, { agentId: f.worker.id });
  delete f.worker.handoff;
  f.snapshot.queuedPrompts = [{ id: 'queued', agentId: f.worker.id, text: 'Keep until closure succeeds', createdAt: 'now' }];
  f.codex.surface.archiveConversation.mockRejectedValueOnce(new Error('Provider unavailable'));
  await denied(f.parent.id, { agentId: f.worker.id });
  expect(f.snapshot.queuedPrompts.map(prompt => prompt.id)).toEqual(['queued']);
  expect((await f.call(f.parent.id, { agentId: f.worker.id })).isError).toBe(false);
  expect(f.snapshot.queuedPrompts).toEqual([]);
});

it.each(['preparing', 'running', 'needs-input', 'interrupted'] as const)('preserves an idle worker with a %s durable task', async state => {
  const f = await harness(state);
  const result = await f.call(f.parent.id, { agentId: f.worker.id });
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([expect.objectContaining({ text: expect.stringContaining('task') })]);
  expect(f.snapshot.agents).toContain(f.worker);
  expect(f.tasks.list(f.parent.id)[0]!.state).toBe(state);
});
