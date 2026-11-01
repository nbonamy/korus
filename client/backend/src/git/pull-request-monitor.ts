import type { AgentGitPullRequest, AppSnapshot } from '@workspace/core/contracts';

type PullRequestReader = {
  getPullRequest(repository: string, number: number): Promise<AgentGitPullRequest | null>;
  githubConnected(): Promise<boolean>;
  repositoryConnected?(repository: string): Promise<boolean>;
};

export type PullRequestMonitorOptions = {
  getSnapshot: () => AppSnapshot;
  notifySnapshotUpdated: () => void;
  onError?: (agentId: string, error: unknown) => void;
  pullRequests: PullRequestReader;
  saveSnapshot: () => Promise<void>;
  now?: () => Date;
};

/** Reconciles durable agent pull-request tracking with its provider state. */
export class PullRequestMonitor {
  constructor(private readonly options: PullRequestMonitorOptions) {}

  async check(): Promise<void> {
    let changed = false;
    const trackedAgents = this.options.getSnapshot().agents.filter((agent) => agent.pullRequest && agent.pullRequest.state !== 'merged');
    for (const agent of trackedAgents) {
      const tracked = agent.pullRequest!;
      try {
        const connected = this.options.pullRequests.repositoryConnected
          ? await this.options.pullRequests.repositoryConnected(tracked.repository)
          : tracked.provider === 'github' && await this.options.pullRequests.githubConnected();
        if (!connected) continue;
        const current = await this.options.pullRequests.getPullRequest(tracked.repository, tracked.number);
        // The agent may have been removed or retargeted while the provider was read.
        if (!this.options.getSnapshot().agents.includes(agent) || agent.pullRequest !== tracked) continue;
        if (!current || samePullRequest(tracked, current)) continue;
        agent.pullRequest = {
          ...tracked,
          ...current,
          updatedAt: this.now().toISOString(),
        };
        changed = true;
      } catch (error) {
        this.options.onError?.(agent.id, error);
      }
    }

    if (!changed) return;
    await this.options.saveSnapshot();
    this.options.notifySnapshotUpdated();
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

function samePullRequest(
  tracked: NonNullable<AppSnapshot['agents'][number]['pullRequest']>,
  current: AgentGitPullRequest,
): boolean {
  return tracked.number === current.number &&
    tracked.title === current.title &&
    tracked.url === current.url &&
    tracked.draft === current.draft &&
    tracked.headSha === current.headSha &&
    tracked.state === current.state &&
    tracked.mergedAt === current.mergedAt;
}
