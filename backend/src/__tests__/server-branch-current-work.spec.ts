import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { Agent, AppSnapshot } from '@workspace/core/contracts';
import type { BranchWorkPreview, BranchWorkResult } from '@workspace/core/branch-current-work';
import { AppBackendServer } from '../server';
import { DurableTaskService } from '../agents/durable-task-service';
import { createTestSnapshot } from './server-test-fixtures';

const exec = promisify(execFile);
describe('branch current work app boundary', () => {
  it.each(['success', 'roster failure'] as const)('persists one idle agent without a task or commit, with %s', async scenario => {
    const root = await mkdtemp(join(tmpdir(), 'korus-branch-rpc-'));
    const source = join(root, 'repo');
    await exec('git', ['init', '-b', 'main', source]);
    const git = async (...args: string[]) => (await exec('git', args, { cwd: source })).stdout.trim();
    await git('config', 'user.name', 'Tester'); await git('config', 'user.email', 'tester@example.test');
    await writeFile(join(source, 'work'), 'base\n'); await git('add', '.'); await git('commit', '-m', 'initial');
    await writeFile(join(source, 'work'), 'feature\n');
    const snapshot = createTestSnapshot();
    const parent: Agent = { id: 'parent', teamId: snapshot.teams[0]!.id, folder: source, name: 'Parent', backend: 'codex', backendDefaults: { kind: 'codex' }, status: { type: 'idle' }, createdAt: '', updatedAt: '' };
    snapshot.agents = [parent]; snapshot.teams[0]!.agentIds = [parent.id];
    let savedSnapshot: AppSnapshot | undefined;
    const saveSnapshot = vi.fn(async (next: AppSnapshot) => { savedSnapshot = structuredClone(next); });
    if (scenario === 'roster failure') saveSnapshot.mockRejectedValueOnce(new Error('roster full'));
    const send = vi.fn();
    const saveTasks = vi.fn(async () => undefined);
    const tasks = new DurableTaskService({ tasks: [], save: saveTasks, agent: id => snapshot.agents.find(agent => agent.id === id), send, interrupt: vi.fn(), onError: vi.fn() });
    const onEvent = vi.fn();
    const server = new AppBackendServer({ onEvent, version: 'test', snapshot, tasks, saveSnapshot });
    try {
      const response = await server.handleMessage({ jsonrpc: '2.0', id: 'preview', method: backendMethods.agentGitBranchWorkPreview, params: { agentId: parent.id } });
      const preview = (response as { result: BranchWorkPreview }).result;
      const input = { confirmed: true, requestId: 'request', snapshotId: preview.snapshotId, branchName: 'feature/branch' };
      const transfer = async () => ((await server.handleMessage({ jsonrpc: '2.0', id: 'branch', method: backendMethods.agentGitBranchWork, params: { agentId: parent.id, input } })) as { result: BranchWorkResult }).result;
      const first = await transfer();
      if (scenario !== 'success') {
        expect(first.state).toBe('recovery');
        expect(await readFile(join(source, 'work'), 'utf8')).toBe('feature\n');
      }
      const retried = await transfer();
      expect(retried.state, retried.detail).toBe('completed');
      expect(onEvent.mock.calls.map(([event]) => event).filter(event => event.type === 'git.branchWorkProgress').at(-1)).toMatchObject({ agentId: 'parent', payload: { id: 'request', state: 'success' } });
      expect(snapshot.agents).toHaveLength(2); expect(tasks.list(parent.id)).toHaveLength(0);
      expect(send).not.toHaveBeenCalled();
      expect(snapshot.agents[1]?.folder).toBe(retried.folder);
      expect(savedSnapshot!.agents).toHaveLength(2);
      expect(await git('status', '--porcelain')).toBe('');
      expect((await exec('git', ['rev-parse', 'HEAD'], { cwd: retried.folder })).stdout.trim()).toBe(await git('rev-parse', 'HEAD'));
      expect(await readFile(join(retried.folder, 'work'), 'utf8')).toBe('feature\n');
      expect(snapshot.agents[1]?.status.type).toBe('idle');
      expect(snapshot.agents[1]?.backendSession).toBeUndefined();
    } finally { tasks.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
  });
});
