import { execFile } from 'node:child_process';
import { mkdtemp, open, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BranchCurrentWorkService } from '../branch-current-work-service';
import type { BranchWorkInput } from '@workspace/core/branch-current-work';
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
  const provision = vi.fn(async (_agent: Agent, _input: BranchWorkInput, _folder: string, _agentId: string) => undefined);
  const progress = vi.fn();
  const service = new BranchCurrentWorkService({ provision, progress });
  const preview = await service.preview(source);
  const input = { confirmed: true as const, requestId: 'request', snapshotId: preview.snapshotId, branchName: 'feature/work' };
  return { root, source, git, head, agent, provision, service, progress, preview, input };
}

describe('BranchCurrentWorkService', () => {
  it('moves all changes without commits, preserving staged/unstaged state and leaving ignored files behind', async () => {
    const f = await fixture();
    await writeFile(join(f.source, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const before = await f.git('status', '--porcelain');
    const staged = await f.git('diff', '--cached', '--binary');
    const unstaged = await f.git('diff', '--binary');
    const result = await f.service.execute(f.agent, f.input);
    expect(result.state, result.detail).toBe('completed');
    expect(f.progress.mock.calls.map(([value]) => ({ id: value.id, agentId: value.agentId, state: value.state, phase: value.phase }))).toStrictEqual([
      { id: 'request', agentId: 'parent', state: 'running', phase: 'creatingWorktree' },
      { id: 'request', agentId: 'parent', state: 'running', phase: 'movingChanges' },
      { id: 'request', agentId: 'parent', state: 'running', phase: 'creatingAgent' },
      { id: 'request', agentId: 'parent', state: 'running', phase: 'resettingSource' },
      { id: 'request', agentId: 'parent', state: 'success', phase: 'resettingSource' },
    ]);
    const destinationGit = async (...args: string[]) => (await exec('git', args, { cwd: result.folder })).stdout.trim();
    expect(await destinationGit('rev-parse', 'HEAD')).toBe(f.head);
    expect(await destinationGit('status', '--porcelain')).toBe(before);
    expect(await destinationGit('diff', '--cached', '--binary')).toBe(staged);
    expect(await destinationGit('diff', '--binary')).toBe(unstaged);
    expect(await readFile(join(result.folder, 'mixed'), 'utf8')).toBe('final\n');
    expect(await readFile(join(result.folder, 'new file'), 'utf8')).toBe('new\n');
    expect(await readFile(join(result.folder, '.env'), 'utf8')).toBe('synthetic-secret\n');
    await expect(readFile(join(result.folder, 'ignored'))).rejects.toThrow();
    expect(await f.git('rev-parse', 'HEAD')).toBe(f.head);
    expect(await f.git('status', '--porcelain')).toBe('');
    expect(await readFile(join(f.source, 'ignored'), 'utf8')).toBe('ignored\n');
    expect(await readFile(join(result.sourceBackupFolder!, 'mixed'), 'utf8')).toBe('final\n');
    const retry = await new BranchCurrentWorkService({ provision: f.provision }).execute(f.agent, f.input);
    expect(retry).toStrictEqual(result); expect(f.provision).toHaveBeenCalledOnce();
  });
});

describe('transfer safety and recovery', () => {
  it.each(['local', 'remote', 'slash-named remote'] as const)('does not mistake an existing %s branch suffix for the requested branch', async scenario => {
    const f = await fixture();
    if (scenario === 'local') await f.git('branch', 'team/fix');
    else {
      const remote = scenario === 'remote' ? 'origin' : 'team/origin';
      await f.git('remote', 'add', remote, f.source);
      await f.git('update-ref', `refs/remotes/${remote}/team/fix`, f.head);
    }
    const result = await f.service.execute(f.agent, { ...f.input, branchName: 'fix' });
    expect(result.state, result.detail).toBe('completed');
    expect((await exec('git', ['branch', '--show-current'], { cwd: result.folder })).stdout.trim()).toBe('fix');
    expect(await readFile(join(result.folder, 'mixed'), 'utf8')).toBe('final\n');
    expect(await f.git('status', '--porcelain')).toBe('');
  });

  it.each(['invalid branch', 'branch collision', 'remote branch collision', 'destination collision', 'stale preview', 'conflict'] as const)('rejects %s before creating work or provisioning', async scenario => {
    const f = await fixture();
    if (scenario === 'invalid branch') f.input.branchName = 'bad..name';
    if (scenario === 'branch collision') await f.git('branch', f.input.branchName);
    if (scenario === 'remote branch collision') {
      await f.git('remote', 'add', 'team/origin', f.source);
      await f.git('update-ref', `refs/remotes/team/origin/${f.input.branchName}`, f.head);
    }
    if (scenario === 'destination collision') await writeFile(join(f.root, 'source-feature-work'), 'occupied');
    if (scenario === 'stale preview') await writeFile(join(f.source, 'mixed'), 'new edit\n');
    if (scenario === 'conflict') await writeFile(join(f.source, '.git', 'MERGE_HEAD'), f.head);
    const before = await f.git('status', '--porcelain');
    await expect(f.service.execute(f.agent, f.input)).rejects.toThrow();
    expect(await f.git('status', '--porcelain')).toBe(before);
    expect(f.provision).not.toHaveBeenCalled();
    expect((await f.git('worktree', 'list', '--porcelain')).match(/worktree /g)).toHaveLength(1);
  });

  it('retains work after provisioning failure and reuses the worktree and reserved agent identity on retry', async () => {
    const f = await fixture(); f.provision.mockRejectedValueOnce(new Error('Cannot persist agent'));
    const before = await f.git('status', '--porcelain');
    const failed = await f.service.execute(f.agent, f.input);
    expect(failed.state).toBe('recovery');
    expect(f.progress).toHaveBeenLastCalledWith({ id: 'request', agentId: 'parent', branchName: 'feature/work', state: 'error', phase: 'creatingAgent', error: 'Cannot persist agent' });
    expect(await f.git('status', '--porcelain')).toBe(before);
    const restored = new BranchCurrentWorkService({ provision: f.provision });
    expect((await restored.preview(f.source, f.agent.id)).recoveries).toStrictEqual([{ input: f.input, result: failed }]);
    const results = await Promise.all([f.service.execute(f.agent, f.input), f.service.execute(f.agent, f.input)]);
    expect(results[0]).toStrictEqual(results[1]);
    expect(f.provision).toHaveBeenCalledTimes(2);
    await expect(f.service.execute(f.agent, { ...f.input, branchName: 'Different-branch' })).rejects.toThrow('different transfer');
  });

  it('preserves newer selected edits and staged changes made while provisioning', async () => {
    const f = await fixture();
    f.provision.mockImplementationOnce(async () => {
      await writeFile(join(f.source, 'mixed'), 'newer\n');
      await f.git('add', 'mixed');
      return undefined;
    });
    const result = await f.service.execute(f.agent, f.input);
    expect(result.state, result.detail).toBe('completed'); expect(result.retainedPaths).toStrictEqual(['mixed']);
    expect(await readFile(join(f.source, 'mixed'), 'utf8')).toBe('newer\n');
    expect(await f.git('diff', '--cached', '--name-only')).toBe('mixed');
  });

  it('does not clean up source files when the destination changes during agent creation', async () => {
    const f = await fixture();
    f.provision.mockImplementationOnce(async (_agent, _input, folder) => {
      await writeFile(join(folder, 'mixed'), 'destination edit\n');
    });
    const before = await f.git('status', '--porcelain');
    const result = await f.service.execute(f.agent, f.input);
    expect(result.state).toBe('recovery');
    expect(await f.git('status', '--porcelain')).toBe(before);
    expect(await readFile(join(result.folder, 'mixed'), 'utf8')).toBe('destination edit\n');
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
    const result = await f.service.execute(f.agent, { ...f.input, snapshotId: preview.snapshotId });
    expect(result.state, result.detail).toBe('completed');
    expect(await readFile(join(result.folder, ':(glob)*'))).toStrictEqual(binary);
    expect(await readFile(join(result.folder, 'renamed'), 'utf8')).toBe('unrelated\n');
    expect(await f.git('diff', '--cached', '--name-only')).toBe('');
    expect(await readFile(join(f.source, 'other'), 'utf8')).toBe('original\n');
  });

  it('preserves intent-to-add and exact file bytes under checkout filters', async () => {
    const f = await fixture();
    await f.git('config', 'core.autocrlf', 'true');
    await writeFile(join(f.source, 'intent'), 'unstaged addition\n');
    await f.git('add', '--intent-to-add', 'intent');
    const staged = await f.git('diff', '--cached', '--binary');
    const unstaged = await f.git('diff', '--binary');
    const preview = await f.service.preview(f.source);
    const result = await f.service.execute(f.agent, { ...f.input, snapshotId: preview.snapshotId });
    expect(result.state, result.detail).toBe('completed');
    expect(await readFile(join(result.folder, 'mixed'), 'utf8')).toBe('final\n');
    expect(await readFile(join(result.folder, 'intent'), 'utf8')).toBe('unstaged addition\n');
    expect((await exec('git', ['diff', '--cached', '--binary'], { cwd: result.folder })).stdout.trim()).toBe(staged);
    expect((await exec('git', ['diff', '--binary'], { cwd: result.folder })).stdout.trim()).toBe(unstaged);
    expect(await f.git('status', '--porcelain')).toBe('');
  });

  it('never clears source work if HEAD changes while the new agent starts', async () => {
    const f = await fixture();
    f.provision.mockImplementationOnce(async () => {
      await f.git('commit', '--allow-empty', '-m', 'concurrent commit');
      return undefined;
    });
    const result = await f.service.execute(f.agent, f.input);
    expect(result.state).toBe('recovery'); expect(result.detail).toContain('Source HEAD changed');
    expect(await readFile(join(f.source, 'mixed'), 'utf8')).toBe('final\n');
  });

  it('carries net-zero staged/unstaged changes without collapsing their staging state', async () => {
    const f = await fixture(); await writeFile(join(f.source, 'staged'), 'original\n');
    const preview = await f.service.preview(f.source);
    const staged = await f.git('diff', '--cached', '--binary');
    const unstaged = await f.git('diff', '--binary');
    const result = await f.service.execute(f.agent, { ...f.input, snapshotId: preview.snapshotId });
    expect(result.state, result.detail).toBe('completed');
    expect((await exec('git', ['diff', '--cached', '--binary'], { cwd: result.folder })).stdout.trim()).toBe(staged);
    expect((await exec('git', ['diff', '--binary'], { cwd: result.folder })).stdout.trim()).toBe(unstaged);
    expect(await f.git('status', '--porcelain')).toBe('');
  });
});


describe('source cleanup races', () => {
  it('retains edits through an open file descriptor in the reported recovery copies', async () => {
    const f = await fixture();
    const descriptor = await open(join(f.source, 'mixed'), 'r+');
    try {
      const result = await f.service.execute(f.agent, f.input);
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
    const result = await f.service.execute({ ...f.agent, folder: linked }, { ...f.input, snapshotId: preview.snapshotId });
    expect(result.state, result.detail).toBe('completed');
    expect((await exec('git', ['rev-parse', 'HEAD'], { cwd: result.folder })).stdout.trim()).toBe(sourceHead);
    expect(await f.git('status', '--porcelain')).toBe(before);
    expect(await f.git('branch', '--show-current')).toBe('main');
  });

  it('retains work and refuses to mutate a destination whose transfer ownership is unconfirmed', async () => {
    const f = await fixture(); f.provision.mockRejectedValueOnce(new Error('Cannot persist agent'));
    const failed = await f.service.execute(f.agent, f.input);
    const marker = (await exec('git', ['rev-parse', '--path-format=absolute', '--git-path', 'korus-branch-transfer'], { cwd: failed.folder })).stdout.trim();
    await rm(marker);
    const before = await f.git('status', '--porcelain');
    const retry = await f.service.execute(f.agent, f.input);
    expect(retry.state).toBe('recovery'); expect(retry.detail).toContain('ownership is unconfirmed');
    expect(await f.git('status', '--porcelain')).toBe(before);
    expect((await exec('git', ['rev-parse', 'HEAD'], { cwd: failed.folder })).stdout.trim()).toBe(f.head);
    expect(f.provision).toHaveBeenCalledOnce();
  });

  it('transfers symlink values without copying or altering their external targets', async () => {
    const f = await fixture(); const external = join(f.root, 'external');
    await writeFile(external, 'private target\n');
    await symlink(external, join(f.source, 'link'));
    const preview = await f.service.preview(f.source);
    const result = await f.service.execute(f.agent, { ...f.input, snapshotId: preview.snapshotId });
    expect(result.state, result.detail).toBe('completed');
    expect(await readlink(join(result.folder, 'link'))).toBe(external);
    expect(await readFile(external, 'utf8')).toBe('private target\n');
    await expect(readlink(join(f.source, 'link'))).rejects.toThrow();
  });
});
