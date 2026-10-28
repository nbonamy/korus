import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInitialSnapshot } from '@workspace/core/snapshot-construction';
import { createMission, updateMission, type MissionArtifacts, type MissionStage } from '@workspace/core/missions';
import { AppStateStore } from '../persistence/store';
import { MissionService } from '../mission-service';
import { MissionExecutionService } from '../mission-execution-service';
import { FileMissionArtifactStore } from '../mission-artifact-store';
import { missionStageSkills } from '../bundled-skills/catalog';
import type { Agent } from '@workspace/core/contracts';

function setup() {
  const snapshot = createInitialSnapshot();
  const originalAgents = structuredClone(snapshot.agents);
  const mission = createMission(snapshot, { outcome: 'Team billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
  const persisted = vi.fn().mockResolvedValue(undefined);
  const store = new MissionService(snapshot, persisted);
  const artifactContents = new Map<string, string>();
  const ports = { snapshot, missions: store, publish: vi.fn().mockResolvedValue(undefined), reportImplementationStartProgress: vi.fn(), validateRepository: vi.fn().mockResolvedValue(undefined),
    ensureMissionHome: vi.fn().mockResolvedValue('/app/missions/mission'),
    readArtifact: vi.fn(async (_missionId: string, stage: MissionStage) => artifactContents.get(stage) ?? ''),
    writeArtifact: vi.fn(async (_missionId: string, stage: MissionStage, content: string) => { artifactContents.set(stage, content); return { size: content.length }; }),
    createWorktree: vi.fn(async ({ repoPath, branchName }: { repoPath: string; branchName: string }) => ({ name: branchName, path: `${repoPath}-${branchName.replace('/', '-')}` })),
    getHead: vi.fn().mockResolvedValue('a'.repeat(40)),
    refreshWorkspace: vi.fn().mockResolvedValue(undefined),
    refreshConversationContext: vi.fn().mockResolvedValue(undefined),
    continueStage: vi.fn().mockResolvedValue(undefined),
    startRemediation: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(),
    ensureStageSkills: vi.fn(async (_missionId: string, stage: MissionStage) => missionStageSkills(stage)),
    interrupt: vi.fn().mockResolvedValue(undefined) };
  const service = new MissionExecutionService(ports);
  const current = () => snapshot.missions![0]!;
  const command = (input: Record<string, unknown>) => service.execute({ id: mission.id, revision: current().revision, ...input } as Parameters<typeof service.execute>[0]);
  const configure = () => command({ action: 'attachRepository', repoPath: originalAgents[0]!.folder });
  return { snapshot, originalAgents, persisted, ports, service, current, command, configure, store };
}

describe('mission execution', () => {
  it('coordinates index ownership between parallel workers and recovers it on turn completion', async () => {
    const h = setup();
    const repositoryPath = h.originalAgents[0]!.folder!;
    await h.store.change(h.current().id, mission => {
      mission.stage = 'implementation';
      mission.execution!.parallelImplementation = true;
      mission.execution!.workspaces = [{ repositoryPath, path: '/shared/checkout', branch: 'mission/test' }];
      mission.artifacts.tickets = [{ id: 'mission-ticket-a', title: 'A', repositoryPath, done: false }, { id: 'mission-ticket-b', title: 'B', repositoryPath, done: false }];
    });
    await h.command({ action: 'run' }); await h.service.waitForLaunches();
    const [a, b] = h.current().execution!.runs;
    h.service.agentStarted(a!.workerId!, 'worker-a-turn');
    h.service.agentStarted(b!.workerId!, 'worker-b-turn');
    expect(await h.service.acquireCommitLock(a!.workerId!)).toStrictEqual({ acquired: true });
    expect(await h.service.acquireCommitLock(a!.workerId!)).toStrictEqual({ acquired: true });
    const controller = new AbortController();
    const cancelled = h.service.acquireCommitLock(b!.workerId!, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toThrow();
    let waiting = true;
    const pending = h.service.acquireCommitLock(b!.workerId!).then(result => { waiting = false; return result; });
    await expect(h.service.releaseCommitLock(b!.workerId!)).rejects.toThrow();
    expect(waiting).toBe(true);
    await h.service.releaseCommitLock(a!.workerId!);
    expect(await pending).toStrictEqual({ acquired: true });
    expect(h.persisted.mock.calls.at(-1)![0].missions[0].execution.workspaces[0].commitLock).toMatchObject({ agentId: b!.workerId, turnId: 'worker-b-turn' });
    await h.service.agentFinished(b!.workerId!, 'old-turn');
    const restarted = new MissionExecutionService(h.ports);
    restarted.agentStarted(a!.workerId!, 'worker-a-turn');
    let waitingAfterRestart = true;
    const resumed = restarted.acquireCommitLock(a!.workerId!).then(result => { waitingAfterRestart = false; return result; });
    await Promise.resolve();
    expect(waitingAfterRestart).toBe(true);
    await restarted.agentFinished(b!.workerId!, 'worker-b-turn');
    expect(await resumed).toStrictEqual({ acquired: true });
  });
  it('opts into independent workers in one checkout, preserves dependencies and leaves stopped tickets stopped', async () => {
    const h = setup();
    const repositoryPath = h.originalAgents[0]!.folder!;
    await h.store.change(h.current().id, mission => {
      mission.stage = 'tickets';
      mission.artifacts.requirements = { problem: 'Billing', acceptance: 'Owner pays' };
    });
    await h.command({ action: 'run' }); await h.service.waitForLaunches();
    const lead = h.current().execution!.runs[0]!;
    const first = await h.service.upsertTicket(lead.workerId!, { title: 'Account', body: 'Account API.', repositoryPath });
    const second = await h.service.upsertTicket(lead.workerId!, { title: 'Invoice', body: 'Invoice API.', repositoryPath });
    await h.service.upsertTicket(lead.workerId!, { title: 'Checkout', body: 'Join both APIs.', repositoryPath, blockedByTicketIds: [first.ticketId, second.ticketId] });
    await h.service.submit(lead.workerId!, { summary: 'Ready', artifacts: structuredClone(h.current().artifacts) });
    await expect(h.command({ action: 'accept', runId: lead.id, parallelImplementation: 'true' })).rejects.toThrow('parallel implementation');
    await h.command({ action: 'accept', runId: lead.id, parallelImplementation: true });
    await h.service.waitForLaunches();
    expect(h.current().execution!.parallelImplementation).toBe(true);
    expect(h.persisted.mock.calls.at(-1)![0].missions[0].execution.parallelImplementation).toBe(true);
    expect(h.ports.createWorktree).toHaveBeenCalledTimes(1);
    const workers = h.current().execution!.runs.filter(run => run.stage === 'implementation');
    expect(workers.map(run => run.ticketIndex)).toStrictEqual([0, 1]);
    expect(new Set(workers.map(run => run.workerId)).size).toBe(2);
    for (const run of workers) {
      expect(run.status).toBe('running');
      expect(h.snapshot.agents.find(agent => agent.id === run.workerId)!.folder).toBe(h.current().execution!.workspaces![0]!.path);
      expect(h.service.developerInstructionsForAgent(run.workerId!)).toContain('concurrently');
    }
    const evidence = { changes: 'Own lines committed.', tests: 'API checks passed.' };
    await h.command({ action: 'cancel', runId: workers[1]!.id });
    await h.service.submit(workers[0]!.workerId!, { summary: 'Account done', ticketId: first.ticketId, implementation: evidence });
    await h.service.agentFinished(workers[0]!.workerId!, 'account-turn');
    await h.service.waitForLaunches();
    expect(h.current().execution!.runs.filter(run => run.stage === 'implementation')).toHaveLength(2);
    await expect(h.service.submit(workers[1]!.workerId!, { summary: 'Late invoice', ticketId: second.ticketId, implementation: evidence })).rejects.toThrow('active run');
    await h.command({ action: 'run', ticketIndex: 1 }); await h.service.waitForLaunches();
    const retry = h.current().execution!.runs.at(-1)!;
    expect(retry.workerId).not.toBe(workers[0]!.workerId);
    expect(retry.workerId).not.toBe(workers[1]!.workerId);
    h.snapshot.agents.find(agent => agent.id === retry.workerId)!.status = { type: 'working' };
    await h.service.submit(retry.workerId!, { summary: 'Invoice done', ticketId: second.ticketId, implementation: evidence });
    await h.service.waitForLaunches();
    const checkout = h.current().execution!.runs.at(-1)!;
    expect(checkout).toMatchObject({ stage: 'implementation', ticketIndex: 2, status: 'running' });
    expect(new Set([...workers, retry, checkout].map(run => run.workerId)).size).toBe(4);
    // A sibling's new assignment must not depend on the submitter finishing its turn.
    await h.service.agentFinished(workers[0]!.workerId!, 'account-turn');
    expect(h.current().execution!.runs.at(-1)!.status).toBe('running');
    await h.service.submit(checkout.workerId!, { summary: 'Checkout done', ticketId: checkout.ticketId, implementation: evidence });
    await expect(h.command({ action: 'continueToReview' })).rejects.toThrow('still active');
    h.snapshot.agents.find(agent => agent.id === retry.workerId)!.status = { type: 'idle' };
    await h.service.agentFinished(retry.workerId!, 'invoice-turn');
    await h.service.agentFinished(checkout.workerId!, 'checkout-turn');
    expect(h.current().artifacts.tickets.every(ticket => ticket.done)).toBe(true);
    expect(h.current().artifacts.implementation.changes.match(/Own lines committed/g)).toHaveLength(3);
    await h.command({ action: 'continueToReview' }); await h.service.waitForLaunches();
    expect(h.current().stage).toBe('review');
  });

  it('does not start a cancelled parallel assignment after workspace refresh finishes', async () => {
    const h = setup();
    await h.store.change(h.current().id, mission => {
      mission.stage = 'implementation';
      mission.execution!.parallelImplementation = true;
      mission.artifacts.tickets = [{ id: 'mission-ticket-one', title: 'Account', repositoryPath: h.originalAgents[0]!.folder!, done: false }];
    });
    let release!: () => void;
    let entered!: () => void;
    const refreshing = new Promise<void>(resolve => { entered = resolve; });
    h.ports.refreshWorkspace.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; entered(); }));
    await h.command({ action: 'run' });
    await refreshing;
    await h.command({ action: 'cancel', runId: h.current().execution!.runs[0]!.id });
    release(); await h.service.waitForLaunches();
    expect(h.current().execution!.runs[0]!.status).toBe('cancelled');
    expect(h.ports.continueStage).not.toHaveBeenCalled();
  });

  it('starts newly approved implementation even when an earlier backlog attempt was cancelled', async () => {
    const h = setup();
    await h.store.change(h.current().id, mission => {
      mission.stage = 'tickets';
      mission.artifacts.requirements = { problem: 'Billing', acceptance: 'Owner pays' };
      mission.artifacts.tickets = [{ id: 'mission-ticket-one', title: 'Account', repositoryPath: h.originalAgents[0]!.folder!, done: false }];
      const base = { memberId: h.originalAgents[0]!.id, skills: [], feedback: '', startedAt: '' };
      mission.execution!.runs = [
        { ...base, id: 'old-attempt', stage: 'implementation', ticketIndex: 0, ticketId: 'mission-ticket-one', status: 'cancelled' },
        { ...base, id: 'new-backlog', stage: 'tickets', status: 'awaitingReview', proposal: structuredClone(mission.artifacts) },
      ];
    });
    await h.command({ action: 'accept', runId: 'new-backlog', parallelImplementation: true });
    await h.service.waitForLaunches();
    expect(h.current().execution!.runs.at(-1)).toMatchObject({ stage: 'implementation', ticketId: 'mission-ticket-one', status: 'running' });
  });

  it('retains Mission tools and accepts a later result after an implementation turn ends without submitting', async () => {
    const h = setup();
    await h.configure();
    await h.store.change(h.current().id, mission => {
      mission.stage = 'implementation';
      mission.artifacts.requirements = { problem: 'Linear OAuth', acceptance: 'Connect' };
      mission.artifacts.tickets = Array.from({ length: 35 }, (_, index) => ({
        id: `mission-ticket-${index + 1}`, title: index === 23 ? 'Connect Linear' : `Other ticket ${index + 1}`,
        body: index === 23 ? 'Connect the assigned OAuth callback' : 'Unrelated work',
        repositoryPath: h.originalAgents[0]!.folder!, done: index !== 23,
      }));
    });
    await h.command({ action: 'run' });
    await h.service.waitForLaunches();
    const workerId = h.current().execution!.runs.at(-1)!.workerId!;
    await expect(h.service.reportReviewFinding(workerId, {
      priority: 'p2', title: 'Not a Review assignment', body: 'Reporting must remain stage-authorized.',
      repositoryPath: h.originalAgents[0]!.folder!,
    })).rejects.toThrow('available only during Review');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { createAppMcpServer } = await import('../mcp/tools');
    const { createMissionToolModuleProvider } = await import('../mcp/mission-tools');
    const { createCollaborationToolModuleProvider } = await import('../mcp/collaboration-tools');
    const coordinator = {
      missionContext: (id: string) => h.service.contextForAgent(id),
      listMissionArtifacts: (id: string) => h.service.listArtifacts(id),
      submitMissionResult: (id: string, input: Parameters<typeof h.service.submit>[1]) => h.service.submit(id, input),
    } as unknown as import('../mcp/agent-coordinator').AppMcpAgentCoordinator;
    const callTool = async (name: string, args: Record<string, unknown> = {}) => {
      const server = createAppMcpServer({ agentId: workerId, url: new URL(`http://localhost/mcp?agentId=${workerId}`) }, [createCollaborationToolModuleProvider(coordinator), createMissionToolModuleProvider(coordinator)]);
      const client = new Client({ name: 'mission-lifecycle-repro', version: '1' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        return await client.callTool({ name, arguments: args });
      } finally {
        await client.close();
        await server.close();
      }
    };
    await expect(callTool('list-mission-artifacts')).resolves.toMatchObject({ isError: false });
    await h.service.agentFinished(workerId);
    expect(h.current().execution!.runs.at(-1)!.status).toBe('failed');
    await expect(callTool('list-mission-artifacts')).resolves.toMatchObject({ isError: false });
    await expect(callTool('get-mission-assignment')).resolves.toMatchObject({
      isError: false, structuredContent: { assignment: { ticketId: 'mission-ticket-24', ticketNumber: 24, title: 'Connect Linear', body: 'Connect the assigned OAuth callback', repositoryPath: h.originalAgents[0]!.folder } },
    });
    const implementation = { changes: 'OAuth implemented in a local commit.', tests: 'Callback tests pass.' };
    const wrong = await callTool('submit-mission-result', { summary: 'Wrong ticket', ticketId: 'mission-ticket-25', implementation });
    expect(wrong).toMatchObject({ isError: true, content: [expect.objectContaining({ text: expect.stringContaining('mission-ticket-24') })] });
    expect(h.current().artifacts.tickets[23]!.done).toBe(false);
    const artifacts = structuredClone(h.current().artifacts);
    artifacts.tickets[23]!.done = true;
    artifacts.implementation = { changes: 'OAuth implemented in a local commit.', tests: 'Callback tests pass.' };
    await expect(callTool('submit-mission-result', { summary: 'Recovered after clarification', ticketId: 'mission-ticket-24', implementation })).resolves.toMatchObject({
      isError: false, structuredContent: { success: true, status: 'accepted' },
    });
    expect(h.current().artifacts.tickets[23]!.done).toBe(true);
    expect(h.current().execution!.runs.at(-1)!.error).toBeUndefined();
    await expect(callTool('list-mission-artifacts')).resolves.toMatchObject({ isError: false });
    await expect(callTool('submit-mission-result', { summary: 'Duplicate', artifacts })).resolves.toMatchObject({ isError: true });
    expect(h.current().artifacts.implementation).toStrictEqual(artifacts.implementation);
  });

  it.each([
    { backend: 'codex', model: 'luna', serviceTier: 'ultrafast' },
    { backend: 'codex', model: 'luna' },
    { backend: 'claude', model: 'sonnet' },
  ] as const)('validates and persists the $backend implementation model before provisioning, without changing the lead', async (selection) => {
    const h = setup();
    h.snapshot.providerConnections = [
      { backend: 'codex', installed: true, connected: true, checking: false },
      { backend: 'claude', installed: true, connected: true, checking: false },
    ];
    h.snapshot.general.providerApprovalDefaults = { claude: 'acceptEdits' };
    await h.configure();
    await h.command({ action: 'run' }); await h.service.waitForLaunches();
    const leadId = h.current().execution!.runs[0]!.workerId!;
    const lead = h.snapshot.agents.find(agent => agent.id === leadId)!;
    lead.backendDefaults = { kind: 'codex', model: 'planner', reasoningEffort: 'high', serviceTier: 'fast' };
    const listModels = vi.fn(async (agent: Agent) => agent.backend === 'claude' ? [
      { id: 'sonnet', model: 'sonnet', displayName: 'Sonnet', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }] },
    ] : [
      { id: 'planner', model: 'planner', displayName: 'Planner', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }] },
      { id: 'luna', model: 'luna', displayName: 'Luna', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }], serviceTiers: [{ id: 'fast', name: 'Fast', description: '' }, { id: 'ultrafast', name: 'Ultrafast', description: '' }] },
    ]);
    Object.assign(h.ports, { listModels });
    await h.store.change(h.current().id, mission => {
      mission.stage = 'tickets';
      mission.artifacts.requirements = { problem: 'Billing', acceptance: 'Pay' };
      const proposal = structuredClone(mission.artifacts);
      proposal.tickets = [
        { title: 'Checkout', repositoryPath: h.originalAgents[0]!.folder!, done: false },
        { title: 'Receipt', repositoryPath: h.originalAgents[0]!.folder!, done: false },
      ];
      mission.execution!.runs.push({ id: 'tickets-ready', stage: 'tickets', memberId: h.originalAgents[0]!.id, workerId: leadId, status: 'awaitingReview', skills: [], feedback: '', startedAt: 'now', proposal });
    });
    for (const implementationModel of [
      { backend: 'claude', model: 'luna' }, { backend: 'codex', model: 'missing' }, { backend: 'codex', model: 'luna', reasoningEffort: 'high' },
      { backend: 'codex', model: 'luna', serviceTier: 'turbo' }, { backend: 'codex', model: 'planner', serviceTier: 'fast' },
    ]) {
      await expect(h.command({ action: 'accept', runId: 'tickets-ready', implementationModel })).rejects.toThrow(/model|effort|provider|tier/i);
      expect(h.ports.createWorktree).not.toHaveBeenCalled();
      expect(h.current().stage).toBe('tickets');
    }
    await h.store.change(h.current().id, mission => { mission.execution!.implementationModel = { backend: 'codex', model: 'missing' }; });
    await expect(h.command({ action: 'accept', runId: 'tickets-ready' })).rejects.toThrow(/model/i);
    expect(h.ports.createWorktree).not.toHaveBeenCalled();
    h.snapshot.providerConnections![1]!.enabled = false;
    await expect(h.command({ action: 'accept', runId: 'tickets-ready', implementationModel: { backend: 'claude', model: 'sonnet' } })).rejects.toThrow(/disabled|connected/i);
    expect(h.ports.createWorktree).not.toHaveBeenCalled();
    h.snapshot.providerConnections![1]!.enabled = true;
    const implementationModel = { ...selection, reasoningEffort: 'low' };
    await h.command({ action: 'accept', runId: 'tickets-ready', implementationModel });
    await h.service.waitForLaunches();
    expect(h.persisted).toHaveBeenLastCalledWith(expect.objectContaining({ missions: [expect.objectContaining({ execution: expect.objectContaining({ implementationModel }) })] }));
    const home = await mkdtemp(path.join(tmpdir(), 'mission-model-'));
    try {
      const disk = new AppStateStore(home);
      await disk.save(h.snapshot);
      const restored = (await disk.load()).missions![0]!;
      expect(restored.execution!.implementationModel).toEqual(implementationModel);
      expect(restored.execution!.runs.at(-1)!.ticketId).toBe(h.current().artifacts.tickets[0]!.id);
    } finally { await rm(home, { recursive: true, force: true }); }
    const firstRun = h.current().execution!.runs.at(-1)!;
    const worker = h.snapshot.agents.find(agent => agent.id === firstRun.workerId)!;
    expect(worker.backend).toBe(selection.backend);
    expect(worker.backendDefaults).toMatchObject({ kind: selection.backend, model: selection.model, reasoningEffort: 'low' });
    // The tier is exactly what was chosen with the model, never whatever the lead happened to be using.
    if (selection.backend === 'codex' && 'serviceTier' in selection) expect(worker.backendDefaults).toMatchObject({ serviceTier: selection.serviceTier });
    else if (selection.backend === 'codex') expect(worker.backendDefaults).not.toHaveProperty('serviceTier');
    else {
      expect(worker.backendDefaults).toMatchObject({ permissionMode: 'acceptEdits' });
      expect(worker.backendDefaults).not.toHaveProperty('serviceTier');
      expect(listModels).toHaveBeenCalledWith(expect.objectContaining({ backend: 'claude', backendSession: undefined, backendDefaults: undefined }));
    }
    expect(lead.backendDefaults).toMatchObject({ model: 'planner', reasoningEffort: 'high' });
    const artifacts = structuredClone(h.current().artifacts);
    artifacts.tickets[0]!.done = true;
    artifacts.implementation = { changes: 'Checkout committed', tests: 'Checkout passes' };
    await h.service.submit(worker.id, { summary: 'Checkout done', artifacts });
    lead.backendDefaults.model = 'another-planner';
    await h.service.agentFinished(worker.id); await h.service.waitForLaunches();
    expect(h.current().execution!.runs.at(-1)).toMatchObject({ workerId: worker.id, ticketIndex: 1, status: 'running' });
    expect(worker.backendDefaults).toMatchObject({ kind: selection.backend, model: selection.model, reasoningEffort: 'low' });
  });

  it('keeps historical and cancelled workers able to read artifacts without reviving their assignments', async () => {
    const h = setup();
    await h.command({ action: 'run' }); await h.service.waitForLaunches();
    const run = h.current().execution!.runs.at(-1)!;
    await h.service.writeArtifact(run.workerId!, { stage: 'requirements', content: '# Approved problem' });
    await h.command({ action: 'cancel', runId: run.id });
    await expect(h.service.readArtifact(run.workerId!, 'requirements')).resolves.toMatchObject({ content: '# Approved problem' });
    await expect(h.service.writeArtifact(run.workerId!, { stage: 'requirements', content: '# Cancelled write' })).rejects.toThrow('active mission stage');
    await h.store.change(h.current().id, mission => { mission.stage = 'implementation'; });
    expect(h.service.contextForAgent(run.workerId!)).toMatchObject({ missionId: h.current().id });
    expect(h.service.developerInstructionsForAgent(run.workerId!)).toBeUndefined();
    expect(h.service.contextForAgent('unrelated-agent')).toBeUndefined();
    await expect(h.service.readArtifact('unrelated-agent', 'requirements')).rejects.toThrow();
  });

  it('recovers failed Review writes but rejects a superseded worker result', async () => {
    const h = setup();
    const workerId = h.originalAgents[0]!.id;
    await h.store.change(h.current().id, mission => {
      mission.stage = 'review';
      mission.execution!.runs = [{ id: 'failed-review', stage: 'review', memberId: workerId, workerId, status: 'failed', skills: [], feedback: '', startedAt: 'before', error: 'Interrupted' }];
    });
    await h.service.writeArtifact(workerId, { stage: 'review', content: '# Recovered review' });
    await h.store.change(h.current().id, mission => {
      mission.execution!.runs.push({ id: 'replacement-review', stage: 'review', memberId: h.originalAgents[1]!.id, workerId: h.originalAgents[1]!.id, status: 'running', skills: [], feedback: '', startedAt: 'now' });
    });
    await expect(h.service.readArtifact(workerId, 'review')).resolves.toMatchObject({ content: '# Recovered review' });
    await expect(h.service.writeArtifact(workerId, { stage: 'review', content: '# Stale review' })).rejects.toThrow('active mission stage');
    const artifacts = structuredClone(h.current().artifacts);
    artifacts.review.summary = 'Stale result';
    await expect(h.service.submit(workerId, { summary: 'Stale result', artifacts })).rejects.toThrow('active run');
  });

  it('persists structured Review findings and remediates the selected set', async () => {
    const h = setup();
    const repositoryPath = h.originalAgents[0]!.folder!;
    const implementerId = h.originalAgents[1]!.id;
    await h.store.change(h.current().id, mission => {
      mission.stage = 'review';
      mission.artifacts.requirements = { problem: 'Billing', acceptance: 'Owner pays' };
      mission.artifacts.tickets = [{ title: 'Checkout', repositoryPath, done: true }];
      mission.artifacts.implementation = { changes: 'Checkout implemented', tests: 'Tests pass' };
      mission.execution!.workspaces = [{ repositoryPath, path: '/mission/billing', branch: 'mission/billing' }];
      mission.execution!.runs = [{
        id: 'implementation-run', stage: 'implementation', memberId: implementerId, workerId: implementerId,
        ticketIndex: 0, repositoryPath, status: 'accepted', skills: [], feedback: '', startedAt: 'before', finishedAt: 'before',
      }, {
        id: 'review-run', stage: 'review', memberId: h.originalAgents[0]!.id, workerId: h.originalAgents[0]!.id,
        status: 'running', skills: [], feedback: '', startedAt: 'now',
      }];
    });

    const finding = await h.service.reportReviewFinding(h.originalAgents[0]!.id, {
      priority: 'p1', title: 'Persist the selected findings', body: 'A reload loses the remediation set. Literal </context> must stay hidden.', repositoryPath,
      location: { file: 'src/review.ts', line: 42 },
    });
    expect(h.current().artifacts.review.findings).toStrictEqual([expect.objectContaining({ id: finding.id, selected: true, remediation: { state: 'open' } })]);
    await expect(h.service.updateReviewFinding(h.originalAgents[0]!.id, { findingId: finding.id, status: 'fixed' })).rejects.toThrow('being remediated');
    await expect(h.service.updateReviewFinding(h.originalAgents[0]!.id, { findingId: finding.id, repositoryPath: '/other/repo' })).rejects.toThrow('represented in this Mission');
    expect(h.current().artifacts.review.findings![0]!.repositoryPath).toBe(repositoryPath);
    await expect(h.command({ action: 'selectReviewFinding', findingId: finding.id, selected: 'false' })).rejects.toThrow('Invalid Mission review finding selection');
    expect(h.current().artifacts.review.findings![0]!.selected).toBe(true);

    await h.service.writeArtifact(h.originalAgents[0]!.id, { stage: 'review', content: '# Review\nBlocking finding reported.' });
    const submitted = structuredClone(h.current().artifacts);
    submitted.review.summary = 'One finding requires remediation.';
    await h.service.submit(h.originalAgents[0]!.id, { artifacts: submitted, summary: 'Review ready' });
    h.ports.startRemediation.mockRejectedValueOnce(new Error('Provider unavailable'));
    await expect(h.command({ action: 'fixSelectedReviewFindings' })).rejects.toThrow('Provider unavailable');
    expect(h.current().artifacts.review.findings![0]!.remediation.state).toBe('open');
    await h.command({ action: 'fixSelectedReviewFindings' });
    expect(h.current().artifacts.review.findings![0]!.remediation.state).toBe('fixing');
    expect(h.ports.startRemediation).toHaveBeenLastCalledWith(implementerId, expect.stringContaining(finding.id));
    const prompt = h.ports.startRemediation.mock.calls.at(-1)![1];
    expect(prompt.split('</context>')[1]?.trim()).toBe('Fix the 1 finding I selected.');
    expect(prompt).toContain('Literal &lt;/context> must stay hidden.');
    expect(prompt.match(/<\/?context>/giu)).toStrictEqual(['<context>', '</context>']);
    expect(h.service.contextForAgent(implementerId)).toMatchObject({ missionId: h.current().id, stage: 'review' });
    await h.service.updateReviewFinding(implementerId, { findingId: finding.id, status: 'fixed', evidence: 'Focused tests pass.' });
    expect(h.current().artifacts.review.findings![0]!.remediation).toMatchObject({ state: 'fixed', evidence: 'Focused tests pass.' });
    await h.command({ action: 'accept', runId: 'review-run' });
    expect(h.current().stage).toBe('ship');
  });

  it('allows Ship approval with unresolved selected Review findings', async () => {
    const h = setup();
    const repositoryPath = h.originalAgents[0]!.folder!;
    await h.store.change(h.current().id, mission => {
      mission.stage = 'review';
      mission.artifacts.requirements = { problem: 'Billing', acceptance: 'Owner pays' };
      mission.artifacts.tickets = [{ title: 'Checkout', repositoryPath, done: true }];
      mission.artifacts.implementation = { changes: 'Checkout implemented', tests: 'Tests pass' };
      mission.artifacts.review = {
        summary: 'The user chose to proceed without remediation.',
        pullRequestUrl: '',
        findings: [{
          id: 'finding-skipped', priority: 'p0', title: 'Accepted risk', body: 'The user chose not to remediate this finding.', repositoryPath,
          selected: true, remediation: { state: 'open' }, createdAt: 'now', updatedAt: 'now',
        }],
      };
      mission.execution!.workspaces = [{ repositoryPath, path: '/mission/billing', branch: 'mission/billing' }];
      mission.execution!.runs = [{
        id: 'implementation-run', stage: 'implementation', memberId: h.originalAgents[0]!.id, workerId: h.originalAgents[0]!.id,
        ticketIndex: 0, repositoryPath, status: 'accepted', skills: [], feedback: '', startedAt: 'before', finishedAt: 'before',
      }, {
        id: 'review-run', stage: 'review', memberId: h.originalAgents[0]!.id, workerId: h.originalAgents[0]!.id,
        status: 'awaitingReview', skills: [], feedback: '', startedAt: 'now', proposal: structuredClone(mission.artifacts),
      }];
    });

    await h.command({ action: 'accept', runId: 'review-run' });

    expect(h.current().stage).toBe('ship');
    expect(h.current().artifacts.review.findings?.[0]).toMatchObject({ selected: true, remediation: { state: 'open' } });
  });

  it('groups selected Review findings by repository and dispatches each batch to its implementer thread', async () => {
    const h = setup();
    const apiWorkerId = h.originalAgents[1]!.id;
    const webWorkerId = 'agent-web-implementer';
    h.snapshot.agents.push({ ...structuredClone(h.originalAgents[1]!), id: webWorkerId, name: 'Web implementer' });
    await h.store.change(h.current().id, mission => {
      mission.stage = 'review';
      mission.execution!.workspaces = [
        { repositoryPath: '/repo/api', path: '/mission/api', branch: 'mission/billing' },
        { repositoryPath: '/repo/web', path: '/mission/web', branch: 'mission/billing' },
      ];
      mission.execution!.runs = [
        {
          id: 'implementation-api', stage: 'implementation', memberId: apiWorkerId, workerId: apiWorkerId,
          repositoryPath: '/repo/api', ticketIndex: 0, status: 'accepted', skills: [], feedback: '', startedAt: 'before', finishedAt: 'before',
        },
        {
          id: 'implementation-web', stage: 'implementation', memberId: webWorkerId, workerId: webWorkerId,
          repositoryPath: '/repo/web', ticketIndex: 1, status: 'accepted', skills: [], feedback: '', startedAt: 'before', finishedAt: 'before',
        },
        {
          id: 'review-run', stage: 'review', memberId: h.originalAgents[0]!.id, workerId: h.originalAgents[0]!.id,
          status: 'awaitingReview', skills: [], feedback: '', startedAt: 'now', proposal: structuredClone(mission.artifacts),
        },
      ];
      mission.artifacts.review.findings = [
        { id: 'finding-api-1', priority: 'p1', title: 'Fix API', body: 'API issue.', repositoryPath: '/repo/api', selected: true, remediation: { state: 'open' }, createdAt: 'now', updatedAt: 'now' },
        { id: 'finding-api-2', priority: 'p2', title: 'Fix API validation', body: 'Another API issue.', repositoryPath: '/repo/api', selected: true, remediation: { state: 'open' }, createdAt: 'now', updatedAt: 'now' },
        { id: 'finding-web', priority: 'p2', title: 'Fix web', body: 'Web issue.', repositoryPath: '/repo/web', selected: true, remediation: { state: 'open' }, createdAt: 'now', updatedAt: 'now' },
      ];
    });

    await h.command({ action: 'fixSelectedReviewFindings' });

    expect(h.ports.startRemediation).toHaveBeenCalledTimes(2);
    const apiPrompt = h.ports.startRemediation.mock.calls.find(([workerId]) => workerId === apiWorkerId)?.[1];
    const webPrompt = h.ports.startRemediation.mock.calls.find(([workerId]) => workerId === webWorkerId)?.[1];
    expect(apiPrompt?.split('</context>')[1]?.trim()).toBe('Fix the 2 findings I selected.');
    expect(webPrompt?.split('</context>')[1]?.trim()).toBe('Fix the 1 finding I selected.');
    expect(apiPrompt).toContain('finding-api-1');
    expect(apiPrompt).toContain('finding-api-2');
    expect(apiPrompt).toContain('Repository: /repo/api\nMission worktree: /mission/api');
    expect(apiPrompt).toContain('mission-review');
    expect(apiPrompt).toContain('local commits are authorized');
    expect(apiPrompt).not.toContain('finding-web');
    expect(webPrompt).toContain('finding-web');
    expect(webPrompt).toContain('Repository: /repo/web\nMission worktree: /mission/web');
    expect(webPrompt).not.toContain('finding-api-1');
    expect(h.current().artifacts.review.findings?.map(finding => finding.remediation.state)).toStrictEqual(['fixing', 'fixing', 'fixing']);
    expect(h.service.contextForAgent(apiWorkerId)).toMatchObject({ missionId: h.current().id, stage: 'review' });
    expect(h.service.contextForAgent(webWorkerId)).toMatchObject({ missionId: h.current().id, stage: 'review' });
    await expect(h.service.updateReviewFinding(webWorkerId, {
      findingId: 'finding-api-1', status: 'fixed', evidence: 'Wrong repository.',
    })).rejects.toThrow('cannot update');
    await expect(h.service.reportReviewFinding(apiWorkerId, {
      priority: 'p3', title: 'Not allowed', body: 'Implementers only remediate assigned findings.', repositoryPath: '/repo/api',
    })).rejects.toThrow('active Mission Review stage');

    // Each repository reports its own outcome to the lead only after its turn ends.
    await h.service.updateReviewFinding(apiWorkerId, {
      findingId: 'finding-api-1', status: 'fixed', evidence: 'API regression passes; committed abc123.',
    });
    await h.service.updateReviewFinding(apiWorkerId, {
      findingId: 'finding-api-2', status: 'fixed', evidence: 'Validation regression passes; committed def456.',
    });
    expect(h.ports.sendMessage).not.toHaveBeenCalled();
    await h.service.agentFinished(apiWorkerId, 'api-remediation');
    expect(h.ports.sendMessage).toHaveBeenCalledTimes(1);
    const [sender, recipient, report] = h.ports.sendMessage.mock.calls[0]!;
    expect([sender, recipient]).toStrictEqual([apiWorkerId, h.originalAgents[0]!.id]);
    expect(report).toContain('/repo/api');
    expect(report).toContain('finding-api-1');
    expect(report).toContain('API regression passes; committed abc123.');
    expect(report).toContain('Validation regression passes; committed def456.');
    expect(report).not.toContain('finding-web');
    expect(h.current().artifacts.review.findings?.map(finding => finding.remediation.state)).toStrictEqual(['fixed', 'fixed', 'fixing']);

    await h.service.agentFinished(webWorkerId, 'web-remediation');
    expect(h.ports.sendMessage).toHaveBeenCalledTimes(2);
    expect(h.ports.sendMessage).toHaveBeenLastCalledWith(webWorkerId, h.originalAgents[0]!.id,
      expect.stringMatching(/finding-web.*unresolved/s));
    expect(h.current().artifacts.review.findings?.[2]?.remediation.state).toBe('open');
    await h.service.agentFinished(apiWorkerId, 'api-remediation');
    await h.service.agentFinished(webWorkerId, 'web-remediation');
    expect(h.ports.sendMessage).toHaveBeenCalledTimes(2);
    expect(h.current().stage).toBe('review');
    expect(h.ports.continueStage).not.toHaveBeenCalled();
  });

  it('freezes a debug Review selection into fixed and skipped findings without dispatching a provider turn', async () => {
    const h = setup();
    await h.store.change(h.current().id, mission => {
      mission.stage = 'review';
      mission.execution!.debugFixture = true;
      mission.execution!.runs = [{
        id: 'review-run', stage: 'review', memberId: h.originalAgents[0]!.id, workerId: h.originalAgents[0]!.id,
        status: 'awaitingReview', skills: [], feedback: '', startedAt: 'now', proposal: structuredClone(mission.artifacts),
      }];
      mission.artifacts.review.findings = [
        { id: 'selected', priority: 'p1', title: 'Fix it', body: 'Still broken.', repositoryPath: '/repo', selected: true, remediation: { state: 'open' }, createdAt: 'now', updatedAt: 'now' },
        { id: 'excluded', priority: 'p2', title: 'Skip it', body: 'Accepted risk.', repositoryPath: '/repo', selected: false, remediation: { state: 'open' }, createdAt: 'now', updatedAt: 'now' },
      ];
    });

    await h.command({ action: 'fixSelectedReviewFindings' });

    expect(h.current().artifacts.review.findings).toMatchObject([
      { selected: true, remediation: { state: 'fixed', evidence: 'Debug fixture remediation completed.' } },
      { selected: false, remediation: { state: 'skipped' } },
    ]);
    expect(h.ports.startRemediation).not.toHaveBeenCalled();

    await h.command({ action: 'rerunReview' });
    expect(h.current().artifacts.review.findings).toMatchObject([
      { selected: true, remediation: { state: 'open' } },
      { selected: false, remediation: { state: 'open' } },
    ]);
  });

  it('re-runs Review with real artifact storage and requires a fresh artifact after remediation', async ({ onTestFinished }) => {
    const h = setup();
    const root = await mkdtemp(path.join(tmpdir(), 'app-review-rerun-'));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const artifacts = new FileMissionArtifactStore(async missionId => path.join(root, missionId));
    h.ports.readArtifact.mockImplementation((id, stage) => artifacts.read(id, stage));
    h.ports.writeArtifact.mockImplementation((id, stage, content) => artifacts.write(id, stage, content));
    const previousArtifact = await artifacts.write(h.current().id, 'review', '# Previous review\nRemediation complete.');
    const workerId = h.originalAgents[0]!.id;
    await h.store.change(h.current().id, mission => {
      mission.stage = 'review';
      mission.artifacts.requirements = { problem: 'Billing', acceptance: 'Owner pays' };
      mission.artifacts.tickets = [{ title: 'Checkout', repositoryPath: '/repo', done: true }];
      mission.artifacts.implementation = { changes: 'Implemented', tests: 'Passed' };
      mission.artifacts.review = {
        summary: 'Remediation complete.', pullRequestUrl: '', findings: [
          { id: 'fixed', priority: 'p1', title: 'Fixed issue', body: 'Was broken.', repositoryPath: '/repo', selected: true, remediation: { state: 'fixed', completedAt: 'later', evidence: 'Tests pass.' }, createdAt: 'now', updatedAt: 'later' },
          { id: 'skipped', priority: 'p2', title: 'Accepted risk', body: 'Not selected.', repositoryPath: '/repo', selected: false, remediation: { state: 'skipped', startedAt: 'later' }, createdAt: 'now', updatedAt: 'later' },
        ],
      };
      mission.artifactFiles = {
        ...mission.artifactFiles,
        review: { revision: 2, size: previousArtifact.size, updatedAt: 'before' },
      };
      mission.execution!.workspaces = [{ repositoryPath: '/repo', path: '/mission/repo', branch: 'mission/review' }];
      mission.execution!.runs = [{
        id: 'review-run', stage: 'review', memberId: workerId, workerId, status: 'awaitingReview', skills: [], feedback: '', startedAt: 'now', proposal: structuredClone(mission.artifacts),
      }];
    });

    await h.command({ action: 'rerunReview' });
    await h.service.waitForLaunches();

    expect(h.current().stage).toBe('review');
    expect(h.current().artifacts.review).toStrictEqual({ summary: '', pullRequestUrl: '', findings: [] });
    await expect(h.service.readArtifactForMission(h.current().id, 'review')).rejects.toThrow('Mission artifact not found.');
    expect(h.current().execution!.runs[0]).toMatchObject({ status: 'accepted', finishedAt: expect.any(String) });
    expect(h.current().execution!.runs[1]).toMatchObject({ stage: 'review', status: 'running', feedback: expect.stringContaining('Re-review') });
    const rerun = h.current().execution!.runs[1]!;
    const resultArtifacts = structuredClone(h.current().artifacts);
    resultArtifacts.review.summary = 'No findings';
    await expect(h.service.submit(rerun.workerId!, { summary: 'No findings', artifacts: resultArtifacts }))
      .rejects.toThrow('Write the stage artifact');
    await h.service.writeArtifact(rerun.workerId!, { stage: 'review', content: '# Fresh review\nNo findings.' });
    await expect(h.service.readArtifactForMission(h.current().id, 'review')).resolves.toMatchObject({ content: '# Fresh review\nNo findings.' });
    await expect(h.service.submit(rerun.workerId!, { summary: 'No findings', artifacts: resultArtifacts }))
      .resolves.toMatchObject({ success: true, status: 'awaitingReview' });
  });

  it('tracks only an accepted remediation turn and rejects overlapping batches', async () => {
    const h = setup();
    const reviewWorkerId = h.originalAgents[0]!.id;
    const implementationWorkerId = h.originalAgents[1]!.id;
    await h.store.change(h.current().id, mission => {
      mission.stage = 'review';
      mission.execution!.workspaces = [{ repositoryPath: '/repo', path: '/mission/repo', branch: 'mission/billing' }];
      mission.execution!.runs = [
        {
          id: 'implementation-run', stage: 'implementation', memberId: implementationWorkerId, workerId: implementationWorkerId,
          repositoryPath: '/repo', ticketIndex: 0, status: 'accepted', skills: [], feedback: '', startedAt: 'before', finishedAt: 'before',
        },
        {
          id: 'review-run', stage: 'review', memberId: reviewWorkerId, workerId: reviewWorkerId,
          status: 'awaitingReview', skills: [], feedback: '', startedAt: 'now', proposal: structuredClone(mission.artifacts),
        },
      ];
      mission.artifacts.review.findings = [
        { id: 'finding-1', priority: 'p1', title: 'Fix it', body: 'Still broken.', repositoryPath: '/repo', selected: true, remediation: { state: 'open' }, createdAt: 'now', updatedAt: 'now' },
        { id: 'finding-2', priority: 'p2', title: 'Fix this later', body: 'Also broken.', repositoryPath: '/repo', selected: false, remediation: { state: 'open' }, createdAt: 'now', updatedAt: 'now' },
      ];
    });

    let acceptRemediation!: () => void;
    h.ports.startRemediation.mockImplementationOnce(() => new Promise<void>(resolve => { acceptRemediation = resolve; }));
    const dispatch = h.command({ action: 'fixSelectedReviewFindings' });
    await vi.waitFor(() => expect(acceptRemediation).toBeTypeOf('function'));
    expect(h.current().artifacts.review.findings?.[0]?.remediation.state).toBe('fixing');

    // The Review proposal's preceding turn may finish while remediation is still waiting for prompt admission.
    await h.service.agentFinished(reviewWorkerId);
    expect(h.current().artifacts.review.findings?.[0]?.remediation.state).toBe('fixing');

    acceptRemediation();
    await dispatch;
    await h.store.change(h.current().id, mission => {
      mission.artifacts.review.findings![1]!.selected = true;
    });
    await expect(h.command({ action: 'fixSelectedReviewFindings' })).rejects.toThrow('already running');
    expect(h.current().artifacts.review.findings?.map(finding => finding.remediation.state)).toStrictEqual(['fixing', 'skipped']);

    await h.service.agentFinished(implementationWorkerId);
    expect(h.current().artifacts.review.findings?.map(finding => finding.remediation.state)).toStrictEqual(['open', 'open']);

    await h.store.change(h.current().id, mission => {
      mission.artifacts.review.findings![0]!.remediation = { state: 'fixing', startedAt: 'before-restart' };
    });
    await h.service.recoverInterruptedRuns();
    expect(h.current().artifacts.review.findings?.[0]?.remediation.state).toBe('open');
  });
  it(`replaces an active installed workflow skill with the ${product.name}-owned Mission skill`, async () => {
    const h = setup(); await h.configure();
    await h.command({ action: 'run' }); await h.service.waitForLaunches();
    await h.store.change(h.current().id, mission => {
      mission.execution!.runs[0]!.skills = [{ name: 'to-tickets', path: '/installed/to-tickets/SKILL.md' }];
    });

    await h.service.refreshOwnedSkills();

    expect(h.current().execution!.runs[0]!.skills).toStrictEqual([
      { name: 'mission-shape-requirements' },
    ]);
  });

  it('does not launch or rewrite simulated debug runs during recovery', async () => {
    const h = setup(); await h.configure();
    await h.command({ action: 'run' }); await h.service.waitForLaunches();
    await h.store.change(h.current().id, mission => {
      mission.execution!.debugFixture = true;
      mission.execution!.runs[0]!.status = 'preparing';
      mission.execution!.runs[0]!.skills = [];
      mission.artifacts.review.findings = [{
        id: 'debug-finding', priority: 'p1', title: 'Keep fixture state', body: 'Fixture state is intentional.', repositoryPath: '/repo',
        selected: true, remediation: { state: 'fixing', startedAt: 'now' }, createdAt: 'now', updatedAt: 'now',
      }];
    });
    h.ports.ensureStageSkills.mockClear();

    await h.service.refreshOwnedSkills();
    await h.service.recoverInterruptedRuns();

    expect(h.ports.ensureStageSkills).not.toHaveBeenCalled();
    expect(h.current().execution!.runs[0]).toMatchObject({ status: 'preparing', skills: [] });
    expect(h.current().artifacts.review.findings?.[0]?.remediation.state).toBe('fixing');
  });

  it('accepts legacy ticket results during recovery but waits for user confirmation before Review', async () => {
    const h = setup();
    await h.store.change(h.current().id, mission => {
      mission.stage = 'implementation';
      mission.artifacts.requirements = { problem: 'Billing', acceptance: 'Owner pays' };
      mission.artifacts.tickets = [{ title: 'Checkout', repositoryPath: h.originalAgents[0]!.folder!, done: false }];
      const proposal = structuredClone(mission.artifacts);
      proposal.tickets[0]!.done = true;
      proposal.implementation = { changes: 'Checkout implemented.', tests: 'Checkout tests pass.' };
      mission.execution!.runs = [{
        id: 'legacy-ticket-review', stage: 'implementation', memberId: h.originalAgents[0]!.id,
        workerId: h.originalAgents[0]!.id, ticketIndex: 0, repositoryPath: h.originalAgents[0]!.folder!,
        status: 'awaitingReview', skills: [], feedback: '', startedAt: '2026-09-19T00:00:00.000Z',
        proposal, implementationResult: structuredClone(proposal.implementation),
      }];
    });

    await h.service.recoverInterruptedRuns();
    await h.service.waitForLaunches();

    expect(h.current().artifacts.tickets[0]!.done).toBe(true);
    expect(h.current().execution!.runs[0]!.status).toBe('accepted');
    expect(h.current().stage).toBe('implementation');
    expect(h.current().execution!.runs).toHaveLength(1);
    await h.command({ action: 'continueToReview' });
    await h.service.waitForLaunches();
    expect(h.current().stage).toBe('review');
    expect(h.current().execution!.runs.at(-1)).toMatchObject({ stage: 'review', status: 'running' });
  });

  it('prepares an isolated mission worker without starting its provider conversation', async () => {
    const h = setup(); await h.configure();
    h.snapshot.general.useInteractivePlans = false;
    await h.command({ action: 'run' }); await h.service.waitForLaunches();
    const mission = h.current(); const run = mission.execution!.runs[0]!;
    expect(run.status).toBe('running');
    expect(h.ports.createWorktree).not.toHaveBeenCalled();
    expect(h.snapshot.agents.slice(0, 2)).toStrictEqual(h.originalAgents);
    const worker = h.snapshot.agents.find(agent => agent.id === run.workerId)!;
    expect(worker).toMatchObject({ folder: '/app/missions/mission', backend: h.originalAgents[0]!.backend, status: { type: 'idle' } });
    expect(worker).not.toHaveProperty('backendSession');
    expect(run.skills).toStrictEqual([{ name: 'mission-shape-requirements' }]);
    const instructions = h.service.developerInstructionsForAgent(run.workerId!);
    expect(instructions).toMatch(/^<context>\n/);
    expect(instructions).toContain(h.originalAgents[0]!.folder);
    expect(instructions).toContain("Treat the user's first message as the beginning of requirements shaping");
    expect(instructions).toContain('- [ ] / - [x]');
    expect(instructions).toContain('```mermaid');
    expect(instructions).not.toContain('Run ID:');
    expect(h.service.contextForAgent(run.workerId!)).toEqual({ missionId: mission.id, runId: run.id, stage: 'requirements' });
    await expect(h.service.setTitle(h.originalAgents[0]!.id, 'Add team billing')).rejects.toThrow('not working');
    await expect(h.service.setTitle(run.workerId!, '   ')).rejects.toThrow('between 1 and 200');
    await expect(h.service.setTitle(run.workerId!, 'x'.repeat(201))).rejects.toThrow('between 1 and 200');
    await expect(h.service.setTitle(run.workerId!, '  Add team billing  ')).resolves.toEqual({ success: true, title: 'Add team billing' });
    expect(h.current().outcome).toBe('Add team billing');
    expect(h.persisted).toHaveBeenCalled();
    expect(h.ports.publish).toHaveBeenCalled();
    const artifacts = structuredClone(mission.artifacts); artifacts.requirements = { problem: 'Teams pay together', acceptance: 'Owner can check out' };
    await expect(h.service.submit(h.originalAgents[0]!.id, { artifacts, summary: 'Requirements ready' })).rejects.toThrow('does not own');
    await h.service.writeArtifact(run.workerId!, { stage: 'requirements', content: '# Requirements\nTeams pay together.' });
    expect(h.service.listArtifacts(run.workerId!)).toEqual([expect.objectContaining({ stage: 'requirements', revision: 1 })]);
    await expect(h.service.readArtifact(run.workerId!, 'requirements')).resolves.toMatchObject({ content: expect.stringContaining('Teams pay together'), revision: 1 });
    await expect(h.service.writeArtifact(run.workerId!, { stage: 'tickets', content: '# Tickets' })).rejects.toThrow('assigned stage');
    await expect(h.service.writeArtifact(run.workerId!, { stage: 'requirements', content: '# Stale', expectedRevision: 0 })).rejects.toThrow('changed');
    await h.service.submit(run.workerId!, { artifacts, summary: 'Requirements ready' });
    expect(h.current().artifacts.requirements.problem).toBe('');
    expect(h.current().execution!.runs[0]!.status).toBe('awaitingReview');
    expect(h.service.contextForAgent(run.workerId!)).toEqual({ missionId: mission.id, runId: run.id, stage: 'requirements' });
    await expect(h.service.setTitle(run.workerId!, 'Refined team billing')).resolves.toEqual({ success: true, title: 'Refined team billing' });
    const revisedArtifacts = structuredClone(artifacts);
    revisedArtifacts.requirements.problem = 'Teams need one shared invoice';
    await h.service.writeArtifact(run.workerId!, { stage: 'requirements', content: '# Requirements\nShared invoice.', expectedRevision: 1 });
    await h.service.submit(run.workerId!, { artifacts: revisedArtifacts, summary: 'Requirements revised after review' });
    expect(h.current().execution!.runs[0]).toMatchObject({ status: 'awaitingReview', summary: 'Requirements revised after review' });
    expect(() => updateMission(h.snapshot, { id: mission.id, revision: h.current().revision, artifacts, stageAgentIds: {}, action: 'advance' })).toThrow('current mission run');
    const approvalRevision = h.current().revision;
    worker.backendSession = { kind: 'codex', threadId: 'thread-mission' };
    await h.command({ action: 'accept', runId: run.id });
    expect(h.current().revision).toBe(approvalRevision + 1);
    expect(h.current().artifacts.requirements).toStrictEqual(revisedArtifacts.requirements);
    expect(h.current().stage).toBe('tickets');
    expect(h.current().execution!.runs[0]!.status).toBe('accepted');
    expect(h.current().execution!.runs[1]).toMatchObject({ stage: 'tickets', status: 'preparing', workerId: run.workerId });
    await h.service.waitForLaunches();
    expect(h.current().execution!.runs[1]).toMatchObject({ stage: 'tickets', status: 'running', workerId: run.workerId, skills: [{ name: 'mission-to-tickets' }] });
    expect(h.service.contextForAgent(run.workerId!)).toEqual({ missionId: mission.id, runId: h.current().execution!.runs[1]!.id, stage: 'tickets' });
    expect(h.service.developerInstructionsForAgent(run.workerId!)).toContain('Continue as the same Mission orchestrator');
    expect(h.ports.refreshConversationContext).toHaveBeenCalledWith(worker);
    expect(h.ports.continueStage).toHaveBeenCalledWith(run.workerId, expect.stringContaining(`assigned ${product.name} Mission skill`));
  });

  it('persists live ticket drafts in the Mission artifact and submits those exact drafts for review', async () => {
    const h = setup();
    await h.store.change(h.current().id, mission => {
      mission.stage = 'tickets';
      mission.artifacts.requirements = { problem: 'Billing', acceptance: 'Owner pays' };
    });
    await h.command({ action: 'run' }); await h.service.waitForLaunches();
    const run = h.current().execution!.runs[0]!;
    await expect(h.service.upsertTicket(h.originalAgents[0]!.id, { title: 'Wrong owner', body: 'Nope', repositoryPath: h.originalAgents[0]!.folder! })).rejects.toThrow('not working');
    const foundation = await h.service.upsertTicket(run.workerId!, {
      title: 'Create the billing account',
      body: 'Deliver an owner-visible billing account with integration coverage.',
      repositoryPath: h.originalAgents[0]!.folder!,
    });
    const checkout = await h.service.upsertTicket(run.workerId!, {
      title: 'Add owner checkout',
      body: 'Let an owner buy seats and verify the completed payment.',
      repositoryPath: h.originalAgents[0]!.folder!,
      blockedByTicketIds: [foundation.ticketId],
      reference: 'https://example.com/issues/42',
    });
    expect(h.current().execution!.runs[0]!.draftTickets).toStrictEqual([
      expect.objectContaining({ id: foundation.ticketId, title: 'Create the billing account', done: false }),
      expect.objectContaining({ id: checkout.ticketId, title: 'Add owner checkout', dependsOn: [0], reference: 'https://example.com/issues/42' }),
    ]);
    expect(h.current().artifactFiles?.tickets).toMatchObject({ revision: 2 });
    await expect(h.service.readArtifact(run.workerId!, 'tickets')).resolves.toMatchObject({
      content: expect.stringContaining('# 02: Add owner checkout'), revision: 2,
    });
    await expect(h.service.upsertTicket(run.workerId!, {
      ticketId: foundation.ticketId,
      title: 'Create the billing account',
      body: 'Deliver the account, permissions, and integration coverage.',
      repositoryPath: h.originalAgents[0]!.folder!,
    })).resolves.toMatchObject({ ticketId: foundation.ticketId, index: 0, artifactRevision: 3 });
    expect(h.current().execution!.runs[0]!.draftTickets?.[0]?.body).toContain('permissions');
    await expect(h.service.upsertTicket(run.workerId!, {
      title: 'Broken dependency', body: 'Cannot be saved.', repositoryPath: h.originalAgents[0]!.folder!, blockedByTicketIds: ['mission-ticket-missing'],
    })).rejects.toThrow('was not found');
    const submitted = structuredClone(h.current().artifacts);
    await h.service.submit(run.workerId!, { artifacts: submitted, summary: 'Backlog ready' });
    expect(h.current().execution!.runs[0]!.proposal?.tickets).toStrictEqual(h.current().execution!.runs[0]!.draftTickets);
    expect(h.current().artifacts.tickets).toStrictEqual([]);
  });

  it('provisions one shared Mission branch and informs the lead when all repositories finish, before user-approved Review', async () => {
    const h = setup();
    const repositoryPaths = ['/repo/billing-service', '/repo/invoice-service'];
    for (const [index, repositoryPath] of repositoryPaths.entries()) {
      const agent = h.snapshot.agents.find(candidate => candidate.id === h.originalAgents[index]!.id)!;
      agent.folder = repositoryPath;
      if (agent.workspace?.kind === 'git') {
        agent.workspace.folder = repositoryPath;
        agent.workspace.repositoryRoot = repositoryPath;
        agent.workspace.primaryWorktreeRoot = repositoryPath;
      }
    }
    await h.store.change(h.current().id, mission => {
      mission.stage = 'tickets';
      mission.artifacts.requirements = { problem: 'Billing', acceptance: 'Pay' };
      mission.execution!.runs = [];
    });
    await h.command({ action: 'run' }); await h.service.waitForLaunches();
    const ticketsRun = h.current().execution!.runs[0]!;
    const missionLead = h.snapshot.agents.find(agent => agent.id === ticketsRun.workerId)!;
    missionLead.backendSession = { kind: 'codex', threadId: 'thread-mission-lead' };
    // The live Mission choice can differ from both the original lead and assigned members.
    missionLead.backendDefaults = { kind: 'codex', model: 'mission-model', reasoningEffort: 'high', serviceTier: 'fast' };
    const otherMember = h.snapshot.agents.find(agent => agent.id === h.originalAgents[1]!.id)!;
    otherMember.backend = 'claude';
    otherMember.backendDefaults = { kind: 'claude', model: 'member-model', reasoningEffort: 'low' };
    await h.service.upsertTicket(ticketsRun.workerId!, {
      title: 'Checkout', body: 'Implement checkout.', repositoryPath: repositoryPaths[0]!,
    });
    await h.service.upsertTicket(ticketsRun.workerId!, {
      title: 'Invoice', body: 'Implement invoices.', repositoryPath: repositoryPaths[1]!,
    });
    await h.service.submit(ticketsRun.workerId!, {
      artifacts: structuredClone(h.current().artifacts), summary: 'Backlog ready',
    });
    await h.command({ action: 'accept', runId: ticketsRun.id });

    const workspaces = h.current().execution!.workspaces!;
    expect(workspaces).toHaveLength(2);
    expect(workspaces[0]!.branch).toMatch(/^mission\/team-billing-/);
    expect(new Set(workspaces.map(workspace => workspace.branch)).size).toBe(1);
    expect(h.ports.createWorktree).toHaveBeenCalledTimes(2);
    expect(h.ports.createWorktree.mock.calls.map(([input]) => input.repoPath)).toStrictEqual(repositoryPaths);
    expect(h.ports.createWorktree.mock.calls[0]![0].branchName).toBe(h.ports.createWorktree.mock.calls[1]![0].branchName);
    expect(h.ports.reportImplementationStartProgress.mock.calls.map(([progress]) => progress.phase)).toStrictEqual([
      'creatingWorktrees',
      'initializingWorkspaces',
      'startingAgents',
    ]);
    expect(h.ports.reportImplementationStartProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      repositoryCount: 2,
      ticketCount: 2,
    }));

    await h.service.waitForLaunches();
    const implementationRuns = h.current().execution!.runs.filter(run => run.stage === 'implementation');
    expect(implementationRuns).toHaveLength(2);
    expect(implementationRuns.map(run => run.status)).toStrictEqual(['running', 'running']);
    expect(implementationRuns.map(run => run.repositoryPath)).toStrictEqual(repositoryPaths);
    expect(new Set(implementationRuns.map(run => run.workerId)).size).toBe(2);
    expect(implementationRuns.every(run => run.workerId !== ticketsRun.workerId)).toBe(true);
    for (const run of implementationRuns) {
      const worker = h.snapshot.agents.find(agent => agent.id === run.workerId)!;
      expect({ backend: worker.backend, defaults: worker.backendDefaults }).toStrictEqual({
        backend: 'codex', defaults: { kind: 'codex', model: 'mission-model', reasoningEffort: 'high', serviceTier: 'fast' },
      });
      expect(worker.backendDefaults).not.toBe(missionLead.backendDefaults);
    }

    const leadPromptCount = h.ports.continueStage.mock.calls.filter(([id]) => id === missionLead.id).length;
    for (const [index, run] of implementationRuns.entries()) {
      const artifacts: MissionArtifacts = structuredClone(h.current().artifacts);
      artifacts.requirements.problem = 'Unapproved upstream edit';
      artifacts.tickets[index]!.done = true;
      artifacts.implementation = { changes: `Changed ticket ${index}`, tests: `Tests for ${index} passed` };
      if (index === implementationRuns.length - 1) h.persisted.mockImplementationOnce(async snapshot => {
        expect(snapshot.missions[0].artifacts.tickets.every((ticket: { done: boolean }) => ticket.done)).toBe(true);
        expect(h.ports.continueStage.mock.calls.filter(([id]) => id === missionLead.id)).toHaveLength(leadPromptCount);
      });
      await expect(h.service.submit(run.workerId!, {
        ...(index === 0 ? { artifacts } : { ticketId: run.ticketId, implementation: artifacts.implementation }), summary: 'Implemented',
      })).resolves.toEqual({ success: true, status: 'accepted' });
      await h.service.agentFinished(run.workerId!);
      expect(h.ports.continueStage.mock.calls.filter(([id]) => id === missionLead.id)).toHaveLength(leadPromptCount + (index === implementationRuns.length - 1 ? 1 : 0));
    }

    await h.service.waitForLaunches();
    const completion = h.ports.continueStage.mock.calls.filter(([id]) => id === missionLead.id).at(-1)![1];
    expect(completion).toContain(h.current().outcome);
    expect(completion).toContain('read-mission-artifact');
    await h.service.agentFinished(implementationRuns.at(-1)!.workerId!);
    expect(h.ports.continueStage.mock.calls.filter(([id]) => id === missionLead.id)).toHaveLength(leadPromptCount + 1);
    expect(h.current().artifacts.tickets.every(ticket => ticket.done)).toBe(true);
    expect(h.current().artifacts.requirements.problem).toBe('Billing');
    expect(h.current().artifacts.implementation.tests).toContain('Tests for 0 passed');
    expect(h.current().artifacts.implementation.tests).toContain('Tests for 1 passed');
    expect(h.current().stage).toBe('implementation');
    expect(h.current().execution!.runs.filter(run => run.stage === 'review')).toHaveLength(0);
    await h.command({ action: 'continueToReview' });
    await h.service.waitForLaunches();
    expect(h.current().stage).toBe('review');
    expect(h.current().execution!.runs.at(-1)).toMatchObject({
      stage: 'review', status: 'running', workerId: ticketsRun.workerId,
    });
    expect(h.current().stageAgentIds.review).toBe(ticketsRun.workerId);
    expect(missionLead.backendSession).toStrictEqual({ kind: 'codex', threadId: 'thread-mission-lead' });
    expect(h.ports.refreshConversationContext).toHaveBeenCalledWith(missionLead);
    expect(h.ports.continueStage).toHaveBeenCalledWith(ticketsRun.workerId, expect.stringContaining('Begin the Mission review'));
  });

  it('keeps a repository queue moving automatically while preserving the final Mission review', async () => {
    const h = setup();
    await h.store.change(h.current().id, mission => {
      mission.stage = 'tickets';
      mission.artifacts.requirements = { problem: 'Billing', acceptance: 'Owner pays' };
    });
    await h.command({ action: 'run' }); await h.service.waitForLaunches();
    const ticketsRun = h.current().execution!.runs[0]!;
    const foundation = await h.service.upsertTicket(ticketsRun.workerId!, {
      title: 'Billing foundation', body: 'Build the billing foundation.', repositoryPath: h.originalAgents[0]!.folder!,
    });
    await h.service.upsertTicket(ticketsRun.workerId!, {
      title: 'Owner checkout', body: 'Build owner checkout.', repositoryPath: h.originalAgents[0]!.folder!, blockedByTicketIds: [foundation.ticketId],
    });
    await h.service.submit(ticketsRun.workerId!, {
      artifacts: structuredClone(h.current().artifacts), summary: 'Backlog ready',
    });
    await h.command({ action: 'accept', runId: ticketsRun.id });
    await h.service.waitForLaunches();

    const firstRun = h.current().execution!.runs.find(run => run.stage === 'implementation')!;
    const implementationWorkerId = firstRun.workerId;
    expect(implementationWorkerId).not.toBe(ticketsRun.workerId);
    h.snapshot.agents.find(agent => agent.id === implementationWorkerId)!.backendSession = {
      kind: 'codex',
      threadId: 'thread-implementation',
    };
    const firstResult = structuredClone(h.current().artifacts);
    firstResult.tickets[0]!.done = true;
    firstResult.implementation = { changes: 'Built the foundation.', tests: 'Foundation tests passed.' };
    await expect(h.service.submit(firstRun.workerId!, {
      artifacts: firstResult, summary: 'Foundation complete',
    })).resolves.toEqual({ success: true, status: 'accepted' });
    await h.service.waitForLaunches();
    await h.service.agentFinished(implementationWorkerId!, 'foundation-turn');
    await h.service.waitForLaunches();
    // A repeated completion must not consume the compaction guard for the next ticket.
    await h.service.agentFinished(implementationWorkerId!, 'foundation-turn');
    await h.service.agentFinished(implementationWorkerId!, 'compaction-turn');
    await h.service.agentFinished(implementationWorkerId!, 'compaction-turn');

    const implementationRuns = h.current().execution!.runs.filter(run => run.stage === 'implementation');
    expect(implementationRuns).toHaveLength(2);
    expect(implementationRuns[0]).toMatchObject({ status: 'accepted', ticketIndex: 0 });
    expect(implementationRuns[1]).toMatchObject({ status: 'running', ticketIndex: 1 });
    expect(implementationRuns[1]!.workerId).toBe(implementationWorkerId);
    await expect(h.command({ action: 'continueToReview' })).rejects.toThrow('Complete every implementation ticket');
    expect(h.current().stage).toBe('implementation');
    expect(h.ports.continueStage.mock.calls.slice(-2)).toStrictEqual([
      [implementationWorkerId, '/compact'],
      [implementationWorkerId, expect.stringContaining('ticket 2')],
    ]);

    const secondResult = structuredClone(h.current().artifacts);
    secondResult.tickets[1]!.done = true;
    secondResult.implementation = { changes: 'Built checkout.', tests: 'Checkout tests passed.' };
    await expect(h.service.submit(implementationRuns[1]!.workerId!, {
      artifacts: secondResult, summary: 'Checkout complete',
    })).resolves.toEqual({ success: true, status: 'accepted' });
    await h.service.waitForLaunches();
    await h.service.agentFinished(implementationWorkerId!);
    await h.service.waitForLaunches();

    expect(h.current().stage).toBe('implementation');
    expect(h.current().execution!.runs.filter(run => run.stage === 'review')).toHaveLength(0);
    await h.command({ action: 'continueToReview' });
    await h.service.waitForLaunches();
    expect(h.current().stage).toBe('review');
    expect(h.current().execution!.runs.at(-1)).toMatchObject({ stage: 'review', status: 'running' });
    await expect(h.command({ action: 'continueToReview' })).rejects.toThrow('Only Implementation');
    expect(h.current().artifactFiles?.implementation?.revision).toBe(2);
  });

  it('advances an approved review into Ship and completes only after every repository is delivered', async () => {
    const h = setup();
    const repositories = ['/repo/billing-api', '/repo/billing-web'];
    await h.store.change(h.current().id, mission => {
      mission.stage = 'review';
      mission.artifacts.requirements = { problem: 'Billing', acceptance: 'Owner pays' };
      mission.artifacts.tickets = repositories.map((repositoryPath, index) => ({ title: `Slice ${index + 1}`, repositoryPath, done: true }));
      mission.artifacts.implementation = { changes: 'Implemented both slices', tests: 'All checks pass' };
      const proposal = structuredClone(mission.artifacts);
      proposal.review = { summary: 'Reviewed and ready to ship', pullRequestUrl: '' };
      mission.execution!.workspaces = repositories.map((repositoryPath, index) => ({ repositoryPath, path: `${repositoryPath}-mission`, branch: 'mission/team-billing', baseSha: String(index + 1).repeat(40) }));
      mission.execution!.runs = [
        ...repositories.map((repositoryPath, index) => ({
          id: `implementation-${index}`, stage: 'implementation' as const, memberId: h.originalAgents[index]!.id,
          workerId: h.originalAgents[index]!.id, ticketIndex: index, repositoryPath, status: 'accepted' as const,
          skills: [], feedback: '', startedAt: '2026-09-19T00:00:00.000Z',
        })),
        { id: 'review-run', stage: 'review', memberId: h.originalAgents[0]!.id, workerId: h.originalAgents[0]!.id, status: 'awaitingReview', skills: [], feedback: '', startedAt: '2026-09-19T00:01:00.000Z', proposal },
      ];
    });

    await h.command({ action: 'accept', runId: 'review-run' });
    expect(h.current()).toMatchObject({
      stage: 'ship',
      status: 'active',
      execution: { deliveries: [
        { repositoryPath: repositories[0], agentId: h.originalAgents[0]!.id, status: 'pending' },
        { repositoryPath: repositories[1], agentId: h.originalAgents[1]!.id, status: 'pending' },
      ] },
    });
    expect(h.current().execution!.runs).toHaveLength(3);

    await expect(h.command({ action: 'recordDelivery', repositoryPath: '/not-affected', result: { kind: 'merge' } })).rejects.toThrow('not part');
    await h.command({ action: 'recordDelivery', repositoryPath: repositories[0], result: { kind: 'pullRequest', number: 42, url: 'https://github.com/acme/billing/pull/42' } });
    expect(h.current().status).toBe('active');
    expect(h.current().execution!.deliveries![0]).toMatchObject({ status: 'pullRequestCreated', pullRequest: { number: 42 } });
    await h.command({ action: 'recordDelivery', repositoryPath: repositories[1], result: { kind: 'merge' } });
    expect(h.current().status).toBe('completed');
    expect(h.current().execution!.deliveries![1]).toMatchObject({ status: 'merged' });
  });

  it('lets the active orchestrator attach a repository represented in its team', async () => {
    const h = setup();
    await h.command({ action: 'run' }); await h.service.waitForLaunches();
    const workerId = h.current().execution!.runs[0]!.workerId!;

    await expect(h.service.attachRepository(workerId, '/outside-team')).rejects.toThrow('represented');
    await expect(h.service.attachRepository(workerId, `  ${h.originalAgents[0]!.folder}  `)).resolves.toEqual({
      success: true, repoPath: h.originalAgents[0]!.folder,
    });
    expect(h.current().execution!.repoPath).toBe(h.originalAgents[0]!.folder);
    expect(h.ports.validateRepository).toHaveBeenCalledWith(h.originalAgents[0]!.folder);
  });

  it('does not treat a Mission worker home as a represented team repository', async () => {
    const h = setup();
    await h.command({ action: 'run' }); await h.service.waitForLaunches();
    const workerId = h.current().execution!.runs[0]!.workerId!;

    await expect(h.service.attachRepository(workerId, '/app/missions/mission')).rejects.toThrow('represented');
    expect(h.ports.validateRepository).not.toHaveBeenCalledWith('/app/missions/mission');
    await expect(h.service.attachRepository(workerId, h.originalAgents[0]!.folder!)).resolves.toMatchObject({
      success: true, repoPath: h.originalAgents[0]!.folder,
    });
  });

  it('allows repositories from any team member even when that member is not selected for the mission', async () => {
    const h = setup();
    const teamId = h.current().teamId;
    const otherRepository = '/team/other-repository';
    h.snapshot.agents[1]!.folder = otherRepository;
    await h.command({ action: 'configure', teamId, memberIds: [h.originalAgents[0]!.id] });
    await h.command({ action: 'attachRepository', repoPath: otherRepository });

    expect(h.current().execution!.repoPath).toBe(otherRepository);
    expect(h.ports.validateRepository).toHaveBeenCalledWith(otherRepository);
  });

  it('does not reassign an existing mission to another team', async () => {
    const h = setup();
    h.snapshot.teams.push({ id: 'team-other', name: 'Other', color: '#7158D4', agentIds: [] });
    const moved = structuredClone(h.snapshot.agents[1]!);
    moved.id = 'agent-other';
    moved.teamId = 'team-other';
    h.snapshot.agents.push(moved);
    h.snapshot.teams[1]!.agentIds.push(moved.id);

    await expect(h.command({ action: 'configure', teamId: 'team-other', memberIds: [moved.id] })).rejects.toThrow('local team');
    expect(h.current().teamId).toBe('team-app');
  });

  it('keeps the backlog reviewable when an affected repository worktree cannot be created', async () => {
    const h = setup();
    await h.store.change(h.current().id, mission => {
      mission.stage = 'tickets';
      mission.artifacts.requirements = { problem: 'Billing', acceptance: 'Owner pays' };
    });
    await h.command({ action: 'run' });
    await h.service.waitForLaunches();
    const run = h.current().execution!.runs[0]!;
    await h.service.upsertTicket(run.workerId!, { title: 'Implement billing', body: 'Deliver billing end to end.', repositoryPath: h.originalAgents[0]!.folder! });
    await h.service.submit(run.workerId!, { artifacts: structuredClone(h.current().artifacts), summary: 'Tickets ready' });
    const revision = h.current().revision;
    h.ports.createWorktree.mockRejectedValueOnce(new Error('Worktree path is unavailable'));

    await expect(h.command({ action: 'accept', runId: run.id })).rejects.toThrow('Worktree path is unavailable');

    expect(h.current()).toMatchObject({ revision, stage: 'tickets', artifacts: { tickets: [] } });
    expect(h.current().execution!.runs[0]).toMatchObject({ status: 'awaitingReview' });
  });

  it('serializes competing artifact revisions before writing the canonical file', async () => {
    const h = setup();
    await h.command({ action: 'run' }); await h.service.waitForLaunches();
    const run = h.current().execution!.runs[0]!;
    let finishWrite!: () => void;
    h.ports.writeArtifact.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { finishWrite = resolve; });
      return { size: 14 };
    });

    const first = h.service.writeArtifact(run.workerId!, {
      stage: 'requirements', content: '# First draft', expectedRevision: 0,
    });
    await vi.waitFor(() => expect(h.ports.writeArtifact).toHaveBeenCalledOnce());
    const stale = h.service.writeArtifact(run.workerId!, {
      stage: 'requirements', content: '# Stale draft', expectedRevision: 0,
    });
    finishWrite();

    await expect(first).resolves.toMatchObject({ revision: 1, content: '# First draft' });
    await expect(stale).rejects.toThrow('changed');
    expect(h.ports.writeArtifact).toHaveBeenCalledOnce();
    expect(h.current().artifactFiles?.requirements?.revision).toBe(1);
  });

  it('retains failures, rejects overlapping work, and never starts a cancelled preparation', async () => {
    const h = setup(); await h.configure();
    let release!: (path: string) => void;
    h.ports.ensureMissionHome.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    await h.command({ action: 'run' });
    await expect(h.command({ action: 'run' })).rejects.toThrow('existing run');
    const id = h.current().execution!.runs[0]!.id;
    await h.command({ action: 'cancel', runId: id });
    release('/app/missions/mission'); await h.service.waitForLaunches();
    expect(h.current().execution!.workspace).toBeUndefined();
    h.ports.ensureMissionHome.mockRejectedValueOnce(new Error('Mission home unavailable'));
    await h.command({ action: 'run' }); await h.service.waitForLaunches();
    expect(h.current().execution!.runs[1]).toMatchObject({ status: 'failed', error: 'Mission home unavailable' });
    await h.command({ action: 'run' }); await h.service.waitForLaunches();
    const run = h.current().execution!.runs[2]!;
    await h.service.agentFinished(run.workerId!);
    expect(h.current().execution!.runs[2]!.status).toBe('running'); // Shaping questions can span multiple turns.
    const artifacts = structuredClone(h.current().artifacts);
    artifacts.requirements = { problem: 'Clarified after a question', acceptance: 'User answered' };
    await h.service.writeArtifact(run.workerId!, { stage: 'requirements', content: '# Requirements\nClarified.' });
    await h.service.submit(run.workerId!, { artifacts, summary: 'Ready after discussion' });
    expect(h.current().execution!.runs[2]!.status).toBe('awaitingReview');
  });
});

it('rejects invalid configuration, stale commands and inactive worker results without accepting artifacts', async () => {
  const h = setup();
  await expect(h.command({ action: 'configure', teamId: 'missing', memberIds: [] })).rejects.toThrow('local team');
  await expect(h.command({ action: 'attachRepository', repoPath: '' })).rejects.toThrow('repository');
  await expect(h.command({ action: 'attachRepository', repoPath: '/outside-team' })).rejects.toThrow('represented');
  await h.configure();
  await expect(h.command({ action: 'run', memberId: 'missing' })).rejects.toThrow('unavailable');
  await expect(h.command({ action: 'run', feedback: 99 })).rejects.toThrow('feedback');
  await expect(h.command({ action: 'accept', runId: 'missing' })).rejects.toThrow('proposal');
  await expect(h.command({ action: 'cancel', runId: 'missing' })).rejects.toThrow('cancellable');
  await expect(h.command({ action: 'unknown' })).rejects.toThrow('Unknown');
  await expect(h.service.execute({ id: h.current().id, revision: -1, action: 'run' })).rejects.toThrow('changed');
  await expect(h.service.execute({ id: 'missing', revision: 0, action: 'run' })).rejects.toThrow('not found');
  await h.command({ action: 'run' }); await h.service.waitForLaunches();
  const run = h.current().execution!.runs[0]!;
  await h.service.writeArtifact(run.workerId!, { stage: 'requirements', content: '# Requirements' });
  await expect(h.service.submit(run.workerId!, { summary: 'Empty', artifacts: h.current().artifacts })).rejects.toThrow('incomplete');
  const worker = h.snapshot.agents.find(agent => agent.id === run.workerId)!;
  worker.status = { type: 'working' };
  await h.command({ action: 'cancel', runId: run.id });
  expect(h.ports.interrupt).toHaveBeenCalledWith(worker);
  await expect(h.command({ action: 'run' })).rejects.toThrow('still active');
  worker.status = { type: 'idle' };
  await h.command({ action: 'run' }); await h.service.waitForLaunches();
  expect(h.current().execution!.runs.at(-1)!.status).toBe('running');
});

it('reopens reached stages while invalidating dependent acceptance and retains incomplete implementation failures', async () => {
  const h = setup(); await h.configure();
  await h.store.change(h.current().id, mission => {
    mission.stage = 'review'; mission.status = 'completed';
    mission.artifacts = { requirements: { problem: 'Billing', acceptance: 'Pay' }, tickets: [{ title: 'Pay', repositoryPath: h.originalAgents[0]!.folder!, done: true }], implementation: { changes: 'Payment', tests: 'Pass' }, review: { summary: 'Approved', pullRequestUrl: '' } };
  });
  await expect(h.command({ action: 'run' })).rejects.toThrow('Reopen');
  await h.command({ action: 'reopen', stage: 'requirements' });
  expect(h.current()).toMatchObject({ stage: 'requirements', status: 'active', artifacts: { tickets: [{ title: 'Pay', done: false }], implementation: { changes: '', tests: '' }, review: { summary: '', pullRequestUrl: '' } } });
  await expect(h.command({ action: 'reopen', stage: 'review' })).rejects.toThrow('reached');
  await h.store.change(h.current().id, mission => { mission.stage = 'implementation'; });
  await h.command({ action: 'run' }); await h.service.waitForLaunches();
  const run = h.current().execution!.runs.at(-1)!;
  const artifacts = structuredClone(h.current().artifacts);
  await expect(h.service.submit(run.workerId!, { summary: 'Not done', artifacts })).rejects.toThrow('assigned ticket');
  artifacts.tickets[0]!.done = true;
  await expect(h.service.submit(run.workerId!, { summary: 'No evidence', artifacts })).rejects.toThrow('test evidence');
  await h.service.agentFinished(run.workerId!);
  expect(h.current().execution!.runs.at(-1)).toMatchObject({ status: 'failed', error: expect.stringContaining('without submitting') });
  await h.service.agentFinished('unrelated-agent');
  expect(h.current().execution!.runs).toHaveLength(1);
});
