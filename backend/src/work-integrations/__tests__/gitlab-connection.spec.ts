import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { decodeAppSnapshot } from '@workspace/core/snapshot-guards';
import { AppBackendServer } from '../../server';
import { GitHubWorkProviderDriver } from '../github-driver';
import { GitLabWorkProviderDriver } from '../gitlab-driver';
import { WorkIntegrationManager } from '../manager';
import { FileWorkIntegrationTokenStore } from '../file-token-store';
import { MemoryWorkIntegrationTokenStore } from '../memory-token-store';

// Failure modes at this boundary: provider confusion/token leakage, missing private or
// subgroup projects/pages, incorrect default branch, expired/denied/late grants,
// rotating-token races, and partial catalogs presented as complete.
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const device = () => ({ device_code: 'private-device-code', user_code: 'ABCD1234', verification_uri: 'https://gitlab.com/oauth/device', expires_in: 300, interval: 5 });
const grant = () => ({ access_token: 'private-access', refresh_token: 'private-refresh', token_type: 'Bearer', expires_in: 7200, scope: 'api' });
const project = (namespace = 'group/subgroup', name = 'repo') => ({ id: 123, path: name, path_with_namespace: `${namespace}/${name}`, web_url: `https://gitlab.com/${namespace}/${name}`, visibility: 'private', last_activity_at: '2026-10-24T00:00:00Z' });

async function setup(clientId = 'korus-public-id') {
  const snapshot = createInitialSnapshot();
  const tokenStore = new MemoryWorkIntegrationTokenStore();
  await tokenStore.set({ provider: 'github', accessToken: 'github-secret', tokenType: 'Bearer', accountLabel: 'github-user', connectedAt: 'then' });
  const driver = new GitLabWorkProviderDriver(clientId);
  const options = { drivers: [new GitHubWorkProviderDriver('github-client'), driver], getSnapshot: () => snapshot, saveSnapshot: async () => {}, tokenStore };
  const manager = new WorkIntegrationManager(options);
  await manager.hydrateConnections();
  const upstream = vi.fn<typeof fetch>().mockImplementation(async input => {
    const url = String(input);
    if (url.endsWith('/oauth/authorize_device')) return Response.json(device());
    if (url.endsWith('/oauth/token')) return Response.json(grant());
    if (url.endsWith('/user')) return Response.json({ username: 'gitlab-user' });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', upstream);
  return { snapshot, tokenStore, driver, options, manager, upstream };
}

it('connects through the protocol, paginates private subgroup projects/branches and restores both providers independently', async () => {
  const { snapshot, manager, options, upstream, tokenStore } = await setup();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'korus-gitlab-'));
  const server = new AppBackendServer({ version: 'test', snapshot, workIntegrations: manager });
  async function rpc(method: string, params: Record<string, unknown>) {
    const response = await server.handleMessage({ jsonrpc: '2.0', id: method, method, params }) as { result?: unknown; error?: unknown };
    expect(response.error).toBeUndefined();
    return response.result;
  }
  try {
    const result = await rpc('workProvider/connect', { provider: 'gitlab' }) as { authorization: unknown };
    expect(result.authorization).toStrictEqual({ provider: 'gitlab', userCode: 'ABCD1234', verificationUri: 'https://gitlab.com/oauth/device', expiresAt: expect.any(String) });
    const body = new URLSearchParams(String(upstream.mock.calls[0]![1]?.body));
    expect(Object.fromEntries(body)).toStrictEqual({ client_id: 'korus-public-id', scope: 'api' });
    await rpc('workProvider/authorization/poll', { provider: 'gitlab' });
    expect(snapshot.workBacklog.connections).toContainEqual({ provider: 'gitlab', source: 'api', status: 'connected', hostedMcp: { status: 'authorizationRequired' }, accountLabel: 'gitlab-user', connectedAt: expect.any(String) });
    upstream.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer private-access');
      if (url.pathname === '/api/v4/projects') return Response.json([project(url.searchParams.get('page') === '2' ? 'other/nested' : 'group/subgroup')], { headers: { 'x-next-page': url.searchParams.get('page') === '2' ? '' : '2' } });
      if (url.pathname.endsWith('/repository/branches')) return Response.json(url.searchParams.get('page') === '2' ? [{ name: 'main', default: true }] : [{ name: 'topic', default: false }], { headers: { 'x-next-page': url.searchParams.get('page') === '2' ? '' : '2' } });
      throw new Error(`Unexpected API call: ${url}`);
    });
    expect(await rpc('workProvider/sources/list', { provider: 'gitlab' })).toStrictEqual(['group/subgroup', 'other/nested'].map(namespace => ({ provider: 'gitlab', id: `gitlab.com/${namespace}/repo`, owner: namespace, name: 'repo', fullName: `${namespace}/repo`, url: `https://gitlab.com/${namespace}/repo`, isPrivate: true, updatedAt: '2026-10-24T00:00:00Z' })));
    expect(await rpc('workProvider/branches/list', { provider: 'gitlab', sourceId: 'gitlab.com/group/subgroup/repo' })).toStrictEqual([{ name: 'main', isDefault: true }, { name: 'topic', isDefault: false }]);
    expect(upstream.mock.calls.some(([url]) => String(url).includes('group%2Fsubgroup%2Frepo/repository/branches'))).toBe(true);
    const fileStore = new FileWorkIntegrationTokenStore(path.join(directory, 'tokens.json'));
    for (const provider of ['github', 'gitlab'] as const) await fileStore.set((await tokenStore.get(provider))!);
    const restored = JSON.parse(JSON.stringify(snapshot));
    restored.workBacklog.providerSettings.gitlab = { oauthClientId: 'public-client' };
    restored.workBacklog.providerConfigurations.gitlab = { sourceId: 'gitlab.com/group/subgroup/repo' };
    expect(decodeAppSnapshot(restored)?.value).toStrictEqual(restored);
    const restarted = new WorkIntegrationManager({ ...options, getSnapshot: () => restored, tokenStore: new FileWorkIntegrationTokenStore(path.join(directory, 'tokens.json')) });
    await restarted.hydrateConnections();
    expect(restarted.isConnected('github')).toBe(true);
    expect(restarted.isConnected('gitlab')).toBe(true);
    await restarted.disconnect('gitlab');
    expect(await fileStore.get('gitlab')).toBeNull();
    expect(await restarted.authorizationHeader('github')).toBe('Bearer github-secret');
    await restarted.hydrateConnections();
    expect(restarted.isConnected('gitlab')).toBe(false);
    expect(JSON.stringify([result, snapshot, restored])).not.toMatch(/private-(access|refresh|device-code)|github-secret/);
    restarted.close();
  } finally { await server.close(); await rm(directory, { recursive: true, force: true }); }
});

it('resumes pending device authorization through the server without replacing its grant', async () => {
  const { manager, snapshot, upstream, tokenStore } = await setup();
  const server = new AppBackendServer({ version: 'test', snapshot, workIntegrations: manager });
  const rpc = async () => {
    const response = await server.handleMessage({ jsonrpc: '2.0', id: 'resume', method: 'workProvider/connect', params: { provider: 'gitlab' } }) as { result: { authorization: unknown } };
    return response.result;
  };
  const [first, concurrent] = await Promise.all([rpc(), rpc()]);
  expect(concurrent.authorization).toStrictEqual(first.authorization);
  const restored = await rpc();
  expect(restored.authorization).toStrictEqual(first.authorization);
  expect(upstream.mock.calls.filter(([url]) => String(url).endsWith('/oauth/authorize_device'))).toHaveLength(1);
  await manager.pollAuthorization('gitlab');
  expect(await tokenStore.get('gitlab')).toMatchObject({ accountLabel: 'gitlab-user' });
  expect(await manager.authorizationHeader('github')).toBe('Bearer github-secret');
});

it('restores an interrupted daemon login as reconnectable without replaying its device code', async () => {
  const { manager, snapshot, options, upstream } = await setup();
  await manager.connect('gitlab');
  const restarted = new WorkIntegrationManager(options);
  await restarted.hydrateConnections();
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'gitlab')).toMatchObject({
    status: 'disconnected', detail: { key: 'workProvider.authorizationExpired', params: { provider: 'GitLab' } },
  });
  expect(upstream.mock.calls.filter(([url]) => String(url).endsWith('/oauth/authorize_device'))).toHaveLength(1);
  await restarted.connect('gitlab');
  expect(upstream.mock.calls.filter(([url]) => String(url).endsWith('/oauth/authorize_device'))).toHaveLength(2);
  expect(restarted.isConnected('github')).toBe(true);
});

it('reports actionable missing app configuration without affecting GitHub', async () => {
  const { manager, snapshot, upstream } = await setup('');
  const result = await manager.connect('gitlab');
  expect(result.authorization).toBeUndefined();
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'gitlab')).toMatchObject({ status: 'notConfigured', detail: { key: 'gitlabIntegration.setup' } });
  expect(upstream).not.toHaveBeenCalled();
  expect(await manager.authorizationHeader('github')).toBe('Bearer github-secret');
});

it.each(['access_denied', 'expired_token'])('keeps %s authorization disconnected and retryable', async error => {
  const { manager, tokenStore, upstream } = await setup();
  await manager.connect('gitlab');
  upstream.mockResolvedValueOnce(Response.json({ error }, { status: 400 }));
  await manager.pollAuthorization('gitlab');
  expect(manager.isConnected('gitlab')).toBe(false);
  expect(await tokenStore.get('gitlab')).toBeNull();
  expect((await manager.connect('gitlab')).authorization?.provider).toBe('gitlab');
});

it('honors polling intervals and slow_down without exposing OAuth error bodies', async () => {
  const { manager, upstream, snapshot } = await setup();
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  await manager.connect('gitlab');
  upstream.mockResolvedValueOnce(Response.json({ error: 'slow_down' }, { status: 400 }));
  await manager.pollAuthorization('gitlab');
  now += 5_000;
  await manager.pollAuthorization('gitlab');
  expect(upstream).toHaveBeenCalledTimes(2);
  now += 5_000;
  upstream.mockResolvedValueOnce(Response.json({ error: 'server_error', error_description: 'private-access' }, { status: 500 }));
  await manager.pollAuthorization('gitlab');
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'gitlab')?.status).toBe('error');
  expect(JSON.stringify(snapshot)).not.toContain('private-access');
});

it.each(['disconnect', 'expiry', 'account lookup expiry'] as const)('rejects a late successful grant after %s', async transition => {
  const { manager, upstream, tokenStore, snapshot } = await setup();
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  await manager.connect('gitlab');
  let complete!: (response: Response) => void;
  if (transition === 'account lookup expiry') upstream.mockResolvedValueOnce(Response.json(grant()));
  upstream.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const pending = manager.pollAuthorization('gitlab');
  await vi.waitFor(() => expect(complete).toBeDefined());
  if (transition === 'disconnect') await manager.disconnect('gitlab');
  else now += 301_000;
  complete(Response.json(transition === 'account lookup expiry' ? { username: 'late' } : grant()));
  await pending;
  expect(manager.isConnected('gitlab')).toBe(false);
  expect(await tokenStore.get('gitlab')).toBeNull();
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'github')?.status).toBe('connected');
});

it('shares rotating refreshes, rejects stale token reads and never revives a disconnected account', async () => {
  const { manager, upstream, tokenStore, snapshot } = await setup();
  await manager.connect('gitlab');
  await manager.pollAuthorization('gitlab');
  const old = { ...(await tokenStore.get('gitlab'))!, expiresAt: '2000-01-01' };
  await tokenStore.set(old);
  let finishRead!: (token: typeof old) => void;
  vi.spyOn(tokenStore, 'get').mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
  const stale = manager.authorizationHeader('gitlab');
  upstream.mockResolvedValueOnce(Response.json({ ...grant(), access_token: 'rotated', refresh_token: 'rotated-refresh' }));
  expect(await Promise.all([manager.authorizationHeader('gitlab'), manager.authorizationHeader('gitlab')])).toStrictEqual(['Bearer rotated', 'Bearer rotated']);
  finishRead(old);
  expect(await stale).toBe('Bearer rotated');
  expect(upstream.mock.calls.filter(([url]) => String(url).endsWith('/oauth/token'))).toHaveLength(2);
  let finishRefresh!: (response: Response) => void;
  upstream.mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }));
  const late = manager.authorizationHeader('gitlab', { forceRefresh: true });
  const rejection = expect(late).rejects.toThrow();
  await vi.waitFor(() => expect(finishRefresh).toBeDefined());
  await manager.disconnect('gitlab');
  finishRefresh(Response.json(grant()));
  await rejection;
  expect(await tokenStore.get('gitlab')).toBeNull();
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'github')?.status).toBe('connected');
});

it.each([403, 429, 500])('fails a partial catalog on HTTP %s without returning incomplete discovery', async status => {
  const { manager, upstream } = await setup();
  await manager.connect('gitlab'); await manager.pollAuthorization('gitlab');
  upstream.mockResolvedValueOnce(Response.json([project()], { headers: { 'x-next-page': '2' } }));
  upstream.mockResolvedValueOnce(Response.json({ message: 'private-access' }, { status }));
  await expect(manager.listSources('gitlab')).rejects.toThrow(/GitLab/);
  expect(await manager.authorizationHeader('github')).toBe('Bearer github-secret');
});

it('rejects foreign repository identities and untrusted pagination links before credentials can leave GitLab', async () => {
  const { manager, upstream } = await setup();
  await manager.connect('gitlab'); await manager.pollAuthorization('gitlab');
  await expect(manager.listBranches('gitlab', 'github.com/group/repo')).rejects.toThrow(/Invalid GitLab/);
  upstream.mockResolvedValueOnce(Response.json([project()], { headers: { link: '<https://attacker.example/steal>; rel="next"' } }));
  await expect(manager.listSources('gitlab')).rejects.toThrow(/pagination/);
  expect(upstream.mock.calls.every(([url]) => new URL(String(url)).hostname === 'gitlab.com')).toBe(true);
});

it('follows Link pages and completes a full page when GitLab omits pagination headers', async () => {
  const { manager, upstream } = await setup();
  await manager.connect('gitlab'); await manager.pollAuthorization('gitlab');
  upstream.mockResolvedValueOnce(Response.json(Array.from({ length: 100 }, (_, i) => project('group', `repo${i}`))));
  upstream.mockResolvedValueOnce(Response.json([project('group', 'last')], { headers: { link: '<https://gitlab.com/api/v4/projects?min_access_level=10&per_page=100&page=3>; rel="next"' } }));
  upstream.mockResolvedValueOnce(Response.json([]));
  const sources = await manager.listSources('gitlab');
  expect(sources).toHaveLength(101);
  expect(sources.at(-1)?.id).toBe('gitlab.com/group/last');
  expect(upstream.mock.calls.slice(-2).map(([url]) => new URL(String(url)).searchParams.get('page'))).toStrictEqual(['2', '3']);
});

it.each(['invalid account', 'invalid grant', 'expired refresh'] as const)('requires reconnection after %s without changing GitHub', async failure => {
  const { manager, upstream, tokenStore, snapshot } = await setup();
  await manager.connect('gitlab');
  if (failure === 'invalid account') {
    upstream.mockResolvedValueOnce(Response.json(grant()));
    upstream.mockResolvedValueOnce(Response.json({ error: 'denied', detail: 'private-access' }, { status: 403 }));
  } else if (failure === 'invalid grant') {
    upstream.mockResolvedValueOnce(Response.json({ access_token: 'incomplete' }));
  }
  await manager.pollAuthorization('gitlab');
  if (failure === 'expired refresh') {
    await tokenStore.set({ ...(await tokenStore.get('gitlab'))!, expiresAt: '2000-01-01' });
    upstream.mockResolvedValueOnce(Response.json({ error: 'invalid_grant' }, { status: 400 }));
    await expect(manager.authorizationHeader('gitlab')).rejects.toThrow();
    await manager.hydrateConnections();
  }
  expect(manager.isConnected('gitlab')).toBe(false);
  expect(await tokenStore.get('gitlab')).toBeNull();
  expect(await manager.authorizationHeader('github')).toBe('Bearer github-secret');
  expect(JSON.stringify(snapshot)).not.toContain('private-access');
});

it('keeps GitLab connected when GitHub disconnects', async () => {
  const { manager, snapshot } = await setup();
  await manager.connect('gitlab'); await manager.pollAuthorization('gitlab');
  await manager.disconnect('github');
  expect(await manager.authorizationHeader('gitlab')).toBe('Bearer private-access');
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'gitlab')?.accountLabel).toBe('gitlab-user');
});
