import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentWorkspaceService } from '../agent-workspace-service';
import type { AgentWorkspaceIdentity } from '@workspace/core/contracts';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';

afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  const snapshot = createTestSnapshot();
  snapshot.activeAgentId = 'agent';
  snapshot.agents = [{
    id: 'agent', teamId: 'team-test', name: 'Test', folder: '/repo', backend: 'codex',
    status: { type: 'working' }, createdAt: '', updatedAt: '',
  }];
  const getGitStatus = vi.fn(async () => null);
  const service = new AgentWorkspaceService({
    getSnapshot: () => snapshot, getGitStatus, applyGitStatus: vi.fn(),
    persistSnapshot: async () => undefined,
  });
  return { service, snapshot, getGitStatus };
}

describe('scheduled Git refresh', () => {
  it('coalesces bursts without postponing the refresh indefinitely', async () => {
    const { service, getGitStatus } = setup();
    service.scheduleGitStatusRefresh('agent');
    await vi.advanceTimersByTimeAsync(400);
    service.scheduleGitStatusRefresh('agent');
    await vi.advanceTimersByTimeAsync(100);
    expect(getGitStatus).toHaveBeenCalledOnce();
    service.close();
  });

  it('reads again after a change during an in-flight read, without overlapping reads', async () => {
    const { service, getGitStatus } = setup();
    let finish!: (value: null) => void;
    getGitStatus.mockImplementationOnce(() => new Promise<null>((resolve) => { finish = resolve; }));
    const first = service.refreshGitStatus('agent');
    service.scheduleGitStatusRefresh('agent');
    await vi.advanceTimersByTimeAsync(500);
    expect(getGitStatus).toHaveBeenCalledOnce();
    service.scheduleGitStatusRefresh('agent');
    finish(null);
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(getGitStatus).toHaveBeenCalledTimes(2);
    service.close();
  });

  it('refreshes independently of client selection but skips a removed agent', async () => {
    const { service, snapshot, getGitStatus } = setup();
    service.scheduleGitStatusRefresh('agent');
    snapshot.activeAgentId = null;
    await vi.advanceTimersByTimeAsync(500);
    expect(getGitStatus).toHaveBeenCalledOnce();
    snapshot.activeAgentId = 'agent';
    service.scheduleGitStatusRefresh('agent');
    snapshot.agents = [];
    await vi.advanceTimersByTimeAsync(500);
    expect(getGitStatus).toHaveBeenCalledOnce();
    service.close();
  });

  it('cancels pending work on shutdown', async () => {
    const { service, getGitStatus } = setup();
    service.scheduleGitStatusRefresh('agent');
    service.close();
    service.scheduleGitStatusRefresh('agent');
    await vi.advanceTimersByTimeAsync(500);
    expect(getGitStatus).not.toHaveBeenCalled();
  });

  it('an immediate refresh consumes a pending refresh', async () => {
    const { service, getGitStatus } = setup();
    service.scheduleGitStatusRefresh('agent');
    await service.refreshGitStatus('agent');
    await vi.advanceTimersByTimeAsync(500);
    expect(getGitStatus).toHaveBeenCalledOnce();
    service.close();
  });

  it('does not start a follow-up after shutdown while waiting for a read', async () => {
    const { service, getGitStatus } = setup();
    let finish!: (value: null) => void;
    getGitStatus.mockImplementationOnce(() => new Promise<null>((resolve) => { finish = resolve; }));
    const first = service.refreshGitStatus('agent');
    service.scheduleGitStatusRefresh('agent');
    await vi.advanceTimersByTimeAsync(500);
    service.close();
    finish(null);
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(getGitStatus).toHaveBeenCalledOnce();
  });
});

describe('workspace default branch reconciliation', () => {
  it('backfills legacy identities and persists a changed default branch', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.folder = '/repo';
    const workspace: AgentWorkspaceIdentity = {
      kind: 'git', folder: '/repo', repositoryName: 'repo', repositoryRoot: '/repo',
      branch: 'main', isLinkedWorktree: false, primaryWorktreeRoot: '/repo', updatedAt: '',
    };
    agent.workspace = workspace;
    const resolveIdentity = vi.fn().mockResolvedValue({ ...workspace, defaultBranch: 'trunk' });
    const persistSnapshot = vi.fn(async () => undefined);
    const service = new AgentWorkspaceService({
      getSnapshot: () => snapshot, getGitStatus: async () => null, applyGitStatus: vi.fn(),
      persistSnapshot, resolveIdentity,
    });

    await service.reconcile([agent.id]);
    expect(snapshot.agents[0]!.workspace).toStrictEqual({ ...workspace, defaultBranch: 'trunk' });
    expect(persistSnapshot).toHaveBeenCalledOnce();
    resolveIdentity.mockResolvedValue({ ...workspace, defaultBranch: 'release' });
    await service.reconcile([agent.id], true);
    expect(snapshot.agents[0]!.workspace).toStrictEqual({ ...workspace, defaultBranch: 'release' });
    expect(persistSnapshot).toHaveBeenCalledTimes(2);
    await service.reconcile([agent.id]);
    expect(resolveIdentity).toHaveBeenCalledTimes(2);
    service.close();
  });
});
