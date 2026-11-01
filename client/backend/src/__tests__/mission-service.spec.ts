import { describe, expect, it, vi } from 'vitest';
import { MissionService } from '../mission-service';
import { createEmptySnapshot, createInitialSnapshot } from '@workspace/core/snapshot-construction';
import { createMission } from '@workspace/core/missions';

describe('MissionService', () => {
  it('keeps failed writes out of live state and serializes competing revision updates', async () => {
    const snapshot = createInitialSnapshot();
    const persist = vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined);
    const service = new MissionService(snapshot, persist);
    const input = { outcome: 'Billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id };
    await expect(service.mutate('create', input)).rejects.toThrow('Disk full');
    expect(snapshot.missions).toBeUndefined();
    await service.mutate('create', input);
    const mission = snapshot.missions![0]!;
    const change = { id: mission.id, revision: 0, artifacts: mission.artifacts, stageAgentIds: {}, action: 'save' };
    const results = await Promise.allSettled([service.mutate('update', change), service.mutate('update', change)]);
    expect(results.map(r => r.status)).toStrictEqual(['fulfilled', 'rejected']);
    expect(snapshot.missions![0]!.revision).toBe(1);
  });

  it('removes a mission and its workers only after their conversations are cleaned up', async () => {
    const snapshot = createEmptySnapshot();
    snapshot.teams = [{ id: 'team-1', name: 'Team', agentIds: ['worker-1'], color: '#000000' }];
    snapshot.agents = [{
      id: 'worker-1', teamId: 'team-1', name: 'Mission worker', folder: '/repo', backend: 'codex',
      status: { type: 'idle' }, createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z',
    }];
    const mission = createMission(snapshot, { outcome: 'Billing', workflowType: 'shapeAndShipFeature', teamId: 'team-1', orchestratorMemberId: 'worker-1' });
    mission.execution = {
      teamId: 'team-1', repoPath: '/repo', memberIds: [],
      runs: [{
        id: 'run-1', stage: 'requirements', memberId: 'member-1', workerId: 'worker-1',
        status: 'running', skills: [], feedback: '', startedAt: '2026-09-19T00:00:00.000Z',
      }],
    };
    const persist = vi.fn().mockResolvedValue(undefined);
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const service = new MissionService(snapshot, persist);

    await service.remove({ id: mission.id, revision: mission.revision, deleteWorktrees: false, confirmed: true }, cleanup);

    expect(cleanup).toHaveBeenCalledWith(
      expect.objectContaining({ id: mission.id }),
      [expect.objectContaining({ id: 'worker-1' })],
    );
    expect(snapshot.missions).toStrictEqual([]);
    expect(snapshot.agents).toStrictEqual([]);
    expect(snapshot.teams[0]!.agentIds).toStrictEqual([]);
    expect(persist).toHaveBeenCalledOnce();
  });
});
