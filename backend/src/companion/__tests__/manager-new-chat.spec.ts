import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { opaquePath } from '@workspace/core/companion-projection';
import type { AppSnapshot } from '@workspace/core/contracts';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';
import { CompanionManager } from '../manager';
import type { CompanionGateway } from '../gateway';

const transport = vi.hoisted(() => ({ gateway: null as CompanionGateway | null }));
vi.mock('../connector', () => ({ CompanionOutboundConnector: class {
  connected = false;
  constructor(_key: unknown, gateway: CompanionGateway) { transport.gateway = gateway; }
  async stop() {}
} }));
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'companion-new-chat-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const snapshot = createTestSnapshot();
  const workspace = { kind: 'git' as const, folder: '/code/repo', repositoryName: 'repo', repositoryRoot: '/code/repo', primaryWorktreeRoot: '/code/repo', branch: 'main', defaultBranch: 'main', isLinkedWorktree: false, updatedAt: '' };
  snapshot.agents = [{ id: 'existing', teamId: 'team-test', name: 'Existing', backend: 'codex', folder: '/code/repo', workspace, status: { type: 'idle' }, createdAt: '', updatedAt: '' }];
  snapshot.teams[0]!.agentIds = ['existing'];
  snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true }, { backend: 'claude', installed: true, connected: true }] as AppSnapshot['providerConnections'];
  const calls: { method: string; params: unknown }[] = [];
  const backend = { async request<Result>(method: string, params?: unknown): Promise<Result> {
    calls.push({ method, params });
    if (method === backendMethods.snapshotGet) return { snapshot } as Result;
    if (method === backendMethods.sourceWorktreeCreate) return { name: 'feature', path: '/code/repo-feature' } as Result;
    if (method === backendMethods.agentCreate) {
      const { input } = params as { input: { folder: string; backend: 'codex' | 'claude'; teamId: string } };
      snapshot.agents.push({ id: 'new-chat', teamId: input.teamId, name: 'New', backend: input.backend, folder: input.folder, status: { type: 'idle' }, createdAt: '', updatedAt: '' });
      return snapshot as Result;
    }
    if (method === backendMethods.agentUpdate) {
      const { input } = params as { input: { id: string; backend: 'codex' | 'claude' } };
      snapshot.agents.find((agent) => agent.id === input.id)!.backend = input.backend;
      return snapshot as Result;
    }
    throw new Error(`Unexpected ${method}`);
  } };
  const initial = new CompanionManager(directory, backend, {});
  await initial.control({ action: 'status' }); await initial.stop();
  const file = path.join(directory, 'state.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  saved.gateway.grants = [{ peerId: 'phone', name: 'Phone', createdAt: 1 }];
  await writeFile(file, JSON.stringify(saved));
  const manager = new CompanionManager(directory, backend, {});
  cleanup.push(() => manager.stop());
  await manager.control({ action: 'status' });
  const gateway = transport.gateway!;
  async function create(extra: object) {
    const { creationId } = await gateway.request('phone', 'agent.create', { teamId: 'team-test', repositoryId: opaquePath('/code/repo'), backend: 'claude', ...extra }) as { creationId: string };
    return vi.waitFor(async () => {
      const result = await gateway.request('phone', 'agent.create.status', { creationId }) as { state: string };
      if (result.state === 'running') throw new Error('still running');
      return result;
    });
  }
  return { calls, create, gateway, snapshot };
}

describe('mobile chat creation', () => {
  it('starts a chat in the repository checkout without making a worktree', async () => {
    const f = await fixture();
    expect(await f.create({})).toStrictEqual({ state: 'success', agentId: 'new-chat' });
    expect(f.calls.map((call) => call.method)).not.toContain(backendMethods.sourceWorktreeCreate);
    expect(f.calls.find((call) => call.method === backendMethods.agentCreate)?.params).toMatchObject({ input: { name: null, folder: '/code/repo', backend: 'claude', sourceRepositoryName: 'repo', teamId: 'team-test' } });
  });
  it('makes the worktree from the default branch first, then opens the chat in it', async () => {
    const f = await fixture();
    expect(await f.create({ worktree: { branchName: 'feature' } })).toStrictEqual({ state: 'success', agentId: 'new-chat' });
    expect(f.calls.find((call) => call.method === backendMethods.sourceWorktreeCreate)?.params).toMatchObject({ input: { repoPath: '/code/repo', branchName: 'feature', baseBranch: 'main' } });
    expect(f.calls.find((call) => call.method === backendMethods.agentCreate)?.params).toMatchObject({ input: { folder: '/code/repo-feature' } });
  });
  it('offers only the engines the laptop has connected', async () => {
    const f = await fixture();
    expect(await f.create({ backend: 'antigravity' }).catch((error: Error) => error.message)).toMatch(/not available/);
  });
  it('changes the engine of a chat that has not started, through the same update the desktop uses', async () => {
    const f = await fixture();
    f.snapshot.agents[0]!.status = { type: 'idle' };
    await f.gateway.request('phone', 'agent.backend.set', { agentId: 'existing', backend: 'claude' });
    expect(f.calls.find((call) => call.method === backendMethods.agentUpdate)?.params).toMatchObject({ input: { id: 'existing', backend: 'claude' } });
    expect(f.snapshot.agents[0]!.backend).toBe('claude');
  });
});
