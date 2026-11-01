import { describe, expect, it } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot-construction';
import { createMission, featureStages, isMission } from '@workspace/core/missions';
import { applyMissionDebugFixture } from '../mission-debug-fixtures';

describe('Mission debug fixtures', () => {
  it('populates every workflow stage with coherent, reviewable visual state', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.folder = '/repo/api';
    snapshot.agents[1]!.folder = '/repo/web';
    const mission = createMission(snapshot, { outcome: 'Debug mission', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    const missionWorker = { ...structuredClone(snapshot.agents[0]!), id: 'agent-mission-worker', name: 'Mission worker', folder: '/app/missions/debug' };
    snapshot.agents.push(missionWorker);
    mission.execution!.runs.push({
      id: 'run-existing', stage: 'requirements', memberId: snapshot.agents[0]!.id, workerId: missionWorker.id,
      status: 'running', skills: [], feedback: '', startedAt: '2026-09-19T00:00:00.000Z',
    });

    for (const stage of featureStages) {
      applyMissionDebugFixture(snapshot, mission.id, stage, '2026-09-19T12:00:00.000Z');
      expect(mission.stage).toBe(stage);
      expect(mission.status).toBe('active');
      expect(mission.execution?.debugFixture).toBe(true);
      expect(isMission(mission)).toBe(true);

      const currentRun = mission.execution!.runs.at(-1);
      if (stage === 'requirements') {
        expect(currentRun).toMatchObject({ stage, status: 'awaitingReview', proposal: { requirements: { problem: expect.stringContaining('guided path') } } });
        expect(currentRun!.proposal!.requirements.problem).toContain('```mermaid');
        expect(currentRun!.proposal!.requirements.problem).toContain('- [x]');
        expect(currentRun!.proposal!.requirements.problem).toContain('- ( )');
      } else if (stage === 'tickets') {
        expect(currentRun).toMatchObject({ stage, status: 'awaitingReview' });
        expect(currentRun?.proposal?.tickets).toHaveLength(4);
        expect(currentRun?.proposal?.tickets.every(ticket => !ticket.done)).toBe(true);
      } else if (stage === 'implementation') {
        expect(mission.execution!.workspaces).toHaveLength(2);
        expect(mission.execution!.runs.filter(run => run.stage === stage).map(run => run.status)).toStrictEqual(['accepted', 'running', 'failed']);
        expect(mission.execution!.runs.filter(run => run.stage === stage).every(run => run.workerId === missionWorker.id)).toBe(true);
        expect(mission.execution!.runs.filter(run => run.stage === stage).map(run => run.memberId)).toStrictEqual([
          snapshot.agents[0]!.id,
          snapshot.agents[1]!.id,
          snapshot.agents[0]!.id,
        ]);
        expect(mission.artifacts.tickets.map(ticket => ticket.done)).toStrictEqual([true, false, false, false]);
      } else if (stage === 'review') {
        expect(currentRun).toMatchObject({ stage, status: 'awaitingReview', proposal: { review: { summary: expect.stringContaining('approved requirements') } } });
        expect(mission.artifacts.tickets.every(ticket => ticket.done)).toBe(true);
        expect(mission.artifacts.review.findings).toMatchObject([
          { priority: 'p1', repositoryPath: '/repo/api', selected: true, remediation: { state: 'open' } },
          { priority: 'p2', repositoryPath: '/repo/web', selected: false, remediation: { state: 'open' } },
        ]);
        expect(mission.execution!.workspaces?.map(workspace => workspace.repositoryPath)).toStrictEqual(['/repo/api', '/repo/web']);

        applyMissionDebugFixture(snapshot, mission.id, stage, '2026-09-19T12:00:00.000Z', 'remediated');
        expect(mission.artifacts.review.findings).toMatchObject([
          { selected: true, remediation: { state: 'fixed', evidence: 'Focused Mission workflow tests passed.' } },
          { selected: false, remediation: { state: 'skipped' } },
        ]);
      } else {
        expect(currentRun).toMatchObject({ stage: 'review', status: 'accepted' });
        expect(mission.execution!.deliveries).toStrictEqual([
          expect.objectContaining({ repositoryPath: '/repo/api', status: 'pullRequestCreated' }),
          expect.objectContaining({ repositoryPath: '/repo/web', status: 'pending' }),
        ]);
      }
    }
    expect(mission.revision).toBe(6);
  });

  it('requires an existing Mission with at least one team agent', () => {
    const snapshot = createInitialSnapshot();
    expect(() => applyMissionDebugFixture(snapshot, 'missing', 'requirements')).toThrow('not found');
    const mission = createMission(snapshot, { outcome: 'Debug mission', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    snapshot.agents = [];
    expect(() => applyMissionDebugFixture(snapshot, mission.id, 'requirements')).toThrow('Add an agent');
  });
});
