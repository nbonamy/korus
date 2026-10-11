import { execFile } from 'node:child_process';
import { mkdtemp, open, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BranchCurrentWorkService } from '../branch-current-work-service';
import { AgentGitService } from '../agent-git-service';
import type { Agent } from '@workspace/core/contracts';

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'korus-branch-test-')); roots.push(root);
  const source = join(root, 'source');
  await exec('git', ['init', '-b', 'main', source]);
  const git = async (...args: string[]) => (await exec('git', args, { cwd: source })).stdout.trim();
  await git('config', 'user.name', 'Branch Tester'); await git('config', 'user.email', 'branch@example.test');
  for (const file of ['staged', 'mixed', 'deleted', 'other']) await writeFile(join(source, file), 'original\n');
  await writeFile(join(source, '.gitignore'), 'ignored\n');
  await git('add', '.'); await git('commit', '-m', 'initial');
  const head = await git('rev-parse', 'HEAD');
  await writeFile(join(source, 'staged'), 'staged\n'); await writeFile(join(source, 'mixed'), 'indexed\n');
  await git('add', 'staged', 'mixed'); await writeFile(join(source, 'mixed'), 'final\n');
  await rm(join(source, 'deleted')); await writeFile(join(source, 'other'), 'unrelated\n');
  await writeFile(join(source, 'new file'), 'new\n'); await writeFile(join(source, 'ignored'), 'ignored\n');
  await writeFile(join(source, '.env'), 'synthetic-secret\n');
  const agent = { id: 'parent', folder: source } as Agent;
  const provision = vi.fn(async () => ({ taskId: 'task', agentId: 'worker', accepted: true }));
  const service = new BranchCurrentWorkService({ git: new AgentGitService(), provision });
  const preview = await service.preview(source);
  const input = { confirmed: true as const, requestId: 'request', snapshotId: preview.snapshotId, branchName: 'feature/work', paths: ['staged', 'mixed', 'deleted', 'new file'], message: 'feat: current work', prompt: 'Finish this work' };
  return { root, source, git, head, agent, provision, service, preview, input };
}

describe('BranchCurrentWorkService', () => {
  it('commits selected staged/unstaged/deleted/untracked files from captured HEAD and clears only transferred work', async () => {
    const f = await fixture();
    expect(f.preview.files.find(file => file.path === '.env')?.sensitive).toBe(true);
    expect(f.preview.files.some(file => file.path === 'ignored')).toBe(false);
    const result = await f.service.execute(f.agent, f.input);
    expect(result.state, result.detail).toBe('completed');
    const destinationGit = async (...args: string[]) => (await exec('git', args, { cwd: result.folder })).stdout.trim();
    expect(await destinationGit('rev-parse', 'HEAD^')).toBe(f.head);
    expect(await destinationGit('show', 'HEAD:mixed')).toBe('final');
    expect(await destinationGit('show', 'HEAD:new file')).toBe('new');
    expect(await destinationGit('show', 'HEAD:other')).toBe('original');
    expect(await destinationGit('show', '-s', '--format=%an <%ae>')).toBe('Branch Tester <branch@example.test>');
    expect(await destinationGit('status', '--porcelain')).toBe('');
    expect(await f.git('rev-parse', 'HEAD')).toBe(f.head);
    expect(await f.git('status', '--porcelain')).toBe('M other\n?? .env');
    expect(await readFile(join(f.source, 'ignored'), 'utf8')).toBe('ignored\n');
    expect(await readFile(join(result.sourceBackupFolder!, 'mixed'), 'utf8')).toBe('final\n');
    await expect(readFile(join(result.folder!, '.env'))).rejects.toThrow();
    const retry = await new BranchCurrentWorkService({ git: new AgentGitService(), provision: f.provision }).execute(f.agent, f.input);
    expect(retry).toStrictEqual(result); expect(f.provision).toHaveBeenCalledOnce();
  });
});

describe('transfer safety and recovery', () => {
  it.each(['invalid branch', 'branch collision', 'destination collision', 'stale preview', 'ignored path', 'traversal', 'conflict'] as const)('rejects %s before creating work or provisioning', async scenario => {
    const f = await fixture();
    if (scenario === 'invalid branch') f.input.branchName = 'bad..name';
    if (scenario === 'branch collision') await f.git('branch', f.input.branchName);
    if (scenario === 'destination collision') await writeFile(join(f.root, 'source-feature-work'), 'occupied');
    if (scenario === 'stale preview') await writeFile(join(f.source, 'mixed'), 'new edit\n');
    if (scenario === 'ignored path') f.input.paths = ['ignored'];
    if (scenario === 'traversal') f.input.paths = ['../outside'];
    if (scenario === 'conflict') await writeFile(join(f.source, '.git', 'MERGE_HEAD'), f.head);
    const before = await f.git('status', '--porcelain');
    await expect(f.service.execute(f.agent, f.input)).rejects.toThrow();
    expect(await f.git('status', '--porcelain')).toBe(before);
    expect(f.provision).not.toHaveBeenCalled();
    expect((await f.git('worktree', 'list', '--porcelain')).match(/worktree /g)).toHaveLength(1);
  });

  it('retains source work after a real failing commit hook and retries without another worktree', async () => {
    const f = await fixture();
    const hook = join(f.source, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const before = await f.git('status', '--porcelain');
    const failed = await f.service.execute(f.agent, f.input);
    expect(failed.state).toBe('recovery'); expect(failed.commit).toBeUndefined();
    expect(await f.git('status', '--porcelain')).toBe(before); expect(f.provision).not.toHaveBeenCalled();
    await rm(hook);
    const retry = await f.service.execute(f.agent, f.input);
    expect(retry.state).toBe('completed');
    expect((await f.git('worktree', 'list', '--porcelain')).match(/worktree /g)).toHaveLength(2);
  });

  it('retains work after provisioning failure and reuses the commit on retry', async () => {
    const f = await fixture(); f.provision.mockRejectedValueOnce(new Error('Cannot persist agent'));
    const before = await f.git('status', '--porcelain');
    const failed = await f.service.execute(f.agent, f.input);
    expect(failed.state).toBe('recovery'); expect(failed.commit).toBeTruthy();
    expect(await f.git('status', '--porcelain')).toBe(before);
    const restored = new BranchCurrentWorkService({ git: new AgentGitService(), provision: f.provision });
    expect((await restored.preview(f.source, f.agent.id)).recoveries).toStrictEqual([{ input: f.input, result: failed }]);
    const results = await Promise.all([f.service.execute(f.agent, f.input), f.service.execute(f.agent, f.input)]);
    expect(results[0]).toStrictEqual(results[1]); expect(results[0]?.commit).toBe(failed.commit);
    expect(f.provision).toHaveBeenCalledTimes(2);
    await expect(f.service.execute(f.agent, { ...f.input, prompt: 'Different task' })).rejects.toThrow('different transfer');
  });

  it('preserves newer selected edits and staged changes made while provisioning', async () => {
    const f = await fixture();
    f.provision.mockImplementationOnce(async () => {
      await writeFile(join(f.source, 'mixed'), 'newer\n');
      await f.git('add', 'mixed');
      return { taskId: 'task', agentId: 'worker', accepted: true };
    });
    const result = await f.service.execute(f.agent, f.input);
    expect(result.state, result.detail).toBe('completed'); expect(result.retainedPaths).toStrictEqual(['mixed']);
    expect(await readFile(join(f.source, 'mixed'), 'utf8')).toBe('newer\n');
    expect(await f.git('diff', '--cached', '--name-only')).toBe('mixed');
  });

  it('does not clean up when provider acceptance is uncertain', async () => {
    const f = await fixture(); f.provision.mockResolvedValue({ taskId: 'task', agentId: 'worker', accepted: false });
    const before = await f.git('status', '--porcelain');
    const result = await f.service.execute(f.agent, f.input);
    expect(result.state).toBe('recovery'); expect(result.agentId).toBe('worker');
    expect(await f.git('status', '--porcelain')).toBe(before);
  });
});

describe('file and checkout boundaries', () => {
  it('transfers staged additions/deletions, renames, binary content, and literal pathspecs', async () => {
    const f = await fixture();
    await f.git('mv', 'other', 'renamed');
    await writeFile(join(f.source, 'addition'), 'added\n'); await f.git('add', 'addition');
    await f.git('rm', 'deleted');
    const binary = Buffer.from([0, 1, 2, 255]);
    await writeFile(join(f.source, ':(glob)*'), binary);
    const preview = await f.service.preview(f.source);
    expect(preview.files.map(file => file.path)).toContain('other');
    const result = await f.service.execute(f.agent, { ...f.input, snapshotId: preview.snapshotId, paths: ['other', 'renamed', 'addition', 'deleted', ':(glob)*'] });
    expect(result.state, result.detail).toBe('completed');
    expect(await readFile(join(result.folder, ':(glob)*'))).toStrictEqual(binary);
    expect(await readFile(join(result.folder, 'renamed'), 'utf8')).toBe('unrelated\n');
    expect(await f.git('diff', '--cached', '--name-only')).toBe('mixed\nstaged');
    expect(await readFile(join(f.source, 'other'), 'utf8')).toBe('original\n');
  });

  it('never clears source work if HEAD changes while the new agent starts', async () => {
    const f = await fixture();
    f.provision.mockImplementationOnce(async () => {
      await f.git('commit', '--allow-empty', '-m', 'concurrent commit');
      return { taskId: 'task', agentId: 'worker', accepted: true };
    });
    const result = await f.service.execute(f.agent, f.input);
    expect(result.state).toBe('recovery'); expect(result.detail).toContain('Source HEAD changed');
    expect(await readFile(join(f.source, 'mixed'), 'utf8')).toBe('final\n');
  });

  it('preserves net-zero staging state rather than claiming it was transferred', async () => {
    const f = await fixture(); await writeFile(join(f.source, 'staged'), 'original\n');
    const preview = await f.service.preview(f.source);
    await expect(f.service.execute(f.agent, { ...f.input, snapshotId: preview.snapshotId, paths: ['staged'] })).rejects.toThrow('no final changes');
    expect(await f.git('diff', '--cached', '--name-only')).toBe('mixed\nstaged');
    expect(f.provision).not.toHaveBeenCalled();
  });
});


describe('source cleanup races', () => {
  it('retains edits through an open file descriptor in the reported recovery copies', async () => {
    const f = await fixture();
    const descriptor = await open(join(f.source, 'mixed'), 'r+');
    try {
      const result = await f.service.execute(f.agent, { ...f.input, paths: ['mixed'] });
      expect(result.state, result.detail).toBe('completed');
      await descriptor.writeFile('late editor write\n');
      expect(await readFile(join(f.source, 'mixed'), 'utf8')).toBe('original\n');
      expect(await readFile(join(result.sourceBackupFolder!, 'mixed'), 'utf8')).toBe('late editor write\n');
    } finally { await descriptor.close(); }
  });
});


describe('worktree identity', () => {
  it('branches from a linked checkout HEAD without changing the primary checkout', async () => {
    const f = await fixture(); const linked = join(f.root, 'linked');
    await f.git('worktree', 'add', '-b', 'source-feature', linked);
    await exec('git', ['commit', '--allow-empty', '-m', 'source tip'], { cwd: linked });
    const sourceHead = (await exec('git', ['rev-parse', 'HEAD'], { cwd: linked })).stdout.trim();
    await writeFile(join(linked, 'mixed'), 'linked feature\n');
    const before = await f.git('status', '--porcelain');
    const preview = await f.service.preview(linked);
    const result = await f.service.execute({ ...f.agent, folder: linked }, { ...f.input, snapshotId: preview.snapshotId, paths: ['mixed'] });
    expect(result.state, result.detail).toBe('completed');
    expect((await exec('git', ['rev-parse', 'HEAD^'], { cwd: result.folder })).stdout.trim()).toBe(sourceHead);
    expect(await f.git('status', '--porcelain')).toBe(before);
    expect(await f.git('branch', '--show-current')).toBe('main');
  });

  it('retains work and refuses to mutate a destination whose transfer ownership is unconfirmed', async () => {
    const f = await fixture(); const hook = join(f.source, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const failed = await f.service.execute(f.agent, f.input);
    const marker = (await exec('git', ['rev-parse', '--path-format=absolute', '--git-path', 'korus-branch-transfer'], { cwd: failed.folder })).stdout.trim();
    await rm(marker); await rm(hook);
    const before = await f.git('status', '--porcelain');
    const retry = await f.service.execute(f.agent, f.input);
    expect(retry.state).toBe('recovery'); expect(retry.detail).toContain('ownership is unconfirmed');
    expect(await f.git('status', '--porcelain')).toBe(before);
    expect((await exec('git', ['rev-parse', 'HEAD'], { cwd: failed.folder })).stdout.trim()).toBe(f.head);
    expect(f.provision).not.toHaveBeenCalled();
  });

  it('transfers symlink values without copying or altering their external targets', async () => {
    const f = await fixture(); const external = join(f.root, 'external');
    await writeFile(external, 'private target\n');
    await symlink(external, join(f.source, 'link'));
    const preview = await f.service.preview(f.source);
    const result = await f.service.execute(f.agent, { ...f.input, snapshotId: preview.snapshotId, paths: ['link'] });
    expect(result.state, result.detail).toBe('completed');
    expect(await readlink(join(result.folder, 'link'))).toBe(external);
    expect(await readFile(external, 'utf8')).toBe('private target\n');
    await expect(readlink(join(f.source, 'link'))).rejects.toThrow();
  });
});
