import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { opaquePath } from '@workspace/core/companion-projection';
import type { AppSnapshot, SourceBranch } from '@workspace/core/contracts';
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
  const branches: SourceBranch[] = [
    { name: 'main', isDefault: true, worktreePath: '/code/repo' },
    { name: 'feature/checked-out', isDefault: false, worktreePath: '/code/repo-existing' },
    { name: 'feature/available', isDefault: false },
  ];
  const calls: { method: string; params: unknown }[] = [];
  const backend = { async request<Result>(method: string, params?: unknown): Promise<Result> {
    calls.push({ method, params });
    if (method === backendMethods.snapshotGet) return { snapshot } as Result;
    if (method === backendMethods.sourceBranchesList) return branches as Result;
    if (method === backendMethods.sourceWorktreeCreate) return { name: 'feature', path: '/code/repo-feature' } as Result;
    if (method === backendMethods.agentCreate) {
      const { input } = params as { input: { folder: string; backend: 'codex' | 'claude'; teamId: string } };
      snapshot.agents.push({ id: 'new-chat', teamId: input.teamId, name: 'New', backend: input.backend, folder: input.folder, status: { type: 'idle' }, createdAt: '', updatedAt: '' });
      return snapshot as Result;
    }
    if (method === backendMethods.agentQuickChatCreate) {
      const { input } = params as { input: { teamId: string; backend: 'codex' | 'claude' } };
      snapshot.agents.push({ id: 'quick-chat', teamId: input.teamId, name: null, backend: input.backend, folder: null, sessionKind: 'quickChat', status: { type: 'idle' }, createdAt: '', updatedAt: '' } as never);
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
  async function quickChat(backend = 'claude') {
    const { creationId } = await gateway.request('phone', 'agent.quickChat.create', { teamId: 'team-test', backend }) as { creationId: string };
    return vi.waitFor(async () => {
      const result = await gateway.request('phone', 'agent.create.status', { creationId }) as { state: string };
      if (result.state === 'running') throw new Error('still running');
      return result;
    });
  }
  return { calls, create, quickChat, gateway, snapshot, branches };
}

describe('mobile chat creation', () => {
  it('lists the desktop branch catalog without exposing checkout paths, routed to the owning host', async () => {
    const f = await fixture();
    f.snapshot.teams[0]!.remoteConnectionId = 'ssh-host';
    expect(await f.gateway.request('phone', 'repository.branches', { teamId: 'team-test', repositoryId: opaquePath('/code/repo') })).toStrictEqual([
      { name: 'main', isDefault: true, isCheckedOut: true },
      { name: 'feature/checked-out', isDefault: false, isCheckedOut: true },
      { name: 'feature/available', isDefault: false, isCheckedOut: false },
    ]);
    expect(f.calls.find((call) => call.method === backendMethods.sourceBranchesList)?.params).toStrictEqual({ repoPath: '/code/repo', remoteConnectionId: 'ssh-host', _clientId: 'companion-read' });
  });
  it.each([
    ['stranger', 'team-test', opaquePath('/code/repo')],
    ['phone', 'unknown-team', opaquePath('/code/repo')],
    ['phone', 'team-test', '/arbitrary/path'],
  ])('rejects branch discovery outside the paired repository scope: %s %s %s', async (peer, teamId, repositoryId) => {
    const f = await fixture();
    await expect(f.gateway.request(peer, 'repository.branches', { teamId, repositoryId })).rejects.toThrow();
    expect(f.calls.map((call) => call.method)).not.toContain(backendMethods.sourceBranchesList);
  });
  it.each([
    ['main', '/code/repo'],
    ['feature/checked-out', '/code/repo-existing'],
  ])('opens an existing checkout for %s without creating or switching a branch', async (existingBranch, folder) => {
    const f = await fixture();
    expect(await f.create({ existingBranch })).toStrictEqual({ state: 'success', agentId: 'new-chat' });
    expect(f.calls.map((call) => call.method)).not.toContain(backendMethods.sourceWorktreeCreate);
    expect(f.calls.find((call) => call.method === backendMethods.agentCreate)?.params).toMatchObject({ input: { folder } });
  });
  it('creates a worktree for an existing branch without basing it on the default branch', async () => {
    const f = await fixture();
    expect(await f.create({ existingBranch: 'feature/available' })).toStrictEqual({ state: 'success', agentId: 'new-chat' });
    expect(f.calls.find((call) => call.method === backendMethods.sourceWorktreeCreate)?.params).toStrictEqual({ input: { repoPath: '/code/repo', branchName: 'feature/available' }, _clientId: 'companion-write' });
    expect(f.calls.find((call) => call.method === backendMethods.agentCreate)?.params).toMatchObject({ input: { folder: '/code/repo-feature' } });
  });
  it('rejects a branch removed since listing instead of creating a new branch with its name', async () => {
    const f = await fixture();
    expect(await f.create({ existingBranch: 'deleted' })).toStrictEqual({ state: 'error', error: 'Branch not found. Refresh the branch list.' });
    expect(f.calls.map((call) => call.method)).not.toContain(backendMethods.sourceWorktreeCreate);
    expect(f.calls.map((call) => call.method)).not.toContain(backendMethods.agentCreate);
  });
  it('rejects conflicting existing-branch and new-worktree selections', async () => {
    const f = await fixture();
    await expect(f.create({ existingBranch: 'main', worktree: { branchName: 'new' } })).rejects.toThrow();
    expect(f.calls.map((call) => call.method)).not.toContain(backendMethods.agentCreate);
  });
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
  it('starts a quick chat in the team and finds the agent it made', async () => {
    const f = await fixture();
    expect(await f.quickChat()).toStrictEqual({ state: 'success', agentId: 'quick-chat' });
    expect(f.calls.find((call) => call.method === backendMethods.agentQuickChatCreate)?.params).toMatchObject({ input: { teamId: 'team-test', backend: 'claude' } });
  });
});
