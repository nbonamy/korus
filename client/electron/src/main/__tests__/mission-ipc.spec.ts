import { describe, expect, it, vi } from 'vitest';
import { registerMissionIpcHandlers } from '../mission-ipc';
import { createInitialSnapshot } from '@workspace/core/snapshot-construction';
import { createMission } from '@workspace/core/missions';

describe('mission IPC', () => {
  it('forwards mission writes to daemon and adopts the returned snapshots', async () => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'Billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = { handle: (key: string, handler: (...args: unknown[]) => unknown) => handlers.set(key, handler) } as unknown as Parameters<typeof registerMissionIpcHandlers>[0];
    const artifact = { stage: 'requirements', content: '# Billing', revision: 1, updatedAt: '2026-09-19T00:00:00.000Z' };
    const request = vi.fn(async (method: string) => method === 'mission/artifact/read' ? artifact : snapshot);
    const adopt = vi.fn(value => value);
    const selectMission = vi.fn();
    registerMissionIpcHandlers(ipc, () => ({ request }) as unknown as ReturnType<Parameters<typeof registerMissionIpcHandlers>[1]>, adopt, selectMission);
    expect(handlers.get('mission:select')!({}, mission.id)).toBeUndefined();
    expect(selectMission).toHaveBeenCalledWith(mission.id);
    const input = { outcome: 'Billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id };
    await expect(handlers.get('mission:create')!({}, input)).resolves.toBe(snapshot);
    expect(request).toHaveBeenLastCalledWith('mission/create', { input });
    const update = { id: mission.id, revision: 0, artifacts: mission.artifacts, stageAgentIds: {}, action: 'save' };
    await expect(handlers.get('mission:update')!({}, update)).resolves.toBe(snapshot);
    expect(request).toHaveBeenLastCalledWith('mission/update', { input: update });
    const execution = { id: mission.id, revision: 0, action: 'run' };
    await expect(handlers.get('mission:execute')!({}, execution)).resolves.toBe(snapshot);
    expect(request).toHaveBeenLastCalledWith('mission/execution/update', { input: execution });
    await expect(handlers.get('mission:artifact:read')!({}, mission.id, 'requirements')).resolves.toBe(artifact);
    expect(request).toHaveBeenLastCalledWith('mission/artifact/read', { missionId: mission.id, stage: 'requirements' });
    const deletion = { id: mission.id, revision: 0, deleteWorktrees: true, confirmed: true as const };
    await expect(handlers.get('mission:delete')!({}, deletion)).resolves.toBe(snapshot);
    expect(request).toHaveBeenLastCalledWith('mission/delete', { input: deletion });
    expect(adopt).toHaveBeenCalledTimes(4);
    request.mockRejectedValueOnce(new Error('Stale revision'));
    await expect(handlers.get('mission:update')!({}, update)).rejects.toThrow('Stale revision');
    expect(adopt).toHaveBeenCalledTimes(4);
  });
});
