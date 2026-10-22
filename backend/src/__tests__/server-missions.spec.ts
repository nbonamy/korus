import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import { AppBackendServer } from '../server';
import { createInitialSnapshot } from '@workspace/core/snapshot-construction';
import { persistedStateFromSnapshot, snapshotFromPersistedState } from '../state-persistence';
import type { AppSnapshot } from '@workspace/core/contracts';
import { AgentGitService } from '../git/agent-git-service';

describe('mission backend boundary', () => {
  it('keeps a resumed Mission running through compaction while its work prompt is queued', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const worker = snapshot.agents[0]!;
    worker.backendSession = { kind: 'codex', threadId: 'mission-thread' };
    worker.status = { type: 'working' };
    const mission = createMission(snapshot, {
      outcome: 'Linear tools', workflowType: 'shapeAndShipFeature', teamId: worker.teamId!, orchestratorMemberId: worker.id,
    });
    mission.stage = 'implementation';
    mission.artifacts.tickets = [{ title: 'Linear tools', repositoryPath: worker.folder!, done: false }];
    mission.execution!.runs = [{
      id: 'active-run', stage: 'implementation', memberId: worker.id, workerId: worker.id,
      repositoryPath: worker.folder!, ticketIndex: 0, status: 'running', skills: [], feedback: '', startedAt: new Date().toISOString(),
    }];
    const sendPrompt = vi.fn().mockResolvedValue({ backendSession: worker.backendSession, turnId: 'work-turn' });
    const driver: AgentBackendDriver = {
      backend: 'codex', getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }), getCapabilities: () => codexBackendCapabilities,
      sendPrompt, interrupt: async () => ({ backendSession: worker.backendSession! }),
      respondToAgentRequest: async () => undefined, onEvent: () => () => {}, close: async () => {},
    };
    let disk: unknown;
    const server = new AppBackendServer({
      version: 'test', snapshot, driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
      saveSnapshot: async value => { disk = persistedStateFromSnapshot(value); },
    });
    const completed = (turnId: string) => server.emitEvent({
      agentId: worker.id, backend: 'codex', threadId: 'mission-thread', type: 'codex.conversationEventReceived',
      payload: { revision: 1, event: {
        seq: 1, occurredAt: new Date().toISOString(), origin: 'notification', conversationId: 'mission-thread', turnId,
        type: 'turn.completed', payload: { status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null },
      } },
    });
    const currentRun = () => snapshot.missions![0]!.execution!.runs[0]!;
    try {
      // Enqueue through the real prompt manager, as launch does while /compact is active.
      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'agent/prompt/send', params: {
        agentId: worker.id, prompt: 'Begin the assigned ticket now.',
      } });
      expect(snapshot.queuedPrompts).toHaveLength(1);
      completed('compact-turn');
      server.emitEvent({ agentId: worker.id, type: 'agent.statusChanged', payload: { type: 'idle' } });
      await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(snapshot.queuedPrompts).toHaveLength(0));
      expect(currentRun().status).toBe('running');
      expect(snapshotFromPersistedState(disk).missions![0]!.execution!.runs[0]!.status).toBe('running');
      // A replay after dequeue must not fail the work that just started.
      completed('compact-turn');
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(currentRun().status).toBe('running');
      // A genuine work completion without a result still fails the assignment.
      completed('work-turn');
      server.emitEvent({ agentId: worker.id, type: 'agent.statusChanged', payload: { type: 'idle' } });
      await vi.waitFor(() => expect(currentRun().status).toBe('failed'));
    } finally { await server.close(); }
  });

  it('creates, broadcasts, updates and reloads a team-scoped mission without a repository', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
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

  it('deletes every tracked Mission worktree and the Mission data directory when requested', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
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
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
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
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
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
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AgentBackendDriver } from '@workspace/core/backend-driver';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import { createMission } from '@workspace/core/missions';
import { BackendDriverRpc } from '../driver-rpc';

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
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    snapshot.agents[0]!.folder = repo;
    const sendPrompt = vi.fn().mockResolvedValue({ backendSession: { kind: 'codex', threadId: 'mission-thread' } });
    const interrupt = vi.fn().mockResolvedValue({ backendSession: { kind: 'codex', threadId: 'mission-thread' } });
    const archiveAgentConversation = vi.fn().mockResolvedValue(undefined);
    const releaseConversation = vi.fn();
    const refreshedContexts: Array<{
      context: ReturnType<AppBackendServer['missionContext']>;
      instructions: string | undefined;
    }> = [];
    const loadConversation = vi.fn(async (agent: Parameters<NonNullable<AgentBackendDriver['loadConversation']>>[0]) => {
      refreshedContexts.push({
        context: server!.missionContext(agent.id),
        instructions: server!.missionDeveloperInstructions(agent.id),
      });
      return { kind: 'codex' as const, threadId: 'mission-thread' };
    });
    const driver: AgentBackendDriver = {
      backend: 'codex', getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }), getCapabilities: () => codexBackendCapabilities,
      sendPrompt, interrupt, archiveAgentConversation, releaseConversation, loadConversation,
      respondToAgentRequest: async () => undefined, onEvent: () => () => {}, close: async () => {},
      listSkills: async () => [{ name: 'grill-with-docs', path: '/skills/grill-with-docs/SKILL.md', enabled: true }],
    };
    let disk: unknown;
    const missionHome = join(root, 'mission-home');
    await mkdir(missionHome);
    server = new AppBackendServer({ version: 'test', snapshot, driverRpc: new BackendDriverRpc(new Map([['codex', driver]])), ensureMissionHome: async () => missionHome, saveSnapshot: async value => { disk = persistedStateFromSnapshot(value); } });
    const call = (method: string, input: unknown) => server!.handleMessage({ jsonrpc: '2.0', id: 1, method, params: { input } });
    await call('mission/create', { outcome: 'Billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    const current = () => snapshot.missions![0]!;
    await vi.waitFor(() => expect(current().execution!.runs[0]!.status).toBe('running'));
    const run = current().execution!.runs[0]!;
    const worker = snapshot.agents.find(agent => agent.id === run.workerId)!;
    expect(worker).toMatchObject({ id: run.workerId, folder: missionHome, status: { type: 'idle' } });
    expect(worker).not.toHaveProperty('backendSession');
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(current().execution!.workspace).toBeUndefined();
    const instructions = server.missionDeveloperInstructions(run.workerId!);
    expect(instructions).toMatch(/^<context>\n/);
    expect(instructions).toContain("Treat the user's first message as the beginning of requirements shaping");
    expect(instructions).toContain(repo);
    expect(instructions).toContain('read-skill with name="mission-shape-requirements"');
    expect(instructions).not.toContain('/skills/grill-with-docs/SKILL.md');
    expect(server.missionContext(run.workerId!)).toEqual({ missionId: current().id, runId: run.id, stage: 'requirements' });
    await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'agent/prompt/send', params: { agentId: run.workerId, prompt: 'Build team billing' } });
    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledOnce());
    expect(sendPrompt).toHaveBeenCalledWith(expect.objectContaining({ id: run.workerId }), 'Build team billing', undefined);
    await vi.waitFor(() => expect(worker.backendSession).toEqual({ kind: 'codex', threadId: 'mission-thread' }));
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
    expect(worker.backendSession).toEqual({ kind: 'codex', threadId: 'mission-thread' });
    expect(current().execution!.runs.at(-1)).toMatchObject({ stage: 'tickets', status: 'preparing' });
    expect(releaseConversation).not.toHaveBeenCalled();
    server.emitEvent({
      agentId: worker.id, backend: 'codex', threadId: 'mission-thread', type: 'codex.conversationEventReceived',
      payload: { revision: 1, event: {
        seq: 1, occurredAt: new Date().toISOString(), origin: 'notification', conversationId: 'mission-thread', turnId: 'requirements-turn',
        type: 'turn.completed', payload: { status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null },
      } },
    });
    server.emitEvent({ agentId: worker.id, type: 'agent.statusChanged', payload: { type: 'idle' } });
    await vi.waitFor(() => expect(current().execution!.runs.at(-1)).toMatchObject({ stage: 'tickets', status: 'running' }));
    expect(current().execution!.runs.at(-1)!.workerId).toBe(run.workerId);
    await vi.waitFor(() => expect(releaseConversation).toHaveBeenCalledWith(worker.id));
    expect(loadConversation).toHaveBeenCalledWith(worker);
    const ticketsRun = current().execution!.runs.at(-1)!;
    expect(refreshedContexts.at(-1)).toMatchObject({
      context: { missionId: current().id, runId: ticketsRun.id, stage: 'tickets' },
      instructions: expect.stringContaining('read-skill with name="mission-to-tickets"'),
    });
    expect(refreshedContexts.at(-1)?.instructions).toContain('Owners can pay');
    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: worker.id }), expect.stringContaining(`assigned ${product.name} Mission skill`), undefined,
    ));
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
    expect(interrupt).toHaveBeenCalledWith(expect.objectContaining({ id: worker.id }));
    expect(archiveAgentConversation).toHaveBeenCalledWith(expect.objectContaining({ id: worker.id }));
    expect(releaseConversation).toHaveBeenCalledWith(worker.id);
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
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
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
    const sendPrompt = vi.fn().mockResolvedValue({ backendSession: { kind: 'codex', threadId: 'recovered-mission-thread' } });
    const driver: AgentBackendDriver = {
      backend: 'codex', getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }), getCapabilities: () => codexBackendCapabilities,
      sendPrompt, interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'recovered-mission-thread' } }), respondToAgentRequest: async () => undefined, onEvent: () => () => {}, close: async () => {},
      listSkills: async () => [{ name: 'grilling', path: '/skills/grilling/SKILL.md', enabled: true }],
    };
    server = new AppBackendServer({ version: 'test', snapshot, driverRpc: new BackendDriverRpc(new Map([['codex', driver]])) });

    await server.initialize();
    await server.initialize();

    expect(sendPrompt).not.toHaveBeenCalled();
    const recoveredMission = snapshot.missions![0]!;
    const run = recoveredMission.execution!.runs[0]!;
    const worker = snapshot.agents.find(agent => agent.id === run.workerId);
    expect(run.status).toBe('running');
    expect(worker).toMatchObject({ folder: expect.stringMatching(/mission-/), workspace: { kind: 'folder' } });
    expect(worker).not.toHaveProperty('backendSession');
    expect(server.missionDeveloperInstructions(worker!.id)).toContain('<context>');
    expect(snapshot.teams[0]!.agentIds).toContain(worker!.id);
  } finally { await server?.close(); await rm(root, { recursive: true, force: true }); }
});
