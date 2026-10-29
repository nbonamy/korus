import { describe, expect, it } from 'vitest';
import { createInitialSnapshot } from '../snapshot-construction';
import { createMission, deleteMission, updateMission, isMission, type UpdateMissionInput } from '../missions';
import { decodeAppSnapshot } from '../snapshot-guards';
import { findMissionWorkflow } from '../mission-workflows';

describe('missions', () => {
  const createInput = (snapshot: ReturnType<typeof createInitialSnapshot>, outcome: string) => ({
    outcome, workflowType: 'shapeAndShipFeature' as const,
    teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id,
  });

  it('persists a team-scoped outcome through five explicit workflow stages without creating another agent', () => {
    const snapshot = createInitialSnapshot();
    const originalAgentIds = snapshot.agents.map(agent => agent.id);
    const mission = createMission(snapshot, createInput(snapshot, ' Add team billing '));
    expect(mission.outcome).toBe('Add team billing');
    expect(mission.teamId).toBe(snapshot.teams[0]!.id);
    expect(snapshot.agents.map(agent => agent.id)).toStrictEqual(originalAgentIds);
    const update = (action: UpdateMissionInput['action']) => updateMission(snapshot, { id: mission.id, revision: mission.revision, artifacts, stageAgentIds: {}, action });
    const artifacts = structuredClone(mission.artifacts);
    expect(() => update('advance')).toThrow('required stage');
    artifacts.requirements = { problem: 'Teams need billing', acceptance: 'An owner can pay' };
    update('save'); expect(mission.stage).toBe('requirements');
    update('advance'); expect(mission.stage).toBe('tickets');
    expect(() => update('advance')).toThrow('required stage');
    artifacts.tickets = [{ title: 'Add owner checkout', repositoryPath: snapshot.agents[0]!.folder!, done: false }];
    update('advance'); expect(mission.stage).toBe('implementation');
    artifacts.implementation = { changes: 'commit abc', tests: 'Checkout tests pass' };
    expect(() => update('advance')).toThrow('required stage');
    artifacts.tickets[0]!.done = true;
    update('advance'); expect(mission.stage).toBe('review');
    expect(() => update('advance')).toThrow('required stage');
    artifacts.review.summary = 'Reviewed acceptance; ready to deliver';
    update('advance'); expect(mission.stage).toBe('ship');
    expect(mission.status).toBe('active');
    expect(() => update('advance')).toThrow('Complete delivery');
    expect(decodeAppSnapshot(snapshot)?.value.missions).toStrictEqual([mission]);
  });

  it('derives new Mission state and stage order from its workflow definition', () => {
    const snapshot = createInitialSnapshot();
    const workflow = findMissionWorkflow('shapeAndShipFeature')!;
    const mission = createMission(snapshot, createInput(snapshot, 'Billing'));

    expect(mission.workflow).toStrictEqual({ type: workflow.type, version: workflow.version });
    expect(mission.stage).toBe(workflow.stages[0]);
    expect(mission.artifacts).toStrictEqual(workflow.createArtifacts());
    expect(findMissionWorkflow('unknown')).toBeUndefined();
  });
  it('rejects malformed input, stale writers, dangling agents, and invalidated earlier gates without mutation', () => {
    const snapshot = createInitialSnapshot();
    for (const input of [null, { outcome: ' ', workflowType: 'shapeAndShipFeature' }, { outcome: 'x', workflowType: 'unknown' }]) expect(() => createMission(snapshot, input)).toThrow();
    const mission = createMission(snapshot, createInput(snapshot, 'Billing'));
    const input: UpdateMissionInput = { id: mission.id, revision: 0, artifacts: structuredClone(mission.artifacts), stageAgentIds: {}, action: 'save' };
    const before = structuredClone(mission);
    expect(() => updateMission(snapshot, { ...input, revision: 9 })).toThrow('changed');
    expect(() => updateMission(snapshot, { ...input, id: 'missing' })).toThrow('not found');
    expect(() => updateMission(snapshot, { ...input, artifacts: {} })).toThrow('Invalid');
    expect(() => updateMission(snapshot, { ...input, stageAgentIds: { requirements: 'missing' } })).toThrow('agent not found');
    expect(mission).toStrictEqual(before);
    expect(isMission({ ...mission, stage: 'unknown' })).toBe(false);
    expect(decodeAppSnapshot({ ...snapshot, missions: [{}] })).toBeNull();
    input.artifacts.requirements = { problem: 'Billing', acceptance: 'Payment' };
    updateMission(snapshot, { ...input, action: 'advance' });
    input.artifacts.requirements.problem = '';
    expect(() => updateMission(snapshot, { ...input, revision: 1 })).toThrow('required stage');
  });

  it('invalidates only edited completed tickets when saving artifacts and rejects advancing stale completion', () => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, createInput(snapshot, 'Billing'));
    mission.stage = 'implementation';
    mission.artifacts.requirements = { problem: 'Billing', acceptance: 'Owner pays' };
    mission.artifacts.tickets = [
      { id: 'mission-ticket-account', title: 'Account', repositoryPath: '/repo', done: true, dependsOn: [2, 1] },
      { id: 'mission-ticket-checkout', title: 'Checkout', repositoryPath: '/repo', done: true },
      { id: 'mission-ticket-invoice', title: 'Invoice', repositoryPath: '/repo', done: true },
    ];
    mission.artifacts.implementation = { changes: 'Committed implementation', tests: 'Verified' };
    const artifacts = structuredClone(mission.artifacts);
    artifacts.tickets[0]!.dependsOn = [1, 2];
    artifacts.tickets[1]!.body = 'Support refunds.';
    const update = (action: UpdateMissionInput['action']) => updateMission(snapshot, { id: mission.id, revision: mission.revision, artifacts, stageAgentIds: {}, action });
    mission.execution!.runs = [{ id: 'accepted-implementation', stage: 'implementation', memberId: snapshot.agents[0]!.id, workerId: snapshot.agents[0]!.id, ticketId: 'mission-ticket-checkout', status: 'accepted', skills: [], feedback: '', startedAt: 'before' }];
    snapshot.agents[0]!.status = { type: 'working' };
    expect(() => update('save')).toThrow('worker');
    snapshot.agents[0]!.status = { type: 'idle' };
    expect(() => update('advance')).toThrow('required stage');
    update('save');
    expect(mission.artifacts.tickets).toStrictEqual([
      artifacts.tickets[0], { ...artifacts.tickets[1], done: false, revision: 1 }, artifacts.tickets[2],
    ]);
    update('save');
    expect(mission.artifacts.tickets[1]).toMatchObject({ done: false, revision: 1 });
    expect(mission.artifacts.implementation).toStrictEqual({ changes: 'Committed implementation', tests: 'Verified' });
    expect(decodeAppSnapshot(snapshot)?.value.missions).toStrictEqual([mission]);
  });

  it('deletes only the current mission revision', () => {
    const snapshot = createInitialSnapshot();
    const first = createMission(snapshot, createInput(snapshot, 'Billing'));
    const second = createMission(snapshot, createInput(snapshot, 'Invitations'));

    expect(() => deleteMission(snapshot, { id: first.id, revision: 1, deleteWorktrees: false, confirmed: true })).toThrow('changed');
    expect(() => deleteMission(snapshot, { id: 'missing', revision: 0, deleteWorktrees: false, confirmed: true })).toThrow('not found');
    expect(() => deleteMission(snapshot, { id: first.id, revision: 0, deleteWorktrees: false })).toThrow('Invalid');
    expect(deleteMission(snapshot, { id: first.id, revision: 0, deleteWorktrees: false, confirmed: true })).toBe(first);
    expect(snapshot.missions).toStrictEqual([second]);
  });
});
