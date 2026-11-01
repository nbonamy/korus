import { mkdir, mkdtemp, readdir, rm, stat, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSourceRepository, requireRepositoryName } from '../create-source-repository';

describe('createSourceRepository', () => {
  it('creates an empty project folder without initializing Git', async () => {
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'app-create-repository-'));

    try {
      await expect(createSourceRepository(sourceRoot, 'new-project')).resolves.toStrictEqual({
        name: 'new-project',
        path: path.join(sourceRoot, 'new-project'),
        worktrees: [],
      });
      expect((await stat(path.join(sourceRoot, 'new-project'))).isDirectory()).toBe(true);
      expect(await readdir(path.join(sourceRoot, 'new-project'))).toStrictEqual([]);
    } finally {
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
