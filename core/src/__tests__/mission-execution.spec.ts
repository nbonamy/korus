import { product } from '../product';
import { expect, it } from 'vitest';

import { createInitialSnapshot } from '../snapshot-construction';
import { createMission, isMission, isMissionArtifacts, missionTicketReady, updateMission } from '../missions';
import { missionDeveloperInstructions, pendingMissionRun, type MissionRun } from '../mission-execution';
import { missionWorkflow } from '../mission-workflows';

it('carries the assigned stage, accepted artifacts, workspace, skills and revision feedback into the provider handoff', () => {
  const snapshot = createInitialSnapshot();
  const mission = createMission(snapshot, { outcome: 'Billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
  mission.execution = { teamId: 'team', memberIds: ['member'], workspaceName: 'billing-work', workspaces: [{ repositoryPath: '/repo', path: '/isolated', branch: 'mission/billing-work', baseSha: 'a'.repeat(40) }], runs: [] };
  mission.artifacts.requirements = { problem: 'Owners pay', acceptance: 'Only owners' };
  for (const stage of ['requirements', 'tickets', 'implementation', 'review'] as const) {
    const run: MissionRun = { id: 'run', stage, memberId: 'member', ticketIndex: 1, status: 'running', skills: [{ name: `mission-${stage}`, path: `/mission/skills/mission-${stage}/SKILL.md` }], feedback: 'Check permissions', startedAt: 'now' };
    const prompt = missionDeveloperInstructions(mission, run);
    expect(prompt).toMatch(/^<context>\n/);
    expect(prompt).toMatch(/\n<\/context>$/);
    expect(prompt).toContain('Mission: Billing');
    expect(prompt).toContain(`Stage: ${stage}.`);
    expect(prompt).not.toContain('Run ID:');
    expect(prompt).toContain('/isolated');
    expect(prompt).toContain('a'.repeat(40));
    expect(prompt).toContain(`read-skill with name="mission-${stage}"`);
    expect(prompt).not.toContain(`/mission/skills/mission-${stage}/SKILL.md`);
    expect(prompt).toContain('Check permissions');
    expect(prompt).toContain('User-provided context and feedback:');
    expect(prompt).toContain('Only owners');
    expect(prompt).toContain(`${product.mcpServerName}.submit-mission-result`);
    expect(prompt).toContain(`${product.mcpServerName}.read-mission-artifact`);
    if (stage === 'tickets') {
      expect(prompt).toContain('Continue as the same Mission orchestrator');
    }
    if (stage === 'implementation') {
      expect(prompt).toContain('coherent local commits');
    }
    if (stage === 'review') {
      expect(prompt).toContain('may inspect every listed isolated Mission worktree');
      expect(prompt).not.toContain('Do not edit source checkouts or other Mission worktrees');
    }
    expect(prompt).toContain(`${product.name}-owned Mission skill`);
    expect(missionDeveloperInstructions(mission, { ...run, skills: [], ticketIndex: undefined, feedback: '' })).toContain('no agent-run skill');
  }
});

it('preserves accepted criteria and ticket indices when saved artifact metadata is present', () => {
  const snapshot = createInitialSnapshot();
  const mission = createMission(snapshot, { outcome: 'Billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
  mission.artifacts.requirements = { problem: 'Persisted problem', acceptance: 'Persisted acceptance' };
  mission.artifacts.tickets = [
    { id: 'mission-ticket-1', title: 'First ticket', body: 'Unrelated ticket body', done: true },
    { id: 'mission-ticket-2', title: 'Assigned ticket', body: 'Exact acceptance for this worker', repositoryPath: '/repo', done: false },
  ];
  mission.artifactFiles = {
    requirements: { revision: 2, size: 100, updatedAt: 'now' },
    tickets: { revision: 3, size: 200, updatedAt: 'now' },
  };
  const run: MissionRun = { id: 'run', stage: 'implementation', memberId: 'member', repositoryPath: '/repo', ticketIndex: 1, status: 'running', skills: [{ name: 'mission-implement-ticket' }], feedback: '', startedAt: 'now' };
  const prompt = missionDeveloperInstructions(mission, run);
  expect(prompt).toContain('"revision": 2');
  expect(prompt).toContain('"revision": 3');
  expect(prompt).toContain('Exact acceptance for this worker');
  expect(prompt).toContain('mission-ticket-2');
  expect(prompt).toContain('Persisted acceptance');
  expect(prompt).not.toContain('Unrelated ticket body');
  expect(prompt).toContain('get-mission-assignment');
  expect(prompt).toContain('ticketId');
  expect(prompt).toContain('Implement ONLY ticket 2 in /repo');
});

it('allows Review approval independently of optional finding remediation', () => {
  const snapshot = createInitialSnapshot();
  const artifacts = createMission(snapshot, { outcome: 'Billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id }).artifacts;
  artifacts.review = {
    summary: 'Reviewed',
    pullRequestUrl: '',
    findings: [{
      id: 'finding-1', priority: 'p2', title: 'Keep selection durable', body: 'Selection is lost on reload.', repositoryPath: '/repo', selected: true,
      remediation: { state: 'open' }, createdAt: 'now', updatedAt: 'now',
    }],
  };
  expect(missionWorkflow('shapeAndShipFeature').stageReady('review', artifacts)).toBe(true);
  artifacts.review.findings![0]!.selected = false;
  expect(missionWorkflow('shapeAndShipFeature').stageReady('review', artifacts)).toBe(true);
  artifacts.review.findings![0]!.priority = 'p1';
  expect(missionWorkflow('shapeAndShipFeature').stageReady('review', artifacts)).toBe(true);
  artifacts.review.findings![0]!.selected = true;
  expect(missionWorkflow('shapeAndShipFeature').stageReady('review', artifacts)).toBe(true);
  artifacts.review.findings![0]!.remediation = { state: 'fixed', completedAt: 'later', evidence: 'Test passed.' };
  expect(missionWorkflow('shapeAndShipFeature').stageReady('review', artifacts)).toBe(true);
  expect(isMissionArtifacts(artifacts)).toBe(true);
  artifacts.review.findings![0]!.remediation = { state: 'skipped', startedAt: 'later' };
  expect(isMissionArtifacts(artifacts)).toBe(true);
});

it('validates persisted execution records and dependency graphs before admitting them into app state', () => {
  const snapshot = createInitialSnapshot();
  const mission = createMission(snapshot, { outcome: 'Billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
  const run: MissionRun = { id: 'run', stage: 'requirements', memberId: 'member', workerId: 'worker', status: 'running', skills: [{ name: 'grilling', path: '/skill' }], feedback: '', startedAt: 'now', finishedAt: 'later', summary: 'Ready', error: 'old error', proposal: structuredClone(mission.artifacts), ticketIndex: 0 };
  mission.execution = { teamId: 'team', memberIds: ['member'], workspaceName: 'billing-work', workspaces: [{ repositoryPath: '/repo', path: '/isolated', branch: 'mission/billing-work', baseSha: 'a'.repeat(40) }], runs: [run] };
  expect(isMission(mission)).toBe(true);
  expect(isMission({ ...mission, execution: { ...mission.execution, implementationModel: { backend: 'codex', model: 'luna', reasoningEffort: 'low' } } })).toBe(true);
  for (const implementationModel of [{ backend: 'unknown', model: 'luna' }, { backend: 'codex', model: '' }, { backend: 'codex', model: 'luna', reasoningEffort: 1 }]) {
    expect(isMission({ ...mission, execution: { ...mission.execution, implementationModel } })).toBe(false);
  }
  expect(pendingMissionRun(mission)).toBe(run);
  expect(() => updateMission(snapshot, { id: mission.id, revision: 0, artifacts: mission.artifacts, stageAgentIds: {}, action: 'save' })).toThrow('current mission run');
  expect(isMission({ ...mission, execution: { ...mission.execution, runs: [{ ...run, skills: [{ name: 'mission-shape-requirements' }] }] } })).toBe(true);
  for (const change of [{ status: 'unknown' }, { stage: 'unknown' }, { memberId: null }, { workerId: false }, { ticketIndex: -1 }, { ticketId: 42 }, { skills: [{ name: 'x', path: 42 }] }, { feedback: null }, { startedAt: null }, { finishedAt: false }, { summary: false }, { error: false }, { proposal: {} }]) {
    expect(isMission({ ...mission, execution: { ...mission.execution, runs: [{ ...run, ...change }] } })).toBe(false);
  }
  expect(isMission({ ...mission, execution: { ...mission.execution, workspace: { path: '/repo', branch: 'x', baseSha: 'bad' } } })).toBe(false);
  expect(isMission({ ...mission, execution: { ...mission.execution, reviewPolicy: 'reviewEachTicket' } })).toBe(true);
  expect(isMission({ ...mission, execution: { ...mission.execution, workspaces: [{ repositoryPath: '', path: '/repo', branch: 'x' }] } })).toBe(false);
  const delivery = { repositoryPath: '/repo', agentId: 'worker', status: 'pullRequestCreated', pullRequest: { number: 42, url: 'https://github.com/acme/repo/pull/42' } };
  expect(isMission({ ...mission, execution: { ...mission.execution, deliveries: [delivery] } })).toBe(true);
  expect(isMission({ ...mission, execution: { ...mission.execution, deliveries: [{ ...delivery, repositoryPath: '' }] } })).toBe(false);
  expect(isMission({ ...mission, execution: { ...mission.execution, deliveries: [delivery, delivery] } })).toBe(false);
  expect(isMission({ ...mission, execution: { ...mission.execution, deliveries: [{ ...delivery, status: 'pending' }] } })).toBe(false);
  const tickets = [{ title: 'Checkout', done: false, reference: 'https://example.com/1', dependsOn: [1] }, { title: 'Account', done: false }];
  expect(isMissionArtifacts({ ...mission.artifacts, tickets })).toBe(true);
  expect(missionTicketReady(tickets, 0)).toBe(false);
  expect(missionTicketReady(tickets, 1)).toBe(true);
  tickets[1]!.done = true;
  expect(missionTicketReady(tickets, 0)).toBe(true);
  expect(missionTicketReady(tickets, 2)).toBe(false);
  expect(isMissionArtifacts({ ...mission.artifacts, tickets: [{ ...tickets[0], dependsOn: [0] }] })).toBe(false);
  expect(isMissionArtifacts({ ...mission.artifacts, tickets: [{ ...tickets[0], dependsOn: [3] }] })).toBe(false);
  expect(isMissionArtifacts({ ...mission.artifacts, tickets: [{ ...tickets[0], dependsOn: [-1] }] })).toBe(false);
  expect(isMissionArtifacts({ ...mission.artifacts, tickets: [{ ...tickets[0], reference: '' }] })).toBe(false);
  expect(isMissionArtifacts({ ...mission.artifacts, tickets: [{ id: 'mission-ticket-1', title: 'Checkout', body: 'Vertical slice', done: false }] })).toBe(true);
  expect(isMissionArtifacts({ ...mission.artifacts, tickets: [{ id: 'tracker-1', title: 'Checkout', done: false }] })).toBe(false);
  expect(isMission({ ...mission, execution: { ...mission.execution, runs: [{ ...run, draftTickets: [{ id: 'tracker-1', title: 'Checkout', done: false }] }] } })).toBe(false);
});
