import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { AppBackendServer } from '../server';
import { AgentGitService } from '../git/agent-git-service';
import { AppStateStore } from '../persistence/store';

// Real Git and roster persistence protect against deleting the wrong checkout or losing a user rename.
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'feature-groups-'));
  const git = promisify(execFile);
  const snapshot = createInitialSnapshot();
  const source = snapshot.agents[0]!;
  snapshot.agents = [];
  snapshot.teams[0]!.agentIds = [];
  for (const repo of ['api', 'web']) {
    const primary = join(root, repo), folder = join(root, `${repo}-feat1`);
    await git('git', ['init', '-b', 'main', primary]);
    await git('git', ['-C', primary, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'initial']);
    await git('git', ['-C', primary, 'worktree', 'add', '-b', 'feat1', folder]);
    const agent = { ...source, id: repo, name: repo, folder, backendSession: undefined, workspace: { kind: 'git' as const, folder, repositoryName: repo, repositoryRoot: folder, primaryWorktreeRoot: primary, branch: 'feat1', defaultBranch: 'main', isLinkedWorktree: true, updatedAt: '' } };
    snapshot.agents.push(agent); snapshot.teams[0]!.agentIds.push(agent.id);
  }
  const store = new AppStateStore(join(root, 'state'));
  const gitService = new AgentGitService();
  const server = new AppBackendServer({ version: 'test', snapshot, agentGitService: gitService, saveSnapshot: value => store.save(value) });
  const call = async (input: Record<string, unknown>) => {
    const response = await server.handleMessage({ jsonrpc: '2.0', id: 'feature', method: 'feature/control', params: { input: { teamId: snapshot.teams[0]!.id, branch: 'feat1', ...input } } });
    if (!response || 'error' in response) throw new Error(response && 'error' in response ? response.error.message : 'No response');
    return response.result as any;
  };
  return { root, snapshot, server, call, git, store, gitService, close: async () => { await server.close(); await rm(root, { recursive: true, force: true }); } };
}

describe('feature groups through the backend and real Git', () => {
  it('persists display labels in roster.json without renaming branches and requires fresh confirmed cleanup of every worktree', async () => {
    const f = await fixture();
    try {
      f.snapshot.agents.push({ ...f.snapshot.agents[0]!, id: 'api-helper' });
      f.snapshot.teams[0]!.agentIds.push('api-helper');
      const offline = vi.spyOn(f.gitService, 'workflow').mockRejectedValue(new Error('Host offline'));
      await f.call({ type: 'rename', label: 'Account settings' });
      expect(offline).not.toHaveBeenCalled();
      offline.mockRestore();
      const roster = JSON.parse(await readFile(join(f.root, 'state', 'roster.json'), 'utf8'));
      expect(roster.data.teams[0].featureLabels).toStrictEqual({ feat1: 'Account settings' });
      expect((await f.store.load()).teams[0]!.featureLabels).toStrictEqual({ feat1: 'Account settings' });
      expect((await f.git('git', ['-C', join(f.root, 'api-feat1'), 'branch', '--show-current'])).stdout.trim()).toBe('feat1');
      let preview = (await f.call({ type: 'preview-delete' })).preview;
      expect(preview.worktrees.map((tree: { path: string }) => tree.path)).toStrictEqual([join(f.root, 'api-feat1'), join(f.root, 'web-feat1')]);
      await expect(f.call({ type: 'delete', fingerprint: preview.fingerprint, confirmed: false })).rejects.toThrow();
      await f.call({ type: 'rename', label: 'New label' });
      await expect(f.call({ type: 'delete', fingerprint: preview.fingerprint, confirmed: true })).rejects.toThrow(/changed|confirmation/i);
      await writeFile(join(f.root, 'web-feat1', 'uncommitted.txt'), 'local changes');
      preview = (await f.call({ type: 'preview-delete' })).preview;
      expect(preview.worktrees[1].changedFiles).toBeGreaterThan(0);
      await f.call({ type: 'delete', fingerprint: preview.fingerprint, confirmed: true });
      expect(f.snapshot.agents).toHaveLength(0);
      for (const repo of ['api', 'web']) {
        const list = (await f.git('git', ['-C', join(f.root, repo), 'worktree', 'list', '--porcelain'])).stdout;
        expect(list).not.toContain(`${repo}-feat1`);
        expect(list).toContain('refs/heads/main');
      }
      expect((await f.store.load()).teams[0]!.featureLabels?.feat1).toBeUndefined();
    } finally { await f.close(); }
  });

  it('blocks default branches, changed checkouts and worktrees shared outside the feature before deleting anything', async () => {
    const f = await fixture();
    try {
      for (const type of ['rename', 'preview-delete', 'delete']) await expect(f.call({ type, branch: 'main', label: 'Wrong', confirmed: true, fingerprint: '' })).rejects.toThrow();
      const preview = (await f.call({ type: 'preview-delete' })).preview;
      await f.git('git', ['-C', join(f.root, 'web-feat1'), 'switch', '-c', 'other']);
      await expect(f.call({ type: 'delete', fingerprint: preview.fingerprint, confirmed: true })).rejects.toThrow(/branch|changed/i);
      expect(f.snapshot.agents).toHaveLength(2);
      await f.git('git', ['-C', join(f.root, 'web-feat1'), 'switch', 'feat1']);
      const workflow = f.gitService.workflow.bind(f.gitService);
      vi.spyOn(f.gitService, 'workflow').mockImplementationOnce(async folder => {
        const inspected = await workflow(folder);
        await f.git('git', ['-C', folder, 'switch', '-c', 'raced-branch']);
        return inspected;
      });
      const raced = f.server.handleMessage({ jsonrpc: '2.0', id: 'race', method: 'feature/control', params: { input: { type: 'cleanup-agent', agentId: 'api', branch: 'feat1', deleteWorktree: true, confirmed: true } } });
      await expect(raced).rejects.toThrow(/branch changed/i);
      expect(f.snapshot.agents).toHaveLength(2);
      await f.git('git', ['-C', join(f.root, 'api-feat1'), 'switch', 'feat1']);
      f.snapshot.agents.push({ ...f.snapshot.agents[0]!, id: 'foreign', teamId: 'another-team' });
      await expect(f.call({ type: 'preview-delete' })).rejects.toThrow(/also used|shared/i);
      expect(f.snapshot.agents).toHaveLength(3);
    } finally { await f.close(); }
  });
});
