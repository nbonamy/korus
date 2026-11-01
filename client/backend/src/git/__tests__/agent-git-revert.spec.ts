import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { AgentGitService, type AgentGitRunner } from '../agent-git-service';

const exec = promisify(execFile);
const git: AgentGitRunner = (cwd, args) => exec('git', args, {
  cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
});

async function fixture(run: (folder: string, service: AgentGitService) => Promise<void>) {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'app-revert-')));
  try {
    await git(folder, ['init', '-b', 'main']);
    await git(folder, ['config', 'user.name', 'Revert Test']);
    await git(folder, ['config', 'user.email', 'revert@example.invalid']);
    await run(folder, new AgentGitService(() => new Date(), git));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

describe('revert with real Git', () => {
  it.each([false, true])('discards staged and unstaged changes; includeUntracked=%s', async (includeUntracked) => {
    await fixture(async (folder, service) => {
      await writeFile(join(folder, 'tracked.txt'), 'committed\n');
      await writeFile(join(folder, 'deleted.txt'), 'restore me\n');
      await writeFile(join(folder, '.gitignore'), 'ignored.txt\n');
      await git(folder, ['add', '.']);
      await git(folder, ['commit', '-m', 'base']);
      const head = (await git(folder, ['rev-parse', 'HEAD'])).stdout;
      await writeFile(join(folder, 'tracked.txt'), 'staged\n');
      await git(folder, ['add', 'tracked.txt']);
      await writeFile(join(folder, 'tracked.txt'), 'unstaged\n');
      await rm(join(folder, 'deleted.txt'));
      await mkdir(join(folder, 'scratch'));
      await writeFile(join(folder, 'scratch', 'notes.txt'), 'unversioned\n');
      await writeFile(join(folder, 'ignored.txt'), 'private\n');
      // Respect the user's current ignore rules, even when those rules are reverted.
      await writeFile(join(folder, '.gitignore'), 'ignored.txt\nlocal-secret.txt\n');
      await writeFile(join(folder, 'local-secret.txt'), 'keep private\n');
      await git(folder, ['init', '-b', 'main', 'nested-repo']);
      await writeFile(join(folder, 'nested-repo', 'keep.txt'), 'nested\n');

      await service.revert(join(folder, 'scratch'), includeUntracked);

      expect(await readFile(join(folder, 'tracked.txt'), 'utf8')).toBe('committed\n');
      expect(await readFile(join(folder, 'deleted.txt'), 'utf8')).toBe('restore me\n');
      expect((await git(folder, ['diff', 'HEAD'])).stdout).toBe('');
      expect((await git(folder, ['rev-parse', 'HEAD'])).stdout).toBe(head);
      expect(await readFile(join(folder, 'ignored.txt'), 'utf8')).toBe('private\n');
      expect(await readFile(join(folder, 'local-secret.txt'), 'utf8')).toBe('keep private\n');
      expect(await readFile(join(folder, 'nested-repo', 'keep.txt'), 'utf8')).toBe('nested\n');
      if (includeUntracked) {
        await expect(readFile(join(folder, 'scratch', 'notes.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
      } else {
        expect(await readFile(join(folder, 'scratch', 'notes.txt'), 'utf8')).toBe('unversioned\n');
      }
    });
  });

  it('does not delete files when there is no commit to restore', async () => {
    await fixture(async (folder, service) => {
      await writeFile(join(folder, 'notes.txt'), 'keep\n');
      await expect(service.revert(folder, true)).rejects.toThrow();
      expect(await readFile(join(folder, 'notes.txt'), 'utf8')).toBe('keep\n');
    });
  });
});
