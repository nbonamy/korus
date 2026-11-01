import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { AgentGitService, type AgentGitRunner } from '../agent-git-service';

const exec = promisify(execFile);
const git: AgentGitRunner = (cwd, args) => exec('git', args, {
  cwd,
  env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'app-merge-')));
  const repo = join(root, 'repo');
  const feature = join(root, 'feature');
  await git(root, ['init', '-b', 'main', repo]);
  await git(repo, ['config', 'user.name', 'Merge Test']);
  await git(repo, ['config', 'user.email', 'merge@example.invalid']);
  await git(repo, ['commit', '--allow-empty', '-m', 'base']);
  await git(root, ['init', '--bare', join(root, 'origin.git')]);
  await git(repo, ['remote', 'add', 'origin', join(root, 'origin.git')]);
  await git(repo, ['worktree', 'add', '-b', 'feature', feature]);
  await git(feature, ['push', '-u', 'origin', 'feature']);
  await writeFile(join(feature, 'feature.txt'), 'merged content\n');
  await git(feature, ['add', 'feature.txt']);
  await git(feature, ['commit', '-m', 'feature']);
  return { root, repo, feature };
}

describe('merge cleanup with real Git', () => {
  it('refuses to delete the base upstream of an unpublished worktree branch while allowing local-only cleanup', async () => {
    const { root, repo, feature } = await fixture();
    try {
      await git(repo, ['push', 'origin', 'main']);
      await git(repo, ['push', 'origin', '--delete', 'feature']);
      expect((await git(repo, ['ls-remote', '--heads', 'origin', 'refs/heads/feature'])).stdout).toBe('');
      await git(feature, ['branch', '--set-upstream-to=origin/main']);
      const service = new AgentGitService(() => new Date(), git);
      await expect(service.deleteLinkedWorktree(feature, true)).rejects.toThrow('remote branch');
      expect((await git(repo, ['ls-remote', '--heads', 'origin', 'refs/heads/main'])).stdout).not.toBe('');
      expect((await git(repo, ['worktree', 'list', '--porcelain'])).stdout).toContain(`worktree ${feature}`);
      await service.deleteLinkedWorktree(feature, false);
      expect((await git(repo, ['ls-remote', '--heads', 'origin', 'refs/heads/main'])).stdout).not.toBe('');
      expect((await git(repo, ['branch', '--list', 'feature'])).stdout).toBe('');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(['merge', 'squash'] as const)('cleans up a %s when the tracked remote branch is behind', async (strategy) => {
    const { root, repo, feature } = await fixture();
    try {
      const service = new AgentGitService(() => new Date(), git);
      await expect(service.merge(feature, strategy, true, true, 'feat: merge feature'))
        .resolves.toStrictEqual({ targetFolder: repo });
      expect(await readFile(join(repo, 'feature.txt'), 'utf8')).toBe('merged content\n');
      expect((await git(repo, ['branch', '--list', 'feature'])).stdout).toBe('');
      expect((await git(repo, ['worktree', 'list', '--porcelain'])).stdout).not.toContain(`worktree ${feature}`);
      expect((await git(repo, ['ls-remote', '--heads', 'origin', 'refs/heads/feature'])).stdout).toBe('');
      expect((await git(repo, ['branch', '-r', '--list', 'origin/feature'])).stdout).toBe('');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['fully published', 'untracked', 'different upstream', 'already deleted', 'no origin', 'cleanup disabled'] as const)('handles %s without assuming an origin tracking branch', async (scenario) => {
    const { root, repo, feature } = await fixture();
    try {
      if (scenario === 'untracked') await git(feature, ['branch', '--unset-upstream']);
      if (scenario === 'fully published') await git(feature, ['push', 'origin', 'feature']);
      if (scenario === 'different upstream') {
        await git(root, ['init', '--bare', join(root, 'fork.git')]);
        await git(repo, ['remote', 'add', 'fork', join(root, 'fork.git')]);
        await git(feature, ['push', '-u', 'fork', 'feature']);
      }
      if (scenario === 'already deleted') await git(join(root, 'origin.git'), ['update-ref', '-d', 'refs/heads/feature']);
      if (scenario === 'no origin') await git(repo, ['remote', 'remove', 'origin']);
      const deleteBranch = scenario !== 'cleanup disabled';
      const service = new AgentGitService(() => new Date(), git);
      await expect(service.merge(feature, 'merge', deleteBranch, true)).resolves.toStrictEqual({ targetFolder: repo });
      expect((await git(repo, ['branch', '--list', 'feature'])).stdout.trim()).toBe(deleteBranch ? '' : 'feature');
      if (scenario !== 'no origin') {
        expect(Boolean((await git(repo, ['ls-remote', '--heads', 'origin', 'refs/heads/feature'])).stdout))
          .toBe(!deleteBranch);
        expect(Boolean((await git(repo, ['branch', '-r', '--list', 'origin/feature'])).stdout)).toBe(!deleteBranch);
      }
      if (scenario === 'different upstream') {
        expect((await git(repo, ['ls-remote', '--heads', 'fork', 'refs/heads/feature'])).stdout).not.toBe('');
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['push rejected', 'lookup failed', 'remote advanced', 'remote raced', 'different push destination', 'origin default branch'] as const)('retains origin and reports cleanup warning when %s', async (scenario) => {
    const { root, repo, feature } = await fixture();
    try {
      const origin = join(root, 'origin.git');
      const sourceSha = (await git(feature, ['rev-parse', 'HEAD'])).stdout.trim();
      let retainedSha = (await git(origin, ['rev-parse', 'refs/heads/feature'])).stdout.trim();
      const advanceOrigin = async () => {
        retainedSha = (await git(repo, ['commit-tree', `${sourceSha}^{tree}`, '-p', sourceSha, '-m', 'new remote work'])).stdout.trim();
        await git(repo, ['push', 'origin', `${retainedSha}:refs/heads/feature`]);
      };
      if (scenario === 'remote advanced') await advanceOrigin();
      if (scenario === 'origin default branch') await git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/feature']);
      if (scenario === 'different push destination') {
        const destination = join(root, 'push.git');
        await git(root, ['init', '--bare', destination]);
        await git(repo, ['push', destination, `${sourceSha}:refs/heads/feature`]);
        await git(repo, ['remote', 'set-url', '--push', 'origin', destination]);
        const newSha = (await git(repo, ['commit-tree', `${sourceSha}^{tree}`, '-p', sourceSha, '-m', 'push-only work'])).stdout.trim();
        await git(repo, ['push', destination, `${newSha}:refs/heads/feature`]);
        retainedSha = newSha;
      }
      const runner: AgentGitRunner = async (cwd, args) => {
        if (scenario === 'lookup failed' && args[0] === 'ls-remote') throw new Error('origin offline');
        if (args[0] === 'push') {
          if (scenario === 'push rejected') throw new Error('permission denied');
          if (scenario === 'remote raced') await advanceOrigin();
        }
        return git(cwd, args);
      };
      const service = new AgentGitService(() => new Date(), runner);
      await expect(service.merge(feature, 'squash', true, true, 'feat: merge feature')).resolves.toStrictEqual({
        targetFolder: repo,
        warning: { type: 'branchRetained', branch: 'origin/feature' },
      });
      expect(await readFile(join(repo, 'feature.txt'), 'utf8')).toBe('merged content\n');
      expect((await git(repo, ['branch', '--list', 'feature'])).stdout).toBe('');
      const destination = scenario === 'different push destination' ? join(root, 'push.git') : origin;
      expect((await git(destination, ['rev-parse', 'refs/heads/feature'])).stdout.trim()).toBe(retainedSha);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['locked branch', 'unverified ancestry'])('preserves the branch and reports completed merge with cleanup warning for %s', async (failure) => {
    const { root, repo, feature } = await fixture();
    try {
      const runner: AgentGitRunner = (cwd, args) => {
        if (failure === 'locked branch' && args[0] === 'branch' && ['-d', '-D'].includes(args[1]!)) {
          return Promise.reject(new Error('cannot lock ref'));
        }
        if (failure === 'unverified ancestry' && args.join(' ') === 'merge-base --is-ancestor feature HEAD') {
          return Promise.reject(new Error('ancestry check failed'));
        }
        return git(cwd, args);
      };
      const service = new AgentGitService(() => new Date(), runner);
      await expect(service.merge(feature, 'merge', true, true)).resolves.toStrictEqual({
        targetFolder: repo,
        warning: { type: 'branchRetained', branch: 'feature' },
      });
      expect(await readFile(join(repo, 'feature.txt'), 'utf8')).toBe('merged content\n');
      expect((await git(repo, ['branch', '--list', 'feature'])).stdout.trim()).toBe('feature');
      expect((await git(repo, ['worktree', 'list', '--porcelain'])).stdout).not.toContain(`worktree ${feature}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
