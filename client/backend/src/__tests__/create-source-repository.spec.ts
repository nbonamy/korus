import { mkdir, mkdtemp, readdir, rm, stat, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { createSourceRepository, requireRepositoryName } from '../create-source-repository';
import { AgentGitService } from '../git/agent-git-service';

const exec = promisify(execFile);

describe('createSourceRepository', () => {
  it('creates a local Git repository recognized without commits or a remote', async () => {
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'app-create-repository-'));

    try {
      await expect(createSourceRepository(sourceRoot, 'new-project')).resolves.toStrictEqual({
        name: 'new-project',
        path: path.join(sourceRoot, 'new-project'),
        worktrees: [],
      });
      expect((await stat(path.join(sourceRoot, 'new-project'))).isDirectory()).toBe(true);
      const folder = path.join(sourceRoot, 'new-project');
      expect(await readdir(folder)).toStrictEqual(['.git']);
      expect(await new AgentGitService().identity(folder)).toMatchObject({ kind: 'git', isLinkedWorktree: false });
      expect((await exec('git', ['remote'], { cwd: folder })).stdout.trim()).toBe('');
      expect((await exec('git', ['rev-list', '--all', '--count'], { cwd: folder })).stdout.trim()).toBe('0');
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
    }
  });

  it('tolerates a missing Git executable but surfaces other initialization failures', async () => {
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'app-create-repository-git-'));
    try {
      vi.stubEnv('PATH', sourceRoot);
      await expect(createSourceRepository(sourceRoot, 'without-git')).resolves.toMatchObject({ name: 'without-git' });
      expect(await readdir(path.join(sourceRoot, 'without-git'))).toStrictEqual([]);
      vi.unstubAllEnvs();
      vi.stubEnv('GIT_CONFIG_COUNT', '1');
      vi.stubEnv('GIT_CONFIG_KEY_0', 'init.defaultBranch');
      vi.stubEnv('GIT_CONFIG_VALUE_0', 'invalid branch name');
      await expect(createSourceRepository(sourceRoot, 'broken-git')).rejects.toMatchObject({ code: 128 });
    } finally {
      vi.unstubAllEnvs();
      await rm(sourceRoot, { recursive: true, force: true });
    }
  });

  it('rejects an existing destination and preserves its contents', async () => {
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'app-create-repository-existing-'));
    await mkdir(path.join(sourceRoot, 'existing'));
    await writeFile(path.join(sourceRoot, 'existing', 'notes.txt'), 'keep me');

    try {
      await expect(createSourceRepository(sourceRoot, 'existing')).rejects.toThrow('existing already exists');
      expect(await readFile(path.join(sourceRoot, 'existing', 'notes.txt'), 'utf8')).toBe('keep me');
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
    }
  });

  it('accepts only one non-empty folder name', () => {
    expect(requireRepositoryName(' project ')).toBe('project');
    expect(() => requireRepositoryName('')).toThrow('Project name is required');
    expect(() => requireRepositoryName('../project')).toThrow('single folder name');
    expect(() => requireRepositoryName('nested/project')).toThrow('single folder name');
  });
});
