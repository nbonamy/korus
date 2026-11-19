import { createEntityId } from '@workspace/core/ids';
import { basename } from 'node:path';
import { createAgentInSnapshot } from '@workspace/core/agent-manager';
import { missionLeadAgentId } from '@workspace/core/mission-attention';
import type { AppSnapshot, CreateSourceWorktreeInput, SourceWorktree } from '@workspace/core/contracts';
import type { Mission, MissionRepository, MissionWorkspace } from '@workspace/core/mission-types';
import type { MissionImplementationStartProgress } from '@workspace/core/mission-execution';
import { missionTeamRepositories, missionWorkspaceName } from './mission-execution-policy';

export type MissionWorkspacePorts = {
  snapshot: AppSnapshot;
  validateRepository(path: string): Promise<void>;
  createWorktree(input: CreateSourceWorktreeInput): Promise<SourceWorktree>;
  getHead(path: string): Promise<string>;
  resolveRepository?(repo: MissionRepository): Promise<string>;
};

export class MissionWorkspaceService {
  private readonly checkouts = new Map<string, Promise<string>>();
  private readonly workerWorkspaces = new Map<string, Promise<MissionWorkspace>>();
  constructor(private readonly ports: MissionWorkspacePorts) {}

  /**
   * Checkout and worktree I/O runs outside Mission transactions; `persist` records the
   * prepared workspace. Concurrent workers for one Mission repository share one result.
   */
  provisionWorkerWorkspace(
    mission: Mission,
    repositoryKey: string,
    persist: (record: (current: Mission) => MissionWorkspace) => Promise<MissionWorkspace>,
  ): Promise<MissionWorkspace> {
    const existing = mission.execution!.workspaces?.find(workspace => workspace.repositoryPath === repositoryKey && !workspace.deleted);
    if (existing) return Promise.resolve(existing);
    const id = JSON.stringify([mission.id, repositoryKey]);
    let pending = this.workerWorkspaces.get(id);
    if (!pending) {
      pending = this.prepareWorkerWorkspace(mission, repositoryKey)
        .then(prepared => persist(current => recordWorkerWorkspace(current, prepared)))
        .finally(() => this.workerWorkspaces.delete(id));
      this.workerWorkspaces.set(id, pending);
    }
    return pending;
  }

  /** Resolves once no worker workspace is being prepared for the Mission. */
  async settleWorkerWorkspaces(missionId: string): Promise<void> {
    const pending = [...this.workerWorkspaces].flatMap(([id, workspace]) => JSON.parse(id)[0] === missionId ? [workspace] : []);
    await Promise.allSettled(pending);
  }

  private async prepareWorkerWorkspace(mission: Mission, repositoryKey: string): Promise<MissionWorkspace> {
    const repo = mission.execution!.repositoryCatalog?.find(entry => entry.key === repositoryKey);
    if (!repo || !this.ports.resolveRepository) throw new Error(`Repository ${repositoryKey} is unavailable on the Mission host.`);
    const checkout = await this.checkout(repo);
    await this.ports.validateRepository(checkout);
    const branch = `mission/${mission.execution!.workspaceName ?? missionWorkspaceName(mission)}`;
    const worktree = await this.ports.createWorktree({ repoPath: checkout, branchName: branch, reuseExisting: true });
    return { repositoryPath: repositoryKey, path: worktree.path, branch, baseSha: await this.ports.getHead(worktree.path) };
  }

  /** Missions targeting the same origin share one checkout acquisition. */
  private checkout(repo: MissionRepository): Promise<string> {
    let pending = this.checkouts.get(repo.key);
    if (!pending) {
      pending = this.ports.resolveRepository!(repo).finally(() => this.checkouts.delete(repo.key));
      this.checkouts.set(repo.key, pending);
    }
    return pending;
  }

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
      throw new Error('Every ticket must target a repository represented in this Mission workspace.');
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

  prepareDeliveries(mission: Mission, missionHome?: string): void {
    const execution = mission.execution;
    if (!execution?.workspaces?.length) throw new Error('This Mission has no repository workspaces to ship.');
    const previousDeliveries = execution.deliveries;
    const leadId = missionLeadAgentId(mission);
    execution.deliveries = execution.workspaces.map(workspace => {
      const run = execution.runs.slice().reverse().find(candidate => (
        candidate.stage === 'implementation' && candidate.repositoryPath === workspace.repositoryPath && candidate.workerId
      ));
      if (!run?.workerId) throw new Error(`No implementation agent is available to ship ${workspace.repositoryPath}.`);
      let agentId = run.workerId;
      if (agentId === leadId) {
        // Git delivery is repository-bound and can remove its agent's worktree.
        // Use an idle handle, never another model run or the lead's conversation.
        const previous = previousDeliveries?.find(delivery => delivery.repositoryPath === workspace.repositoryPath);
        const handle = this.ports.snapshot.agents.find(agent => agent.id === previous?.agentId && agent.id !== leadId && agent.folder === workspace.path);
        const lead = this.ports.snapshot.agents.find(agent => agent.id === leadId)!;
        agentId = handle?.id ?? createEntityId('agent');
        if (!handle) createAgentInSnapshot(this.ports.snapshot, {
          name: `Delivery · ${basename(workspace.repositoryPath)}`, teamId: execution.teamId,
          folder: workspace.path, selection: { provider: lead.provider },
        }, undefined, agentId, { select: false });
      }
      return { repositoryPath: workspace.repositoryPath, agentId, status: 'pending' };
    });
    const lead = this.ports.snapshot.agents.find(agent => agent.id === leadId);
    if (missionHome && lead) { lead.folder = missionHome; delete lead.workspace; }
  }
}

function recordWorkerWorkspace(mission: Mission, prepared: MissionWorkspace): MissionWorkspace {
  const execution = mission.execution!;
  const existing = execution.workspaces?.find(workspace => workspace.repositoryPath === prepared.repositoryPath && !workspace.deleted);
  if (existing) return existing;
  execution.workspaceName ??= prepared.branch.slice('mission/'.length);
  execution.workspaces = [...(execution.workspaces ?? []).filter(item => item.repositoryPath !== prepared.repositoryPath), prepared];
  return prepared;
}
