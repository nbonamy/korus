import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import NewSourceWorktreeDialog from '../NewSourceWorktreeDialog.vue';
import { provideBackendChoices } from '../backend-selection';
import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { RemoteConnection, SourceBranch, SourceRepository, WorkItem } from '@workspace/core/contracts';
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
  const startWorkItemInExistingSession = vi.fn();
  const prefillWorkItemForAgent = vi.fn();
  const session = useRepositorySession({
    activeTeamId: () => snapshot.activeTeamId ?? undefined, getSnapshot: () => snapshot, getWorkRepositories: () => [],
    assignWorkItem: vi.fn(), createAgent, createIsolatedWorkItemAgent: vi.fn() as never, createSourceWorktree: vi.fn() as never,
    cloneRepository, remoteConnections: () => snapshot.remoteConnections.connections,
    listSourceRepositories, listSourceBranches, loadWorkItems: async () => [], loadWorkRepositories: async () => [],
    notifyError: vi.fn(), prefillWorkItemForAgent, startWorkItemInExistingSession, suggestSourceWorktreePath: async () => '',
  });
  return { session, snapshot, startWorkItemInExistingSession, prefillWorkItemForAgent, listSourceBranches, listSourceRepositories, cloneRepository, createAgent };
}

describe('repository session host choice', () => {
  it.each([true, false])('uses the remote engine through worktree reuse with local engine available=%s', async localAvailable => {
    const { session, snapshot, createAgent } = setup([]);
    snapshot.providerConnections = localAvailable ? [{ backend: 'codex', installed: true, connected: true, checking: false }] : [];
    snapshot.remoteConnections.connections[0]!.providerConnections = [{ backend: 'claude', installed: true, connected: true, checking: false }];
    await session.openWorktree({ repositoryName: 'korus', repositoryRoot: '/remote/repo', remoteConnectionId: 'devbox' });
    const wrapper = mount(defineComponent({ setup() {
      provideBackendChoices(() => snapshot, () => undefined);
      return () => h('div', [
        h(NewSourceWorktreeDialog, { visible: true, repo: { name: 'korus', path: '/remote/repo', worktrees: [] }, remoteConnectionId: 'devbox',
          backend: session.backend.value, 'onUpdate:backend': value => { session.backend.value = value; },
          branches: [{ name: 'existing', isDefault: true, worktreePath: '/remote/existing' }],
          chooseDestination: async () => null, suggestDestination: async () => '/remote/existing',
          createWorktree: async () => ({ name: 'existing', path: '/remote/existing' }), onCreated: session.createFromWorktree }),
        h(NewSourceWorktreeDialog, { visible: false, repo: null, backend: session.backend.value,
          'onUpdate:backend': value => { session.backend.value = value; }, chooseDestination: async () => null,
          suggestDestination: async () => '', createWorktree: async () => ({ name: '', path: '' }) }),
      ]);
    } }));
    try {
      await wrapper.get('.new-source-worktree-dialog__branch-input').setValue('existing');
      await flushPromises();
      const create = () => wrapper.get('.new-source-worktree-dialog .app-button--primary');
      expect(create().attributes('disabled')).toBeUndefined();
      await create().trigger('click');
      await create().trigger('click');
      await flushPromises();
      expect(createAgent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ folder: '/remote/existing', remoteConnectionId: 'devbox', selection: { backend: 'claude' } }));
      await session.openWorktree(source);
      expect(session.backend.value).toBe(localAvailable ? 'codex' : undefined);
    } finally { wrapper.unmount(); }
  });
  it('removes original-host sessions and catalog identity before looking up a missing checkout, and rejects stale submissions', async () => {
    const { session, snapshot, listSourceRepositories, startWorkItemInExistingSession, prefillWorkItemForAgent } = setup([]);
    const agent = snapshot.agents[0]!;
    agent.workspace = { kind: 'git', folder: source.repositoryRoot, repositoryRoot: source.repositoryRoot, primaryWorktreeRoot: source.repositoryRoot,
      repositoryName: 'korus', branch: 'main', isLinkedWorktree: false, updatedAt: '' };
    await session.open({ ...source, agentId: agent.id });
    expect(session.assignmentSessions.value.map(session => session.agentId)).toStrictEqual([agent.id]);
    let resolve!: (repositories: SourceRepository[]) => void;
    listSourceRepositories.mockImplementationOnce(() => new Promise(accept => { resolve = accept; }));
    const changing = session.changeHost('devbox');
    expect(session.assignmentSessions.value).toStrictEqual([]);
    expect(session.modelAgentId.value).toBeUndefined();
    resolve([]); await changing;
    expect(session.assignmentSessions.value).toStrictEqual([]);
    const item: WorkItem = { provider: 'github', id: 'issue', sourceId: 'nbonamy/korus', sourceName: 'korus', kind: 'issue', number: 1,
      title: 'Fix', url: '', state: 'open', labels: [], assignees: [], createdAt: '', updatedAt: '' };
    await session.startWork({ destination: 'existing', agentId: agent.id, item, action: 'fix' });
    await session.customizeWork({ destination: 'existing', agentId: agent.id, item });
    expect(startWorkItemInExistingSession).not.toHaveBeenCalled();
    expect(prefillWorkItemForAgent).not.toHaveBeenCalled();
    expect(session.visible.value).toBe(true);
    await session.changeHost(undefined);
    expect(session.assignmentSessions.value.map(session => session.agentId)).toStrictEqual([agent.id]);
    await session.startWork({ destination: 'existing', agentId: agent.id, item, action: 'fix' });
    expect(startWorkItemInExistingSession).toHaveBeenCalledExactlyOnceWith(agent.id, item, 'fix');
  });
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

  it.each(['catalog', 'checkout'] as const)('finds and clones a repository opened from its %s without an explicit origin', async entry => {
    const { session, cloneRepository, createAgent } = setup([]);
    await session.open({ repositoryName: source.repositoryName, repositoryRoot: source.repositoryRoot,
      ...(entry === 'catalog' ? { workSource: { provider: 'github' as const, id: 'nbonamy/korus', name: 'korus', fullName: 'nbonamy/korus', url: 'https://github.com/nbonamy/korus' } } : {}),
    });
    await session.changeHost('devbox');
    expect(session.hostCheckout.value?.state).toBe('missing');
    await session.createForSourceBranch({ name: 'feature', isDefault: false });
    expect(cloneRepository).toHaveBeenCalledExactlyOnceWith({ url: entry === 'catalog' ? 'https://github.com/nbonamy/korus' : 'https://github.com/nbonamy/korus.git', remoteConnectionId: 'devbox', reuseExisting: true });
    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({ folder: '/home/me/src/korus', remoteConnectionId: 'devbox' }));
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

  it.each(['resolve', 'reject'] as const)('ignores a stale clone %s after the dialog is replaced', async outcome => {
    let resolve!: (repository: SourceRepository) => void;
    let reject!: (error: Error) => void;
    let resolveNext!: (repository: SourceRepository) => void;
    const { session, createAgent, cloneRepository } = setup([], () => new Promise((accept, fail) => { resolve = accept; reject = fail; }));
    await session.open(source);
    await session.changeHost('devbox');
    const opening = session.createForSourceBranch({ name: 'main', isDefault: true });
    session.close();
    const replacement = { repositoryName: 'second', repositoryRoot: '/local/second', originUrl: 'https://github.com/org/second.git' };
    await session.open(replacement);
    await session.changeHost('devbox');
    cloneRepository.mockImplementationOnce(() => new Promise(accept => { resolveNext = accept; }));
    const nextOpening = session.createForSourceBranch({ name: 'main', isDefault: true });
    if (outcome === 'resolve') resolve(checkout('/remote/korus'));
    else reject(new Error('Old clone failed'));
    await opening;
    expect(createAgent).not.toHaveBeenCalled();
    expect(session.source.value).toStrictEqual(replacement);
    expect(session.visible.value).toBe(true);
    expect(session.hostCheckout.value?.state).toBe('missing');
    expect(session.error.value).toBeNull();
    expect(session.hostBusy.value).toBe(true);
    resolveNext({ name: 'second', path: '/remote/second', worktrees: [] });
    await nextOpening;
    expect(createAgent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ folder: '/remote/second', remoteConnectionId: 'devbox' }));
  });

  it('does not create an agent when a clone finishes after closing the dialog', async () => {
    let resolve!: (repository: SourceRepository) => void;
    const { session, createAgent } = setup([], () => new Promise(accept => { resolve = accept; }));
    await session.open(source);
    await session.changeHost('devbox');
    const opening = session.createForSourceBranch({ name: 'main', isDefault: true });
    session.close();
    resolve(checkout('/remote/korus'));
    await opening;
    expect(createAgent).not.toHaveBeenCalled();
    expect(session.source.value).toBeNull();
    expect(session.visible.value).toBe(false);
  });

  it('reports a machine that cannot be reached instead of listing it as empty', async () => {
    const { session, listSourceRepositories } = setup([]);
    await session.open(source);
    listSourceRepositories.mockRejectedValueOnce(new Error('Host unreachable'));
    await session.changeHost('devbox');
    expect(session.hostCheckout.value).toStrictEqual({ state: 'unreachable', message: 'Host unreachable' });
  });
});
