import { describe, expect, it, vi } from 'vitest';
import { useAppState } from '../../src/app-state';
import { stubElectronTestWindow } from '../support/client';
import { createInitialSnapshot } from '@workspace/core/snapshot-construction';
import { createMission, updateMission } from '@workspace/core/missions';

describe('mission client state', () => {
  it('adopts backend mission revisions without changing agent navigation and preserves state on failure', async () => {
    const provider = createInitialSnapshot();
    const api = {
      getSnapshot: vi.fn(async () => structuredClone(provider)),
      createMission: vi.fn(async input => { createMission(provider, input); return structuredClone(provider); }),
      readMissionArtifact: vi.fn().mockResolvedValue({ stage: 'requirements', content: '# Billing', revision: 1, updatedAt: '2026-09-19T00:00:00.000Z' }),
      updateMission: vi.fn(async input => { updateMission(provider, input); return structuredClone(provider); }),
    };
    stubElectronTestWindow({ app: api });
    const state = useAppState();
    await state.loadSnapshot();
    const mission = await state.createMission({ outcome: 'Billing', workflowType: 'shapeAndShipFeature', teamId: provider.teams[0]!.id, orchestratorMemberId: provider.agents[0]!.id });
    const input = { id: mission.id, revision: 0, artifacts: JSON.parse(JSON.stringify(mission.artifacts)), stageAgentIds: {}, action: 'save' as const };
    await state.updateMission(input);
    await expect(state.readMissionArtifact(mission.id, 'requirements')).resolves.toMatchObject({ content: '# Billing' });
    expect(api.readMissionArtifact).toHaveBeenCalledWith(mission.id, 'requirements');
    expect(state.snapshot.value.missions?.[0]?.revision).toBe(1);
    expect(state.snapshot.value.activeAgentId).toBe(provider.activeAgentId);
    await expect(state.updateMission(input)).rejects.toThrow('changed');
    expect(state.snapshot.value.missions?.[0]?.revision).toBe(1);
  });
});
