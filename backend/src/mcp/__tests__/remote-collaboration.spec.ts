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
import { codexSdkFixture, sdkSnapshot, sdkSummary } from '../../codex/__tests__/sdk-surface-fixture';
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
    sendRemoteMessage: (agent, prompt, messageId) => server.deliverRemoteMessage(agent, prompt, messageId),
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
  cleanup.push(async () => { tasks.close(); await worktreeManager.close(); await mcp.stop(); await server.close(); await tasks.flush(); await store.save(snapshot); });
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

async function connectedPair() {
  const local = createInitialSnapshot();
  local.providerConnections = [{ backend: 'codex', connected: true, installed: true, checking: false }];
  local.remoteConnections.connections = [readyRemoteConnection()];
  const remote = createInitialSnapshot();
  remote.agents = [];
  remote.teams.forEach(team => { team.agentIds = []; });
  remote.providerConnections = local.providerConnections;
  let owner!: Awaited<ReturnType<typeof host>>;
  const workerHost = await host(remote, 'remote', undefined, input => owner.server.handleRemoteCollaborationCall('connection-devbox', input));
  const network = { online: true, loseReply: false };
  const clients = { close: vi.fn(), request: vi.fn(async (_connection, method, params, onEvent) => {
    if (!network.online) throw new Error('Host disconnected');
    workerHost.events.clear();
    if (onEvent) workerHost.events.add(onEvent);
    const response = await workerHost.server.handleMessage({ jsonrpc: '2.0', id: 'ssh', method, params });
    if (!response || 'error' in response) throw new Error(response && 'error' in response ? response.error.message : 'No response');
    if (network.loseReply && method === 'collaboration/message/send') {
      network.loseReply = false;
      throw new Error('SSH reply lost after admission');
    }
    return response.result;
  }) };
  owner = await host(local, 'local', clients);
  const created = await owner.server.handleMessage({ jsonrpc: '2.0', id: 'ui', method: backendMethods.agentQuickChatCreate,
    params: { input: { teamId: local.teams[0]!.id, remoteConnectionId: 'connection-devbox', selection: { backend: 'codex' } }, entityResult: true } });
  if (!created || 'error' in created) throw new Error('UI chat creation failed');
  const workerId = (created.result as { agentId: string }).agentId;
  const worker = remote.agents.find(agent => agent.id === workerId)!;
  worker.backendSession = { kind: 'codex', threadId: 'remote-worker' };
  return { owner, workerHost, network, clients, worker,
    send: (content: string) => owner.mcp.callTool(local.agents[0]!.id, 'send-message', { to: workerId, content }) };
}

describe('collaboration across daemon ownership boundaries', () => {
  it.each([false, true])('inherits the authoritative same-host parent conversation (durable task: %s)', async durable => {
    const { owner, workerHost, worker } = await connectedPair();
    const parentConversation = workerHost.provider.conversation('remote-worker');
    const childConversation = workerHost.provider.conversation('remote-child');
    parentConversation.handle.fork.mockResolvedValue({ conversationId: 'remote-child', conversation: workerHost.provider.surface.conversation('remote-child'), snapshot: sdkSnapshot('remote-child') });
    childConversation.handle.sendMessage.mockImplementation(async () => {
      childConversation.setSnapshot({ busy: true, activeTurnId: 'child-turn' });
      return childConversation.handle.getSnapshot();
    });
    const created = await workerHost.mcp.callTool(worker.id, 'create-agent', {
      repoPath: '/remote/repo', startingContext: 'conversation', createWorktree: true,
      branchName: 'same-host-child', prompt: 'Inspect the inherited context',
      ...(durable ? { requestId: 'same-host-child', task: { title: 'Inspect', doneWhen: 'Verified' } } : {}),
    });
    expect(created.isError).toBe(false);
    expect(created.structuredContent?.delegationContext).toStrictEqual({ requested: 'conversation', effective: 'conversation' });
    const childId = created.structuredContent!.agentId as string;
    expect(workerHost.snapshot.agents.find(agent => agent.id === childId)).toMatchObject({
      teamId: worker.teamId, delegatedByAgentId: worker.id, folder: '/remote/same-host-child',
      backendSession: { kind: 'codex', threadId: 'remote-child' },
    });
    expect(parentConversation.handle.fork).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ cwd: '/remote/same-host-child' }), { extensionContext: expect.objectContaining({ id: childId }) });
    expect(childConversation.handle.sendMessage).toHaveBeenCalledOnce();
    expect(owner.provider.conversation('remote-worker').handle.fork).not.toHaveBeenCalled();
    expect(parentConversation.handle.sendMessage).not.toHaveBeenCalled();
    if (durable) expect((await owner.store.loadTasks())[0]).toMatchObject({ workerAgentId: childId, acceptance: { backendSession: { kind: 'codex', threadId: 'remote-child' } } });
  });

  it.each(['missing', 'other-team', 'different-caller'])('rejects a %s local parent in remote provisioning', async invalid => {
    const { owner, workerHost, worker } = await connectedPair();
    const link = owner.snapshot.teams[0]!.remoteLinks![0]!;
    if (invalid === 'other-team') worker.teamId = workerHost.snapshot.teams.find(team => team.id !== link.remoteTeamId)!.id;
    const count = workerHost.snapshot.agents.length;
    await expect(workerHost.server.handleMessage({ jsonrpc: '2.0', id: 'invalid-parent', method: backendMethods.collaborationWorkerCreate, params: {
      ownerId: link.collaborationOwnerId, teamId: link.remoteTeamId, agentId: 'invalid-child',
      localCallerId: invalid === 'missing' ? 'missing' : worker.id,
      caller: { ...worker, ...(invalid === 'different-caller' ? { id: 'different' } : {}) },
      input: { repoPath: '/remote/repo', createWorktree: true, branchName: 'invalid-child', startingContext: 'conversation' },
      assignmentPrompt: 'Inspect',
    } })).rejects.toThrow('parent');
    expect(workerHost.snapshot.agents).toHaveLength(count);
    expect(workerHost.createWorktree).not.toHaveBeenCalled();
  });

  it('gives a UI-created remote chat its controlling roster, messaging and delegation', async () => {
    const local = createInitialSnapshot();
    local.providerConnections = [{ backend: 'codex', connected: true, installed: true, checking: false }];
    local.remoteConnections.connections = [readyRemoteConnection()];
    const parent = local.agents[0]!;
    parent.backendSession = { kind: 'codex', threadId: 'local-parent' };
    const remote = createInitialSnapshot();
    remote.providerConnections = local.providerConnections;
    remote.agents = [];
    remote.teams.forEach(team => { team.agentIds = []; });
    let owner!: Awaited<ReturnType<typeof host>>;
    const workerHost = await host(remote, 'remote', undefined, input => owner.server.handleRemoteCollaborationCall('connection-devbox', input));
    const clients = { close: vi.fn(), request: vi.fn(async (_connection, method, params, onEvent) => {
      workerHost.events.clear();
      if (onEvent) workerHost.events.add(onEvent);
      const response = await workerHost.server.handleMessage({ jsonrpc: '2.0', id: 'ssh', method, params });
      if (!response || 'error' in response) throw new Error(response && 'error' in response ? response.error.message : 'No response');
      return response.result;
    }) };
    owner = await host(local, 'local', clients);
    const created = await owner.server.handleMessage({ jsonrpc: '2.0', id: 'ui', method: backendMethods.agentQuickChatCreate,
      params: { input: { teamId: local.teams[0]!.id, remoteConnectionId: 'connection-devbox', selection: { backend: 'codex' } }, entityResult: true } });
    if (!created || 'error' in created) throw new Error('UI chat creation failed');
    const workerId = (created.result as { agentId: string }).agentId;
    const roster = await workerHost.mcp.callTool(workerId, 'list-agents', {});
    expect(roster.structuredContent?.agents).toEqual(expect.arrayContaining([expect.objectContaining({ id: parent.id }), expect.objectContaining({ id: workerId })]));
    expect((await workerHost.mcp.callTool(workerId, 'send-message', { to: parent.id, content: 'Question from UI-created remote chat' })).isError).toBe(false);
    await vi.waitFor(() => expect(owner.provider.conversation('local-parent').handle.sendMessage).toHaveBeenCalledOnce());
    const child = await workerHost.mcp.callTool(workerId, 'create-agent', { remoteConnectionId: 'local', repoPath: '/local/repo' });
    expect(child.isError).toBe(false);
    expect(local.agents.find(agent => agent.id === child.structuredContent?.agentId)).toMatchObject({ teamId: local.teams[0]!.id, delegatedByAgentId: workerId });
    const ownerId = local.teams[0]!.remoteLinks![0]!.collaborationOwnerId;
    expect(remote.teams.find(team => team.id === local.teams[0]!.remoteLinks![0]!.remoteTeamId)?.collaborationOwnerId).toBe(ownerId);
  });

  it('retains remote-parent results across Stop racing completion and delivers after a user resume', async () => {
    const { owner, workerHost, worker } = await connectedPair();
    workerHost.provider.surface.readConversationSummary.mockResolvedValue(sdkSummary('remote-worker'));
    await workerHost.server.sendTaskPrompt(worker, 'Work as parent');
    const parent = workerHost.provider.conversation('remote-worker');
    const created = await workerHost.mcp.callTool(worker.id, 'create-agent', {
      remoteConnectionId: 'local', repoPath: '/local/repo', prompt: 'Inspect',
      requestId: 'stopped-parent-child', task: { title: 'Inspect', doneWhen: 'Verified' },
    });
    expect(created.isError).toBe(false);
    parent.handle.interrupt.mockImplementationOnce(async () => {
      expect((await owner.store.loadTasks())[0]).toMatchObject({ parentWakeBlocked: true, parentStopRequested: true });
      parent.setSnapshot({ busy: false, activeTurnId: null });
      parent.emit({ seq: 2, origin: 'notification', occurredAt: '', conversationId: 'remote-worker', turnId: 'remote-turn',
        type: 'turn.completed', payload: { status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null } } as never);
      parent.emit({ seq: 3, origin: 'notification', occurredAt: '', conversationId: 'remote-worker',
        type: 'conversation.activityChanged', payload: { threadStatus: { type: 'idle' }, busy: false, error: null } });
      return parent.handle.getSnapshot();
    });
    await owner.server.handleMessage({ jsonrpc: '2.0', id: 'stop', method: backendMethods.agentInterrupt, params: { agentId: worker.id } });
    const childId = created.structuredContent!.agentId as string;
    expect((await owner.mcp.callTool(childId, 'complete-task', { summary: 'Verified', evidence: [], artifacts: [], caveats: [] })).isError).toBe(false);
    const child = owner.provider.conversation('local-worker');
    child.setSnapshot({ busy: false, activeTurnId: null });
    child.emit({ seq: 2, origin: 'notification', occurredAt: '', conversationId: 'local-worker', turnId: 'local-turn',
      type: 'turn.completed', payload: { status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null } } as never);
    await vi.waitFor(() => expect(owner.tasks.list(worker.id)[0]).toMatchObject({ state: 'completed', delivery: { state: 'pending' } }));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(owner.tasks.list(worker.id)[0]).toMatchObject({ parentWakeBlocked: true, parentStopRequested: true, delivery: { state: 'pending' } });
    expect(parent.handle.sendMessage).toHaveBeenCalledOnce();

    let seq = 3;
    parent.handle.sendMessage.mockImplementation(async () => {
      const turnId = seq === 3 ? 'resume-turn' : 'delivery-turn';
      parent.setSnapshot({ busy: true, activeTurnId: turnId });
      parent.emit({ seq: ++seq, origin: 'notification', occurredAt: '', conversationId: 'remote-worker', turnId,
        type: 'turn.started', payload: { turn: { id: turnId, status: 'inProgress', items: [], error: null } } } as never);
      return parent.handle.getSnapshot();
    });
    await owner.server.handleMessage({ jsonrpc: '2.0', id: 'resume', method: backendMethods.agentPromptSend, params: { agentId: worker.id, prompt: 'Resume my work' } });
    parent.setSnapshot({ busy: false, activeTurnId: null });
    parent.emit({ seq: ++seq, origin: 'notification', occurredAt: '', conversationId: 'remote-worker', turnId: 'resume-turn',
      type: 'turn.completed', payload: { status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null } } as never);
    parent.emit({ seq: ++seq, origin: 'notification', occurredAt: '', conversationId: 'remote-worker',
      type: 'conversation.activityChanged', payload: { threadStatus: { type: 'idle' }, busy: false, error: null } });
    await vi.waitFor(() => expect(owner.tasks.list(worker.id)[0]?.delivery?.state).toBe('accepted'));
    expect(parent.handle.sendMessage).toHaveBeenCalledTimes(3);
  });

  it.each(['approval', 'failed steering', 'non-steerable provider'] as const)('queues remote messages on the worker during %s and drains them after idle', async state => {
    const { owner, workerHost, worker, send } = await connectedPair();
    const conversation = workerHost.provider.conversation('remote-worker');
    conversation.setSnapshot({ busy: true, activeTurnId: 'remote-turn' });
    if (state === 'failed steering') conversation.handle.steerMessage.mockRejectedValueOnce(new Error('Turn changed'));
    if (state === 'non-steerable provider') {
      // Driver capabilities are the server's provider boundary; this host cannot steer its active turn.
      const capabilities = workerHost.provider.driver.getCapabilities(worker);
      vi.spyOn(workerHost.provider.driver, 'getCapabilities').mockReturnValue({ ...capabilities, steerPrompt: false });
    }
    workerHost.server.emitEvent({ agentId: worker.id, type: 'agent.statusChanged', payload: state === 'approval'
      ? { type: 'awaitingInput' } : { type: 'working' } });
    expect((await send('Handle this when ready')).isError).toBe(false);
    await vi.waitFor(() => expect(workerHost.snapshot.queuedPrompts).toEqual([
      expect.objectContaining({ agentId: worker.id, text: expect.stringContaining('Handle this when ready') }),
    ]));
    expect(owner.snapshot.queuedPrompts).toStrictEqual([]);
    expect(await owner.server.handleMessage({ jsonrpc: '2.0', id: 'queue', method: backendMethods.snapshotGet }))
      .toMatchObject({ result: { snapshot: { queuedPrompts: [expect.objectContaining({ agentId: worker.id })] } } });
    conversation.setSnapshot({ busy: false, activeTurnId: null });
    workerHost.server.emitEvent({ agentId: worker.id, type: 'agent.statusChanged', payload: { type: 'idle' } });
    await vi.waitFor(() => expect(conversation.handle.sendMessage).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(workerHost.snapshot.queuedPrompts).toStrictEqual([]));
    if (state === 'non-steerable provider') expect(conversation.handle.steerMessage).not.toHaveBeenCalled();
  });

  it('retries offline remote messages and deduplicates admission after a lost reply', async () => {
    const { owner, workerHost, worker, network, send } = await connectedPair();
    const conversation = workerHost.provider.conversation('remote-worker');
    network.online = false;
    expect((await send('Read after reconnect')).isError).toBe(false);
    await vi.waitFor(() => expect(owner.snapshot.queuedPrompts).toStrictEqual([]));
    network.online = true;
    await vi.waitFor(() => expect(conversation.handle.sendMessage).toHaveBeenCalledOnce(), { timeout: 4000 });
    workerHost.server.emitEvent({ agentId: worker.id, type: 'agent.statusChanged', payload: { type: 'awaitingInput' } });
    network.loseReply = true;
    expect((await send('Admit exactly once')).isError).toBe(false);
    await vi.waitFor(() => expect(network.loseReply).toBe(false));
    await vi.waitFor(async () => expect((await workerHost.mcp.callTool(worker.id, 'check-messages', { markAsRead: false })).structuredContent?.messages).toStrictEqual([]), { timeout: 4000 });
    expect(workerHost.snapshot.queuedPrompts).toHaveLength(1);
    workerHost.server.emitEvent({ agentId: worker.id, type: 'agent.statusChanged', payload: { type: 'idle' } });
    await vi.waitFor(() => expect(conversation.handle.sendMessage).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(workerHost.snapshot.queuedPrompts).toStrictEqual([]));
    expect(owner.snapshot.queuedPrompts).toStrictEqual([]);
  });

  it.each(['confirmed deletion', 'lost deletion reply'] as const)('resumes mixed-host cleanup after restart following %s', async failure => {
    const local = createInitialSnapshot();
    const team = local.teams[0]!;
    local.teams.push({ id: 'local-fallback', name: 'Other', agentIds: [] });
    local.remoteConnections.connections = [readyRemoteConnection(), { ...readyRemoteConnection(), id: 'second-host', name: 'second' }];
    team.remoteLinks = [{ connectionId: 'connection-devbox', remoteTeamId: 'first-team' }, { connectionId: 'second-host', remoteTeamId: 'second-team' }];
    const first = createInitialSnapshot();
    first.teams.push({ id: 'first-team', name: 'First hidden', agentIds: [] });
    const second = createInitialSnapshot();
    second.teams.push({ id: 'second-team', name: 'Second hidden', agentIds: [] });
    const firstHost = await host(first, 'first');
    const secondHost = await host(second, 'second');
    const keptAgents = [first.agents[0]!.id, second.agents[0]!.id];
    let online = false;
    let loseReply = failure === 'lost deletion reply';
    const clients = { close: vi.fn(), request: vi.fn(async (connection, method, params) => {
      if (connection.id === 'second-host' && !online) throw new Error('Second host disconnected');
      const target = connection.id === 'second-host' ? secondHost : firstHost;
      const response = await target.server.handleMessage({ jsonrpc: '2.0', id: 'ssh', method, params });
      if (!response || 'error' in response) throw new Error(response && 'error' in response ? response.error.message : 'No response');
      if (loseReply && method === backendMethods.teamDelete) { loseReply = false; throw new Error('Deletion reply lost'); }
      return response.result;
    }) };
    let owner = await host(local, 'local', clients);
    await owner.store.save(local);
    const deletion = { jsonrpc: '2.0', id: 'delete', method: backendMethods.teamDelete, params: { teamId: team.id } } as const;
    await expect(owner.server.handleMessage(deletion)).rejects.toThrow(failure === 'confirmed deletion' ? 'Second host disconnected' : 'Deletion reply lost');
    expect(first.teams.some(team => team.id === 'first-team')).toBe(false);
    const restored = await owner.store.load();
    expect(restored.teams.find(candidate => candidate.id === team.id)?.remoteLinks?.map(link => link.connectionId))
      .toStrictEqual(failure === 'confirmed deletion' ? ['second-host'] : ['connection-devbox', 'second-host']);
    await owner.mcp.stop();
    await owner.server.close();
    owner = await host(restored, 'restarted', clients);
    online = true;
    expect(await owner.server.handleMessage(deletion)).toMatchObject({ result: { teams: [{ id: 'local-fallback' }] } });
    expect([first.agents[0]!.id, second.agents[0]!.id]).toStrictEqual(keptAgents);
    expect(second.teams.some(team => team.id === 'second-team')).toBe(false);
    const lastRealTeam = { jsonrpc: '2.0', id: 'protected', method: backendMethods.teamDelete,
      params: { teamId: first.teams[0]!.id, missingOk: true } } as const;
    await expect(firstHost.server.handleMessage(lastRealTeam)).rejects.toThrow('At least one team must remain open');
  });

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
