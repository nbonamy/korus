import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { AgentGitService } from '../agent-git-service';
import { AppBackendServer } from '../../server';
import { persistedStateFromSnapshot, snapshotFromPersistedState } from '../../state-persistence';

it('persists global strategies and applies changed settings to the existing update action', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'git-preferences-boundary-')));
  const exec = promisify(execFile);
  const git = (cwd: string, args: string[]) => exec('git', args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  let server: AppBackendServer | undefined;
  try {
    const repo = join(root, 'repo');
    await git(root, ['init', '-b', 'main', repo]);
    await git(repo, ['config', 'user.name', 'Test']); await git(repo, ['config', 'user.email', 'test@example.invalid']);
    await git(repo, ['commit', '--allow-empty', '-m', 'base']);
    const feature = join(root, 'feature');
    await git(repo, ['worktree', 'add', '-b', 'work', feature]);
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!; agent.folder = feature;
    snapshot.agents = [agent];
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const service = new AgentGitService(undefined, git);
    server = new AppBackendServer({ version: 'test', snapshot, agentGitService: service, saveSnapshot, workIntegrations: { githubConnected: async () => false } as never });
    const request = (method: string, input?: unknown) => server!.handleMessage({ jsonrpc: '2.0', id: method, method, params: { agentId: agent.id, ...(input === undefined ? {} : { input }) } });
    await server.handleMessage({ jsonrpc: '2.0', id: 'settings', method: backendMethods.settingsUpdate, params: { input: { general: { git: { pull: 'rebase', update: 'rebase' } } } } });
    expect(saveSnapshot).toHaveBeenCalled();
    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));
    expect(restored.general.git).toStrictEqual(snapshot.general.git);
    await writeFile(join(repo, 'base.txt'), 'base'); await git(repo, ['add', 'base.txt']); await git(repo, ['commit', '-m', 'base']);
    await writeFile(join(feature, 'work.txt'), 'work'); await git(feature, ['add', '.']); await git(feature, ['commit', '-m', 'work']);
    const head = (await git(repo, ['rev-parse', 'HEAD'])).stdout;
    await server.handleMessage({ jsonrpc: '2.0', id: 'ff', method: backendMethods.settingsUpdate, params: { input: { general: { git: { update: 'ff-only' } } } } });
    const before = (await git(feature, ['rev-parse', 'HEAD'])).stdout;
    await expect(request(backendMethods.agentGitUpdateFromBase, { confirmed: true })).rejects.toThrow();
    expect((await git(feature, ['rev-parse', 'HEAD'])).stdout).toBe(before);
    await server.handleMessage({ jsonrpc: '2.0', id: 'rebase', method: backendMethods.settingsUpdate, params: { input: { general: { git: { update: 'rebase' } } } } });
    expect(await request(backendMethods.agentGitUpdateFromBase, { confirmed: true })).toMatchObject({ result: { conflicts: [], workflow: { branch: 'work' } } });
    expect((await git(feature, ['rev-parse', 'HEAD^'])).stdout).toBe(head);
    expect((await git(repo, ['rev-parse', 'HEAD'])).stdout).toBe(head);
    expect((await git(repo, ['worktree', 'list', '--porcelain'])).stdout).toContain(feature);
  } finally { await server?.close(); await rm(root, { recursive: true, force: true }); }
});
