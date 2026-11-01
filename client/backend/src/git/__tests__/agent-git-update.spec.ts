import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { AgentGitService, type AgentGitRunner } from '../agent-git-service';

const exec = promisify(execFile);
const git: AgentGitRunner = (cwd, args) => exec('git', args, {
  cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
});

async function fixture(run: (base: string, work: string, service: AgentGitService) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'app-update-')));
  try {
    const base = join(root, 'repo');
    const work = join(root, 'work');
    await git(root, ['init', '-b', 'main', base]);
    await git(base, ['config', 'user.name', 'Update Test']);
    await git(base, ['config', 'user.email', 'update@example.invalid']);
    await writeFile(join(base, 'file.txt'), 'base');
    await git(base, ['add', '.']); await git(base, ['commit', '-m', 'base']);
    await git(base, ['worktree', 'add', '-b', 'feature', work]);
    await run(base, work, new AgentGitService(undefined, git));
  } finally { await rm(root, { recursive: true, force: true }); }
}

describe('update strategies with real Git', () => {
  it.each(['merge', 'rebase', 'ff-only'] as const)('applies %s to divergent history without changing the base or deleting work', async strategy => {
    await fixture(async (base, work, service) => {
      service.setSettingsProvider(() => ({ pull: 'git-config', update: strategy }));
      await writeFile(join(base, 'base.txt'), 'base update'); await git(base, ['add', '.']); await git(base, ['commit', '-m', 'base update']);
      await writeFile(join(work, 'work.txt'), 'work'); await git(work, ['add', '.']); await git(work, ['commit', '-m', 'work']);
      const baseHead = (await git(base, ['rev-parse', 'HEAD'])).stdout;
      const workHead = (await git(work, ['rev-parse', 'HEAD'])).stdout;
      await git(work, ['config', 'merge.ff', 'only']);
      if (strategy === 'ff-only') {
        await expect(service.updateFromBase(work)).rejects.toThrow();
        expect((await git(work, ['rev-parse', 'HEAD'])).stdout).toBe(workHead);
      } else {
        expect((await service.updateFromBase(work)).conflicts).toStrictEqual([]);
        expect(await readFile(join(work, 'base.txt'), 'utf8')).toBe('base update');
        expect((await git(work, ['rev-list', '--parents', '-n', '1', 'HEAD'])).stdout.trim().split(' ')).toHaveLength(strategy === 'merge' ? 3 : 2);
      }
      expect((await git(base, ['rev-parse', 'HEAD'])).stdout).toBe(baseHead);
      expect((await git(base, ['worktree', 'list', '--porcelain'])).stdout).toContain(work);
      expect((await git(work, ['stash', 'list'])).stdout).toBe('');
    });
  });

  it('fast-forwards from the existing base target without fetching any remote', async () => {
    await fixture(async (base, work, service) => {
      service.setSettingsProvider(() => ({ pull: 'git-config', update: 'ff-only' }));
      await git(base, ['remote', 'add', 'origin', join(base, 'missing-remote')]);
      await git(base, ['commit', '--allow-empty', '-m', 'advance']);
      expect((await service.updateFromBase(work)).conflicts).toStrictEqual([]);
      expect((await git(work, ['rev-parse', 'HEAD'])).stdout).toBe((await git(base, ['rev-parse', 'HEAD'])).stdout);
      await expect(service.updateFromBase(base)).rejects.toThrow('not a linked worktree');
    });
  });

  it.each(['continue', 'abort'] as const)('returns rebase conflicts to the existing resolution flow and supports %s', async action => {
    await fixture(async (base, work, service) => {
      service.setSettingsProvider(() => ({ pull: 'git-config', update: 'rebase' }));
      for (const [folder, content] of [[base, 'base change'], [work, 'work change']]) {
        await writeFile(join(folder!, 'file.txt'), content!); await git(folder!, ['commit', '-am', content!]);
      }
      const before = (await git(work, ['rev-parse', 'HEAD'])).stdout;
      expect((await service.updateFromBase(work)).conflicts).toStrictEqual(['file.txt']);
      if (action === 'continue') {
        await writeFile(join(work, 'file.txt'), 'resolved'); await git(work, ['add', 'file.txt']);
      }
      await git(work, ['-c', 'core.editor=true', 'rebase', `--${action}`]);
      expect((await git(work, ['branch', '--show-current'])).stdout.trim()).toBe('feature');
      expect(await readFile(join(work, 'file.txt'), 'utf8')).toBe(action === 'continue' ? 'resolved' : 'work change');
      if (action === 'abort') expect((await git(work, ['rev-parse', 'HEAD'])).stdout).toBe(before);
    });
  });

  it('does not autostash dirty files for a configured rebase', async () => {
    await fixture(async (base, work, service) => {
      service.setSettingsProvider(() => ({ pull: 'git-config', update: 'rebase' }));
      await git(base, ['commit', '--allow-empty', '-m', 'advance']);
      await writeFile(join(work, 'file.txt'), 'keep this');
      await git(work, ['config', 'rebase.autoStash', 'true']);
      await expect(service.updateFromBase(work, true)).rejects.toThrow('before updating with rebase');
      expect(await readFile(join(work, 'file.txt'), 'utf8')).toBe('keep this');
      expect((await git(work, ['stash', 'list'])).stdout).toBe('');
    });
  });

  it('rebases over untracked files when dirty updates are allowed', async () => {
    await fixture(async (base, work, service) => {
      service.setSettingsProvider(() => ({ pull: 'git-config', update: 'rebase' }));
      await writeFile(join(base, 'base.txt'), 'base update'); await git(base, ['add', '.']); await git(base, ['commit', '-m', 'base update']);
      await writeFile(join(work, 'work.txt'), 'work'); await git(work, ['add', '.']); await git(work, ['commit', '-m', 'work']);
      await writeFile(join(work, 'scratch.txt'), 'scratch');
      expect((await service.updateFromBase(work, true)).conflicts).toStrictEqual([]);
      expect(await readFile(join(work, 'scratch.txt'), 'utf8')).toBe('scratch');
      expect(await readFile(join(work, 'base.txt'), 'utf8')).toBe('base update');
    });
  });
});
