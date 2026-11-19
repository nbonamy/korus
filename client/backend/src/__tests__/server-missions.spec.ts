import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import { sessionError, turnCompleted, turnStarted } from './support/conversation-activity';
import { AppBackendServer } from '../server';
import { scriptedDriver } from './support/scripted-driver';
import { createInitialSnapshot } from '@workspace/core/snapshot-construction';
import { persistedStateFromSnapshot, snapshotFromPersistedState } from '../state-persistence';
import type { AppSnapshot } from '@workspace/core/contracts';
import { AgentGitService } from '../git/agent-git-service';
import { applyMissionDebugFixture } from '../mission-debug-fixtures';
import { applyMissionScreenshotFixture } from '../mission-screenshot-fixture';
import { missionCreatedWorkspaces } from '@workspace/core/mission-execution';
import { readyRemoteConnection } from './server-test-fixtures';
import { CompanionGateway, type GatewayPort } from '../companion/gateway';
import { companionWorkspaceOf } from '@workspace/core/companion-projection';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';

/** A Codex driver that accepts every prompt as `session` (reporting `turnId` when given). */
function acceptingDriver(session: unknown, turnId?: string) {
  const scripted = scriptedDriver('codex');
  scripted.respondAlways('sendPrompt', () => ({ providerSession: session, ...(turnId ? { turnId } : {}) }));
  return scripted;
}

describe('mission backend boundary', () => {
  it('dispatches on the remote daemon with the controller offline and projects the worker on reconnect', async () => {
    const git = promisify(execFile);
    const root = await mkdtemp(join(tmpdir(), 'remote-mission-'));
    const origin = join(root, 'origin'), source = join(root, 'devbox'), home = join(root, 'mission');
    let controller: AppBackendServer | undefined, host: AppBackendServer | undefined;
    try {
      await git('git', ['init', '-b', 'main', origin]);
      await git('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'initial'], { cwd: origin });
      await mkdir(source);
      await mkdir(home);
      vi.stubEnv('GIT_CONFIG_COUNT', '1');
      vi.stubEnv('GIT_CONFIG_KEY_0', `url.${pathToFileURL(origin).href}.insteadOf`);
      vi.stubEnv('GIT_CONFIG_VALUE_0', 'https://git.example.invalid/team/assigned.git');
      vi.stubEnv('GIT_ALLOW_PROTOCOL', 'file');

      const local = createInitialSnapshot(), remote = createInitialSnapshot();
      remote.providerConnections = [{ provider: 'codex', installed: true, connected: true, checking: false }];
      remote.sourceFolder = { ...remote.sourceFolder, initialized: true, path: source };
      const member = local.agents[0]!;
      const repositories: [typeof member, string][] = [[member, 'assigned'], [{ ...member, id: 'agent-unused' }, 'unused']];
      for (const [agent, repo] of repositories) {
        const folder = `/laptop/${repo}`;
        agent.folder = folder;
        agent.workspace = { kind: 'git', folder, repositoryName: repo, repositoryRoot: folder, primaryWorktreeRoot: folder,
          branch: 'main', isLinkedWorktree: false, originUrl: `https://git.example.invalid/team/${repo}.git`, updatedAt: '' };
        if (agent !== member) { local.agents.push(agent); local.teams[0]!.agentIds.push(agent.id); }
      }
      const connection = { ...readyRemoteConnection(), daemonVersion: 'test', installedAt: new Date().toISOString() };
      local.remoteConnections.connections = [connection];
      const { driver, sentPrompts } = acceptingDriver({ kind: 'codex', conversationId: 'remote-mission-thread' });
      host = new AppBackendServer({ version: 'test', snapshot: remote, ensureMissionHome: async () => home, driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])) });
      async function call(server: AppBackendServer, method: string, params?: unknown) {
        const reply = await server.handleMessage({ jsonrpc: '2.0', id: 1, method, params });
        if (!reply || 'error' in reply) throw new Error(reply && 'error' in reply ? reply.error.message : 'Missing reply');
        return reply.result;
      }
      let disk = persistedStateFromSnapshot(local), online = true;
      let hostInspection = Promise.resolve({ ...connection }), answerInspection = () => {};
      const events = new EventEmitter();
      const connectController = (snapshot: AppSnapshot) => new AppBackendServer({
        version: 'test', snapshot, saveSnapshot: async candidate => { disk = persistedStateFromSnapshot(candidate); },
        onEvent: event => events.emit('event', event),
        sshConnections: { inspectVersions: () => hostInspection } as never,
        remoteClients: {
          request: async (_connection: unknown, method: string, params: unknown) => {
            if (!online) throw new Error('Controller offline');
            return structuredClone(await call(host!, method, params));
          },
          close: async () => {},
        } as never,
      });
      controller = connectController(local);
      const created = await call(controller, backendMethods.missionCreate, { input: {
        outcome: 'Remote planning', workflowType: 'shapeAndShipFeature', teamId: member.teamId,
        orchestratorMemberId: member.id, remoteConnectionId: 'connection-devbox',
      } }) as AppSnapshot;
      const mission = created.missions![0]!;
      expect(mission).toMatchObject({ teamId: member.teamId, remoteConnectionId: 'connection-devbox' });
      expect(local.missions ?? []).toHaveLength(0);
      const current = () => remote.missions!.find(candidate => candidate.id === mission.id)!;
      await vi.waitFor(() => expect(current().execution!.runs.at(-1)?.status).toBe('running'));
      const lead = current().execution!.runs[0]!.workerId!;
      expect(host.missionDeveloperInstructions(lead)).toContain('git.example.invalid/team/unused');
      expect(await readdir(source)).toEqual([]);
      const approve = () => call(controller!, backendMethods.missionExecute, { input: {
        id: mission.id, revision: current().revision, action: 'accept', runId: current().execution!.runs.at(-1)!.id,
      } });
      await host.writeMissionArtifact(lead, { stage: 'requirements', content: '# Requirements\nOwners can pay.' });
      await host.submitMissionResult(lead, { summary: 'Requirements ready', artifacts: {
        ...structuredClone(current().artifacts), requirements: { problem: 'Billing', acceptance: 'Owners can pay' },
      } });
      await approve();
      await vi.waitFor(() => expect(current().execution!.runs.at(-1)).toMatchObject({ stage: 'tickets', status: 'running' }));
      await host.upsertMissionTicket(lead, { title: 'Implement billing', body: 'Only this repository needs a change.', repositoryPath: 'git.example.invalid/team/assigned' });
      await host.submitMissionResult(lead, { summary: 'Tickets ready', artifacts: structuredClone(current().artifacts) });
      await approve();
      expect(current().stage).toBe('implementation');
      expect(await readdir(source)).toEqual([]);
      await controller.close();
      controller = undefined;
      online = false;
      const ticket = current().artifacts.tickets[0]!;
      await host.setMissionSchedule(lead, { commandId: 'offline-dispatch', expectedRevision: 0, maxConcurrency: 1, continuationLimit: 0,
        assignments: [{ ticketId: ticket.id!, ticketRevision: ticket.revision ?? 0, memberId: lead }] });
      await vi.waitFor(() => expect(current().execution!.runs.at(-1)).toMatchObject({ stage: 'implementation', status: 'running' }));
      const worker = current().execution!.runs.at(-1)!.workerId!;
      const worktree = current().execution!.workspaces![0]!;
      await git('git', ['rev-parse', '--verify', 'HEAD'], { cwd: worktree.path });
      expect(await readdir(source)).toContain('assigned');
      expect(await readdir(source)).not.toContain('unused');
      await vi.waitFor(() => expect(sentPrompts()).toContainEqual(expect.objectContaining({ agent: expect.objectContaining({ id: worker, folder: worktree.path }) })));
      await host.submitMissionResult(worker, { summary: 'Billing shipped to the worktree', ticketId: ticket.id,
        implementation: { changes: 'Implemented billing', tests: 'Billing checks passed' } });
      host.emitEvent({ agentId: worker, type: 'agent.statusChanged', payload: { type: 'idle' } });

      online = true;
      const savedController = snapshotFromPersistedState(disk);
      savedController.remoteConnections.connections[0]!.status = 'error';
      delete savedController.remoteConnections.connections[0]!.transport;
      hostInspection = new Promise(resolve => { answerInspection = () => resolve({ ...connection }); });
      controller = connectController(savedController);
      // Startup finishes while the unavailable host is still being inspected.
      await controller.initialize();
      expect((await call(controller, backendMethods.snapshotGet) as { snapshot: AppSnapshot }).snapshot.missions ?? []).toHaveLength(0);
      answerInspection();
      await vi.waitFor(async () => expect((await call(controller!, backendMethods.snapshotGet) as { snapshot: AppSnapshot }).snapshot.missions).toHaveLength(1));
      const synced = await call(controller, backendMethods.snapshotGet) as { snapshot: AppSnapshot };
      expect(synced.snapshot.missions!.find(candidate => candidate.id === mission.id)?.execution!.runs.at(-1)?.workerId).toBe(worker);
      expect(synced.snapshot.missions!.find(candidate => candidate.id === mission.id)?.artifacts.tickets[0]?.done).toBe(true);
      expect(synced.snapshot.agents.find(agent => agent.id === worker)).toMatchObject({ remoteConnectionId: 'connection-devbox', teamId: member.teamId, folder: worktree.path });
      expect(await call(controller, backendMethods.missionArtifactRead, { missionId: mission.id, stage: 'implementation' })).toMatchObject({
        content: expect.stringContaining('Billing checks passed'),
      });

      const gateway = new CompanionGateway('controller', { grants: [{ peerId: 'phone', name: 'Phone', createdAt: 1 }], commands: {} }, {
        workspace: async () => companionWorkspaceOf((await call(controller!, backendMethods.snapshotGet) as { snapshot: AppSnapshot }).snapshot),
        executeMission: async input => { await call(controller!, backendMethods.missionExecute, { input, _clientId: 'companion-write' }); },
        onEvent(listener) { events.on('event', listener); return () => { events.off('event', listener); }; },
      } as GatewayPort);
      const update = vi.fn();
      const subscription = gateway.subscribe('phone', update, () => {});
      try {
        const phone = await subscription.request('snapshot.get', {});
        expect(phone).toMatchObject({ missionProgress: [{ id: mission.id, next: 'review', tickets: [
          { number: 1, title: 'Implement billing', state: 'accepted', repository: 'assigned', agentId: worker },
        ] }] });
        await expect(gateway.request('phone', 'mission.continue', { missionId: mission.id, revision: current().revision })).resolves.toEqual({});
        expect(current().stage).toBe('review');
        await vi.waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({
          type: 'workspace', workspace: expect.objectContaining({ missionProgress: [expect.objectContaining({ id: mission.id, stage: 'review' })] }),
        })));
      } finally { subscription.close(); }
    } finally {
      await controller?.close();
      await host?.close();
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  }, 10_000);

  it('persists user Stop and removes a queued Mission recovery before provider interruption', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ provider: 'codex', installed: true, connected: true, checking: false }];
    const worker = snapshot.agents[0]!;
    worker.providerSession = { kind: 'codex', conversationId: 'mission-worker' }; worker.status = { type: 'working' };
    const mission = createMission(snapshot, { outcome: 'Checkout', workflowType: 'shapeAndShipFeature', teamId: worker.teamId!, orchestratorMemberId: worker.id });
    mission.stage = 'implementation';
    mission.execution!.dispatchPlan = { commandId: 'lead-authorized', expectedRevision: 0, revision: 1, leadId: worker.id, assignments: [], maxConcurrency: 1, continuationLimit: 2 };
    mission.artifacts.tickets = [{ title: 'Checkout', repositoryPath: worker.folder!, done: false }];
    mission.execution!.runs = [{ id: 'mission-run-stop', stage: 'implementation', memberId: worker.id, workerId: worker.id,
      ticketIndex: 0, repositoryPath: worker.folder!, status: 'running', skills: [], feedback: '', startedAt: '' }];
    const { driver, script, sentPrompts } = acceptingDriver(worker.providerSession, 'recovery');
    let server!: AppBackendServer; let disk: unknown;
    const completed = (turnId: string, status: 'completed' | 'failed' | 'interrupted' = 'completed') => server.emitEvent(turnCompleted(worker.id, turnId, { status }));
    script.on('interrupt', () => {
      expect(snapshotFromPersistedState(disk).missions![0]!.execution!.runs[0]!.status).toBe('cancelled');
      completed('unfinished', 'interrupted');
      return { providerSession: worker.providerSession! };
    });
    server = new AppBackendServer({ version: 'test', snapshot, driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])),
      saveSnapshot: async value => { disk = persistedStateFromSnapshot(value); } });
    try {
      completed('unfinished');
      await vi.waitFor(() => expect(snapshot.queuedPrompts).toHaveLength(1));
      await server.handleMessage({ jsonrpc: '2.0', id: 'stop', method: backendMethods.agentInterrupt, params: { agentId: worker.id } });
      server.emitEvent({ agentId: worker.id, type: 'agent.statusChanged', payload: { type: 'idle' } });
      completed('late-completion');
      expect(script.calls('interrupt')).toHaveLength(1);
      expect(snapshot.queuedPrompts).toHaveLength(0);
      expect(snapshot.missions![0]!.execution!.runs[0]!.status).toBe('cancelled');
      expect(sentPrompts()).toHaveLength(0);
      expect(snapshotFromPersistedState(disk).missions![0]!.artifacts.tickets[0]!.done).toBe(false);
    } finally { await server.close(); }
  });

  it('sends Update from main conflicts to the Mission repository worker without changing delivery', async () => {
    const exec = promisify(execFile);
    const root = await mkdtemp(join(tmpdir(), 'mission-update-conflict-'));
    const repo = join(root, 'repo'), worktree = join(root, 'worktree');
    let server: AppBackendServer | undefined;
    try {
      await exec('git', ['init', '-b', 'main', repo]);
      await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
      await exec('git', ['config', 'user.name', 'Mission test'], { cwd: repo });
      await writeFile(join(repo, 'shared.txt'), 'initial\n');
      await exec('git', ['add', '.'], { cwd: repo });
      await exec('git', ['commit', '-m', 'initial'], { cwd: repo });
      await exec('git', ['worktree', 'add', '-b', 'mission/conflicts', worktree], { cwd: repo });
      for (const [folder, content] of [[repo, 'main change\n'], [worktree, 'Mission change\n']] as const) {
        await writeFile(join(folder, 'shared.txt'), content);
        await exec('git', ['commit', '-am', 'change'], { cwd: folder });
      }
      const snapshot = createInitialSnapshot();
      snapshot.providerConnections = [{ provider: 'codex', installed: true, connected: true, checking: false }];
      const lead = snapshot.agents[0]!;
      lead.folder = repo;
      const builder = { ...structuredClone(lead), id: 'mission-repository-worker', folder: worktree, status: { type: 'idle' as const }, providerSession: { kind: 'codex' as const, conversationId: 'repository-thread' } };
      snapshot.agents.push(builder);
      snapshot.teams[0]!.agentIds.push(builder.id);
      const mission = createMission(snapshot, { outcome: 'Ship', workflowType: 'shapeAndShipFeature', teamId: lead.teamId!, orchestratorMemberId: lead.id });
      mission.stage = 'ship';
      mission.execution!.workspaces = [{ repositoryPath: repo, path: worktree, branch: 'mission/conflicts' }];
      mission.execution!.deliveries = [{ repositoryPath: repo, agentId: builder.id, status: 'pending' }];
      mission.execution!.runs = [{ id: 'implementation', stage: 'implementation', memberId: lead.id, workerId: builder.id, repositoryPath: repo, status: 'accepted', skills: [], feedback: '', startedAt: '' }];
      const before = structuredClone(mission);
      const { driver, sentPrompts } = acceptingDriver(builder.providerSession, 'resolve-conflicts');
      server = new AppBackendServer({ version: 'test', snapshot,
        driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])),
        workIntegrations: { githubConnected: async () => false } as never });
      const result = await server.handleMessage({ jsonrpc: '2.0', id: 'update', method: backendMethods.agentGitUpdateFromBase,
        params: { agentId: builder.id, input: { confirmed: true } } });
      expect(result).toMatchObject({ result: { baseBranch: 'main', conflicts: ['shared.txt'] } });
      await vi.waitFor(() => expect(sentPrompts()).toHaveLength(1));
      expect(sentPrompts()).toContainEqual({ agent: expect.objectContaining({ id: builder.id, folder: worktree, providerSession: builder.providerSession }), prompt: expect.stringMatching(/shared\.txt[\s\S]*Resolve the conflicts[\s\S]*Do not push/), options: {} });
      expect((await exec('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: worktree })).stdout.trim()).toBe('shared.txt');
      expect(snapshot.missions![0]).toStrictEqual(before);
    } finally { await server?.close(); await rm(root, { recursive: true, force: true }); }
  });

  // Delivery exercises real merge/push and durable worktree cleanup.
  it.each(['keep', 'delete', 'push', 'legacy missing'])('persists merged delivery and worktree cleanup before removing its builder (%s)', async cleanup => {
    const deleteWorktree = cleanup !== 'keep';
    const exec = promisify(execFile);
    const root = await mkdtemp(join(tmpdir(), 'mission-delivery-'));
    const repo = join(root, 'repo');
    const worktree = join(root, 'worktree');
    let server: AppBackendServer | undefined;
    try {
      await exec('git', ['init', '-b', 'main', repo]);
      await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
      await exec('git', ['config', 'user.name', 'Mission test'], { cwd: repo });
      await writeFile(join(repo, 'README.md'), 'Initial');
      await exec('git', ['add', '.'], { cwd: repo });
      await exec('git', ['commit', '-m', 'initial'], { cwd: repo });
      if (cleanup === 'push') {
        await exec('git', ['init', '--bare', join(root, 'remote.git')]);
        await exec('git', ['remote', 'add', 'origin', join(root, 'remote.git')], { cwd: repo });
      }
      await exec('git', ['worktree', 'add', '-b', 'mission/delivery', worktree], { cwd: repo });
      await writeFile(join(worktree, 'delivered.txt'), 'Delivered');
      await exec('git', ['add', '.'], { cwd: worktree });
      await exec('git', ['commit', '-m', 'implement'], { cwd: worktree });
      const snapshot = createInitialSnapshot();
      const builder = { ...snapshot.agents[0]!, id: 'mission-builder', folder: worktree, providerSession: undefined };
      snapshot.agents.push(builder); snapshot.teams[0]!.agentIds.push(builder.id);
      const mission = createMission(snapshot, { outcome: 'Deliver', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
      mission.stage = 'ship';
      mission.execution!.workspaces = [{ repositoryPath: repo, path: worktree, branch: 'mission/delivery' }];
      mission.execution!.workspace = { path: worktree, branch: 'mission/delivery' };
      mission.execution!.repoPath = repo;
      mission.execution!.deliveries = [{ repositoryPath: repo, agentId: builder.id, status: 'pending' }];
      mission.execution!.runs = [{ id: 'build', stage: 'implementation', memberId: snapshot.agents[0]!.id, workerId: builder.id, status: 'accepted', skills: [], feedback: '', startedAt: '' }];
      let disk: unknown;
      const saveSnapshot = async (value: AppSnapshot) => { disk = persistedStateFromSnapshot(value); };
      await saveSnapshot(snapshot);
      server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot,
        workIntegrations: { githubConnected: async () => false } as never });
      const merged = await server.handleMessage({ jsonrpc: '2.0', id: 'merge', method: 'agent/git/merge', params: {
        agentId: builder.id, input: { strategy: 'merge', deleteWorktree, deleteBranch: deleteWorktree, ...(cleanup === 'push' ? { pushAfter: true } : {}), confirmed: true },
      } });
      expect(merged).not.toHaveProperty('error');
      if (cleanup === 'push') {
        expect(snapshot.missions![0]!.execution!.deliveries![0]!.status).toBe('pending');
        expect(snapshot.agents.some(agent => agent.id === builder.id)).toBe(true);
        await server.handleMessage({ jsonrpc: '2.0', id: 'push', method: 'agent/git/push', params: {
          agentId: builder.id, input: { target: 'mergeTarget', closeAgentAfterPush: true, confirmed: true },
        } });
      }
      expect((await exec('git', ['show', 'HEAD:delivered.txt'], { cwd: repo })).stdout).toBe('Delivered');
      const restored = snapshotFromPersistedState(disk);
      expect(restored.missions![0]!.execution!.deliveries).toStrictEqual([{ repositoryPath: repo, agentId: builder.id, status: 'merged' }]);
      expect(restored.missions![0]!.status).toBe('completed');
      expect(restored.agents.some(agent => agent.id === builder.id)).toBe(!deleteWorktree);
      expect(missionCreatedWorkspaces(restored.missions![0])).toHaveLength(deleteWorktree ? 0 : 1);
      if (cleanup === 'legacy missing') {
        // Old releases retained worktree metadata after removing the directory.
        restored.missions![0]!.execution!.workspaces = [{ repositoryPath: repo, path: worktree, branch: 'mission/delivery' }];
        restored.missions![0]!.execution!.workspace = { path: worktree, branch: 'mission/delivery' };
      }
      await server.close();
      server = new AppBackendServer({ version: 'test', snapshot: restored, saveSnapshot, deleteMissionHome: async () => {} });
      await server.handleMessage({ jsonrpc: '2.0', id: 'delete', method: 'mission/delete', params: {
        input: { id: mission.id, revision: restored.missions![0]!.revision, deleteWorktrees: true, confirmed: true },
      } });
      expect(snapshotFromPersistedState(disk).missions).toStrictEqual([]);
      await expect(access(worktree)).rejects.toThrow();
    } finally { await server?.close(); await rm(root, { recursive: true, force: true }); }
  }, 3_000);

  it.each([
    { preset: 'workflow', deleteWorktrees: true },
    { preset: 'workflow', deleteWorktrees: false },
    { preset: 'screenshot', deleteWorktrees: true },
    { preset: 'screenshot', deleteWorktrees: false },
  ])('deletes the $preset fixture without touching repositories or real agents (cleanup=$deleteWorktrees)', async ({ preset, deleteWorktrees }) => {
    // Debug runs may borrow real agents and display primary checkouts as workspaces.
    // Neither a stale cleanup request nor fixture deletion owns those resources.
    const snapshot = createInitialSnapshot();
    snapshot.agents.forEach((agent, index) => {
      agent.folder = `/src/${index ? 'web' : 'api'}`;
      agent.providerSession = { kind: 'codex', conversationId: `real-thread-${index}` };
    });
    const observer = { ...structuredClone(snapshot.agents[0]!), id: 'unnamed-observer', name: null };
    snapshot.agents.push(observer);
    const originalAgents = structuredClone(snapshot.agents);
    const mission = createMission(snapshot, { outcome: 'New mission', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    if (preset === 'workflow') applyMissionDebugFixture(snapshot, mission.id, 'implementation');
    else applyMissionScreenshotFixture(snapshot, mission.id);
    const validateLinkedWorktreeDeletion = vi.fn().mockRejectedValue(new Error('Primary checkouts cannot be deleted.'));
    const deleteLinkedWorktree = vi.fn();
    const providerRequest = vi.fn().mockRejectedValue(new Error('Fixture cleanup must not contact a provider.'));
    const deleteMissionHome = vi.fn().mockResolvedValue(undefined);
    let disk: unknown;
    const server = new AppBackendServer({
      version: 'test', snapshot,
      agentGitService: { validateLinkedWorktreeDeletion, deleteLinkedWorktree } as unknown as AgentGitService,
      driverRpc: { handle: providerRequest, onEvent: () => () => {}, close: async () => {} } as unknown as ProviderDriverRpc,
      deleteMissionHome, saveSnapshot: async value => { disk = persistedStateFromSnapshot(value); },
    });
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 'delete-fixture', method: 'mission/delete', params: {
        input: { id: mission.id, revision: mission.revision, deleteWorktrees, confirmed: true },
      } });
      expect(snapshot.missions).toStrictEqual([]);
      expect(snapshot.agents).toStrictEqual(originalAgents);
      expect(snapshotFromPersistedState(disk).missions).toStrictEqual([]);
      expect(snapshotFromPersistedState(disk).agents.map(agent => agent.id)).toStrictEqual(originalAgents.map(agent => agent.id));
      expect(deleteMissionHome).toHaveBeenCalledExactlyOnceWith(mission.id);
      expect(validateLinkedWorktreeDeletion).not.toHaveBeenCalled();
      expect(deleteLinkedWorktree).not.toHaveBeenCalled();
      expect(providerRequest).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });

  it('keeps a resumed Mission running through compaction while its work prompt is queued', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ provider: 'codex', installed: true, connected: true, checking: false }];
    const worker = snapshot.agents[0]!;
    worker.providerSession = { kind: 'codex', conversationId: 'mission-thread' };
    worker.status = { type: 'working' };
    const mission = createMission(snapshot, {
      outcome: 'Linear tools', workflowType: 'shapeAndShipFeature', teamId: worker.teamId!, orchestratorMemberId: worker.id,
    });
    mission.stage = 'implementation';
    mission.execution!.dispatchPlan = { commandId: 'lead-authorized', expectedRevision: 0, revision: 1, leadId: worker.id, assignments: [], maxConcurrency: 1, continuationLimit: 2 };
    mission.artifacts.tickets = [{ title: 'Linear tools', repositoryPath: worker.folder!, done: false }];
    mission.execution!.runs = [{
      id: 'active-run', stage: 'implementation', memberId: worker.id, workerId: worker.id,
      repositoryPath: worker.folder!, ticketIndex: 0, status: 'running', skills: [], feedback: '', startedAt: new Date().toISOString(),
    }];
    const { driver, sentPrompts } = acceptingDriver(worker.providerSession, 'work-turn');
    let disk: unknown;
    const server = new AppBackendServer({
      version: 'test', snapshot, driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])),
      saveSnapshot: async value => { disk = persistedStateFromSnapshot(value); },
    });
    const completed = (turnId: string) => server.emitEvent(turnCompleted(worker.id, turnId, { conversationId: 'mission-thread' }));
    const currentRun = () => snapshot.missions![0]!.execution!.runs[0]!;
    try {
      // Enqueue through the real prompt manager, as launch does while /compact is active.
      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'agent/prompt/send', params: {
        agentId: worker.id, prompt: 'Begin the assigned ticket now.',
      } });
      expect(snapshot.queuedPrompts).toHaveLength(1);
      completed('compact-turn');
      server.emitEvent({ agentId: worker.id, type: 'agent.statusChanged', payload: { type: 'idle' } });
      await vi.waitFor(() => expect(sentPrompts()).toHaveLength(1));
      await vi.waitFor(() => expect(snapshot.queuedPrompts).toHaveLength(0));
      expect(currentRun().status).toBe('running');
      expect(snapshotFromPersistedState(disk).missions![0]!.execution!.runs[0]!.status).toBe('running');
      // A replay after dequeue must not fail the work that just started.
      completed('compact-turn');
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(currentRun().status).toBe('running');
      // A genuine work completion without a result continues the same assignment.
      completed('work-turn');
      server.emitEvent({ agentId: worker.id, type: 'agent.statusChanged', payload: { type: 'idle' } });
      await vi.waitFor(() => expect(currentRun()).toMatchObject({ status: 'running', recoveryAttempts: 1 }));
      await vi.waitFor(() => expect(sentPrompts()).toHaveLength(2));
    } finally { await server.close(); }
  });

  it('creates, broadcasts, updates and reloads a team-scoped mission without a repository', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ provider: 'codex', installed: true, connected: true, checking: false }];
    let disk: unknown;
    const onEvent = vi.fn();
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot, saveSnapshot: async value => { disk = persistedStateFromSnapshot(value); }, onEvent });
    const call = (method: string, input: unknown) => server.handleMessage({ jsonrpc: '2.0', id: 1, method, params: { input } });
    try {
      const created = await call('mission/create', {
        outcome: 'Add billing', workflowType: 'shapeAndShipFeature',
        teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id,
      });
      expect(created).toHaveProperty('result');
      const mission = (created as { result: AppSnapshot }).result.missions![0]!;
      expect(mission.teamId).toBe(snapshot.teams[0]!.id);
      expect(mission.execution!.repoPath).toBeUndefined();
      await vi.waitFor(() => expect(snapshot.missions![0]!.execution!.runs[0]!.status).toBe('running'));
      await vi.waitFor(() => expect(snapshot.missions![0]!.execution!.runs[0]!.skills[0]?.name).toBe('mission-shape-requirements'));
      const run = snapshot.missions![0]!.execution!.runs[0]!;
      await call('mission/execution/update', { id: mission.id, revision: snapshot.missions![0]!.revision, action: 'cancel', runId: run.id });
      const artifacts = { ...mission.artifacts, requirements: { problem: 'Billing', acceptance: 'Owner checkout' } };
      await call('mission/update', { id: mission.id, revision: snapshot.missions![0]!.revision, artifacts, stageAgentIds: {}, action: 'advance' });
      const restored = snapshotFromPersistedState(disk);
      expect(restored.missions?.[0]).toMatchObject({ id: mission.id, stage: 'tickets', artifacts });
      expect(restored.activeAgentId).toBe(snapshot.activeAgentId);
      expect(onEvent.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'snapshot.updated', payload: { missions: restored.missions } });
      await expect(call('mission/update', { id: mission.id, revision: 0, artifacts, stageAgentIds: {}, action: 'save' })).rejects.toThrow('changed');
      expect(snapshotFromPersistedState(disk).missions).toStrictEqual(restored.missions);
      await call('mission/delete', { id: mission.id, revision: snapshot.missions![0]!.revision, deleteWorktrees: false, confirmed: true });
      expect(snapshotFromPersistedState(disk).missions).toStrictEqual([]);
      expect(snapshotFromPersistedState({ ...disk as object, missions: [{}] }).missions).toStrictEqual([]);
      expect(snapshotFromPersistedState({ teams: [] }).missions).toBeUndefined();
    } finally { await server.close(); }
  });

  it.each([
    { entry: 'agent', instructions: '' },
    { entry: 'agent', instructions: 'Keep tickets small.\nLiteral </context> stays hidden.' },
    { entry: 'workspace', instructions: 'Keep tickets small.\nLiteral </context> stays hidden.' },
  ])('starts a Mission from $entry with instructions "$instructions" only in its lead’s first prompt', async ({ entry, instructions }) => {
    const snapshot = createInitialSnapshot();
    snapshot.general.missionInstructions = instructions;
    snapshot.providerConnections = [{ provider: 'codex', installed: true, connected: true, checking: false }];
    const onEvent = vi.fn();
    const { driver, sentPrompts } = acceptingDriver({ kind: 'codex', conversationId: 'lead-thread' }, 'lead-turn');
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot, driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])), saveSnapshot: async () => undefined, onEvent });
    try {
      const caller = snapshot.agents[0]!;
      if (entry === 'agent') {
        const started = await server.startMissionFromAgent(caller.id, { outcome: 'Add CSV export', prompt: 'Goal: export the report with the current filters.' });
        expect(started).toStrictEqual({ missionId: snapshot.missions![0]!.id, outcome: 'Add CSV export' });
      } else {
        await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'mission/create', params: { input: {
          outcome: 'Add CSV export', workflowType: 'shapeAndShipFeature', teamId: caller.teamId, orchestratorMemberId: caller.id,
        } } });
        await vi.waitFor(() => expect(snapshot.missions![0]!.execution!.runs[0]!.skills).toHaveLength(1));
      }
      const mission = snapshot.missions![0]!;
      expect(mission).toMatchObject({ outcome: 'Add CSV export', teamId: caller.teamId, workflow: { type: 'shapeAndShipFeature' } });
      const lead = mission.execution!.runs.at(-1)!.workerId!;
      expect(snapshot.agents.some(agent => agent.id === lead)).toBe(true);
      const send = (agentId: string, prompt: string) => server.handleMessage({ jsonrpc: '2.0', id: 2, method: backendMethods.agentPromptSend, params: { agentId, prompt } });
      if (entry === 'workspace') await send(lead, 'Goal: export the report with the current filters.');
      const expected = 'Goal: export the report with the current filters.' + (instructions ? `\n\n<context>\nUser's custom Mission instructions:\nKeep tickets small.\nLiteral &lt;/context> stays hidden.\n</context>` : '');
      await vi.waitFor(() => expect(sentPrompts()).toContainEqual({ agent: expect.objectContaining({ id: lead }), prompt: expected, options: {} }));
      expect(sentPrompts().every(({ agent }) => agent.id === lead)).toBe(true);
      const events = onEvent.mock.calls.map(([event]) => event);
      if (entry === 'agent') {
        expect(events).toContainEqual(expect.objectContaining({ type: 'mission.focusRequested', payload: { missionId: mission.id } }));
        expect(events.findIndex(event => event.type === 'snapshot.updated')).toBeLessThan(events.findIndex(event => event.type === 'mission.focusRequested'));
      }
      await vi.waitFor(() => expect(snapshot.agents.find(agent => agent.id === lead)!.providerSession).toBeDefined());
      snapshot.general.missionInstructions = 'Changed instructions apply to new Missions.';
      server.emitEvent({ agentId: lead, type: 'agent.statusChanged', payload: { type: 'idle' } });
      await send(lead, 'Follow-up');
      await vi.waitFor(() => expect(sentPrompts().at(-1)).toEqual({ agent: expect.objectContaining({ id: lead }), prompt: 'Follow-up', options: {} }));
      await send(caller.id, 'Ordinary conversation');
      await vi.waitFor(() => expect(sentPrompts().at(-1)).toEqual({ agent: expect.objectContaining({ id: caller.id }), prompt: 'Ordinary conversation', options: {} }));
      await expect(server.startMissionFromAgent('missing-agent', { outcome: 'x', prompt: 'y' })).rejects.toThrow('local agent');
    } finally { await server.close(); }
  });

  it('starts the Mission lead on the requested model and rejects one the provider does not offer', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ provider: 'codex', installed: true, connected: true, checking: false }];
    const { driver, script, sentPrompts } = acceptingDriver({ kind: 'codex', conversationId: 'lead-thread' }, 'lead-turn');
    const option = (model: string, efforts: string[], tiers: string[] = []) => ({ id: model, model, displayName: model, supportedReasoningEfforts: efforts.map(reasoningEffort => ({ reasoningEffort, description: reasoningEffort })), serviceTiers: tiers.map(id => ({ id, name: id, description: id })) });
    script.on('listModels', () => [option('gpt-fast', ['low', 'high'], ['fast']), option('gpt-big', ['high'])]);
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot, driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])), saveSnapshot: async () => undefined, onEvent: vi.fn() });
    try {
      const caller = snapshot.agents[0]!;
      const started = await server.startMissionFromAgent(caller.id, { outcome: 'Add CSV export', prompt: 'Goal', selection: { model: 'gpt-fast', reasoningEffort: 'high', serviceTier: 'fast' } });
      const lead = snapshot.agents.find(agent => agent.id === snapshot.missions!.find(mission => mission.id === started.missionId)!.execution!.runs.at(-1)!.workerId)!;
      expect(lead).toMatchObject({ provider: 'codex', providerDefaults: { kind: 'codex', model: 'gpt-fast', userSelectedModel: true, reasoningEffort: 'high', serviceTier: 'fast' } });
      await vi.waitFor(() => expect(sentPrompts()).toContainEqual({ agent: expect.objectContaining({ id: lead.id, providerDefaults: expect.objectContaining({ model: 'gpt-fast' }) }), prompt: 'Goal', options: {} }));
      const missions = snapshot.missions!.length;
      await expect(server.startMissionFromAgent(caller.id, { outcome: 'x', prompt: 'y', selection: { model: 'nope' } })).rejects.toThrow('gpt-fast, gpt-big');
      await expect(server.startMissionFromAgent(caller.id, { outcome: 'x', prompt: 'y', selection: { model: 'gpt-big', reasoningEffort: 'low' } })).rejects.toThrow('reasoning effort');
      await expect(server.startMissionFromAgent(caller.id, { outcome: 'x', prompt: 'y', selection: { reasoningEffort: 'low' } })).rejects.toThrow('needs a model');
      await expect(server.startMissionFromAgent(caller.id, { outcome: 'x', prompt: 'y', selection: { serviceTier: 'fast' } })).rejects.toThrow('needs a model');
      await expect(server.startMissionFromAgent(caller.id, { outcome: 'x', prompt: 'y', selection: { model: 'gpt-big', serviceTier: 'fast' } })).rejects.toThrow('service tier fast');
      expect(snapshot.missions!.length).toBe(missions);
    } finally { await server.close(); }
  });

  it('deletes every tracked Mission worktree and the Mission data directory when requested', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ provider: 'codex', installed: true, connected: true, checking: false }];
    const mission = createMission(snapshot, {
      outcome: 'Add billing', workflowType: 'shapeAndShipFeature',
      teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id,
    });
    mission.execution!.workspaces = [
      { repositoryPath: '/src/api', path: '/src/api-add-billing', branch: 'mission/add-billing' },
      { repositoryPath: '/src/web', path: '/src/web-add-billing', branch: 'mission/add-billing' },
    ];
    const validateLinkedWorktreeDeletion = vi.fn().mockResolvedValue(undefined);
    const deleteLinkedWorktree = vi.fn().mockResolvedValue(undefined);
    const deleteMissionHome = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test', snapshot,
      agentGitService: { validateLinkedWorktreeDeletion, deleteLinkedWorktree } as unknown as AgentGitService,
      deleteMissionHome,
      saveSnapshot: vi.fn().mockResolvedValue(undefined),
    });

    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'mission/delete', params: {
        input: { id: mission.id, revision: mission.revision, deleteWorktrees: true, confirmed: true },
      } });

      expect(validateLinkedWorktreeDeletion.mock.calls).toEqual([
        ['/src/api-add-billing', false, undefined, true],
        ['/src/web-add-billing', false, undefined, true],
      ]);
      expect(deleteLinkedWorktree.mock.calls).toEqual([
        ['/src/api-add-billing', false, undefined, true],
        ['/src/web-add-billing', false, undefined, true],
      ]);
      expect(deleteMissionHome).toHaveBeenCalledWith(mission.id);
      expect(snapshot.missions).toStrictEqual([]);
    } finally { await server.close(); }
  });

  it('keeps tracked worktrees while still deleting Mission data', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ provider: 'codex', installed: true, connected: true, checking: false }];
    const mission = createMission(snapshot, {
      outcome: 'Add billing', workflowType: 'shapeAndShipFeature',
      teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id,
    });
    mission.execution!.workspaces = [{ repositoryPath: '/src/api', path: '/src/api-add-billing', branch: 'mission/add-billing' }];
    const validateLinkedWorktreeDeletion = vi.fn();
    const deleteLinkedWorktree = vi.fn();
    const deleteMissionHome = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test', snapshot,
      agentGitService: { validateLinkedWorktreeDeletion, deleteLinkedWorktree } as unknown as AgentGitService,
      deleteMissionHome,
      saveSnapshot: vi.fn().mockResolvedValue(undefined),
    });

    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'mission/delete', params: {
        input: { id: mission.id, revision: mission.revision, deleteWorktrees: false, confirmed: true },
      } });

      expect(validateLinkedWorktreeDeletion).not.toHaveBeenCalled();
      expect(deleteLinkedWorktree).not.toHaveBeenCalled();
      expect(deleteMissionHome).toHaveBeenCalledWith(mission.id);
      expect(snapshot.missions).toStrictEqual([]);
    } finally { await server.close(); }
  });

  it('keeps the Mission and its data when a tracked worktree cannot be deleted', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ provider: 'codex', installed: true, connected: true, checking: false }];
    const mission = createMission(snapshot, {
      outcome: 'Add billing', workflowType: 'shapeAndShipFeature',
      teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id,
    });
    mission.execution!.workspaces = [
      { repositoryPath: '/src/api', path: '/src/api-add-billing', branch: 'mission/add-billing' },
      { repositoryPath: '/src/web', path: '/src/web-add-billing', branch: 'mission/add-billing' },
    ];
    const deleteMissionHome = vi.fn();
    const deleteLinkedWorktree = vi.fn();
    const validateLinkedWorktreeDeletion = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('The current folder is not a linked worktree.'));
    const server = new AppBackendServer({
      version: 'test', snapshot,
      agentGitService: {
        validateLinkedWorktreeDeletion,
        deleteLinkedWorktree,
      } as unknown as AgentGitService,
      deleteMissionHome,
      saveSnapshot: vi.fn().mockResolvedValue(undefined),
    });

    try {
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'mission/delete', params: {
        input: { id: mission.id, revision: mission.revision, deleteWorktrees: true, confirmed: true },
      } })).rejects.toThrow('not a linked worktree');
      expect(validateLinkedWorktreeDeletion).toHaveBeenCalledTimes(2);
      expect(deleteLinkedWorktree).not.toHaveBeenCalled();
      expect(snapshot.missions).toStrictEqual([mission]);
      expect(deleteMissionHome).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });
});

import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createMission } from '@workspace/core/missions';
import { ProviderDriverRpc } from '../driver-rpc';
import { backendMethods } from '@workspace/core/backend-protocol/methods';

it('prepares a mission without a provider turn, then starts it from the first user message', async () => {
  const exec = promisify(execFile);
  const root = await mkdtemp(join(tmpdir(), 'app-mission-protocol-'));
  const repo = join(root, 'repo');
  let server: AppBackendServer | undefined;
  try {
    await exec('git', ['init', repo]);
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    await exec('git', ['config', 'user.name', 'Mission test'], { cwd: repo });
    await writeFile(join(repo, 'README.md'), 'Mission protocol fixture');
    await exec('git', ['add', '.'], { cwd: repo });
    await exec('git', ['commit', '-m', 'initial'], { cwd: repo });
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ provider: 'codex', installed: true, connected: true, checking: false }];
    snapshot.agents[0]!.folder = repo;
    const { driver, script, sentPrompts } = acceptingDriver({ kind: 'codex', conversationId: 'mission-thread' });
    /** The agents an operation addressed, whether it was handed the agent or just its id. */
    const addressed = (operation: 'interrupt' | 'archiveAgentConversation' | 'releaseConversation' | 'loadConversation') => script.calls(operation).map(({ args }) => typeof args[0] === 'string' ? args[0] : (args[0] as { id: string }).id);
    script.on('listSkills', () => [{ name: 'grill-with-docs', path: '/skills/grill-with-docs/SKILL.md', enabled: true }]);
    const refreshedContexts: Array<{
      context: ReturnType<AppBackendServer['missionContext']>;
      instructions: string | undefined;
    }> = [];
    script.on('loadConversation', (agent: { id: string }) => {
      refreshedContexts.push({
        context: server!.missionContext(agent.id),
        instructions: server!.missionDeveloperInstructions(agent.id),
      });
      return { kind: 'codex' as const, conversationId: 'mission-thread' };
    });
    let disk: unknown;
    const missionHome = join(root, 'mission-home');
    await mkdir(missionHome);
    server = new AppBackendServer({ version: 'test', snapshot, driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])), ensureMissionHome: async () => missionHome, saveSnapshot: async value => { disk = persistedStateFromSnapshot(value); } });
    const call = (method: string, input: unknown) => server!.handleMessage({ jsonrpc: '2.0', id: 1, method, params: { input } });
    await call('mission/create', { outcome: 'Billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    const current = () => snapshot.missions![0]!;
    await vi.waitFor(() => expect(current().execution!.runs[0]!.status).toBe('running'));
    const run = current().execution!.runs[0]!;
    const worker = snapshot.agents.find(agent => agent.id === run.workerId)!;
    expect(worker).toMatchObject({ id: run.workerId, folder: missionHome, status: { type: 'idle' } });
    expect(worker).not.toHaveProperty('providerSession');
    expect(sentPrompts()).toHaveLength(0);
    expect(current().execution!.workspace).toBeUndefined();
    const instructions = server.missionDeveloperInstructions(run.workerId!);
    expect(instructions).toMatch(/^<context>\n/);
    expect(instructions).toContain("Treat the user's first message as the beginning of requirements shaping");
    expect(instructions).toContain(repo);
    expect(instructions).toContain('read-skill with name="mission-shape-requirements"');
    expect(instructions).not.toContain('/skills/grill-with-docs/SKILL.md');
    expect(server.missionContext(run.workerId!)).toEqual({ missionId: current().id, runId: run.id, stage: 'requirements' });
    await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'agent/prompt/send', params: { agentId: run.workerId, prompt: 'Build team billing' } });
    await vi.waitFor(() => expect(sentPrompts()).toHaveLength(1));
    expect(sentPrompts()).toContainEqual({ agent: expect.objectContaining({ id: run.workerId }), prompt: 'Build team billing', options: {} });
    await vi.waitFor(() => expect(worker.providerSession).toEqual({ kind: 'codex', conversationId: 'mission-thread' }));
    await expect(server.setMissionTitle(run.workerId!, 'Add team billing')).resolves.toEqual({ success: true, title: 'Add team billing' });
    expect(snapshotFromPersistedState(disk).missions![0]!.outcome).toBe('Add team billing');
    await expect(server.attachMissionRepository(run.workerId!, repo)).resolves.toEqual({ success: true, repoPath: repo });
    expect(current().execution!.repoPath).toBe(repo);
    const artifacts = structuredClone(current().artifacts);
    artifacts.requirements = { problem: 'Team billing', acceptance: 'Owners can pay' };
    await server.writeMissionArtifact(run.workerId!, { stage: 'requirements', content: '# Requirements\nTeam billing.' });
    await expect(server.readMissionArtifact(run.workerId!, 'requirements')).resolves.toMatchObject({ content: expect.stringContaining('Team billing'), revision: 1 });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'mission/artifact/read', params: { missionId: current().id, stage: 'requirements' } })).resolves.toMatchObject({
      result: { content: expect.stringContaining('Team billing'), revision: 1 },
    });
    expect(server.listMissionArtifacts(run.workerId!)).toEqual([expect.objectContaining({ stage: 'requirements', revision: 1 })]);
    await server.submitMissionResult(run.workerId!, { summary: 'Ready', artifacts });
    await call('mission/execution/update', { id: current().id, revision: current().revision, action: 'accept', runId: run.id });
    expect(snapshotFromPersistedState(disk).missions![0]!.artifacts.requirements).toEqual(artifacts.requirements);
    expect(current().stage).toBe('tickets');
    expect(current().execution!.runs).toHaveLength(2);
    expect(worker.providerSession).toEqual({ kind: 'codex', conversationId: 'mission-thread' });
    expect(current().execution!.runs.at(-1)).toMatchObject({ stage: 'tickets', status: 'preparing' });
    expect(addressed('releaseConversation')).toHaveLength(0);
    server.emitEvent(turnCompleted(worker.id, 'requirements-turn', { conversationId: 'mission-thread' }));
    server.emitEvent({ agentId: worker.id, type: 'agent.statusChanged', payload: { type: 'idle' } });
    await vi.waitFor(() => expect(current().execution!.runs.at(-1)).toMatchObject({ stage: 'tickets', status: 'running' }));
    expect(current().execution!.runs.at(-1)!.workerId).toBe(run.workerId);
    await vi.waitFor(() => expect(addressed('releaseConversation')).toContain(worker.id));
    expect(addressed('loadConversation')).toContain(worker.id);
    const ticketsRun = current().execution!.runs.at(-1)!;
    expect(refreshedContexts.at(-1)).toMatchObject({
      context: { missionId: current().id, runId: ticketsRun.id, stage: 'tickets' },
      instructions: expect.stringContaining('read-skill with name="mission-to-tickets"'),
    });
    expect(refreshedContexts.at(-1)?.instructions).toContain('Owners can pay');
    await vi.waitFor(() => expect(sentPrompts()).toContainEqual({ agent: expect.objectContaining({ id: worker.id }), prompt: expect.stringContaining(`assigned ${product.name} Mission skill`), options: {} }));
    expect(snapshot.queuedPrompts).toStrictEqual([]);
    await server.upsertMissionTicket(worker.id, {
      title: 'Implement billing', body: 'Deliver owner checkout.', repositoryPath: repo,
    });
    await expect(server.submitMissionResult(worker.id, {
      summary: 'Tickets ready', artifacts: structuredClone(current().artifacts),
    })).resolves.toEqual({ success: true, status: 'awaitingReview' });
    expect(current().execution!.runs.at(-1)).toMatchObject({
      id: ticketsRun.id,
      proposal: { tickets: [expect.objectContaining({ title: 'Implement billing' })] },
    });
    const missionId = current().id;
    await call('mission/delete', { id: missionId, revision: current().revision, deleteWorktrees: false, confirmed: true });
    expect(snapshot.missions).toStrictEqual([]);
    expect(snapshot.agents.some(agent => agent.id === worker.id)).toBe(false);
    expect(snapshot.teams[0]!.agentIds).not.toContain(worker.id);
    expect(addressed('interrupt')).toContain(worker.id);
    expect(addressed('archiveAgentConversation')).toContain(worker.id);
    expect(addressed('releaseConversation')).toContain(worker.id);
    await expect(access(missionHome)).rejects.toThrow();
  } finally { await server?.close(); await rm(root, { recursive: true, force: true }); }
});

it('recovers a persisted preparing mission without starting its provider conversation', async () => {
  const exec = promisify(execFile);
  const root = await mkdtemp(join(tmpdir(), 'app-mission-recovery-'));
  const repo = join(root, 'repo');
  let server: AppBackendServer | undefined;
  try {
    await exec('git', ['init', repo]);
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    await exec('git', ['config', 'user.name', 'Mission test'], { cwd: repo });
    await writeFile(join(repo, 'README.md'), 'Mission recovery fixture');
    await exec('git', ['add', '.'], { cwd: repo });
    await exec('git', ['commit', '-m', 'initial'], { cwd: repo });
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ provider: 'codex', installed: true, connected: true, checking: false }];
    const mission = createMission(snapshot, { outcome: 'New mission', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    mission.execution = {
      teamId: snapshot.teams[0]!.id,
      repoPath: repo,
      memberIds: ['agent-dina'],
      runs: [{
        id: 'mission-run-recovery',
        stage: 'requirements',
        memberId: 'agent-dina',
        status: 'preparing',
        skills: [],
        feedback: '',
        startedAt: '2026-09-19T19:18:51.911Z',
      }],
    };
    const { driver, script, sentPrompts } = acceptingDriver({ kind: 'codex', conversationId: 'recovered-mission-thread' });
    script.on('listSkills', () => [{ name: 'grilling', path: '/skills/grilling/SKILL.md', enabled: true }]);
    server = new AppBackendServer({ version: 'test', snapshot, driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])) });

    await server.initialize();
    await server.initialize();

    expect(sentPrompts()).toHaveLength(0);
    const recoveredMission = snapshot.missions![0]!;
    const run = recoveredMission.execution!.runs[0]!;
    const worker = snapshot.agents.find(agent => agent.id === run.workerId);
    expect(run.status).toBe('running');
    expect(worker).toMatchObject({ folder: expect.stringMatching(/mission-/), workspace: { kind: 'folder' } });
    expect(worker).not.toHaveProperty('providerSession');
    expect(server.missionDeveloperInstructions(worker!.id)).toContain('<context>');
    expect(snapshot.teams[0]!.agentIds).toContain(worker!.id);
  } finally { await server?.close(); await rm(root, { recursive: true, force: true }); }
});
