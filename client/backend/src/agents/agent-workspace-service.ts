import { agentFolder } from '@workspace/core/agent-folder';
import { updateAgentWorkspace } from '@workspace/core/agent-manager';
import type { Agent, AgentGitStatus, AgentWorkspaceIdentity, AppSnapshot } from '@workspace/core/contracts';

export type AgentWorkspaceServiceOptions = {
  applyGitStatus: (agentId: string, status: AgentGitStatus) => void;
  getGitStatus: (agent: Agent) => Promise<AgentGitStatus | null>;
  getSnapshot: () => AppSnapshot;
  persistSnapshot: () => Promise<unknown>;
  resolveIdentity?: (folder: string) => Promise<AgentWorkspaceIdentity>;
};

/** Owns workspace identity reconciliation and deduplicated Git status refreshes. */
export class AgentWorkspaceService {
  private readonly gitStatusRefreshes = new Map<string, Promise<boolean>>();
  private readonly scheduledGitRefreshes = new Map<string, ReturnType<typeof setTimeout>>();
  private closed = false;
  private reconciliation: Promise<void> | null = null;

  constructor(private readonly options: AgentWorkspaceServiceOptions) {}

  async reconcile(agentIds?: readonly string[], refreshExisting = false): Promise<void> {
    if (this.reconciliation) return this.reconciliation;
    const snapshot = this.options.getSnapshot();
    const targetIds = agentIds ? new Set(agentIds) : null;
    const targets = snapshot.agents.filter((agent) => (
      (!targetIds || targetIds.has(agent.id)) &&
      (refreshExisting || !agent.workspace || agent.workspace.folder !== agent.folder
        || (agent.workspace.kind === 'git' && agent.workspace.defaultBranch === undefined))
    ));
    if (targets.length === 0) return;

    const reconciliation = (async () => {
      let nextIndex = 0;
      let changed = false;
      const workers = Array.from({ length: Math.min(4, targets.length) }, async () => {
        while (nextIndex < targets.length) {
          const target = targets[nextIndex++];
          if (target) changed = (await this.refreshIdentity(target.id)) || changed;
        }
      });
      await Promise.all(workers);
      if (changed) await this.options.persistSnapshot();
    })().finally(() => {
      if (this.reconciliation === reconciliation) this.reconciliation = null;
    });
    this.reconciliation = reconciliation;
    return reconciliation;
  }

  async refreshIdentity(agentId: string): Promise<boolean> {
    const snapshot = this.options.getSnapshot();
    const agent = snapshot.agents.find((candidate) => candidate.id === agentId);
    const folder = agent ? agentFolder(agent) : undefined;
    if (!agent || !folder || !this.options.resolveIdentity) return false;

    const identity = await this.options.resolveIdentity(folder);
    if (sameWorkspaceIdentity(agent.workspace, identity)) return false;
    updateAgentWorkspace(snapshot, agentId, identity, identity.updatedAt);
    return true;
  }

  refreshGitStatus(agentId: string): Promise<boolean> {
    const existing = this.gitStatusRefreshes.get(agentId);
    if (existing) return existing;
    const scheduled = this.scheduledGitRefreshes.get(agentId);
    if (scheduled) clearTimeout(scheduled);
    this.scheduledGitRefreshes.delete(agentId);

    const refresh = this.performGitStatusRefresh(agentId).finally(() => {
      if (this.gitStatusRefreshes.get(agentId) === refresh) this.gitStatusRefreshes.delete(agentId);
    });
    this.gitStatusRefreshes.set(agentId, refresh);
    return refresh;
  }

  scheduleGitStatusRefresh(agentId: string): void {
    if (this.closed || this.scheduledGitRefreshes.has(agentId)) return;
    const timer = setTimeout(() => {
      void (async () => {
        // A change arriving during a read must trigger a fresh read afterwards.
        await this.gitStatusRefreshes.get(agentId);
        this.scheduledGitRefreshes.delete(agentId);
        if (!this.closed) {
          await this.refreshGitStatus(agentId);
        }
      })().catch(() => { this.scheduledGitRefreshes.delete(agentId); });
    }, 500);
    timer.unref();
    this.scheduledGitRefreshes.set(agentId, timer);
  }

  close(): void {
    this.closed = true;
    for (const timer of this.scheduledGitRefreshes.values()) clearTimeout(timer);
    this.scheduledGitRefreshes.clear();
  }

  private async performGitStatusRefresh(agentId: string): Promise<boolean> {
    const snapshot = this.options.getSnapshot();
    const agent = snapshot.agents.find((candidate) => candidate.id === agentId);
    if (!agent) return false;
    if (!agentFolder(agent)) {
      delete snapshot.agentGitStatuses[agentId];
      return false;
    }

    let status: AgentGitStatus | null;
    try {
      status = await this.options.getGitStatus(agent);
      if (!status) return false;
    } catch {
      return false;
    }

    this.options.applyGitStatus(agentId, status);
    const workspace = agent.workspace;
    if (workspace?.kind === 'git' && workspace.folder === agent.folder) {
      const branch = status.branch ?? null;
      if (workspace.branch !== branch) {
        updateAgentWorkspace(snapshot, agentId, { ...workspace, branch, updatedAt: status.updatedAt }, status.updatedAt);
      }
    } else {
      await this.refreshIdentity(agentId);
    }
    return true;
  }
}

function sameWorkspaceIdentity(current: AgentWorkspaceIdentity | undefined, next: AgentWorkspaceIdentity): boolean {
  if (!current || current.kind !== next.kind || current.folder !== next.folder) return false;
  if (current.kind === 'folder' && next.kind === 'folder') return current.label === next.label;
  if (current.kind === 'git' && next.kind === 'git') {
    return current.repositoryName === next.repositoryName &&
      current.repositoryRoot === next.repositoryRoot &&
      current.branch === next.branch &&
      current.defaultBranch === next.defaultBranch &&
      current.isLinkedWorktree === next.isLinkedWorktree &&
      current.primaryWorktreeRoot === next.primaryWorktreeRoot &&
      current.originUrl === next.originUrl;
  }
  return false;
}
