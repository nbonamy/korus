import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { RemoteConnection, SourceBranch, SourceRepository } from '@workspace/core/contracts';
import { useRepositorySession } from '../use-repository-session';

const connection = (id: string): RemoteConnection => ({ id, kind: 'ssh', name: id, host: id, status: 'ready', sourceFolderPath: '/home/me/src', createdAt: '', updatedAt: '' });
const checkout = (path: string): SourceRepository => ({ name: 'korus', path, remoteIdentity: 'github.com/nbonamy/korus', worktrees: [] });
const localBranches: SourceBranch[] = [{ name: 'main', isDefault: true, worktreePath: '/Users/me/src/korus' }, { name: 'feature', isDefault: false, worktreePath: '/Users/me/src/korus-feature' }];
const source = { repositoryName: 'korus', repositoryRoot: '/Users/me/src/korus', originUrl: 'github.com:nbonamy/korus.git' };

function setup(remoteRepositories: SourceRepository[], clone?: (input: unknown) => Promise<SourceRepository>) {
  const snapshot = createInitialSnapshot();
  snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
  snapshot.remoteConnections.connections = [connection('devbox')];
  const listSourceBranches = vi.fn(async (_root: string, host?: string) => host ? [{ name: 'main', isDefault: true, worktreePath: '/home/me/src/korus' }] : localBranches);
  const listSourceRepositories = vi.fn(async (host?: string) => host ? remoteRepositories : [checkout('/Users/me/src/korus')]);
  const cloneRepository = vi.fn(clone ?? (async () => checkout('/home/me/src/korus')));
  const createAgent = vi.fn(async () => undefined);
  const session = useRepositorySession({
    activeTeamId: () => snapshot.activeTeamId ?? undefined, getSnapshot: () => snapshot, getWorkRepositories: () => [],
    assignWorkItem: vi.fn(), createAgent, createIsolatedWorkItemAgent: vi.fn() as never, createSourceWorktree: vi.fn() as never,
    cloneRepository, remoteConnections: () => snapshot.remoteConnections.connections,
    listSourceRepositories, listSourceBranches, loadWorkItems: async () => [], loadWorkRepositories: async () => [],
    notifyError: vi.fn(), prefillWorkItemForAgent: vi.fn(), startWorkItemInExistingSession: vi.fn(), suggestSourceWorktreePath: async () => '',
  });
  return { session, listSourceBranches, listSourceRepositories, cloneRepository, createAgent };
}

describe('repository session host choice', () => {
  it('lists the ready machines and starts on the machine the section was opened for', async () => {
    const { session } = setup([]);
    await session.open(source);
    expect(session.hosts.value.map((host) => host.id)).toStrictEqual(['devbox']);
    expect(session.hostId.value).toBeUndefined();
    expect(session.hostCheckout.value).toStrictEqual({ state: 'cloned', path: '/Users/me/src/korus' });
  });

  it('refreshes branches and checked-out status from the checkout found on the chosen machine', async () => {
    const { session, listSourceBranches } = setup([checkout('/home/me/src/korus')]);
    await session.open(source);
    await session.changeHost('devbox');
    expect(session.hostId.value).toBe('devbox');
    expect(session.hostCheckout.value).toStrictEqual({ state: 'cloned', path: '/home/me/src/korus' });
    expect(session.source.value).toMatchObject({ repositoryRoot: '/home/me/src/korus', remoteConnectionId: 'devbox' });
    expect(listSourceBranches).toHaveBeenLastCalledWith('/home/me/src/korus', 'devbox');
    expect(session.branches.value).toStrictEqual([{ name: 'main', isDefault: true, worktreePath: '/home/me/src/korus' }]);

    await session.changeHost(undefined);
    expect(session.source.value).toMatchObject({ repositoryRoot: '/Users/me/src/korus' });
    expect(session.source.value).not.toHaveProperty('remoteConnectionId');
    expect(session.branches.value).toStrictEqual(localBranches);
  });

  it('keeps pull requests and issues when the machine changes and always reads them from the repository', async () => {
    const { session, listSourceBranches } = setup([checkout('/home/me/src/korus')]);
    const loadWorkItems = vi.fn(async () => [{ id: 'issue-1' }] as never);
    const loadWorkRepositories = vi.fn(async () => []);
    const withItems = useRepositorySession({
      activeTeamId: () => undefined, getSnapshot: () => createInitialSnapshot(), getWorkRepositories: () => [],
      assignWorkItem: vi.fn(), createAgent: vi.fn(), createIsolatedWorkItemAgent: vi.fn() as never, createSourceWorktree: vi.fn() as never,
      remoteConnections: () => [connection('devbox')],
      listSourceRepositories: async (host) => host ? [checkout('/home/me/src/korus')] : [checkout('/Users/me/src/korus')],
      listSourceBranches, loadWorkItems, loadWorkRepositories,
      notifyError: vi.fn(), prefillWorkItemForAgent: vi.fn(), startWorkItemInExistingSession: vi.fn(), suggestSourceWorktreePath: async () => '',
    });
    expect(session).toBeDefined();
    await withItems.open({ ...source, workSource: { provider: 'github', id: 'nbonamy/korus', name: 'korus', fullName: 'nbonamy/korus', url: 'https://github.com/nbonamy/korus' } });
    expect(loadWorkItems).toHaveBeenCalledExactlyOnceWith('nbonamy/korus', undefined, 'github');
    await withItems.changeHost('devbox');
    expect(loadWorkItems).toHaveBeenCalledOnce();
    expect(withItems.workItems.value).toHaveLength(1);
    expect(withItems.workSourceId.value).toBe('nbonamy/korus');
  });

  it('flags a machine without the repository and shows nothing as checked out there', async () => {
    const { session } = setup([]);
    await session.open(source);
    await session.changeHost('devbox');
    expect(session.hostCheckout.value).toStrictEqual({ state: 'missing', cloneTo: '/home/me/src' });
    expect(session.branches.value.map((branch) => branch.worktreePath)).toStrictEqual([undefined, undefined]);
    expect(session.source.value).toMatchObject({ repositoryRoot: '/Users/me/src/korus' });
  });

  it('clones with the git user restored before opening a conversation on that machine', async () => {
    const { session, cloneRepository, createAgent } = setup([]);
    await session.open(source);
    await session.changeHost('devbox');
    await session.createForSourceBranch({ name: 'feature', isDefault: false });
    expect(cloneRepository).toHaveBeenCalledExactlyOnceWith({ url: 'git@github.com:nbonamy/korus.git', remoteConnectionId: 'devbox', reuseExisting: true });
    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({ folder: '/home/me/src/korus', remoteConnectionId: 'devbox', repositorySession: { existingBranch: 'feature' } }));
  });

  it('stops with the clone error and starts nothing when the clone fails', async () => {
    const { session, createAgent } = setup([], async () => { throw new Error('Could not access korus on github.com.'); });
    await session.open(source);
    await session.changeHost('devbox');
    await session.createForSourceBranch({ name: 'feature', isDefault: false });
    expect(session.error.value).toBe('Could not access korus on github.com.');
    expect(session.visible.value).toBe(true);
    expect(session.hostBusy.value).toBe(false);
    expect(createAgent).not.toHaveBeenCalled();
  });

  it('reports a machine that cannot be reached instead of listing it as empty', async () => {
    const { session, listSourceRepositories } = setup([]);
    await session.open(source);
    listSourceRepositories.mockRejectedValueOnce(new Error('Host unreachable'));
    await session.changeHost('devbox');
    expect(session.hostCheckout.value).toStrictEqual({ state: 'unreachable', message: 'Host unreachable' });
  });
});
