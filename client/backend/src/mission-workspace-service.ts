import type { AppSnapshot, CreateSourceWorktreeInput, SourceWorktree } from '@workspace/core/contracts';
import type { Mission } from '@workspace/core/missions';
import type { MissionImplementationStartProgress } from '@workspace/core/mission-execution';
import { missionTeamRepositories, missionWorkspaceName } from './mission-execution-policy';

export type MissionWorkspacePorts = {
  snapshot: AppSnapshot;
  validateRepository(path: string): Promise<void>;
  createWorktree(input: CreateSourceWorktreeInput): Promise<SourceWorktree>;
  getHead(path: string): Promise<string>;
};

export class MissionWorkspaceService {
  constructor(private readonly ports: MissionWorkspacePorts) {}

  async provisionImplementationWorkspaces(
    mission: Mission,
    onPhase?: (phase: MissionImplementationStartProgress['phase']) => void,
  ): Promise<void> {
    const execution = mission.execution!;
    execution.workspaceName ??= missionWorkspaceName(mission);
    execution.workspaces ??= [];
    const branch = `mission/${execution.workspaceName}`;
    const representedRepositories = missionTeamRepositories(this.ports.snapshot, mission);
    const assignedRepositoryPaths = mission.artifacts.tickets.map(ticket => ticket.repositoryPath);
    if (assignedRepositoryPaths.some(repositoryPath => (
      !repositoryPath || !representedRepositories.includes(repositoryPath)
    ))) {
      throw new Error('Every ticket must target a repository represented in this Mission team.');
    }
    const repositoryPaths = [...new Set(assignedRepositoryPaths.filter(
      (repositoryPath): repositoryPath is string => Boolean(repositoryPath),
    ))];
    const pendingRepositoryPaths = repositoryPaths.filter(repositoryPath => (
      !execution.workspaces!.some(workspace => workspace.repositoryPath === repositoryPath)
    ));
    onPhase?.('creatingWorktrees');
    await Promise.all(pendingRepositoryPaths.map(repositoryPath => this.ports.validateRepository(repositoryPath)));
    const worktrees = await Promise.all(pendingRepositoryPaths.map(async repositoryPath => ({
      repositoryPath,
      worktree: await this.ports.createWorktree({ repoPath: repositoryPath, branchName: branch, reuseExisting: true }),
    })));
    onPhase?.('initializingWorkspaces');
    const workspaces = await Promise.all(worktrees.map(async ({ repositoryPath, worktree }) => ({
      repositoryPath,
      path: worktree.path,
      branch,
      baseSha: await this.ports.getHead(worktree.path),
    })));
    execution.workspaces.push(...workspaces);
  }

  prepareDeliveries(mission: Mission): void {
    const execution = mission.execution;
    if (!execution?.workspaces?.length) throw new Error('This Mission has no repository workspaces to ship.');
    execution.deliveries = execution.workspaces.map(workspace => {
      const run = execution.runs.slice().reverse().find(candidate => (
        candidate.stage === 'implementation' && candidate.repositoryPath === workspace.repositoryPath && candidate.workerId
      ));
      if (!run?.workerId) throw new Error(`No implementation agent is available to ship ${workspace.repositoryPath}.`);
      return { repositoryPath: workspace.repositoryPath, agentId: run.workerId, status: 'pending' };
    });
  }
}
