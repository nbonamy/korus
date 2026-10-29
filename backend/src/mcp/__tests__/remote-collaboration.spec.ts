import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { AppSnapshot, BackendPublishedEvent } from '@workspace/core/contracts';
import { AppStateStore } from '../../persistence/store';
import { AppBackendServer } from '../../server';
import { BackendDriverRpc } from '../../driver-rpc';
import { DurableTaskService } from '../../agents/durable-task-service';
import { codexSdkFixture, sdkSnapshot } from '../../codex/__tests__/sdk-surface-fixture';
import { readyRemoteConnection } from '../../__tests__/server-test-fixtures';
import { AppMcpService } from '../service';
import { createTaskToolModuleProvider } from '../task-tools';
import { WorktreeManager } from '../../worktrees/worktree-manager';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function host(snapshot: AppSnapshot, label: string, remoteClients?: unknown, callController?: (input: unknown) => Promise<unknown>) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'cross-host-mcp-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const store = new AppStateStore(home);
  const provider = codexSdkFixture();
  const createWorktree = vi.fn(async (input: { branchName: string }) => ({ created: true, worktree: { path: `/${label}/${input.branchName}`, name: input.branchName } }));
  const worktreeManager = new WorktreeManager({ createGitWorktree: createWorktree, getInitializationMode: () => 'off' });
  provider.surface.createConversation.mockResolvedValue(sdkSnapshot(`${label}-worker`));
  let server!: AppBackendServer;
  const tasks = new DurableTaskService({ tasks: [], save: data => store.saveTasks(data),
    agent: id => server.collaborationAgents().find(agent => agent.id === id),
    send: (agent, prompt, goal) => server.sendTaskPrompt(agent, prompt, goal),
    interrupt: (agent, turnId) => server.interruptTaskWorker(agent, turnId), onError: error => { throw error; } });
  const mcp = new AppMcpService({ snapshot, tasks, worktreeManager, persistSnapshot: () => store.save(snapshot),
    getCollaborationAgents: () => server.collaborationAgents(),
    createRemoteWorker: (...args) => server.provisionRemoteWorker(...args),
    sendRemotePrompt: (agent, prompt, goal) => server.sendTaskPrompt(agent, prompt, goal),
    sendRemoteMessage: (agent, prompt) => server.deliverRemoteMessage(agent, prompt),
    forwardCollaboration: (agentId, name, args) => server.forwardCollaborationCall(agentId, name, args),
    closeAgent: (caller, worker) => server.closeAgentFromMcp(caller, worker),
    toolModuleProviders: [createTaskToolModuleProvider(tasks, id => Boolean(snapshot.teams.find(team => team.id === snapshot.agents.find(agent => agent.id === id)?.teamId)?.collaborationOwnerId))],
  });
  const rpc = new BackendDriverRpc(new Map([['codex', provider.driver]]));
  const events = new Set<(event: BackendPublishedEvent) => void>();
  server = new AppBackendServer({ version: 'test', snapshot, driverRpc: rpc, tasks,
    ...(remoteClients ? { remoteClients: remoteClients as never } : {}),
    saveSnapshot: data => store.save(data),
    collaborationTools: { provisionWorker: input => mcp.provisionRemoteWorker(input), callTool: (...args) => mcp.callTool(...args) },
    requestCollaborationController: callController,
    onBackendEventApplied: event => { mcp.handleBackendEvent(event); tasks.handleEvent(event); },
    onEvent: event => { for (const listener of events) listener(event); },
  });
  mcp.setDriverRpc(rpc);
  mcp.setEventSink(event => server.emitEvent(event));
  await mcp.start();
  cleanup.push(async () => { tasks.close(); await worktreeManager.close(); await mcp.stop(); await server.close(); await tasks.flush(); });
  for (const id of [`${label}-worker`, `${label}-parent`]) {
    const conversation = provider.conversation(id);
    conversation.handle.sendMessage.mockImplementation(async () => {
      conversation.setSnapshot({ activeTurnId: `${label}-turn`, busy: true });
      conversation.emit({ seq: 1, origin: 'notification', occurredAt: '2026-10-29T00:00:00Z', conversationId: id,
        turnId: `${label}-turn`, type: 'turn.started', payload: { turn: { id: `${label}-turn`, status: 'inProgress', items: [], error: null } } } as never);
      return conversation.handle.getSnapshot();
    });
  }
  return { server, mcp, snapshot, store, tasks, provider, events, createWorktree };
}

describe('collaboration across daemon ownership boundaries', () => {
  it.each(['completion', 'cancellation', 'controller outage'] as const)('creates once on the selected host, exchanges messages, and persists remote %s', async lifecycle => {
    const local = createInitialSnapshot();
    const parent = local.agents[0]!;
    parent.backendSession = { kind: 'codex', threadId: 'local-parent' };
    local.remoteConnections.connections = [readyRemoteConnection()];
    local.providerConnections = [{ backend: 'codex', connected: true, installed: true, checking: false }];
    const remote = createInitialSnapshot();
    remote.agents = [];
    remote.teams.forEach(team => { team.agentIds = []; delete team.activeAgentId; });
    remote.providerConnections = local.providerConnections;
    let owner!: Awaited<ReturnType<typeof host>>;
    let controllerConnected = true;
    const workerHost = await host(remote, 'remote', undefined, input => {
      if (!controllerConnected) return Promise.reject(new Error('Controller disconnected'));
      return owner.server.handleRemoteCollaborationCall('connection-devbox', input);
    });
    let connected = true;
    const clients = { close: vi.fn(), request: vi.fn(async (_connection, method, params, onEvent) => {
      if (!connected) throw new Error('Host disconnected');
      workerHost.events.clear();
      if (onEvent) workerHost.events.add(onEvent);
      const response = await workerHost.server.handleMessage({ jsonrpc: '2.0', id: 'ssh', method, params });
      if (!response || 'error' in response) throw new Error(response && 'error' in response ? response.error.message : 'No response');
      return response.result;
    }) };
    owner = await host(local, 'local', clients);
    const spec = { remoteConnectionId: 'connection-devbox', repoPath: '/remote/repo', prompt: 'Inspect the remote repository',
      createWorktree: true, branchName: 'remote-inspection', startingContext: 'conversation',
      requestId: 'remote-inspection', task: { title: 'Remote inspection', doneWhen: 'Findings verified' } };
    const created = await owner.mcp.callTool(parent.id, 'create-agent', spec);
    expect(created.isError).toBe(false);
    const result = created.structuredContent!;
    const workerId = result.agentId as string;
    expect(local.agents.map(agent => agent.id)).not.toContain(workerId);
    expect(remote.agents.find(agent => agent.id === workerId)?.folder).toBe('/remote/remote-inspection');
    expect(result.delegationContext).toMatchObject({ requested: 'conversation', effective: 'handoff' });
    expect(owner.createWorktree).not.toHaveBeenCalled();
    expect((await owner.store.loadTasks())[0]?.workspace).toMatchObject({ remoteConnectionId: 'connection-devbox' });
    expect(await owner.server.handleMessage({ jsonrpc: '2.0', id: 'tasks', method: backendMethods.agentTasksList, params: { agentId: workerId } }))
      .toMatchObject({ result: [expect.objectContaining({ id: result.taskId, workerAgentId: workerId })] });
    const retry = await owner.mcp.callTool(parent.id, 'create-agent', spec);
    expect(retry.structuredContent?.agentId).toBe(workerId);
    expect(workerHost.provider.surface.createConversation).toHaveBeenCalledOnce();
    const remoteConversation = workerHost.provider.conversation('remote-worker');
    remoteConversation.handle.readHistory.mockResolvedValue({ ...sdkSnapshot('remote-worker'), conversationId: 'remote-worker' });
    expect(await owner.server.readTaskHistory(owner.server.collaborationAgents().find(agent => agent.id === workerId)!)).toStrictEqual([]);
    expect(remoteConversation.handle.readHistory).toHaveBeenCalledOnce();
    expect(owner.provider.conversation('remote-worker').handle.readHistory).not.toHaveBeenCalled();
    const roster = await workerHost.mcp.callTool(workerId, 'list-agents', {});
    expect(roster.structuredContent?.agents).toEqual(expect.arrayContaining([expect.objectContaining({ id: parent.id }), expect.objectContaining({ id: workerId })]));
    expect((await workerHost.mcp.callTool(workerId, 'send-message', { to: parent.id, content: 'Remote question' })).isError).toBe(false);
    await vi.waitFor(() => expect(owner.provider.conversation('local-parent').handle.sendMessage).toHaveBeenCalledOnce());
    expect((await owner.mcp.callTool(parent.id, 'send-message', { to: workerId, content: 'Local answer' })).isError).toBe(false);
    await vi.waitFor(() => expect(workerHost.provider.conversation('remote-worker').handle.steerMessage).toHaveBeenCalled());
    connected = false;
    await expect(owner.server.sendTaskPrompt(owner.server.collaborationAgents().find(agent => agent.id === workerId)!, 'Do not replay')).rejects.toThrow('Host disconnected');
    connected = true;
    if (lifecycle === 'cancellation') {
      const cancelled = await workerHost.mcp.callTool(workerId, 'cancel-task', { taskId: result.taskId });
      expect(cancelled.isError).toBe(false);
      expect((await owner.store.loadTasks())[0]?.state).toBe('cancelled');
      expect(workerHost.provider.conversation('remote-worker').handle.interrupt).toHaveBeenCalledOnce();
      expect((await workerHost.mcp.callTool(workerId, 'complete-task', { summary: 'Late result', evidence: [], artifacts: [], caveats: [] })).isError).toBe(true);
      return;
    }
    if (lifecycle === 'controller outage') controllerConnected = false;
    if (lifecycle === 'completion') {
      const child = await workerHost.mcp.callTool(workerId, 'create-agent', { remoteConnectionId: 'local', repoPath: '/local/repo', createWorktree: true,
        branchName: 'controller-inspection', startingContext: 'conversation', prompt: 'Inspect on the controller' });
      expect(child.isError).toBe(false);
      expect(child.structuredContent?.folder).toBe('/local/controller-inspection');
      expect(child.structuredContent?.delegationContext).toMatchObject({ requested: 'conversation', effective: 'handoff' });
      expect(owner.provider.conversation('remote-worker').handle.fork).not.toHaveBeenCalled();
    }
    const submitted = await workerHost.mcp.callTool(workerId, 'complete-task', { summary: 'Remote findings verified', evidence: ['Inspected'], artifacts: [], caveats: [] });
    expect(submitted.isError).toBe(lifecycle === 'controller outage');
    const conversation = workerHost.provider.conversation('remote-worker');
    conversation.setSnapshot({ busy: false, activeTurnId: null });
    conversation.emit({ seq: 2, origin: 'notification', occurredAt: '2026-10-29T00:00:01Z', conversationId: 'remote-worker', turnId: 'remote-turn',
      type: 'turn.completed', payload: { status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null } } as never);
    conversation.emit({ seq: 3, origin: 'notification', occurredAt: '2026-10-29T00:00:01Z', conversationId: 'remote-worker',
      type: 'conversation.activityChanged', payload: { threadStatus: { type: 'idle' }, busy: false, error: null } });
    if (lifecycle === 'controller outage') {
      await vi.waitFor(async () => expect((await owner.store.loadTasks())[0]).toMatchObject({ state: 'interrupted' }));
      expect((await owner.store.loadTasks())[0]?.delivery).toBeUndefined();
      expect(remoteConversation.handle.sendMessage).toHaveBeenCalledOnce();
      return;
    }
    await vi.waitFor(async () => expect((await owner.store.loadTasks())[0]).toMatchObject({ state: 'completed', submission: { summary: 'Remote findings verified' } }));
    const outcome = await owner.mcp.callTool(parent.id, 'wait-tasks', { taskIds: [result.taskId] });
    expect(outcome.structuredContent?.tasks).toEqual([expect.objectContaining({ state: 'completed' })]);
    const parentConversation = owner.provider.conversation('local-parent');
    parentConversation.setSnapshot({ busy: false, activeTurnId: null });
    parentConversation.emit({ seq: 2, origin: 'notification', occurredAt: '2026-10-29T00:00:01Z', conversationId: 'local-parent', turnId: 'local-turn',
      type: 'turn.completed', payload: { status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null } } as never);
    parentConversation.emit({ seq: 3, origin: 'notification', occurredAt: '2026-10-29T00:00:01Z', conversationId: 'local-parent',
      type: 'conversation.activityChanged', payload: { threadStatus: { type: 'idle' }, busy: false, error: null } });
    await vi.waitFor(async () => expect((await owner.store.loadTasks())[0]?.delivery?.state).toBe('accepted'));
    expect(parentConversation.handle.sendMessage).toHaveBeenCalledTimes(2);
    await expect(owner.server.handleRemoteCollaborationCall('connection-devbox', { ownerId: 'wrong', agentId: workerId, name: 'list-agents', arguments: {} })).rejects.toThrow();
    expect((await owner.mcp.callTool(parent.id, 'close-agent', { agentId: workerId })).isError).toBe(false);
    expect(remote.agents.some(agent => agent.id === workerId)).toBe(false);
  });
});
