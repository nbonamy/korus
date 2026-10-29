import { describe, expect, it, vi } from 'vitest';
import type { CloneSourceRepositoryInput, RemoteConnection, SourceRepository } from '@workspace/core/contracts';
import { useRemoteTarget, type RemoteTargetRequest } from '../use-remote-target';

const connection = (id: string, status: RemoteConnection['status'] = 'ready', sourceFolderPath?: string): RemoteConnection => ({
  id, kind: 'ssh', name: id, host: id, status, createdAt: '', updatedAt: '', ...(sourceFolderPath ? { sourceFolderPath } : {}),
});
const request: RemoteTargetRequest = { action: 'main', repositoryName: 'korus', repositoryKey: 'remote:github.com/nbonamy/korus', originUrl: 'git@github.com:nbonamy/korus.git' };
const checkout = (path: string, remoteIdentity = 'github.com/nbonamy/korus'): SourceRepository => ({ name: 'korus', path, remoteIdentity, worktrees: [] });

function setup(repositories: Record<string, SourceRepository[] | Error>, overrides: { clone?: (input: CloneSourceRepositoryInput) => Promise<SourceRepository> } = {}) {
  const store = new Map<string, string>();
  const list = vi.fn(async (id: string) => { const value = repositories[id]; if (value instanceof Error) throw value; return value ?? []; });
  const openMain = vi.fn().mockResolvedValue(undefined);
  const openWorktree = vi.fn().mockResolvedValue(undefined);
  const cloneRepository = vi.fn(overrides.clone ?? (async () => checkout('/home/me/src/korus')));
  const target = useRemoteTarget({
    connections: () => [connection('devbox', 'ready', '/home/me/src'), connection('offline', 'error'), connection('lab')],
    listSourceRepositories: list,
    cloneRepository, openMain, openWorktree,
    storage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => { store.set(key, value); } },
  });
  return { target, store, openMain, openWorktree, cloneRepository, list };
}

describe('remote target', () => {
  it('checks only the chosen machine on open and the others when they are chosen', async () => {
    const { target, list } = setup({ devbox: [checkout('/srv/korus')], lab: [checkout('/other', 'github.com/other/repo')] });
    await target.open(request);
    expect(target.readyConnections.value.map((item) => item.id)).toStrictEqual(['devbox', 'lab']);
    expect(target.checkouts.value).toStrictEqual({ devbox: { state: 'cloned', path: '/srv/korus' } });
    expect(list.mock.calls.map(([id]) => id)).toStrictEqual(['devbox']);

    target.selectedId.value = 'lab';
    await vi.waitFor(() => expect(target.checkouts.value.lab).toStrictEqual({ state: 'missing' }));
    expect(list.mock.calls.map(([id]) => id)).toStrictEqual(['devbox', 'lab']);

    target.selectedId.value = 'devbox';
    await Promise.resolve();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('reports where a missing repository will be cloned and why a machine cannot be checked', async () => {
    const { target } = setup({ devbox: [], lab: new Error('Host unreachable') });
    await target.open(request);
    expect(target.checkouts.value.devbox).toStrictEqual({ state: 'missing', cloneTo: '/home/me/src' });
    target.selectedId.value = 'lab';
    await vi.waitFor(() => expect(target.checkouts.value.lab).toStrictEqual({ state: 'unreachable', message: 'Host unreachable' }));
  });

  it('cannot clone a repository without an origin and never queries the machines', async () => {
    const list = vi.fn();
    const target = useRemoteTarget({ connections: () => [connection('devbox')], listSourceRepositories: list, cloneRepository: vi.fn(), openMain: vi.fn(), openWorktree: vi.fn() });
    await target.open({ ...request, originUrl: undefined });
    expect(target.checkouts.value.devbox).toStrictEqual({ state: 'noOrigin' });
    expect(target.canConfirm.value).toBe(false);
    expect(list).not.toHaveBeenCalled();
  });

  it('preselects the machine last used for the project', async () => {
    const { target, store } = setup({ devbox: [checkout('/srv/korus')], lab: [checkout('/lab/korus')] });
    store.set('remoteTarget:lastHost:remote:github.com/nbonamy/korus', 'lab');
    await target.open(request);
    expect(target.selectedId.value).toBe('lab');
    store.set('remoteTarget:lastHost:remote:github.com/nbonamy/korus', 'gone');
    await target.open(request);
    expect(target.selectedId.value).toBe('devbox');
  });

  it('opens an existing checkout without cloning and remembers the machine', async () => {
    const { target, store, openMain, cloneRepository } = setup({ devbox: [checkout('/srv/korus')] });
    await target.open(request);
    await target.confirm();
    expect(cloneRepository).not.toHaveBeenCalled();
    expect(openMain).toHaveBeenCalledExactlyOnceWith('/srv/korus', 'devbox', request, undefined);
    expect(store.get('remoteTarget:lastHost:remote:github.com/nbonamy/korus')).toBe('devbox');
    expect(target.visible.value).toBe(false);
  });

  it('hands the chosen engine and model to the conversation it opens, not to a worktree', async () => {
    const { target, openMain } = setup({ devbox: [checkout('/srv/korus')] });
    await target.open(request);
    target.selection.value = { backend: 'claude', model: 'sonnet', reasoningEffort: 'high', serviceTier: null };
    await target.confirm();
    expect(openMain).toHaveBeenCalledExactlyOnceWith('/srv/korus', 'devbox', request, { backend: 'claude', model: 'sonnet', reasoningEffort: 'high', serviceTier: null });
    await target.open(request);
    expect(target.selection.value).toBeUndefined();
  });

  it('clones from the origin first, then continues in the new checkout', async () => {
    const { target, openWorktree, cloneRepository } = setup({ devbox: [] });
    await target.open({ ...request, action: 'new-worktree' });
    await target.confirm();
    expect(cloneRepository).toHaveBeenCalledExactlyOnceWith({ url: request.originUrl, remoteConnectionId: 'devbox', reuseExisting: true });
    expect(openWorktree).toHaveBeenCalledExactlyOnceWith('/home/me/src/korus', 'devbox', { ...request, action: 'new-worktree' });
  });

  it('clones the stored origin with its git user restored, since persistence strips it', async () => {
    const { target, cloneRepository } = setup({ devbox: [] });
    await target.open({ ...request, originUrl: 'github.com:nbonamy/korus.git' });
    await target.confirm();
    expect(cloneRepository).toHaveBeenCalledExactlyOnceWith({ url: 'git@github.com:nbonamy/korus.git', remoteConnectionId: 'devbox', reuseExisting: true });
  });

  it('stops with the clone error and does not continue when the clone cannot authenticate', async () => {
    const clone = async (): Promise<SourceRepository> => { throw new Error('Could not access korus on github.com.'); };
    const { target, openMain, store } = setup({ devbox: [] }, { clone });
    await target.open(request);
    await target.confirm();
    expect(target.error.value).toBe('Could not access korus on github.com.');
    expect(target.visible.value).toBe(true);
    expect(target.busy.value).toBe(false);
    expect(openMain).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });
});
