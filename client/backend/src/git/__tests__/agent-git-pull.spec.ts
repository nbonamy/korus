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

async function fixture(run: (local: string, remote: string, service: AgentGitService) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'app-pull-')));
  try {
    const remote = join(root, 'remote');
    const local = join(root, 'local');
    await git(root, ['init', '-b', 'upstream-branch', remote]);
    await git(remote, ['config', 'user.name', 'Pull Test']);
    await git(remote, ['config', 'user.email', 'pull@example.invalid']);
    await writeFile(join(remote, 'file.txt'), 'base\n');
    await git(remote, ['add', '.']);
    await git(remote, ['commit', '-m', 'base']);
    await git(root, ['clone', remote, local]);
    await git(local, ['branch', '-m', 'local-branch']);
    await git(local, ['config', 'user.name', 'Pull Test']);
    await git(local, ['config', 'user.email', 'pull@example.invalid']);
    await run(local, remote, new AgentGitService(() => new Date(), git));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('pull with real Git', () => {
  it.each(['merge', 'rebase', 'ff-only', 'git-config'] as const)('uses the saved %s strategy for divergent histories without pushing', async strategy => {
    await fixture(async (local, remote, service) => {
      service.setSettingsProvider(() => ({ pull: strategy, update: 'merge' }));
      await writeFile(join(local, 'local.txt'), 'local');
      await git(local, ['add', '.']); await git(local, ['commit', '-m', 'local']);
      await writeFile(join(remote, 'remote.txt'), 'remote');
      await git(remote, ['add', '.']); await git(remote, ['commit', '-m', 'remote']);
      const localHead = (await git(local, ['rev-parse', 'HEAD'])).stdout;
      const remoteHead = (await git(remote, ['rev-parse', 'HEAD'])).stdout;
      if (strategy === 'ff-only' || strategy === 'git-config') {
        await expect(service.pull(local)).rejects.toThrow();
        expect((await git(local, ['rev-parse', 'HEAD'])).stdout).toBe(localHead);
      } else {
        await git(local, ['config', 'pull.ff', 'only']);
        await git(local, ['config', 'pull.rebase', strategy === 'merge' ? 'true' : 'false']);
        expect((await service.pull(local)).conflicts).toStrictEqual([]);
        expect((await git(local, ['rev-list', '--parents', '-n', '1', 'HEAD'])).stdout.trim().split(' ')).toHaveLength(strategy === 'merge' ? 3 : 2);
        expect(await readFile(join(local, 'remote.txt'), 'utf8')).toBe('remote');
      }
      expect((await git(remote, ['rev-parse', 'HEAD'])).stdout).toBe(remoteHead);
      expect((await git(local, ['stash', 'list'])).stdout).toBe('');
    });
  });

  it('uses branch Git configuration on the owning checkout and fetches only its upstream remote', async () => {
    await fixture(async (local, remote, service) => {
      await git(local, ['remote', 'add', 'unrelated', join(local, 'missing-remote')]);
      await writeFile(join(local, 'local.txt'), 'local'); await git(local, ['add', '.']); await git(local, ['commit', '-m', 'local']);
      await writeFile(join(remote, 'remote.txt'), 'remote'); await git(remote, ['add', '.']); await git(remote, ['commit', '-m', 'remote']);
      await git(local, ['config', 'pull.rebase', 'false']);
      await git(local, ['config', 'branch.local-branch.rebase', 'true']);
      const remoteHead = (await git(remote, ['rev-parse', 'HEAD'])).stdout;
      expect((await service.pull(local)).conflicts).toStrictEqual([]);
      expect((await git(local, ['rev-parse', 'HEAD^'])).stdout).toBe(remoteHead);
    });
  });

  it.each(['continue', 'abort'] as const)('leaves native rebase conflicts recoverable with %s', async action => {
    await fixture(async (local, remote, service) => {
      service.setSettingsProvider(() => ({ pull: 'rebase', update: 'merge' }));
      for (const [folder, content] of [[local, 'local'], [remote, 'remote']]) {
        await writeFile(join(folder!, 'file.txt'), content!); await git(folder!, ['commit', '-am', content!]);
      }
      const before = (await git(local, ['rev-parse', 'HEAD'])).stdout;
      expect((await service.pull(local)).conflicts).toStrictEqual(['file.txt']);
      expect((await new AgentGitService(undefined, git).workflow(local)).files.some(file => file.path === 'file.txt')).toBe(true);
      if (action === 'continue') {
        await writeFile(join(local, 'file.txt'), 'resolved'); await git(local, ['add', 'file.txt']);
      }
      await git(local, ['-c', 'core.editor=true', 'rebase', `--${action}`]);
      expect((await git(local, ['branch', '--show-current'])).stdout.trim()).toBe('local-branch');
      expect(await readFile(join(local, 'file.txt'), 'utf8')).toBe(action === 'abort' ? 'local' : 'resolved');
      if (action === 'abort') expect((await git(local, ['rev-parse', 'HEAD'])).stdout).toBe(before);
    });
  });

  it('fetches the configured upstream and fast-forwards without touching unrelated dirty files', async () => {
    await fixture(async (local, remote, service) => {
      await writeFile(join(remote, 'file.txt'), 'remote update\n');
      await git(remote, ['commit', '-am', 'remote update']);
      await writeFile(join(local, 'notes.txt'), 'keep my notes\n');
      await expect(service.pull(local)).rejects.toThrow('Commit your changes');
      expect(await readFile(join(local, 'file.txt'), 'utf8')).toBe('base\n');
      await expect(service.pull(local, true)).resolves.toStrictEqual({
        upstream: 'origin/upstream-branch', branch: 'local-branch', conflicts: [],
      });
      expect(await readFile(join(local, 'file.txt'), 'utf8')).toBe('remote update\n');
      expect(await readFile(join(local, 'notes.txt'), 'utf8')).toBe('keep my notes\n');
    });
  });

  it.each([['saved rebase', 'rebase'], ['configured rebase', 'git-config']] as const)('refuses a %s pull over tracked changes without stashing, but allows untracked files', async (_label, strategy) => {
    await fixture(async (local, remote, service) => {
      service.setSettingsProvider(() => ({ pull: strategy, update: 'merge' }));
      await git(local, ['config', 'pull.rebase', 'true']);
      await writeFile(join(remote, 'remote.txt'), 'remote'); await git(remote, ['add', '.']); await git(remote, ['commit', '-m', 'remote']);
      await writeFile(join(local, 'file.txt'), 'keep this\n');
      await expect(service.pull(local, true)).rejects.toThrow('before pulling with rebase');
      expect(await readFile(join(local, 'file.txt'), 'utf8')).toBe('keep this\n');
      expect((await git(local, ['stash', 'list'])).stdout).toBe('');
      await git(local, ['checkout', '--', 'file.txt']);
      await writeFile(join(local, 'scratch.txt'), 'scratch');
      expect((await service.pull(local, true)).conflicts).toStrictEqual([]);
      expect(await readFile(join(local, 'scratch.txt'), 'utf8')).toBe('scratch');
      expect(await readFile(join(local, 'remote.txt'), 'utf8')).toBe('remote');
    });
  });

  it('leaves a divergent merge conflict for resolution, overriding rebase and ff-only preferences', async () => {
    await fixture(async (local, remote, service) => {
      for (const [folder, text] of [[local, 'local'], [remote, 'remote']]) {
        await writeFile(join(folder!, 'file.txt'), `${text}\n`);
        await git(folder!, ['commit', '-am', text!]);
      }
      service.setSettingsProvider(() => ({ pull: 'merge', update: 'merge' }));
      await git(local, ['config', 'pull.rebase', 'true']);
      await git(local, ['config', 'pull.ff', 'only']);
      await expect(service.pull(local)).resolves.toStrictEqual({
        upstream: 'origin/upstream-branch', branch: 'local-branch', conflicts: ['file.txt'],
      });
      expect(await readFile(join(local, 'file.txt'), 'utf8')).toContain('<<<<<<<');
      expect((await git(local, ['rev-parse', '--verify', 'MERGE_HEAD'])).stdout.trim()).not.toBe('');
      await expect(service.pull(local, true)).rejects.toThrow('Resolve the existing conflicts');
    });
  });

  it('rejects detached or untracked branches and does not misreport fetch errors as conflicts', async () => {
    await fixture(async (local, _remote, service) => {
      await git(local, ['remote', 'set-url', 'origin', join(local, 'missing-remote')]);
      await expect(service.pull(local)).rejects.toThrow();
      expect((await git(local, ['diff', '--name-only', '--diff-filter=U'])).stdout).toBe('');
      await git(local, ['branch', '--unset-upstream']);
      await expect(service.pull(local)).rejects.toThrow('Set an upstream');
      await git(local, ['checkout', '--detach']);
      await expect(service.pull(local)).rejects.toThrow('Check out a branch');
    });
  });
});
