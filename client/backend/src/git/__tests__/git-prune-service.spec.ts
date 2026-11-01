import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { GitPruneService } from '../git-prune-service';
import type { GitPruneInventory, GitPruneTarget } from '@workspace/core/contracts/git-prune';

const exec = promisify(execFile);
const git = (cwd: string, args: string[]) => exec('git', args, {
  cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
});
const targets = (inventory: GitPruneInventory) => inventory.groups.flatMap(group => [...(group.local ? [group.local] : []), ...group.remotes]);
const select = (target: GitPruneTarget) => ({ id: target.id, revision: target.revision });

async function fixture(run: (context: { repo: string; worktree: string; remote: string; service: GitPruneService }) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'app-prune-test-')));
  const repo = join(root, 'repo');
  const worktree = join(root, 'linked tree');
  const remote = join(root, 'remote.git');
  try {
    await git(root, ['init', '-b', 'main', repo]);
    await git(repo, ['config', 'user.name', 'Prune Test']);
    await git(repo, ['config', 'user.email', 'test@example.invalid']);
    await writeFile(join(repo, 'file.txt'), 'base');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-m', 'base']);
    await git(root, ['init', '--bare', '-b', 'main', remote]);
    await git(repo, ['remote', 'add', 'origin', remote]);
    await git(repo, ['worktree', 'add', '-b', 'feat/done', worktree]);
    await git(repo, ['branch', 'feat/local']);
    await git(repo, ['push', 'origin', 'main', 'feat/done']);
    await run({ repo, worktree, remote, service: new GitPruneService(git) });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('repository pruning with real Git', () => {
  it('deletes a branch merged into main even when its tracking branch is behind', async () => {
    await fixture(async ({ repo, service }) => {
      await writeFile(join(repo, 'file.txt'), 'merged work');
      await git(repo, ['commit', '-am', 'merged work']);
      await git(repo, ['branch', '-f', 'feat/local', 'main']);
      await git(repo, ['branch', '--set-upstream-to=origin/feat/done', 'feat/local']);
      const entry = targets(await service.inventory(repo, [])).find(item => item.name === 'feat/local')!;
      expect(entry.merged).toBe(true);
      expect(await service.prune(repo, { confirmed: true, targets: [select(entry)] }, () => []))
        .toStrictEqual({ deleted: [entry.id], failed: [] });
      await expect(git(repo, ['show-ref', '--verify', entry.id])).rejects.toThrow();
    });
  });

  it('identifies a failed target and reports Git stderr without remote credentials', async () => {
    await fixture(async ({ repo }) => {
      const service = new GitPruneService(async (folder, args) => {
        if (args[0] === 'push') throw Object.assign(new Error('command failed with credentials'), { stderr: 'remote: Permission denied for https://user:secret@example.invalid/repo.git\n', cmd: 'git push secret' });
        return git(folder, args);
      });
      const entry = targets(await service.inventory(repo, [])).find(item => item.kind === 'remote')!;
      const result = await service.prune(repo, { confirmed: true, targets: [select(entry)] }, () => []);
      expect(result.failed[0]?.message).toContain(entry.name);
      expect(result.failed[0]?.message).toContain('Permission denied');
      expect(result.failed[0]?.message).not.toContain('secret');
    });
  });
  it('has the same repository scope from every agent and can remove the invoking agent worktree', async () => {
    await fixture(async ({ repo, worktree, service }) => {
      await git(repo, ['branch', 'develop']);
      const owners = () => [{ folder: worktree, name: 'Ada' }];
      const inventory = await service.inventory(worktree, owners());
      expect(inventory).toStrictEqual(await service.inventory(repo, owners()));
      expect(inventory.groups.some(group => group.branch === 'develop')).toBe(true);
      const entry = targets(inventory).find(item => item.name === 'feat/done')!;
      const next = targets(inventory).find(item => item.name === 'feat/local')!;
      expect(await service.prune(worktree, { confirmed: true, force: true, targets: [select(entry), select(next)] }, owners))
        .toStrictEqual({ deleted: [entry.id, next.id], failed: [] });
      await expect(access(worktree)).rejects.toThrow();
      await git(repo, ['show-ref', '--verify', 'refs/heads/main']);
    });
  });

  it('still rejects changed worktree contents after explicit discard consent', async () => {
    await fixture(async ({ repo, worktree, service }) => {
      await writeFile(join(worktree, 'notes.txt'), 'existing work');
      const entry = targets(await service.inventory(repo, [])).find(item => item.name === 'feat/done')!;
      await writeFile(join(worktree, 'new.txt'), 'arrived after selection');
      expect((await service.prune(repo, { confirmed: true, force: true, targets: [select(entry)] }, () => [])).deleted).toStrictEqual([]);
      await access(join(worktree, 'new.txt'));
    });
  });
  it('allows explicit confirmed deletion of an unmerged, dirty, locked worktree used by an agent', async () => {
    await fixture(async ({ repo, worktree, remote, service }) => {
      await writeFile(join(worktree, 'file.txt'), 'unmerged change');
      await git(worktree, ['commit', '-am', 'unmerged work']);
      await writeFile(join(worktree, 'notes.txt'), 'untracked work');
      await writeFile(join(repo, '.git', 'info', 'exclude'), 'secret.env\n');
      await writeFile(join(worktree, 'secret.env'), 'ignored work');
      await git(repo, ['worktree', 'lock', worktree]);
      const owners = () => [{ folder: worktree, name: 'Ada' }];
      const entry = targets(await service.inventory(repo, owners())).find(item => item.name === 'feat/done')!;
      expect(entry.merged).toBe(false);
      expect(entry.changedFiles).toBeGreaterThan(0);
      expect(entry.usedBy).toStrictEqual(['Ada']);
      expect((await service.prune(repo, { confirmed: true, targets: [select(entry)] }, owners)).deleted).toStrictEqual([]);
      expect(await service.prune(repo, { confirmed: true, force: true, targets: [select(entry)] }, owners)).toStrictEqual({ deleted: [entry.id], failed: [] });
      await expect(access(worktree)).rejects.toThrow();
      await expect(git(repo, ['show-ref', '--verify', entry.id])).rejects.toThrow();
      await git(remote, ['show-ref', '--verify', 'refs/heads/feat/done']);
    });
  });
  it('prunes only the selected missing worktree registration and its merged branch', async () => {
    await fixture(async ({ repo, worktree, remote, service }) => {
      const other = join(repo, '..', 'other missing tree');
      await git(repo, ['worktree', 'add', '-b', 'feat/other', other]);
      await rm(worktree, { recursive: true });
      await rm(other, { recursive: true });
      const entry = targets(await service.inventory(repo, [])).find(item => item.name === 'feat/done')!;
      expect(entry.blocked).toBeUndefined();
      expect(entry.worktreeMissing).toBe(true);
      expect(await service.prune(repo, { confirmed: true, targets: [select(entry)] }, () => [])).toStrictEqual({ deleted: [entry.id], failed: [] });
      const trees = (await git(repo, ['worktree', 'list', '--porcelain'])).stdout;
      expect(trees).not.toContain(worktree);
      expect(trees).toContain(other);
      await expect(git(repo, ['show-ref', '--verify', entry.id])).rejects.toThrow();
      await git(remote, ['show-ref', '--verify', 'refs/heads/feat/done']);
    });
  });

  it('protects missing worktrees that are locked, owned, or restored since selection', async () => {
    await fixture(async ({ repo, worktree, service }) => {
      await git(repo, ['worktree', 'lock', worktree]);
      await rm(worktree, { recursive: true });
      const get = async (owners: {folder: string; name: string}[] = []) => targets(await service.inventory(repo, owners)).find(item => item.name === 'feat/done')!;
      expect((await get()).blocked).toBe('locked');
      await git(repo, ['worktree', 'unlock', worktree]);
      expect((await get([{ folder: worktree, name: 'Ada' }])).blocked).toBe('inUse');
      const entry = await get();
      expect(entry.blocked).toBeUndefined();
      await mkdir(worktree);
      await writeFile(join(worktree, 'keep.txt'), 'restored user files');
      expect((await service.prune(repo, { confirmed: true, targets: [select(entry)] }, () => [])).deleted).toStrictEqual([]);
      await access(join(worktree, 'keep.txt'));
      await git(repo, ['show-ref', '--verify', entry.id]);
    });
  });

  it('hides protected branches and bundles worktree/local removal without deleting the remote', async () => {
    await fixture(async ({ repo, worktree, remote, service }) => {
      const inventory = await service.inventory(repo, []);
      expect(inventory.groups.map(group => group.branch)).toStrictEqual(['feat/done', 'feat/local']);
      const local = inventory.groups[0]!.local!;
      expect(local.worktree).toBe(worktree);
      expect(local.blocked).toBeUndefined();
      expect(inventory.groups[0]!.remotes[0]?.merged).toBe(true);
      await expect(service.prune(repo, { confirmed: false, targets: [select(local)] }, () => [])).rejects.toThrow();
      const result = await service.prune(repo, { confirmed: true, targets: [select(local)] }, () => []);
      expect(result).toStrictEqual({ deleted: [local.id], failed: [] });
      await expect(access(worktree)).rejects.toThrow();
      await expect(git(repo, ['show-ref', '--verify', 'refs/heads/feat/done'])).rejects.toThrow();
      expect((await git(remote, ['show-ref', '--verify', 'refs/heads/feat/done'])).stdout).toContain('refs/heads/feat/done');
    });
  });

  it('rejects a changed selection before removing any item, and protects ignored files and agent folders', async () => {
    await fixture(async ({ repo, worktree, service }) => {
      const inventory = await service.inventory(repo, []);
      await writeFile(join(worktree, 'notes.txt'), 'keep');
      const result = await service.prune(repo, { confirmed: true, targets: inventory.groups.map(group => select(group.local!)) }, () => []);
      expect(result.deleted).toStrictEqual([]);
      expect(result.failed.length).toBeGreaterThan(0);
      expect((await git(repo, ['show-ref', '--verify', 'refs/heads/feat/local'])).stdout).toContain('feat/local');
      await rm(join(worktree, 'notes.txt'));
      const used = await service.inventory(repo, [{ folder: join(worktree, 'src'), name: 'Ada' }]);
      expect(used.groups.find(group => group.branch === 'feat/done')!.local?.blocked).toBe('inUse');
      await writeFile(join(repo, '.git', 'info', 'exclude'), 'secret.env\n');
      await writeFile(join(worktree, 'secret.env'), 'private');
      const ignored = await service.inventory(repo, []);
      expect(ignored.groups.find(group => group.branch === 'feat/done')!.local?.blocked).toBe('changes');
      await access(join(worktree, 'secret.env'));
    });
  });

  it('excludes all ignored entries and node_modules from counts while counting changes once', async () => {
    await fixture(async ({ repo, worktree, service }) => {
      await writeFile(join(repo, '.git', 'info', 'exclude'), 'deps/\nnode_modules/\n');
      await mkdir(join(worktree, 'deps'));
      for (const name of ['a', 'b', 'c']) await writeFile(join(worktree, 'deps', name), name);
      for (const directory of ['node_modules', 'packages/web/node_modules']) {
        await mkdir(join(worktree, directory), { recursive: true });
        await writeFile(join(worktree, directory, 'package.json'), '{}');
      }
      const read = async () => (await service.inventory(repo, [])).groups.find(group => group.branch === 'feat/done')!.local!;
      expect(await read()).toMatchObject({ merged: true, blocked: 'changes', changedFiles: 0, uncommittedFiles: 0 });
      await git(worktree, ['mv', 'file.txt', 'renamed.txt']);
      await writeFile(join(worktree, 'new file.txt'), 'untracked work');
      await mkdir(join(worktree, 'node_modules-not-dependencies'));
      await writeFile(join(worktree, 'node_modules-not-dependencies', 'keep.txt'), 'work');
      const dirty = await read();
      expect(dirty).toMatchObject({ merged: true, blocked: 'changes', changedFiles: 3, uncommittedFiles: 3 });
      expect((await service.prune(repo, { confirmed: true, targets: [select(dirty)] }, () => [])).deleted).toStrictEqual([]);
      await access(join(worktree, 'node_modules', 'package.json'));
      await access(join(worktree, 'new file.txt'));
    });
  });

  it('protects only the default branch of each remote', async () => {
    await fixture(async ({ repo, service }) => {
      await git(repo, ['push', 'origin', 'main:develop']);
      const names = targets(await service.inventory(repo, [])).filter(item => item.kind === 'remote').map(item => item.name);
      expect(names).toContain('origin/develop');
      expect(names).not.toContain('origin/main');
    });
  });

  it('revalidates branch heads and live remote heads rather than trusting stale tracking refs', async () => {
    await fixture(async ({ repo, remote, service }) => {
      const inventory = await service.inventory(repo, []);
      const remoteTarget = inventory.groups[0]!.remotes[0]!;
      await git(repo, ['checkout', '-b', 'feat/new']);
      await writeFile(join(repo, 'new.txt'), 'new');
      await git(repo, ['add', '.']);
      await git(repo, ['commit', '-m', 'unmerged']);
      const head = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
      await git(repo, ['push', 'origin', 'feat/new']);
      await git(remote, ['update-ref', 'refs/heads/feat/done', head]);
      await git(repo, ['checkout', 'main']);
      const result = await service.prune(repo, { confirmed: true, targets: [select(remoteTarget)] }, () => []);
      expect(result.deleted).toStrictEqual([]);
      expect(result.failed).toHaveLength(1);
      expect((await git(remote, ['rev-parse', 'refs/heads/feat/done'])).stdout.trim()).toBe(head);
      const local = inventory.groups.find(group => group.branch === 'feat/local')!.local!;
      await git(repo, ['branch', '-f', 'feat/local', head]);
      expect((await service.prune(repo, { confirmed: true, targets: [select(local)] }, () => [])).deleted).toStrictEqual([]);
    });
  });

  it('requires discard confirmation for unmerged local and remote branches', async () => {
    await fixture(async ({ repo, worktree, remote, service }) => {
      const inventory = await service.inventory(repo, []);
      const target = inventory.groups[0]!.remotes[0]!;
      expect(await service.prune(repo, { confirmed: true, targets: [select(target)] }, () => [])).toStrictEqual({ deleted: [target.id], failed: [] });
      await expect(git(remote, ['show-ref', '--verify', 'refs/heads/feat/done'])).rejects.toThrow();
      await access(worktree);
      await git(repo, ['checkout', '-b', 'feat/new']);
      await writeFile(join(repo, 'new.txt'), 'new');
      await git(repo, ['add', '.']);
      await git(repo, ['commit', '-m', 'unmerged']);
      await git(repo, ['checkout', 'main']);
      await git(repo, ['push', 'origin', 'feat/new']);
      const next = targets(await service.inventory(repo, [])).find(item => item.name === 'feat/new')!;
      expect(next.blocked).toBe('notMerged');
      expect(next.commitsAhead).toBe(1);
      expect((await service.prune(repo, { confirmed: true, targets: [select(next)] }, () => [])).deleted).toStrictEqual([]);
      const remoteNext = targets(await service.inventory(repo, [])).find(item => item.name === 'origin/feat/new')!;
      expect(remoteNext.merged).toBe(false);
      expect(remoteNext.blocked).toBeUndefined();
      expect(await service.prune(repo, { confirmed: true, force: true, targets: [select(remoteNext)] }, () => [])).toStrictEqual({ deleted: [remoteNext.id], failed: [] });
      await expect(git(remote, ['show-ref', '--verify', 'refs/heads/feat/new'])).rejects.toThrow();
      await git(repo, ['show-ref', '--verify', 'refs/heads/feat/new']);
      expect(await service.prune(repo, { confirmed: true, force: true, targets: [select(next)] }, () => [])).toStrictEqual({ deleted: [next.id], failed: [] });
      await expect(git(repo, ['show-ref', '--verify', 'refs/heads/feat/new'])).rejects.toThrow();
    });
  });

  it('leases remote deletion against a concurrent push and leaves later selections untouched', async () => {
    await fixture(async ({ repo, remote }) => {
      await git(repo, ['checkout', '-b', 'feat/advance']);
      await writeFile(join(repo, 'new.txt'), 'new');
      await git(repo, ['add', '.']);
      await git(repo, ['commit', '-m', 'advance']);
      await git(repo, ['push', 'origin', 'feat/advance']);
      const advance = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
      await git(repo, ['checkout', 'main']);
      const service = new GitPruneService(async (folder, args) => {
        if (args[0] === 'push') await git(remote, ['update-ref', 'refs/heads/feat/done', advance]);
        return git(folder, args);
      });
      const inventory = await service.inventory(repo, []);
      const selected = [inventory.groups.find(group => group.branch === 'feat/done')!.remotes[0]!, inventory.groups.find(group => group.branch === 'feat/local')!.local!];
      const result = await service.prune(repo, { confirmed: true, targets: selected.map(select) }, () => []);
      expect(result.deleted).toStrictEqual([]);
      expect(result.failed).toHaveLength(1);
      expect((await git(remote, ['rev-parse', 'refs/heads/feat/done'])).stdout.trim()).toBe(advance);
      await git(repo, ['show-ref', '--verify', 'refs/heads/feat/local']);
    });
  });

  it('keeps locked worktrees, rejects forged targets, and reports a retained branch after a partial local failure', async () => {
    await fixture(async ({ repo, worktree }) => {
      const service = new GitPruneService(async (folder, args) => {
        if (args[0] === 'branch' && args[1] === '-D') throw new Error('Ref locked');
        return git(folder, args);
      });
      await git(repo, ['worktree', 'lock', worktree]);
      const locked = (await service.inventory(repo, [])).groups.find(group => group.branch === 'feat/done')!.local!;
      expect(locked.blocked).toBe('locked');
      expect((await service.prune(repo, { confirmed: true, targets: [select(locked)] }, () => [])).deleted).toStrictEqual([]);
      const forged = await service.prune(repo, { confirmed: true, targets: [{ id: 'refs/heads/main', revision: 'fake' }] }, () => []);
      expect(forged.deleted).toStrictEqual([]);
      await git(repo, ['worktree', 'unlock', worktree]);
      const target = (await service.inventory(repo, [])).groups.find(group => group.branch === 'feat/done')!.local!;
      const result = await service.prune(repo, { confirmed: true, targets: [select(target)] }, () => []);
      expect(result.failed[0]?.message).toContain('Worktree removed');
      await expect(access(worktree)).rejects.toThrow();
      await git(repo, ['show-ref', '--verify', 'refs/heads/feat/done']);
    });
  });
});
