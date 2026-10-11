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
  it.each(['success', 'roster failure', 'uncertain acceptance'] as const)('persists one agent and durable task, with %s', async scenario => {
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
    const send = vi.fn(async (worker: Agent, prompt: string) => {
      expect(savedSnapshot!.agents.find(agent => agent.id === worker.id)?.folder).toBe(worker.folder);
      expect(prompt).toContain('Finish the change');
      if (scenario === 'uncertain acceptance') throw new Error('provider disconnected');
      worker.backendSession = { kind: 'codex', threadId: 'worker-thread' };
      return { backendSession: worker.backendSession, turnId: 'worker-turn' };
    });
    const saveTasks = vi.fn(async () => undefined);
    const tasks = new DurableTaskService({ tasks: [], save: saveTasks, agent: id => snapshot.agents.find(agent => agent.id === id), send, interrupt: vi.fn(), onError: vi.fn() });
    const server = new AppBackendServer({ version: 'test', snapshot, tasks, saveSnapshot });
    try {
      const response = await server.handleMessage({ jsonrpc: '2.0', id: 'preview', method: backendMethods.agentGitBranchWorkPreview, params: { agentId: parent.id } });
      const preview = (response as { result: BranchWorkPreview }).result;
      const input = { confirmed: true, requestId: 'request', snapshotId: preview.snapshotId, branchName: 'feature/branch', paths: ['work'], message: 'feat: work', prompt: 'Finish the change' };
      const transfer = async () => ((await server.handleMessage({ jsonrpc: '2.0', id: 'branch', method: backendMethods.agentGitBranchWork, params: { agentId: parent.id, input } })) as { result: BranchWorkResult }).result;
      const first = await transfer();
      if (scenario !== 'success') {
        expect(first.state).toBe('recovery');
        expect(await readFile(join(source, 'work'), 'utf8')).toBe('feature\n');
      }
      const retried = await transfer();
      expect(retried.state).toBe(scenario === 'uncertain acceptance' ? 'recovery' : 'completed');
      expect(snapshot.agents).toHaveLength(2); expect(tasks.list(parent.id)).toHaveLength(1);
      expect(send).toHaveBeenCalledOnce();
      expect(snapshot.agents[1]?.folder).toBe(retried.folder);
      expect(savedSnapshot!.agents).toHaveLength(2);
      if (scenario !== 'uncertain acceptance') expect(await git('status', '--porcelain')).toBe('');
      else expect(await git('status', '--porcelain')).toBe('M work');
    } finally { tasks.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
  });
});
