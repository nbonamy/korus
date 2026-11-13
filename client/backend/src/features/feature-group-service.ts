import { createHash } from 'node:crypto';
import type { AgentGitWorkflow, AppSnapshot } from '@workspace/core/contracts';
import { featureLabel, isDefaultFeatureBranch, reorderFeature, setFeatureLabel, type FeatureGroupPreview, type FeatureGroupRequest, type FeatureGroupResult } from '@workspace/core/feature-groups';

export class FeatureGroupService {
  private readonly deleting = new Set<string>();
  constructor(private readonly snapshot: AppSnapshot, private readonly ports: {
    currentSnapshot(): Promise<AppSnapshot>;
    inspect(agentId: string, branch: string): Promise<AgentGitWorkflow>;
    close(agentId: string, branch: string, deleteWorktree: boolean): Promise<void>;
    save(): Promise<AppSnapshot>;
  }) {}

  async execute(input: FeatureGroupRequest): Promise<FeatureGroupResult> {
    const key = JSON.stringify([input.teamId, input.branch]);
    if (this.deleting.has(key)) throw new Error('This feature is already being deleted.');
    if (input.type === 'reorder') {
      const team = this.snapshot.teams.find(team => team.id === input.teamId);
      const previous = team?.featureOrder;
      reorderFeature(this.snapshot, input.teamId, input.branch, input.beforeBranch);
      try { return { kind: 'updated', snapshot: await this.ports.save() }; }
      catch (error) { team!.featureOrder = previous; throw error; }
    }
    if (input.type === 'rename') {
      const team = this.snapshot.teams.find(team => team.id === input.teamId);
      if (!team) throw new Error('Workspace not found.');
      const previous = team.featureLabels;
      this.deleting.add(key);
      try {
        setFeatureLabel(this.snapshot, input.teamId, input.branch, input.label);
        try { return { kind: 'updated', snapshot: await this.ports.save() }; }
        catch (error) { team.featureLabels = previous; throw error; }
      } finally { this.deleting.delete(key); }
    }
    const preview = await this.preview(input.teamId, input.branch);
    if (this.deleting.has(key)) throw new Error('A feature operation is already in progress.');
    if (input.type === 'preview-delete') return { kind: 'preview', preview };
    if (input.confirmed !== true || input.fingerprint !== preview.fingerprint) throw new Error('The feature changed. Reopen the deletion confirmation.');
    this.deleting.add(key);
    try {
      const snapshot = await this.ports.currentSnapshot();
      const remaining = new Map<string, number>();
      const folderKey = (id: string) => {
        const agent = snapshot.agents.find(agent => agent.id === id)!;
        return JSON.stringify([agent.remoteConnectionId ?? '', agent.folder]);
      };
      for (const id of preview.agentIds) remaining.set(folderKey(id), (remaining.get(folderKey(id)) ?? 0) + 1);
      for (const id of preview.agentIds) {
        const agent = snapshot.agents.find(agent => agent.id === id)!;
        const key = folderKey(id);
        remaining.set(key, remaining.get(key)! - 1);
        const linked = preview.worktrees.some(tree => tree.path === agent.folder && tree.remoteConnectionId === agent.remoteConnectionId);
        await this.ports.close(id, input.branch, linked && remaining.get(key) === 0);
      }
      const remainingSnapshot = await this.ports.currentSnapshot();
      if (remainingSnapshot.agents.some(agent => agent.teamId === input.teamId && agent.workspace?.kind === 'git' && agent.workspace.branch === input.branch)) throw new Error('The feature changed during cleanup. Review the remaining agents.');
      const team = this.snapshot.teams.find(team => team.id === input.teamId)!;
      const { [input.branch]: _label, ...labels } = team.featureLabels ?? {};
      team.featureLabels = labels;
      team.featureOrder = team.featureOrder?.filter(branch => branch !== input.branch);
      return { kind: 'updated', snapshot: await this.ports.save() };
    } finally { this.deleting.delete(key); }
  }

  private async preview(teamId: string, branch: string): Promise<FeatureGroupPreview> {
    const snapshot = await this.ports.currentSnapshot();
    const team = snapshot.teams.find(team => team.id === teamId);
    if (!team) throw new Error('Workspace not found.');
    const agents = snapshot.agents.filter(agent => agent.teamId === teamId && agent.workspace?.kind === 'git' && agent.workspace.branch === branch && agent.sessionKind !== 'quickChat');
    if (isDefaultFeatureBranch(branch, agents)) throw new Error('Default branch groups cannot be renamed or deleted.');
    if (!agents.length) throw new Error('Feature not found.');
    const ids = new Set(agents.map(agent => agent.id));
    const worktrees: FeatureGroupPreview['worktrees'] = [];
    const revisions: unknown[] = [];
    for (const agent of agents) {
      if (snapshot.agents.some(other => !ids.has(other.id) && other.folder === agent.folder && other.remoteConnectionId === agent.remoteConnectionId)) throw new Error('A feature worktree is also used by another agent outside this feature.');
      const workflow = await this.ports.inspect(agent.id, branch);
      if (workflow.branch !== branch || workflow.baseBranch === branch || workflow.detached) throw new Error('The worktree branch changed or is the default branch.');
      revisions.push([agent.id, agent.folder, agent.remoteConnectionId, workflow.headSha, workflow.branch, workflow.files]);
      if (workflow.isLinkedWorktree && !worktrees.some(tree => tree.path === agent.folder && tree.remoteConnectionId === agent.remoteConnectionId)) worktrees.push({
        path: agent.folder!, branch, repositoryName: agent.workspace?.kind === 'git' ? agent.workspace.repositoryName : '', changedFiles: workflow.files.length,
        ...(agent.remoteConnectionId ? { remoteConnectionId: agent.remoteConnectionId } : {}),
      });
    }
    const label = featureLabel(team.featureLabels, branch);
    return { teamId, branch, label, agentIds: agents.map(agent => agent.id), worktrees,
      fingerprint: createHash('sha256').update(JSON.stringify([teamId, branch, label, revisions])).digest('hex') };
  }
}
