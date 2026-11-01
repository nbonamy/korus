import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { AgentGitService } from '../agent-git-service';
import { PullRequestMonitor } from '../pull-request-monitor';
import { AppBackendServer } from '../../server';
import { AppStateStore } from '../../persistence/store';
const exec = promisify(execFile);
const git = (cwd: string, args: string[]) => exec('git', args, { cwd });

// Real Git and the owning server protect against deleting a checkout after its
// branch/repository changes, dirty edits, or commits beyond the recorded MR head.
it.each(['clean', 'dirty', 'new commits', 'other branch', 'other repository', 'remote cleanup', 'remote advanced', 'remote push mismatch'] as const)('restarts GitLab tracking and applies cleanup safely: %s', async scenario => {
  const container = await mkdtemp(join(tmpdir(), 'korus-mr-lifecycle-'));
  let server: AppBackendServer | undefined;
  try {
    const root = join(container, 'repo'), checkout = join(container, 'work'); await mkdir(root);
    await git(root, ['init', '-b', 'main']); await git(root, ['config', 'user.email', 'test@example.test']); await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['commit', '--allow-empty', '-m', 'base']);
    await git(root, ['remote', 'add', 'origin', 'git@gitlab.com:group/sub/repo.git']);
    await git(root, ['worktree', 'add', '-b', 'feature', checkout]);
    await git(checkout, ['commit', '--allow-empty', '-m', 'work']);
    const headSha = (await git(checkout, ['rev-parse', 'HEAD'])).stdout.trim();
    const remote = join(container, 'remote.git');
    if (scenario.startsWith('remote ')) {
      await git(root, ['init', '--bare', remote]);
      await git(checkout, ['push', remote, 'feature']);
      await git(checkout, ['update-ref', 'refs/remotes/origin/feature', headSha]);
      await git(checkout, ['config', 'branch.feature.remote', 'origin']);
      await git(checkout, ['config', 'branch.feature.merge', 'refs/heads/feature']);
      if (scenario === 'remote push mismatch') await git(root, ['remote', 'set-url', '--push', 'origin', 'git@gitlab.com:unrelated/repo.git']);
      if (scenario === 'remote advanced') {
        await git(root, ['commit', '--allow-empty', '-m', 'other remote work']);
        await git(root, ['push', remote, 'HEAD:refs/heads/feature', '--force']);
      }
    }
    let snapshot = createInitialSnapshot(); snapshot.agents = [snapshot.agents[0]!];
    const agent = snapshot.agents[0]!; agent.folder = checkout; agent.backendSession = undefined;
    agent.pullRequest = { provider: 'gitlab', repository: 'gitlab.com/group/sub/repo', branch: 'feature', number: 7, title: 'Draft: Work', url: 'https://gitlab.com/group/sub/repo/-/merge_requests/7', draft: true, headSha, state: 'open', createdAt: '2026-09-03T11:00:00.000Z', updatedAt: '2026-09-03T11:00:00.000Z' };
    const store = new AppStateStore(join(container, 'state')); await store.save(snapshot); snapshot = await new AppStateStore(join(container, 'state')).load();
    let current = { number: 7, title: 'Work', url: agent.pullRequest.url, draft: false, headSha, state: 'open' as 'open' | 'closed' | 'merged', mergedAt: undefined as string | undefined };
    const monitor = new PullRequestMonitor({ getSnapshot: () => snapshot, pullRequests: { githubConnected: async () => false, repositoryConnected: async () => true, getPullRequest: async () => current }, saveSnapshot: () => store.save(snapshot), notifySnapshotUpdated: () => {} });
    await monitor.check(); expect(snapshot.agents[0]!.pullRequest).toMatchObject({ draft: false, title: 'Work', state: 'open' });
    current = { ...current, state: 'closed' }; await monitor.check(); expect(snapshot.agents[0]!.pullRequest?.state).toBe('closed');
    // Closed MRs may reopen; merge is terminal.
    current = { ...current, state: 'open', headSha }; await monitor.check(); expect(snapshot.agents[0]!.pullRequest?.state).toBe('open');
    current = { ...current, state: 'merged', mergedAt: '2026-09-03T12:00:00.000Z' }; await monitor.check();
    snapshot = await new AppStateStore(join(container, 'state')).load();
    expect(snapshot.agents[0]!.pullRequest).toMatchObject({ provider: 'gitlab', state: 'merged', mergedAt: current.mergedAt });
    if (scenario === 'dirty') await writeFile(join(checkout, 'private-work'), 'keep');
    if (scenario === 'new commits') await git(checkout, ['commit', '--allow-empty', '-m', 'later work']);
    if (scenario === 'other branch') await git(checkout, ['switch', '-c', 'unrelated']);
    if (scenario === 'other repository') await git(checkout, ['remote', 'set-url', 'origin', 'git@gitlab.com:other/sub/repo.git']);
    server = new AppBackendServer({ version: 'test', snapshot, agentGitService: new AgentGitService(() => new Date(), (cwd, args) => git(cwd, args[0] === 'push' ? args.map(value => value === 'origin' ? remote : value) : args)) });
    const cleanup = server.handleMessage({ jsonrpc: '2.0', id: 'cleanup', method: backendMethods.agentDelete, params: { agentId: agent.id, input: { confirmed: true, deleteWorktree: true, pullRequestCleanup: true, deleteRemoteBranch: scenario.startsWith('remote ') } } });
    if (scenario === 'clean' || scenario === 'remote cleanup') {
      await cleanup; expect(snapshot.agents).toHaveLength(0); await expect(access(checkout)).rejects.toThrow();
      expect((await git(root, ['branch', '--list', 'feature'])).stdout.trim()).toBe('');
    } else {
      await expect(cleanup).rejects.toThrow(); await access(checkout);
      expect(snapshot.agents[0]!.id).toBe(agent.id);
      expect((await git(root, ['branch', '--list', 'feature'])).stdout).toContain('feature');
    }
    if (scenario.startsWith('remote ')) {
      const refs = (await git(root, ['ls-remote', remote, 'refs/heads/feature'])).stdout.trim();
      expect(Boolean(refs)).toBe(scenario !== 'remote cleanup');
    }
    expect((await git(root, ['branch', '--show-current'])).stdout.trim()).toBe('main');
  } finally { await server?.close(); await rm(container, { recursive: true, force: true }); }
});
