import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { ReviewGit } from '../review-git';

const execute = promisify(execFile);
const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });

async function repository() {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'review-git-'));
  folders.push(folder);
  const git = async (...args: string[]) => (await execute('git', args, { cwd: folder })).stdout.trim();
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Review Test');
  await git('config', 'user.email', 'review@example.test');
  await git('config', 'commit.gpgsign', 'false');
  await writeFile(path.join(folder, 'app.txt'), 'base\n');
  await git('add', '.');
  await git('commit', '-m', 'base');
  return { folder, git, service: new ReviewGit() };
}

describe('automatic review git boundary', () => {
  it('freezes a commit baseline at its first parent, including an initial commit', async () => {
    const { folder, git, service } = await repository();
    const initial = await git('rev-parse', 'HEAD');
    const root = await service.prepare(folder, { type: 'commit', sha: initial });
    expect(await git('diff', root.baseRef, initial, '--', 'app.txt')).toContain('+base');
    await writeFile(path.join(folder, 'app.txt'), 'latest\n');
    await git('commit', '-am', 'latest');
    const latest = await git('rev-parse', 'HEAD');
    expect((await service.prepare(folder, { type: 'commit', sha: latest })).baseRef).toBe(initial);
    expect(await service.hasChanges(folder)).toBe(false);
  });

  it('freezes the branch baseline and commits reviewed tracked and untracked changes without pushing', async () => {
    const { folder, git, service } = await repository();
    const base = await git('rev-parse', 'HEAD');
    await git('checkout', '-b', 'feature');
    await writeFile(path.join(folder, 'app.txt'), 'feature\n');
    await git('commit', '-am', 'feature');
    const prepared = await service.prepare(folder, { type: 'branch', baseRef: 'main' });
    expect(prepared.baseRef).toBe(base);
    await writeFile(path.join(folder, 'app.txt'), 'fixed\n');
    await writeFile(path.join(folder, ':literal.txt'), 'new\n');
    const result = await service.commit(folder, await service.inspect(folder), 1);
    expect(result.commit).not.toBe(prepared.head);
    expect(await git('status', '--porcelain')).toBe('');
    expect(await git('show', 'HEAD::literal.txt')).toBe('new');
    expect(await git('diff', prepared.baseRef, '--', 'app.txt')).toContain('+fixed');
    expect(await git('remote')).toBe('');
  });

  it.each(['contents', 'branch'])('refuses a commit when %s changed after validation', async change => {
    const { folder, git, service } = await repository();
    await writeFile(path.join(folder, 'app.txt'), 'validated\n');
    const validated = await service.inspect(folder);
    if (change === 'contents') await writeFile(path.join(folder, 'app.txt'), 'concurrent edit\n');
    else await git('checkout', '-b', 'other-branch');
    await expect(service.commit(folder, validated, 1)).rejects.toThrow('workspace changed');
    expect(await git('rev-parse', 'HEAD')).toBe(validated.head);
    expect(await readFile(path.join(folder, 'app.txt'), 'utf8')).toBe(change === 'contents' ? 'concurrent edit\n' : 'validated\n');
  });

  it('reports tracked, staged, and untracked changes but not a clean workspace', async () => {
    const { folder, git, service } = await repository();
    expect(await service.hasChanges(folder)).toBe(false);
    await writeFile(path.join(folder, 'new.txt'), 'new\n');
    expect(await service.hasChanges(folder)).toBe(true);
    await git('add', 'new.txt');
    await git('commit', '-m', 'add new');
    expect(await service.hasChanges(folder)).toBe(false);
    await writeFile(path.join(folder, 'app.txt'), 'edited\n');
    expect(await service.hasChanges(folder)).toBe(true);
  });

  it('ignores embedded repositories instead of failing to fingerprint or committing them', async () => {
    const { folder, git, service } = await repository();
    await mkdir(path.join(folder, 'nested'));
    await execute('git', ['init', '-b', 'main'], { cwd: path.join(folder, 'nested') });
    await writeFile(path.join(folder, 'nested', 'inner.txt'), 'inner\n');
    await writeFile(path.join(folder, 'app.txt'), 'fix\n');
    const validated = await service.inspect(folder);
    const result = await service.commit(folder, validated, 1);
    expect(result.commit).not.toBe(validated.head);
    expect(await git('show', '--name-only', '--format=', 'HEAD')).toBe('app.txt');
    expect(await git('status', '--porcelain')).toBe('?? nested/');
  });

  it('explains that automatic review needs a checked-out branch on a detached HEAD', async () => {
    const { git, service, folder } = await repository();
    await git('checkout', '--detach');
    await expect(service.prepare(folder, { type: 'uncommitted' })).rejects.toThrow('checked-out branch');
  });

  it('does not commit outside an agent subfolder or bypass a failing commit hook', async () => {
    const { folder, git, service } = await repository();
    await mkdir(path.join(folder, 'subfolder'));
    await expect(service.prepare(path.join(folder, 'subfolder'), { type: 'uncommitted' })).rejects.toThrow('repository root');
    await writeFile(path.join(folder, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    await writeFile(path.join(folder, 'app.txt'), 'fix\n');
    const validated = await service.inspect(folder);
    await expect(service.commit(folder, validated, 1)).rejects.toThrow();
    expect(await git('rev-parse', 'HEAD')).toBe(validated.head);
    expect(await readFile(path.join(folder, 'app.txt'), 'utf8')).toBe('fix\n');
  });
});
