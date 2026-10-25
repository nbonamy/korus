import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AppSnapshot } from '@workspace/core/contracts';
import { createClientApiMock } from '../test/client-api-mock';
import { configureAppClient } from '../platform-api';
import { createWorkProviderState } from '../work-provider-state';
import { clearConfetti, useConfetti } from '../shared/confetti/use-confetti';

afterEach(() => { clearConfetti(); vi.useRealTimers(); vi.restoreAllMocks(); configureAppClient(); });

describe('work provider authorization state', () => {
  it('passes explicit MCP authorization to the existing app-owned credential path', async () => {
    const snapshot = createInitialSnapshot();
    const { api } = createClientApiMock(snapshot);
    api.connectWorkProvider.mockResolvedValue({ snapshot });
    configureAppClient({ platform: 'desktop', api });
    const state = createWorkProviderState({ getSnapshot: () => snapshot, adoptSnapshot: () => {} });
    await state.connect('gitlab', { hostedMcp: true });
    expect(api.connectWorkProvider).toHaveBeenCalledWith('gitlab', { hostedMcp: true });
  });

  it('reports a denied MCP upgrade while retaining API access without celebrating a successful connection', async () => {
    clearConfetti();
    let snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{ provider: 'gitlab', status: 'connected', source: 'api', hostedMcp: { status: 'authorizationRequired' } }];
    const { api } = createClientApiMock(snapshot);
    api.connectWorkProvider.mockResolvedValue({ snapshot: { ...snapshot, workBacklog: { ...snapshot.workBacklog, connections: [{ provider: 'gitlab', status: 'connecting' }] } }, authorization: { provider: 'gitlab', userCode: 'PUBLIC', verificationUri: 'https://gitlab.com/oauth/device', expiresAt: '2099-01-01' } });
    api.pollWorkProviderAuthorization.mockResolvedValue({ ...snapshot, workBacklog: { ...snapshot.workBacklog, connections: [{ provider: 'gitlab', status: 'connected', source: 'api', detail: 'GitLab MCP authorization was denied.', hostedMcp: { status: 'authorizationRequired' } }] } });
    api.listWorkSources.mockResolvedValue([]);
    configureAppClient({ platform: 'desktop', api });
    const state = createWorkProviderState({ getSnapshot: () => snapshot, adoptSnapshot: value => { snapshot = value; } });
    await state.connect('gitlab', { hostedMcp: true });
    await state.completeConnection('gitlab');
    expect(state.authorizationErrors.value.gitlab).toBe('GitLab MCP authorization was denied.');
    expect(snapshot.workBacklog.connections[0]?.status).toBe('connected');
    expect(useConfetti().bursts.value).toHaveLength(0);
  });

  it('keeps catalog failures and recovery local to the provider while other catalogs remain usable', async () => {
    let snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{ provider: 'github', status: 'connected' }, { provider: 'gitlab', status: 'connected' }];
    const { api } = createClientApiMock(snapshot);
    api.listWorkSources.mockImplementation(async provider => {
      if (provider === 'gitlab') throw new Error('GitLab rate limit reached. Retry later.');
      return [{ provider, id: 'org/repo', name: 'repo', fullName: 'org/repo', url: 'https://github.com/org/repo' }];
    });
    api.configureWorkBacklog.mockResolvedValue(snapshot);
    api.listWorkItems.mockResolvedValue([]);
    configureAppClient({ platform: 'desktop', api });
    const state = createWorkProviderState({ getSnapshot: () => snapshot, adoptSnapshot: value => { snapshot = value; } });
    await state.loadConnected();
    expect(state.catalogState('github')).toStrictEqual({ status: 'loaded', error: null });
    expect(state.catalogState('gitlab')).toStrictEqual({ status: 'error', error: 'GitLab rate limit reached. Retry later.' });
    expect(state.repositoriesByProvider.value.github).toHaveLength(1);
    api.listWorkSources.mockResolvedValue([]);
    await state.loadRepositories('gitlab');
    expect(state.catalogState('gitlab')).toStrictEqual({ status: 'loaded', error: null });
    expect(state.catalogState('github')).toStrictEqual({ status: 'loaded', error: null });
  });
  it('isolates background authorization transport failures and recovers without losing another connection', async () => {
    vi.useFakeTimers();
    let snapshot = createInitialSnapshot();
    const { api } = createClientApiMock(snapshot);
    api.connectWorkProvider.mockImplementation(async provider => {
      const next = structuredClone(snapshot);
      next.workBacklog.connections = [...next.workBacklog.connections.filter(c => c.provider !== provider), { provider, status: 'connecting' }];
      return { snapshot: next, authorization: { provider, userCode: provider, verificationUri: `https://${provider}.com/oauth/device`, expiresAt: '2099-01-01' } };
    });
    let gitlabOffline = true;
    api.pollWorkProviderAuthorization.mockImplementation(async provider => {
      if (provider === 'gitlab' && gitlabOffline) throw new Error('GitLab is temporarily unreachable');
      const next = structuredClone(snapshot);
      next.workBacklog.connections = next.workBacklog.connections.map(c => c.provider === provider ? { provider, status: 'connected', accountLabel: provider } : c);
      return next;
    });
    api.listWorkSources.mockResolvedValue([]);
    api.disconnectWorkProvider.mockImplementation(async provider => {
      const next = structuredClone(snapshot);
      next.workBacklog.connections = next.workBacklog.connections.filter(c => c.provider !== provider);
      return next;
    });
    configureAppClient({ platform: 'desktop', api });
    const state = createWorkProviderState({ getSnapshot: () => snapshot, adoptSnapshot: value => { snapshot = value; } });
    await state.connect('github'); await state.connect('gitlab');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state.authorizationErrors.value).toStrictEqual({ gitlab: 'GitLab is temporarily unreachable' });
    expect(state.authorizations.value.gitlab?.userCode).toBe('gitlab');
    expect(snapshot.workBacklog.connections.find(c => c.provider === 'github')?.status).toBe('connected');
    gitlabOffline = false;
    await state.connect('gitlab'); // recover the same backend grant and resume polling
    expect(state.authorizationErrors.value).toStrictEqual({});
    await vi.advanceTimersByTimeAsync(5_000);
    expect(snapshot.workBacklog.connections.filter(c => c.status === 'connected')).toHaveLength(2);
    await state.disconnect('gitlab'); await state.disconnect('github');
  });

  it('retains GitHub catalogs, work and polling when GitLab disconnects', async () => {
    vi.useFakeTimers();
    let snapshot = createInitialSnapshot();
    const { api } = createClientApiMock(snapshot);
    api.connectWorkProvider.mockImplementation(async provider => {
      const next = structuredClone(snapshot);
      next.workBacklog.connections = [...next.workBacklog.connections.filter(c => c.provider !== provider), { provider, status: 'connecting' }];
      return { snapshot: next, authorization: { provider, userCode: provider, verificationUri: provider === 'gitlab' ? 'https://gitlab.com/oauth/device' : 'https://github.com/login/device', expiresAt: '2099-01-01' } };
    });
    api.disconnectWorkProvider.mockImplementation(async provider => {
      const next = structuredClone(snapshot);
      next.workBacklog.connections = next.workBacklog.connections.filter(c => c.provider !== provider);
      return next;
    });
    api.pollWorkProviderAuthorization.mockImplementation(async () => structuredClone(snapshot));
    configureAppClient({ platform: 'desktop', api });
    const state = createWorkProviderState({ getSnapshot: () => snapshot, adoptSnapshot: value => { snapshot = value; } });
    await state.connect('github'); await state.connect('gitlab');
    state.itemsByRepository.value = { 'github:org/repo': [], 'gitlab:gitlab.com/org/repo': [] };
    state.repositoriesByProvider.value = { github: [], gitlab: [] };
    await state.disconnect('gitlab');
    expect(state.itemsByRepository.value).toStrictEqual({ 'github:org/repo': [] });
    expect(state.authorizations.value.github?.userCode).toBe('github');
    expect(state.authorizations.value.gitlab).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(api.pollWorkProviderAuthorization.mock.calls).toStrictEqual([['github']]);
    await state.disconnect('github');
  });

  it('reports a failed direct GitHub connect while CLI access stays connected', async () => {
    let snapshot = createInitialSnapshot();
    const { api } = createClientApiMock(snapshot);
    api.connectWorkProvider.mockImplementation(async () => {
      const next = structuredClone(snapshot);
      next.workBacklog.connections = [{ provider: 'github', source: 'cli', status: 'connected', accountLabel: 'alice', detail: 'GitHub OAuth is not configured.' }];
      return { snapshot: next };
    });
    configureAppClient({ platform: 'desktop', api });
    const state = createWorkProviderState({ getSnapshot: () => snapshot, adoptSnapshot: value => { snapshot = value; } });

    await state.connect('github');

    expect(state.status.value).toBe('error');
    expect(state.error.value).toBe('GitHub OAuth is not configured.');
  });

  it('keeps GitHub authorization alive when Linear is connected and then cancelled', async () => {
    vi.useFakeTimers();
    let snapshot = createInitialSnapshot();
    const { api } = createClientApiMock(snapshot);
    const githubAuthorization = { provider: 'github' as const, userCode: 'ABCD', verificationUri: 'https://github.com/login/device', expiresAt: '2026-12-01' };
    const linearAuthorization = { provider: 'linear' as const, flow: 'browser' as const, verificationUri: 'https://linear.app/oauth/authorize', expiresAt: '2026-12-01' };
    let finishGitHub!: () => void;
    const githubReady = new Promise<void>(resolve => { finishGitHub = resolve; });
    api.connectWorkProvider.mockImplementation(async provider => {
      if (provider === 'github') await githubReady;
      const next = structuredClone(snapshot);
      next.workBacklog.connections = [...next.workBacklog.connections.filter(connection => connection.provider !== provider), { provider, status: 'connecting' }];
      return { snapshot: next, authorization: provider === 'github' ? githubAuthorization : linearAuthorization };
    });
    api.disconnectWorkProvider.mockImplementation(async provider => {
      const next = structuredClone(snapshot);
      next.workBacklog.connections = next.workBacklog.connections.map(connection => connection.provider === provider ? { provider, status: 'disconnected' } : connection);
      return next;
    });
    api.pollWorkProviderAuthorization.mockImplementation(async () => structuredClone(snapshot));
    configureAppClient({ platform: 'desktop', api });
    vi.spyOn(window, 'open').mockReturnValue(null);
    const state = createWorkProviderState({ getSnapshot: () => snapshot, adoptSnapshot: value => { snapshot = value; } });
    const connectingGitHub = state.connect('github');
    await state.connect('linear');
    finishGitHub();
    await connectingGitHub;
    await state.disconnect('linear');
    expect(state.authorization.value).toStrictEqual(githubAuthorization);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.pollWorkProviderAuthorization.mock.calls).toStrictEqual([['github'], ['github']]);
    await state.disconnect('github');
  });

  it.each([
    { status: 'notConfigured' as const, detail: { key: 'workProvider.oauthNotConfigured', params: { provider: 'GitHub' } }, message: 'GitHub OAuth is not configured.' },
    { status: 'error' as const, detail: 'GitHub authorization request failed.', message: 'GitHub authorization request failed.' },
  ])('surfaces a $status connection result instead of silently treating it as success', async ({ status, detail, message }) => {
    vi.useFakeTimers();
    let snapshot = createInitialSnapshot();
    const { api } = createClientApiMock(snapshot);
    const failed = structuredClone(snapshot);
    failed.workBacklog.connections = [{ provider: 'github', status, detail }];
    api.connectWorkProvider.mockResolvedValue({ snapshot: failed });
    configureAppClient({ platform: 'desktop', api });
    const state = createWorkProviderState({ getSnapshot: () => snapshot, adoptSnapshot: value => { snapshot = value; } });

    await state.connect('github');

    expect(snapshot).toStrictEqual(failed);
    expect(state.status.value).toBe('error');
    expect(state.error.value).toBe(message);
    expect(state.authorization.value).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.pollWorkProviderAuthorization).not.toHaveBeenCalled();
  });

  it('finishes Linear authorization without leaving settings busy or loading GitHub repositories', async () => {
    let snapshot = createInitialSnapshot();
    const { api } = createClientApiMock(snapshot);
    const connected = structuredClone(snapshot);
    connected.workBacklog.connections.push({ provider: 'linear', status: 'connected', accountLabel: 'Alex' });
    api.pollWorkProviderAuthorization.mockResolvedValue(connected);
    configureAppClient({ platform: 'desktop', api });
    const state = createWorkProviderState({ getSnapshot: () => snapshot, adoptSnapshot: value => { snapshot = value; } });
    await state.completeConnection('linear');
    expect(state.status.value).toBe('loaded');
    expect(snapshot.workBacklog.connections[1]?.accountLabel).toBe('Alex');
    expect(api.listWorkSources).toHaveBeenCalledWith('linear');
  });

  it('opens Linear on connect, allows reopening, and ignores a poll that finishes after cancellation', async () => {
    vi.useFakeTimers();
    let snapshot = createInitialSnapshot();
    const { api } = createClientApiMock(snapshot);
    const connecting = structuredClone(snapshot);
    connecting.workBacklog.connections.push({ provider: 'linear', status: 'connecting' });
    const connected = structuredClone(connecting);
    connected.workBacklog.connections[1] = { provider: 'linear', status: 'connected', accountLabel: 'Alex' };
    const disconnected = structuredClone(snapshot);
    disconnected.workBacklog.connections.push({ provider: 'linear', status: 'disconnected' });
    api.connectWorkProvider.mockResolvedValue({ snapshot: connecting, authorization: { provider: 'linear', flow: 'browser', verificationUri: 'https://linear.app/oauth/authorize?state=public', expiresAt: '2026-10-04' } });
    const openExternal = vi.spyOn(window, 'open').mockReturnValue(null);
    api.disconnectWorkProvider.mockResolvedValue(disconnected);
    let completePoll!: (value: AppSnapshot) => void;
    api.pollWorkProviderAuthorization.mockImplementation(() => new Promise(resolve => { completePoll = resolve; }));
    configureAppClient({ platform: 'desktop', api });
    const state = createWorkProviderState({ getSnapshot: () => snapshot, adoptSnapshot: value => { snapshot = value; } });
    await state.connect('linear');
    expect(openExternal).toHaveBeenCalledWith('https://linear.app/oauth/authorize?state=public', '_blank', 'noopener,noreferrer');
    expect(openExternal).toHaveBeenCalledTimes(1);
    await state.openAuthorization('linear');
    expect(openExternal).toHaveBeenCalledTimes(2);
    const poll = state.completeConnection('linear');
    await state.disconnect('linear');
    completePoll(connected);
    await poll;
    expect(snapshot.workBacklog.connections[1]?.status).toBe('disconnected');
    expect(state.authorization.value).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.pollWorkProviderAuthorization).toHaveBeenCalledTimes(1);
    expect(api.listWorkSources).not.toHaveBeenCalled();
  });
});
