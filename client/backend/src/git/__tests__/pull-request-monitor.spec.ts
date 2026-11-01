import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { Agent, AgentGitPullRequest } from '@workspace/core/contracts';
import { PullRequestMonitor } from '../pull-request-monitor';

describe('PullRequestMonitor', () => {
  // Provider auth/read failures, late identity changes, and closed/reopened requests
  // must not corrupt durable tracking or block another provider's update.
  it.each(['github', 'gitlab'] as const)('keeps monitoring when %s is unavailable', async unavailable => {
    const snapshot = createInitialSnapshot();
    snapshot.agents = [trackedAgent('github'), trackedAgent('gitlab')];
    snapshot.agents[1]!.pullRequest = { ...snapshot.agents[1]!.pullRequest!, provider: 'gitlab', repository: 'gitlab.com/group/sub/repo', url: 'https://gitlab.com/group/sub/repo/-/merge_requests/7' };
    const onError = vi.fn(), saveSnapshot = vi.fn();
    const pullRequests = {
      githubConnected: vi.fn().mockResolvedValue(false),
      repositoryConnected: vi.fn(async repository => {
        if ((repository.startsWith('gitlab.com/') ? 'gitlab' : 'github') === unavailable) throw new Error('auth unavailable');
        return true;
      }),
      getPullRequest: vi.fn(async repository => pullRequest({ url: snapshot.agents.find(agent => agent.pullRequest?.repository === repository)!.pullRequest!.url, state: 'merged', mergedAt: '2026-09-03T12:00:00.000Z' })),
    };
    const monitor = new PullRequestMonitor({ getSnapshot: () => snapshot, pullRequests, onError, saveSnapshot, notifySnapshotUpdated: vi.fn() });
    await monitor.check();
    expect(snapshot.agents.find(agent => agent.id !== unavailable)!.pullRequest?.state).toBe('merged');
    expect(snapshot.agents.find(agent => agent.id === unavailable)!.pullRequest?.state).toBe('open');
    expect(onError).toHaveBeenCalledWith(unavailable, expect.any(Error));
    expect(saveSnapshot).toHaveBeenCalledOnce();
  });

  it('ignores a late response for replaced tracking', async () => {
    const snapshot = createInitialSnapshot(); snapshot.agents = [trackedAgent('one')];
    let finish!: (value: AgentGitPullRequest) => void;
    const saveSnapshot = vi.fn();
    const getPullRequest = vi.fn(() => new Promise<AgentGitPullRequest>(resolve => { finish = resolve; }));
    const monitor = new PullRequestMonitor({ getSnapshot: () => snapshot, pullRequests: { githubConnected: async () => true, getPullRequest }, saveSnapshot, notifySnapshotUpdated: vi.fn() });
    const pending = monitor.check();
    await vi.waitFor(() => expect(getPullRequest).toHaveBeenCalledOnce());
    snapshot.agents[0]!.pullRequest = { ...snapshot.agents[0]!.pullRequest!, number: 8 };
    finish(pullRequest({ state: 'merged' })); await pending;
    expect(snapshot.agents[0]!.pullRequest).toMatchObject({ number: 8, state: 'open' });
    expect(saveSnapshot).not.toHaveBeenCalled();
  });

  it('persists one snapshot update when a tracked pull request is merged', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents = [trackedAgent('agent-one'), trackedAgent('agent-two')];
    const pullRequests = {
      githubConnected: vi.fn().mockResolvedValue(true),
      getPullRequest: vi.fn()
        .mockResolvedValueOnce(pullRequest({ number: 7, state: 'merged', mergedAt: '2026-09-03T12:00:00.000Z' }))
        .mockResolvedValueOnce(pullRequest({ number: 7 })),
    };
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const notifySnapshotUpdated = vi.fn();
    const monitor = new PullRequestMonitor({
      getSnapshot: () => snapshot,
      notifySnapshotUpdated,
      pullRequests,
      saveSnapshot,
      now: () => new Date('2026-09-03T12:01:00.000Z'),
    });

    await monitor.check();

    expect(snapshot.agents[0]?.pullRequest).toMatchObject({
      state: 'merged',
      mergedAt: '2026-09-03T12:00:00.000Z',
      updatedAt: '2026-09-03T12:01:00.000Z',
    });
    expect(snapshot.agents[1]?.pullRequest?.updatedAt).toBe('2026-09-03T11:00:00.000Z');
    expect(saveSnapshot).toHaveBeenCalledOnce();
    expect(notifySnapshotUpdated).toHaveBeenCalledOnce();
  });

  it('tracks meaningful open pull-request changes without publishing unchanged checks', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents = [trackedAgent('agent-one')];
    const pullRequests = {
      githubConnected: vi.fn().mockResolvedValue(true),
      getPullRequest: vi.fn().mockResolvedValue(pullRequest({ headSha: 'new-head' })),
    };
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const notifySnapshotUpdated = vi.fn();
    const monitor = new PullRequestMonitor({
      getSnapshot: () => snapshot,
      notifySnapshotUpdated,
      pullRequests,
      saveSnapshot,
    });

    await monitor.check();
    expect(snapshot.agents[0]?.pullRequest?.headSha).toBe('new-head');
    expect(saveSnapshot).toHaveBeenCalledOnce();

    await monitor.check();
    expect(saveSnapshot).toHaveBeenCalledOnce();
    expect(notifySnapshotUpdated).toHaveBeenCalledOnce();
  });

  it('does nothing while GitHub is disconnected', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents = [trackedAgent('agent-one')];
    const pullRequests = {
      githubConnected: vi.fn().mockResolvedValue(false),
      getPullRequest: vi.fn(),
    };
    const saveSnapshot = vi.fn();
    const monitor = new PullRequestMonitor({
      getSnapshot: () => snapshot,
      notifySnapshotUpdated: vi.fn(),
      pullRequests,
      saveSnapshot,
    });

    await monitor.check();
    expect(pullRequests.getPullRequest).not.toHaveBeenCalled();
    expect(saveSnapshot).not.toHaveBeenCalled();
  });

  it('isolates one provider failure and continues checking other agents', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents = [trackedAgent('agent-one'), trackedAgent('agent-two')];
    const onError = vi.fn();
    const monitor = new PullRequestMonitor({
      getSnapshot: () => snapshot,
      notifySnapshotUpdated: vi.fn(),
      onError,
      pullRequests: {
        githubConnected: vi.fn().mockResolvedValue(true),
        getPullRequest: vi.fn()
          .mockRejectedValueOnce(new Error('rate limited'))
          .mockResolvedValueOnce(pullRequest({ state: 'closed' })),
      },
      saveSnapshot: vi.fn().mockResolvedValue(undefined),
    });

    await monitor.check();
    expect(onError).toHaveBeenCalledWith('agent-one', expect.objectContaining({ message: 'rate limited' }));
    expect(snapshot.agents[1]?.pullRequest?.state).toBe('closed');
  });
});

function trackedAgent(id: string): Agent {
  return {
    id,
    teamId: 'team-app',
    name: id,
    folder: `/src/${id}`,
    backend: 'codex',
    status: { type: 'idle' },
    pullRequest: {
      provider: 'github',
      repository: 'owner/repo',
      branch: 'feature',
      ...pullRequest(),
      createdAt: '2026-09-03T11:00:00.000Z',
      updatedAt: '2026-09-03T11:00:00.000Z',
    },
    createdAt: '2026-09-03T10:00:00.000Z',
    updatedAt: '2026-09-03T10:00:00.000Z',
  };
}

function pullRequest(overrides: Partial<AgentGitPullRequest> = {}): AgentGitPullRequest {
  return {
    number: 7,
    title: 'Improve issue seven',
    url: 'https://github.com/owner/repo/pull/7',
    draft: false,
    headSha: 'head-sha',
    state: 'open',
    ...overrides,
  };
}
