import { describe, expect, it, vi } from 'vitest';
import { useAppState } from '../app-state';
import { stubElectronTestWindow } from '../test/client';
import { createInitialSnapshot } from '@workspace/core/snapshot-construction';
import { createMission, updateMission } from '@workspace/core/missions';

describe('mission client state', () => {
  it('adopts backend mission revisions without changing agent navigation and preserves state on failure', async () => {
    const backend = createInitialSnapshot();
    const api = {
      getSnapshot: vi.fn(async () => structuredClone(backend)),
      createMission: vi.fn(async input => { createMission(backend, input); return structuredClone(backend); }),
      readMissionArtifact: vi.fn().mockResolvedValue({ stage: 'requirements', content: '# Billing', revision: 1, updatedAt: '2026-09-19T00:00:00.000Z' }),
      updateMission: vi.fn(async input => { updateMission(backend, input); return structuredClone(backend); }),
    };
    stubElectronTestWindow({ app: api });
    const state = useAppState();
    await state.loadSnapshot();
    const mission = await state.createMission({ outcome: 'Billing', workflowType: 'shapeAndShipFeature', teamId: backend.teams[0]!.id, orchestratorMemberId: backend.agents[0]!.id });
    const input = { id: mission.id, revision: 0, artifacts: JSON.parse(JSON.stringify(mission.artifacts)), stageAgentIds: {}, action: 'save' as const };
    await state.updateMission(input);
    await expect(state.readMissionArtifact(mission.id, 'requirements')).resolves.toMatchObject({ content: '# Billing' });
    expect(api.readMissionArtifact).toHaveBeenCalledWith(mission.id, 'requirements');
    expect(state.snapshot.value.missions?.[0]?.revision).toBe(1);
    expect(state.snapshot.value.activeAgentId).toBe(backend.activeAgentId);
    await expect(state.updateMission(input)).rejects.toThrow('changed');
    expect(state.snapshot.value.missions?.[0]?.revision).toBe(1);
  });
});
