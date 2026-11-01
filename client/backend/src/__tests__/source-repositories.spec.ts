import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listSourceFolders } from '../source-folders';
import {
  resolveSourceFolderPath,
  scanSourceRepositories,
  sourceFolderCandidates,
  sourceFolderPathExists,
} from '../source-repositories';

describe('source repository discovery', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-source-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns no repositories for empty, invalid, or plain folders', async () => {
    await mkdir(path.join(tempDir, 'plain-folder'));

    await expect(scanSourceRepositories(tempDir)).resolves.toStrictEqual([]);
    await expect(scanSourceRepositories(path.join(tempDir, 'missing'))).resolves.toStrictEqual([]);
  });

  it('finds direct child git clones sorted by name', async () => {
    await createClone('zeta');
    await createClone('alpha', 'develop');

    await expect(scanSourceRepositories(tempDir)).resolves.toStrictEqual([
      {
        name: 'alpha',
        path: path.join(tempDir, 'alpha'),
        remoteIdentity: 'github.com/example/alpha',
        worktrees: [{ name: 'develop', path: path.join(tempDir, 'alpha') }],
      },
      {
        name: 'zeta',
        path: path.join(tempDir, 'zeta'),
        remoteIdentity: 'github.com/example/zeta',
        worktrees: [{ name: 'main', path: path.join(tempDir, 'zeta') }],
      },
    ]);
  });

  it('falls back to the folder name for detached or missing HEAD', async () => {
    await createClone('detached', 'abc123def456');
    await createClone('missing-head', null);

    const repos = await scanSourceRepositories(tempDir);

    expect(repos.map((repo) => repo.worktrees[0]?.name)).toStrictEqual(['detached', 'missing-head']);
  });

  it('groups sibling worktrees under the parent clone and strips repo prefixes', async () => {
    await createClone('witsy');
    await createWorktree('witsy-feature-a', 'witsy');
    await createWorktree('unrelated-name', 'witsy');

    await expect(scanSourceRepositories(tempDir)).resolves.toStrictEqual([
      {
        name: 'witsy',
        path: path.join(tempDir, 'witsy'),
        remoteIdentity: 'github.com/example/witsy',
        worktrees: [
          { name: 'main', path: path.join(tempDir, 'witsy') },
          { name: 'feature-a', path: path.join(tempDir, 'witsy-feature-a') },
          { name: 'unrelated-name', path: path.join(tempDir, 'unrelated-name') },
        ],
      },
    ]);
  });

  it('ignores worktrees whose parent clone is outside the source folder', async () => {
    await mkdir(path.join(tempDir, 'orphan'), { recursive: true });
    await writeFile(path.join(tempDir, 'orphan', '.git'), 'gitdir: /outside/repo/.git/worktrees/orphan\n');

    await expect(scanSourceRepositories(tempDir)).resolves.toStrictEqual([]);
  });

  it('expands tilde paths and validates configured folders', async () => {
    expect(sourceFolderCandidates().slice(0, 4)).toStrictEqual(['~/src', '~/code', '~/dev', '~/sources']);
    expect(resolveSourceFolderPath('~/src')).toBe(path.join(os.homedir(), 'src'));
    await expect(sourceFolderPathExists(tempDir)).resolves.toBe(true);
    await expect(sourceFolderPathExists(path.join(tempDir, 'missing'))).resolves.toBe(false);
  });

  it('lists child folders for remote folder picking', async () => {
    await mkdir(path.join(tempDir, 'zeta'));
    await mkdir(path.join(tempDir, 'alpha'));
    await writeFile(path.join(tempDir, 'README.md'), '# Read me\n');

    await expect(listSourceFolders(tempDir)).resolves.toStrictEqual({
      path: tempDir,
      parentPath: path.dirname(tempDir),
      entries: [
        { name: 'alpha', path: path.join(tempDir, 'alpha') },
        { name: 'zeta', path: path.join(tempDir, 'zeta') },
      ],
    });
  });

  async function createClone(name: string, branch: string | null = 'main'): Promise<void> {
    const gitPath = path.join(tempDir, name, '.git');
    await mkdir(gitPath, { recursive: true });
    await writeFile(path.join(gitPath, 'config'), `[remote "origin"]\n\turl = https://token@github.com/example/${name}.git\n`);
    if (branch === null) {
      return;
    }

    const head = branch.startsWith('ref: ') || /^[a-f0-9]{7,}$/i.test(branch)
      ? `${branch}\n`
      : `ref: refs/heads/${branch}\n`;
    await writeFile(path.join(gitPath, 'HEAD'), head);
  }

  async function createWorktree(name: string, parentRepo: string): Promise<void> {
    await mkdir(path.join(tempDir, name), { recursive: true });
    await writeFile(
      path.join(tempDir, name, '.git'),
      `gitdir: ${path.join(tempDir, parentRepo, '.git', 'worktrees', name)}\n`,
    );
  }
});
