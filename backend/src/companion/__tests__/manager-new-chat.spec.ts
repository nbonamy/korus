import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { duplicateAgentInSnapshot, updateAgentFromInput } from '@workspace/core/agent-manager';
import { opaquePath } from '@workspace/core/companion-projection';
import type { AppSnapshot, SourceBranch, SourceRepository } from '@workspace/core/contracts';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';
import { CompanionManager } from '../manager';
import type { CompanionGateway } from '../gateway';

const transport = vi.hoisted(() => ({ gateway: null as CompanionGateway | null }));
vi.mock('../connector', () => ({ CompanionOutboundConnector: class {
  connected = false;
  constructor(_key: unknown, gateway: CompanionGateway) { transport.gateway = gateway; }
  async stop() {}
  revoke() {}
} }));
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

async function fixture(beforeCreationReturns: (id: string) => Promise<void> = async () => {}, beforeProjectReadReturns: (method: string) => Promise<void> = async () => {}) {
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
  const closePreview = { isLinkedWorktree: true, branch: 'feature/new', upstream: 'origin/feature/new', hasChanges: false };
  const repositories: SourceRepository[] = [];
  const unavailableProviders = new Set<string>();
  const failures = new Map<string, Error>();
  let chatCount = 0; let quickCount = 0;
  const backend = { async request<Result>(method: string, params?: unknown): Promise<Result> {
    calls.push({ method, params });
    if (failures.has(method)) throw failures.get(method);
    if (method === backendMethods.snapshotGet) return { snapshot } as Result;
    if (method === backendMethods.agentClosePreview) return closePreview as Result;
    if (method === backendMethods.workProviderBranchesList) { await beforeProjectReadReturns(method); return branches.map(({ name, isDefault }) => ({ name, isDefault })) as Result; }
    if (method === backendMethods.sourceBranchesList) return branches as Result;
    if (method === backendMethods.sourceWorktreeCreate) return { name: 'feature', path: '/code/repo-feature' } as Result;
    if (method === backendMethods.workProviderSourcesList) { await beforeProjectReadReturns(method); const provider = (params as { provider: string }).provider; if (unavailableProviders.has(provider)) return [] as Result; return [{ id: 'org/repo', fullName: provider === 'gitlab' ? 'org/subgroup/repo' : 'org/repo', name: 'repo', provider, url: `https://${provider}.com/org/${provider === 'gitlab' ? 'subgroup/' : ''}repo`, privateMetadata: 'hidden' }] as Result; }
    if (method === backendMethods.sourceRepositoriesList) { await beforeProjectReadReturns(method); return repositories as Result; }
    if (method === backendMethods.sourceRepositoryClone) return { name: 'repo', path: '/code/repo', worktrees: [] } as Result;
    if (method === backendMethods.agentCreate || method === backendMethods.projectCreate) {
      const { input } = params as { input: import('@workspace/core/contracts').CreateAgentInput };
      const id = ++chatCount === 1 ? 'new-chat' : `new-chat-${chatCount}`;
      snapshot.agents.push({ id, teamId: input.teamId!, name: 'New', backend: input.selection!.backend!, folder: input.folder, status: { type: 'idle' }, createdAt: '', updatedAt: '' });
      await beforeCreationReturns(id);
      return { agentId: id, snapshot: { ...snapshot, activeAgentId: id } } as Result;
    }
    if (method === backendMethods.agentDuplicate) {
      const { agentId, options } = params as { agentId: string; options: import('@workspace/core/contracts').DuplicateAgentOptions };
      duplicateAgentInSnapshot(snapshot, agentId, undefined, () => 'duplicated-agent', options);
      return { agentId: 'duplicated-agent', snapshot } as Result;
    }
    if (method === backendMethods.agentQuickChatCreate) {
      const { input } = params as { input: import('@workspace/core/contracts').CreateQuickChatInput };
      const id = ++quickCount === 1 ? 'quick-chat' : `quick-chat-${quickCount}`;
      snapshot.agents.push({ id, teamId: input.teamId, name: null, backend: input.selection?.backend, folder: null, sessionKind: 'quickChat', status: { type: 'idle' }, createdAt: '', updatedAt: '' } as never);
      await beforeCreationReturns(id);
      return { agentId: id, snapshot: { ...snapshot, activeAgentId: id } } as Result;
    }
    if (method === backendMethods.agentUpdate) {
      const { input } = params as { input: import('@workspace/core/contracts').UpdateAgentInput };
      updateAgentFromInput(snapshot, input);
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
    const { creationId } = await gateway.request('phone', 'agent.create', { teamId: 'team-test', repositoryId: opaquePath('/code/repo'), selection: { backend: 'claude' }, ...extra }) as { creationId: string };
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
  return { calls, create, quickChat, gateway, snapshot, branches, repositories, closePreview, unavailableProviders, failures };
}

describe('mobile chat creation', () => {
  it.each([false, true])('acquires opaque GitLab selections on the owning host (new branch: %s)', async newBranch => {
    const f = await fixture();
    f.snapshot.teams[0]!.remoteConnectionId = 'ssh-host';
    f.snapshot.remoteConnections.connections.push({ id: 'ssh-host', kind: 'ssh', name: 'Host', host: 'host', status: 'ready', providerConnections: f.snapshot.providerConnections, createdAt: '', updatedAt: '' });
    const choices = await f.gateway.request('phone', 'project.repositories.list', { teamId: 'team-test', provider: 'gitlab' }) as { id: string; name: string }[];
    expect(choices).toStrictEqual([{ id: expect.stringMatching(/^repo:[a-f0-9]{64}$/), name: 'org/subgroup/repo' }]);
    const repositoryId = choices[0]!.id;
    expect(await f.gateway.request('phone', 'project.repositories.branches', { teamId: 'team-test', provider: 'gitlab', repositoryId })).toStrictEqual(f.branches.map(({ name, isDefault }) => ({ name, isDefault })));
    f.repositories.push({ name: 'different-local-name', path: '/code/repo', remoteIdentity: 'gitlab.com/org/subgroup/repo', worktrees: [] });
    const choice = newBranch ? { worktree: { branchName: 'feature/new', baseBranch: 'main' } } : { branch: 'feature/checked-out' };
    const { creationId } = await f.gateway.request('phone', 'project.create', { teamId: 'team-test', source: 'gitlab', value: repositoryId, ...choice, selection: { backend: 'claude' } }) as { creationId: string };
    await vi.waitFor(async () => expect(await f.gateway.request('phone', 'agent.create.status', { creationId })).toStrictEqual({ state: 'success', agentId: 'new-chat' }));
    expect(f.calls.some(call => call.method === backendMethods.sourceRepositoryClone)).toBe(false);
    expect(f.calls.find(call => call.method === backendMethods.agentCreate)?.params).toMatchObject({ input: { folder: newBranch ? '/code/repo-feature' : '/code/repo-existing', teamId: 'team-test', selection: { ...{ backend: 'claude' } } } });
    expect(f.calls.filter(call => call.method === backendMethods.workProviderBranchesList).every(call => JSON.stringify(call.params).includes('"provider":"gitlab"') && JSON.stringify(call.params).includes('"remoteConnectionId":"ssh-host"'))).toBe(true);
    if (newBranch) expect(f.calls.find(call => call.method === backendMethods.sourceWorktreeCreate)?.params).toMatchObject({ input: { baseBranch: 'main', requireNewBranch: true, fetchRemoteBranch: true, remoteConnectionId: 'ssh-host' } });
  });

  it('rejects GitLab IDs from another host, provider, daemon or removed catalog before writes', async () => {
    const f = await fixture();
    const list = () => f.gateway.request('phone', 'project.repositories.list', { teamId: 'team-test', provider: 'gitlab' }) as Promise<{ id: string }[]>;
    const id = (await list())[0]!.id;
    await expect(f.gateway.request('stranger', 'project.repositories.list', { teamId: 'team-test', provider: 'gitlab' })).rejects.toThrow();
    await expect(f.gateway.request('phone', 'project.repositories.list', { teamId: 'team-test', provider: 'linear' })).rejects.toThrow();
    await expect(f.gateway.request('phone', 'project.repositories.branches', { teamId: 'team-test', provider: 'github', repositoryId: id })).rejects.toThrow();
    f.snapshot.teams[0]!.remoteConnectionId = 'other-host';
    f.snapshot.remoteConnections.connections.push({ id: 'other-host', kind: 'ssh', name: 'Other', host: 'other', status: 'ready', providerConnections: f.snapshot.providerConnections, createdAt: '', updatedAt: '' });
    await expect(f.gateway.request('phone', 'project.repositories.branches', { teamId: 'team-test', provider: 'gitlab', repositoryId: id })).rejects.toThrow();
    const stale = await f.gateway.request('phone', 'project.create', { teamId: 'team-test', source: 'gitlab', value: id, selection: { backend: 'codex' } }) as { creationId: string };
    await vi.waitFor(async () => expect(await f.gateway.request('phone', 'agent.create.status', stale)).toMatchObject({ state: 'error' }));
    delete f.snapshot.teams[0]!.remoteConnectionId;
    f.unavailableProviders.add('gitlab');
    await expect(f.gateway.request('phone', 'project.repositories.branches', { teamId: 'team-test', provider: 'gitlab', repositoryId: id })).rejects.toThrow();
    const other = await fixture();
    await expect(other.gateway.request('phone', 'project.repositories.branches', { teamId: 'team-test', provider: 'gitlab', repositoryId: id })).rejects.toThrow();
    expect(f.calls.some(call => call.method === backendMethods.sourceRepositoryClone || call.method === backendMethods.agentCreate)).toBe(false);
  });

  it.each(['revoke', 'location'] as const)('withholds a GitLab catalog if access changes during the read: %s', async change => {
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    let reached!: () => void;
    const reading = new Promise<void>(resolve => { reached = resolve; });
    const f = await fixture(undefined, async method => { if (method === backendMethods.workProviderSourcesList) { reached(); await barrier; } });
    const pending = f.gateway.request('phone', 'project.repositories.list', { teamId: 'team-test', provider: 'gitlab' });
    await reading;
    if (change === 'location') f.snapshot.teams[0]!.remoteConnectionId = 'other';
    else await f.gateway.revoke('phone');
    release();
    await expect(pending).rejects.toThrow();
    expect(f.calls.some(call => call.method === backendMethods.sourceRepositoryClone)).toBe(false);
  });

  it.each([
    [backendMethods.workProviderSourcesList, 'Could not load GitLab repositories on the selected host. Check its GitLab connection and repository access, then refresh.'],
    [backendMethods.workProviderBranchesList, 'Could not load GitLab branches on the selected host. Check its GitLab connection and repository access, then refresh.'],
    [backendMethods.sourceRepositoriesList, 'Could not list existing repositories on the selected host. Check its source folder, then retry.'],
    [backendMethods.sourceRepositoryClone, 'Could not clone the repository on the selected host. Check its Git credentials and repository access, then retry.'],
    [backendMethods.sourceWorktreeCreate, 'Could not prepare the branch on the selected host. Check its Git credentials and repository access, then retry.'],
    [backendMethods.agentCreate, 'Could not start work on the selected host. Check its available engines, then retry.'],
  ])('keeps host paths and credentials out of GitLab creation receipts: %s', async (failedMethod, message) => {
    const f = await fixture();
    const [{ id }] = await f.gateway.request('phone', 'project.repositories.list', { teamId: 'team-test', provider: 'gitlab' }) as { id: string }[];
    f.failures.set(failedMethod, new Error('git clone /private/checkout https://secret-token@gitlab.com failed'));
    if (failedMethod === backendMethods.workProviderSourcesList) await expect(f.gateway.request('phone', 'project.repositories.list', { teamId: 'team-test', provider: 'gitlab' })).rejects.toThrow(message);
    const { creationId } = await f.gateway.request('phone', 'project.create', { teamId: 'team-test', source: 'gitlab', value: id!, branch: 'feature/available', selection: { backend: 'codex' } }) as { creationId: string };
    await vi.waitFor(async () => {
      const result = await f.gateway.request('phone', 'agent.create.status', { creationId });
      expect(result).toStrictEqual({ state: 'error', error: message });
    });
    if (failedMethod !== backendMethods.agentCreate) expect(f.calls.some(call => call.method === backendMethods.agentCreate)).toBe(false);
  });

  it('clones GitLab with host Git credentials and refuses invalid catalog branches before cloning', async () => {
    const f = await fixture();
    const [{ id }] = await f.gateway.request('phone', 'project.repositories.list', { teamId: 'team-test', provider: 'gitlab' }) as { id: string }[];
    for (const branch of ['removed', 'main']) {
      const { creationId } = await f.gateway.request('phone', 'project.create', { teamId: 'team-test', source: 'gitlab', value: id!, branch, selection: { backend: 'codex' } }) as { creationId: string };
      await vi.waitFor(async () => expect(await f.gateway.request('phone', 'agent.create.status', { creationId })).toMatchObject({ state: branch === 'main' ? 'success' : 'error' }));
    }
    expect(f.calls.filter(call => call.method === backendMethods.sourceRepositoryClone)).toStrictEqual([{ method: backendMethods.sourceRepositoryClone, params: { input: { url: 'https://gitlab.com/org/subgroup/repo' }, _clientId: 'companion-write' } }]);
  });

  it('lists only repository roots with opaque IDs and opens a chosen local branch without cloning', async () => {
    const f = await fixture();
    f.repositories.push({ name: 'repo', path: '/code/repo', worktrees: [{ name: 'main', path: '/code/repo' }, { name: 'feature/checked-out', path: '/code/repo-existing' }] });
    const choices = await f.gateway.request('phone', 'project.local.list', { teamId: 'team-test' });
    expect(choices).toStrictEqual([{ id: opaquePath('/code/repo'), name: 'repo' }]);
    const branches = await f.gateway.request('phone', 'project.local.branches', { teamId: 'team-test', repositoryId: opaquePath('/code/repo') });
    expect(branches).toStrictEqual(f.branches.map(({ name, isDefault }) => ({ name, isDefault })));
    await expect(f.gateway.request('phone', 'project.local.branches', { teamId: 'team-test', repositoryId: '/code/repo' })).rejects.toThrow();
    const { creationId } = await f.gateway.request('phone', 'project.create', { teamId: 'team-test', source: 'local', value: opaquePath('/code/repo'), branch: 'feature/checked-out', selection: { backend: 'claude' } }) as { creationId: string };
    await vi.waitFor(async () => expect(await f.gateway.request('phone', 'agent.create.status', { creationId })).toStrictEqual({ state: 'success', agentId: 'new-chat' }));
    expect(f.calls.find(call => call.method === backendMethods.agentCreate)?.params).toMatchObject({ input: { folder: '/code/repo-existing', selection: { ...{ backend: 'claude' } } } });
    expect(f.calls.some(call => call.method === backendMethods.sourceRepositoryClone)).toBe(false);
    expect(f.calls.some(call => call.method === backendMethods.sourceWorktreeCreate)).toBe(false);
  });

  it('routes a rename through the existing desktop update operation and preserves the session', async () => {
    const f = await fixture();
    f.snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'rename-session' };
    const source = structuredClone(f.snapshot.agents[0]!);
    const target = { hostId: f.gateway.hostId, locationId: 'local', teamId: 'team-test', agentId: 'existing', sessionId: JSON.stringify(source.backendSession) };
    await f.gateway.request('phone', 'agent.rename', { target, name: 'Mobile work' });
    expect(f.calls.find(call => call.method === backendMethods.agentUpdate)?.params).toStrictEqual({ input: { id: 'existing', name: 'Mobile work' }, _clientId: 'companion-write' });
    const result = await f.gateway.request('phone', 'snapshot.get', {});
    expect(result).toMatchObject({ agents: [expect.objectContaining({ id: 'existing', name: 'Mobile work', backend: source.backend, backendSession: source.backendSession })] });
  });

  it('duplicates the target through the desktop operation with an explicit available engine', async () => {
    const f = await fixture();
    const target = { hostId: f.gateway.hostId, locationId: 'local', teamId: 'team-test', agentId: 'existing', sessionId: null };
    expect(await f.gateway.request('phone', 'agent.duplicate', { target, backend: 'claude' })).toStrictEqual({ agentId: 'duplicated-agent' });
    expect(f.calls.find(call => call.method === backendMethods.agentDuplicate)?.params).toStrictEqual({ agentId: 'existing', options: { selection: { backend: 'claude' } }, entityResult: true, _clientId: 'companion-write' });
    expect(f.snapshot.agents.find(agent => agent.id === 'duplicated-agent')).toMatchObject({ folder: '/code/repo', backend: 'claude', status: { type: 'idle' } });
    await expect(f.gateway.request('phone', 'agent.duplicate', { target, backend: 'antigravity' })).rejects.toThrow('not available');
    expect(f.calls.filter(call => call.method === backendMethods.agentDuplicate)).toHaveLength(1);
  });

  it.each([false, true])('prepares local branches without a remote fetch (new branch: %s)', async newBranch => {
    const f = await fixture();
    f.repositories.push({ name: 'repo', path: '/code/repo', worktrees: [] });
    const choice = newBranch ? { worktree: { branchName: 'feature/local', baseBranch: 'main' } } : { branch: 'feature/available' };
    const { creationId } = await f.gateway.request('phone', 'project.create', { teamId: 'team-test', source: 'local', value: opaquePath('/code/repo'), ...choice, selection: { backend: 'codex' } }) as { creationId: string };
    await vi.waitFor(async () => expect(await f.gateway.request('phone', 'agent.create.status', { creationId })).toStrictEqual({ state: 'success', agentId: 'new-chat' }));
    expect(f.calls.find(call => call.method === backendMethods.sourceWorktreeCreate)?.params).toMatchObject({ input: {
      repoPath: '/code/repo', fetchRemoteBranch: false,
      ...(newBranch ? { branchName: 'feature/local', baseBranch: 'main', requireNewBranch: true } : { branchName: 'feature/available', reuseExisting: true }),
    } });
    expect(f.calls.find(call => call.method === backendMethods.agentCreate)?.params).toMatchObject({ input: { folder: '/code/repo-feature' } });
    expect(f.calls.some(call => call.method === backendMethods.sourceRepositoryClone)).toBe(false);
  });

  it.each(['new', 'github', 'url'] as const)('starts a project from %s through the owning remote host desktop operations', async source => {
    const f = await fixture();
    f.snapshot.teams[0]!.remoteConnectionId = 'ssh-host';
    f.snapshot.remoteConnections.connections.push({ id: 'ssh-host', kind: 'ssh', name: 'Host', host: 'host', status: 'ready', providerConnections: f.snapshot.providerConnections, createdAt: '', updatedAt: '' });
    const value = source === 'new' ? 'fresh-project' : source === 'github' ? 'org/repo' : 'https://github.com/org/repo.git';
    const { creationId } = await f.gateway.request('phone', 'project.create', { teamId: 'team-test', source, value, selection: { backend: 'claude' } }) as { creationId: string };
    await vi.waitFor(async () => expect(await f.gateway.request('phone', 'agent.create.status', { creationId })).toStrictEqual({ state: 'success', agentId: 'new-chat' }));
    expect(f.snapshot.agents.find(agent => agent.id === 'new-chat')?.teamId).toBe('team-test');
    if (source === 'new') {
      expect(f.calls.find(call => call.method === backendMethods.projectCreate)?.params).toStrictEqual({ input: { teamId: 'team-test', name: value, selection: { ...{ backend: 'claude' } } }, entityResult: true, _clientId: 'companion-write' });
    } else {
      expect(f.calls.find(call => call.method === backendMethods.sourceRepositoryClone)?.params).toStrictEqual({ input: { url: source === 'github' ? 'https://github.com/org/repo' : value, remoteConnectionId: 'ssh-host' }, _clientId: 'companion-write' });
      expect(f.calls.find(call => call.method === backendMethods.agentCreate)?.params).toMatchObject({ input: { folder: '/code/repo', teamId: 'team-test', selection: { ...{ backend: 'claude' } } } });
    }
  });

  it('returns the daemon close preview unchanged, bound to the captured target', async () => {
    const f = await fixture();
    const target = { hostId: f.gateway.hostId, locationId: 'local', teamId: 'team-test', agentId: 'existing', sessionId: null };
    expect(await f.gateway.request('phone', 'agent.close.preview', target)).toStrictEqual({ target, ...f.closePreview });
    expect(f.calls.at(-1)?.method).toBe(backendMethods.snapshotGet);
    expect(f.calls).toContainEqual({ method: backendMethods.agentClosePreview, params: { agentId: 'existing', _clientId: 'companion-read' } });
  });

  it('lists GitHub branches without cloning, and opens an existing branch in its checked-out folder', async () => {
    const f = await fixture();
    f.repositories.push({ name: 'repo', path: '/code/repo', remoteIdentity: 'github.com/org/repo', worktrees: [] });
    expect(await f.gateway.request('phone', 'project.github.branches', { teamId: 'team-test', repositoryId: 'org/repo' })).toStrictEqual([
      { name: 'main', isDefault: true }, { name: 'feature/checked-out', isDefault: false }, { name: 'feature/available', isDefault: false },
    ]);
    expect(f.calls.some(call => call.method === backendMethods.sourceRepositoryClone)).toBe(false);
    const { creationId } = await f.gateway.request('phone', 'project.create', { teamId: 'team-test', source: 'github', value: 'org/repo', branch: 'feature/checked-out', selection: { backend: 'codex' } }) as { creationId: string };
    await vi.waitFor(async () => expect(await f.gateway.request('phone', 'agent.create.status', { creationId })).toStrictEqual({ state: 'success', agentId: 'new-chat' }));
    expect(f.calls.find(call => call.method === backendMethods.agentCreate)?.params).toMatchObject({ input: { folder: '/code/repo-existing' } });
    expect(f.calls.some(call => call.method === backendMethods.sourceWorktreeCreate)).toBe(false);
  });

  it('creates a worktree for a selected GitHub branch and never creates an agent for an unknown branch', async () => {
    const f = await fixture();
    const { creationId } = await f.gateway.request('phone', 'project.create', { teamId: 'team-test', source: 'github', value: 'org/repo', branch: 'feature/available', selection: { backend: 'codex' } }) as { creationId: string };
    await vi.waitFor(async () => expect(await f.gateway.request('phone', 'agent.create.status', { creationId })).toStrictEqual({ state: 'success', agentId: 'new-chat' }));
    expect(f.calls.find(call => call.method === backendMethods.sourceWorktreeCreate)?.params).toStrictEqual({ input: { repoPath: '/code/repo', branchName: 'feature/available', reuseExisting: true, fetchRemoteBranch: true }, _clientId: 'companion-write' });
    const other = await f.gateway.request('phone', 'project.create', { teamId: 'team-test', source: 'github', value: 'org/repo', branch: 'unknown', selection: { backend: 'codex' } }) as { creationId: string };
    await vi.waitFor(async () => expect(await f.gateway.request('phone', 'agent.create.status', { creationId: other.creationId })).toMatchObject({ state: 'error' }));
    expect(f.calls.filter(call => call.method === backendMethods.agentCreate)).toHaveLength(1);
  });

  it('creates a new GitHub branch from a chosen base on the owning host before opening its agent', async () => {
    const f = await fixture(); f.snapshot.teams[0]!.remoteConnectionId = 'ssh-host';
    f.snapshot.remoteConnections.connections.push({ id: 'ssh-host', kind: 'ssh', name: 'Host', host: 'host', status: 'ready', providerConnections: f.snapshot.providerConnections, createdAt: '', updatedAt: '' });
    const { creationId } = await f.gateway.request('phone', 'project.create', { teamId: 'team-test', source: 'github', value: 'org/repo', worktree: { branchName: 'feature/new', baseBranch: 'feature/available' }, selection: { backend: 'codex' } }) as { creationId: string };
    await vi.waitFor(async () => expect(await f.gateway.request('phone', 'agent.create.status', { creationId })).toStrictEqual({ state: 'success', agentId: 'new-chat' }));
    expect(f.calls.find(call => call.method === backendMethods.sourceWorktreeCreate)?.params).toStrictEqual({ input: { repoPath: '/code/repo', branchName: 'feature/new', baseBranch: 'feature/available', requireNewBranch: true, fetchRemoteBranch: true, remoteConnectionId: 'ssh-host' }, _clientId: 'companion-write' });
    expect(f.snapshot.agents.find(agent => agent.id === 'new-chat')?.folder).toBe('/code/repo-feature');
  });

  it.each([
    { branchName: 'main', baseBranch: 'main' },
    { branchName: 'feature/new', baseBranch: 'removed' },
  ])('rejects a duplicate branch or missing base before cloning: $branchName $baseBranch', async worktree => {
    const f = await fixture();
    const { creationId } = await f.gateway.request('phone', 'project.create', { teamId: 'team-test', source: 'github', value: 'org/repo', worktree, selection: { backend: 'codex' } }) as { creationId: string };
    await vi.waitFor(async () => expect(await f.gateway.request('phone', 'agent.create.status', { creationId })).toMatchObject({ state: 'error' }));
    expect(f.calls.some(call => [backendMethods.sourceRepositoryClone, backendMethods.sourceWorktreeCreate, backendMethods.agentCreate].some(method => method === call.method))).toBe(false);
  });

  it.each([
    { worktree: { branchName: '../escape', baseBranch: 'main' } },
    { branch: 'main', worktree: { branchName: 'feature/new', baseBranch: 'main' } },
    { source: 'url', value: 'https://github.com/org/repo', worktree: { branchName: 'feature/new', baseBranch: 'main' } },
  ])('rejects malformed or conflicting project worktree input', async extra => {
    const f = await fixture();
    await expect(f.gateway.request('phone', 'project.create', { teamId: 'team-test', source: 'github', value: 'org/repo', ...extra, selection: { backend: 'codex' } })).rejects.toThrow();
    expect(f.calls.some(call => call.method === backendMethods.sourceRepositoryClone)).toBe(false);
  });

  it('withholds GitHub branches after grant revocation or a team location change', async () => {
    for (const change of ['revoke', 'location']) {
      let release!: () => void;
      const f = await fixture(undefined, method => method === backendMethods.workProviderBranchesList ? new Promise(resolve => { release = resolve; }) : Promise.resolve());
      const pending = f.gateway.request('phone', 'project.github.branches', { teamId: 'team-test', repositoryId: 'org/repo' });
      const denied = expect(pending).rejects.toThrow();
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      if (change === 'revoke') await f.gateway.revoke('phone'); else f.snapshot.teams[0]!.remoteConnectionId = 'replacement';
      release(); await denied;
    }
  });

  it('reuses an existing checkout instead of cloning the same GitHub repository again', async () => {
    const f = await fixture();
    f.repositories.push({ name: 'repo', path: '/code/repo', remoteIdentity: 'github.com/org/repo', worktrees: [] });
    const { creationId } = await f.gateway.request('phone', 'project.create', { teamId: 'team-test', source: 'github', value: 'org/repo', selection: { backend: 'codex' } }) as { creationId: string };
    await vi.waitFor(async () => expect(await f.gateway.request('phone', 'agent.create.status', { creationId })).toStrictEqual({ state: 'success', agentId: 'new-chat' }));
    expect(f.calls.some(call => call.method === backendMethods.sourceRepositoryClone)).toBe(false);
    expect(f.calls.find(call => call.method === backendMethods.agentCreate)?.params).toMatchObject({ input: { folder: '/code/repo' } });
  });

  it.each(['github', 'local'])('withholds %s repository results if the phone is revoked during the read', async source => {
    let release!: () => void;
    const f = await fixture(undefined, () => new Promise(resolve => { release = resolve; }));
    const loading = f.gateway.request('phone', `project.${source}.list`, { teamId: 'team-test' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await f.gateway.revoke('phone'); release();
    await expect(loading).rejects.toThrow('not authorized');
  });

  it('does not clone after a grant is replaced while repository discovery is in flight', async () => {
    let release!: () => void;
    const f = await fixture(undefined, method => method === backendMethods.sourceRepositoriesList ? new Promise(resolve => { release = resolve; }) : Promise.resolve());
    const { creationId } = await f.gateway.request('phone', 'project.create', { teamId: 'team-test', source: 'url', value: 'https://github.com/org/repo', selection: { backend: 'codex' } }) as { creationId: string };
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await f.gateway.revoke('phone');
    const invitation = f.gateway.invite();
    const { pendingId } = await f.gateway.request('phone', 'pair.claim', { code: invitation.code.replace('-', ''), name: 'Phone' }) as { pendingId: string };
    await f.gateway.decide(pendingId, true);
    release();
    await vi.waitFor(async () => expect(await f.gateway.request('phone', 'agent.create.status', { creationId })).toStrictEqual({ state: 'error', error: 'Device is not authorized.' }));
    expect(f.calls.some(call => call.method === backendMethods.sourceRepositoryClone || call.method === backendMethods.agentCreate)).toBe(false);
  });

  it('lists the owning host GitHub repositories with only display fields', async () => {
    const f = await fixture(); f.snapshot.teams[0]!.remoteConnectionId = 'ssh-host';
    expect(await f.gateway.request('phone', 'project.github.list', { teamId: 'team-test' })).toStrictEqual([{ id: 'org/repo', name: 'org/repo' }]);
    expect(f.calls.find(call => call.method === backendMethods.workProviderSourcesList)?.params).toStrictEqual({ provider: 'github', location: { kind: 'remote', remoteConnectionId: 'ssh-host' }, _clientId: 'companion-read' });
  });

  it.each([
    { source: 'local', value: '/private' }, { source: 'new', value: '../escape' }, { source: 'new', value: '.' },
    { source: 'url', value: 'file:///private/repo' }, { source: 'url', value: '/private/repo' },
    { source: 'url', value: 'https://user:secret@example.com/repo' },
  ])('rejects unsupported or unsafe project input: $source $value', async input => {
    const f = await fixture();
    await expect(f.gateway.request('phone', 'project.create', { teamId: 'team-test', backend: 'claude', ...input })).rejects.toThrow();
    expect(f.calls.some(call => call.method === backendMethods.projectCreate || call.method === backendMethods.sourceRepositoryClone)).toBe(false);
  });

  it.each(['repository', 'quick'] as const)('returns each concurrent %s creation to the phone that requested it', async kind => {
    let arrived = 0; let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const f = await fixture(async () => { if (++arrived === 2) release(); await barrier; });
    const results = await Promise.all(kind === 'repository' ? [f.create({}), f.create({})] : [f.quickChat(), f.quickChat()]);
    expect(results).toStrictEqual(kind === 'repository'
      ? [{ state: 'success', agentId: 'new-chat' }, { state: 'success', agentId: 'new-chat-2' }]
      : [{ state: 'success', agentId: 'quick-chat' }, { state: 'success', agentId: 'quick-chat-2' }]);
  });
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
    expect(f.calls.find((call) => call.method === backendMethods.sourceWorktreeCreate)?.params).toStrictEqual({ input: { repoPath: '/code/repo', branchName: 'feature/available', reuseExisting: true }, _clientId: 'companion-write' });
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
  it.each([true, false])('resolves the default branch instead of trusting the primary checkout (checked out: %s)', async checkedOut => {
    const f = await fixture();
    f.snapshot.agents[0]!.workspace = { ...f.snapshot.agents[0]!.workspace!, branch: 'feature' } as NonNullable<AppSnapshot['agents'][number]['workspace']>;
    f.branches[0] = { name: 'main', isDefault: true, ...(checkedOut ? { worktreePath: '/code/main' } : {}) };
    expect(await f.create({})).toStrictEqual({ state: 'success', agentId: 'new-chat' });
    expect(f.calls.find(call => call.method === backendMethods.agentCreate)?.params).toMatchObject({ input: { folder: checkedOut ? '/code/main' : '/code/repo-feature' } });
    expect(f.calls.filter(call => call.method === backendMethods.sourceWorktreeCreate)).toHaveLength(checkedOut ? 0 : 1);
    if (!checkedOut) expect(f.calls.find(call => call.method === backendMethods.sourceWorktreeCreate)?.params).toMatchObject({ input: { branchName: 'main' } });
  });
  it('fails default-branch creation if the owning catalog cannot identify it', async () => {
    const f = await fixture(); f.branches.forEach(branch => { branch.isDefault = false; });
    expect(await f.create({})).toMatchObject({ state: 'error' });
    expect(f.calls.some(call => call.method === backendMethods.agentCreate)).toBe(false);
  });
  it('starts a chat in the repository checkout without making a worktree', async () => {
    const f = await fixture();
    expect(await f.create({})).toStrictEqual({ state: 'success', agentId: 'new-chat' });
    expect(f.calls.map((call) => call.method)).not.toContain(backendMethods.sourceWorktreeCreate);
    expect(f.calls.find((call) => call.method === backendMethods.agentCreate)?.params).toMatchObject({ input: { name: null, folder: '/code/repo', sourceRepositoryName: 'repo', teamId: 'team-test', selection: { ...{ backend: 'claude' } } } });
  });
  it('makes the worktree from the default branch first, then opens the chat in it', async () => {
    const f = await fixture();
    expect(await f.create({ worktree: { branchName: 'feature' } })).toStrictEqual({ state: 'success', agentId: 'new-chat' });
    expect(f.calls.find((call) => call.method === backendMethods.sourceWorktreeCreate)?.params).toMatchObject({ input: { repoPath: '/code/repo', branchName: 'feature', baseBranch: 'main' } });
    expect(f.calls.find((call) => call.method === backendMethods.agentCreate)?.params).toMatchObject({ input: { folder: '/code/repo-feature' } });
  });
  it('offers only the engines the laptop has connected', async () => {
    const f = await fixture();
    expect(await f.create({ selection: { backend: 'antigravity' } }).catch((error: Error) => error.message)).toMatch(/not available/);
  });
  it('changes the engine of a chat that has not started, through the same update the desktop uses', async () => {
    const f = await fixture();
    f.snapshot.agents[0]!.status = { type: 'idle' };
    await f.gateway.request('phone', 'agent.backend.set', { target: { hostId: f.gateway.hostId, locationId: 'local', teamId: 'team-test', agentId: 'existing', sessionId: null }, backend: 'claude' });
    expect(f.calls.find((call) => call.method === backendMethods.agentUpdate)?.params).toMatchObject({ input: { id: 'existing', selection: { ...{ backend: 'claude' } } } });
    expect(f.snapshot.agents[0]!.backend).toBe('claude');
  });
  it('starts a quick chat in the team and finds the agent it made', async () => {
    const f = await fixture();
    expect(await f.quickChat()).toStrictEqual({ state: 'success', agentId: 'quick-chat' });
    expect(f.calls.find((call) => call.method === backendMethods.agentQuickChatCreate)?.params).toMatchObject({ input: { teamId: 'team-test', selection: { ...{ backend: 'claude' } } } });
  });
});
