import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot-construction';
import { createMission } from '@workspace/core/missions';
import { MissionWorkspaceService } from '../mission-workspace-service';

describe('MissionWorkspaceService', () => {
  it('creates repository worktrees concurrently and advances phases at batch barriers', async () => {
    const snapshot = createInitialSnapshot();
    const repositoryPaths = ['/repo/api', '/repo/web'];
    snapshot.agents.slice(0, 2).forEach((agent, index) => {
      agent.folder = repositoryPaths[index]!;
      agent.workspace = {
        kind: 'git',
        folder: repositoryPaths[index]!,
        repositoryName: repositoryPaths[index]!.slice('/repo/'.length),
        repositoryRoot: repositoryPaths[index]!,
        primaryWorktreeRoot: repositoryPaths[index]!,
        branch: 'main',
        isLinkedWorktree: false,
        updatedAt: '2026-09-22T00:00:00.000Z',
      };
    });
    const mission = createMission(snapshot, {
      outcome: 'Build API and web',
      workflowType: 'shapeAndShipFeature',
      teamId: snapshot.teams[0]!.id,
      orchestratorMemberId: snapshot.agents[0]!.id,
    });
    mission.artifacts.tickets = repositoryPaths.map((repositoryPath, index) => ({
      title: `Ticket ${index + 1}`,
      repositoryPath,
      done: false,
    }));
    const resolvers = new Map<string, (value: { name: string; path: string }) => void>();
    const createWorktree = vi.fn(({ repoPath }: { repoPath: string }) => new Promise<{ name: string; path: string }>(resolve => {
      resolvers.set(repoPath, resolve);
    }));
    const phases: string[] = [];
    const service = new MissionWorkspaceService({
      snapshot,
      validateRepository: vi.fn().mockResolvedValue(undefined),
      createWorktree,
      getHead: vi.fn().mockResolvedValue('a'.repeat(40)),
    });

    const provisioning = service.provisionImplementationWorkspaces(mission, phase => phases.push(phase));
    await vi.waitFor(() => expect(createWorktree).toHaveBeenCalledTimes(2));
    expect(phases).toEqual(['creatingWorktrees']);

    resolvers.get(repositoryPaths[0]!)!({ name: 'mission', path: '/worktrees/api' });
    await Promise.resolve();
    expect(phases).toEqual(['creatingWorktrees']);

    resolvers.get(repositoryPaths[1]!)!({ name: 'mission', path: '/worktrees/web' });
    await provisioning;
    expect(phases).toEqual(['creatingWorktrees', 'initializingWorkspaces']);
    expect(mission.execution?.workspaces).toHaveLength(2);
  });
});
