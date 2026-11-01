import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { WorkIntegrationManager } from '../manager';
import { FileWorkIntegrationTokenStore } from '../file-token-store';
import { LinearWorkProviderDriver } from '../linear-driver';
import { GitHubWorkProviderDriver } from '../github-driver';
import { AppBackendServer } from '../../server';
import { decodeAppSnapshot } from '@workspace/core/snapshot-guards';

const managers: WorkIntegrationManager[] = [];
const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map(manager => manager.disconnect('linear')));
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function setup() {
  const callbackUri = 'http://127.0.0.1:5173/api/auth/callback/linear';
  const snapshot = createInitialSnapshot();
  const directory = await mkdtemp(path.join(tmpdir(), 'app-linear-test-'));
  temporaryDirectories.push(directory);
  const tokenPath = path.join(directory, 'tokens.json');
  const tokenStore = new FileWorkIntegrationTokenStore(tokenPath);
  const driver = new LinearWorkProviderDriver(() => ({ oauthClientId: 'public-client' }));
  const options = { drivers: [driver, new GitHubWorkProviderDriver('github-client')], getSnapshot: () => snapshot, saveSnapshot: async () => {}, tokenStore };
  const manager = new WorkIntegrationManager(options);
  managers.push(manager);
  const realFetch = globalThis.fetch;
  const upstream = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('http://127.0.0.1:')) return realFetch(url, init);
    if (String(url).endsWith('/graphql')) return Response.json({ data: { viewer: { name: 'Alex', organization: { name: 'Example' } } } });
    return Response.json({ access_token: 'access-secret', refresh_token: 'refresh-secret', token_type: 'Bearer', expires_in: 86400, scope: 'read write' });
  });
  vi.stubGlobal('fetch', upstream);
  return { manager, snapshot, tokenStore, callbackUri, upstream, options, realFetch, tokenPath };
}

describe('Linear OAuth through manager and HTTP callback', () => {
  it('rejects malformed HTTP targets without consuming the pending authorization', async () => {
    const { manager, callbackUri, realFetch, upstream, tokenStore } = await setup();
    const authorization = new URL((await manager.connect('linear')).authorization!.verificationUri);
    const callback = new URL(callbackUri);
    const response = await new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: callback.hostname, port: Number(callback.port) });
      let data = '';
      socket.setEncoding('utf8');
      socket.setTimeout(1_000, () => socket.destroy(new Error('Callback did not reject the malformed target.')));
      socket.on('error', reject);
      socket.on('data', chunk => { data += chunk; });
      socket.on('end', () => { socket.destroy(); resolve(data); });
      socket.on('connect', () => socket.write(`GET http://[ HTTP/1.1\r\nHost: ${callback.host}\r\nConnection: close\r\n\r\n`));
    });
    expect(response).toMatch(/^HTTP\/1\.1 400 /);
    expect(upstream).not.toHaveBeenCalled();
    expect(manager.isConnected('linear')).toBe(false);
    expect((await realFetch(`${callbackUri}?state=${authorization.searchParams.get('state')}&code=accepted`)).status).toBe(200);
    await manager.pollAuthorization('linear');
    expect(manager.isConnected('linear')).toBe(true);
    expect(await tokenStore.get('linear')).toMatchObject({ accessToken: 'access-secret' });
  });

  it('surfaces missing setup and permits retry after a callback port conflict', async () => {
    const { manager, snapshot, callbackUri, options } = await setup();
    const unconfigured = new WorkIntegrationManager({ ...options, drivers: [new LinearWorkProviderDriver(() => ({}))] });
    expect((await unconfigured.connect('linear')).authorization).toBeUndefined();
    expect(snapshot.workBacklog.connections.find(c => c.provider === 'linear')).toMatchObject({ status: 'notConfigured', detail: expect.stringContaining('client ID') });
    const blocker = createServer();
    await new Promise<void>(resolve => blocker.listen(Number(new URL(callbackUri).port), '127.0.0.1', resolve));
    try {
      expect((await manager.connect('linear')).authorization).toBeUndefined();
      expect(snapshot.workBacklog.connections.find(c => c.provider === 'linear')).toMatchObject({ status: 'error', detail: expect.stringContaining('callback port') });
    } finally {
      await new Promise<void>(resolve => blocker.close(() => resolve()));
    }
    expect((await manager.connect('linear')).authorization).toBeDefined();
  });

  it.each(['denied', 'exchange failure', 'malformed token', 'account failure', 'expired'] as const)('keeps %s retryable and never connected', async failure => {
    const { manager, snapshot, callbackUri, upstream, tokenStore, realFetch } = await setup();
    const url = new URL((await manager.connect('linear')).authorization!.verificationUri);
    if (failure === 'exchange failure') upstream.mockImplementationOnce(async () => Response.json({}, { status: 503 }));
    if (failure === 'malformed token') upstream.mockResolvedValueOnce(Response.json({ access_token: 'incomplete' }));
    if (failure === 'expired') {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 11 * 60_000);
    } else {
      const callback = `${callbackUri}?state=${url.searchParams.get('state')}&${failure === 'denied' ? 'error=access_denied' : 'code=accepted'}`;
      await realFetch(callback);
      if (failure === 'account failure') upstream.mockImplementationOnce(async () => Response.json({ errors: [{ message: 'denied' }] }));
    }
    await manager.pollAuthorization('linear');
    expect(snapshot.workBacklog.connections.find(c => c.provider === 'linear')?.status).toBe('error');
    expect(await tokenStore.get('linear')).toBeNull();
    vi.useRealTimers();
    expect((await manager.connect('linear')).authorization).toBeDefined();
  });

  it('does not resurrect credentials when disconnect races account lookup', async () => {
    const { manager, callbackUri, upstream, tokenStore, snapshot } = await setup();
    const url = new URL((await manager.connect('linear')).authorization!.verificationUri);
    await fetch(`${callbackUri}?state=${url.searchParams.get('state')}&code=accepted`);
    let resolveAccount!: (response: Response) => void;
    upstream.mockImplementationOnce(() => new Promise(resolve => { resolveAccount = resolve; }));
    const poll = manager.pollAuthorization('linear');
    await vi.waitFor(() => expect(resolveAccount).toBeDefined());
    await manager.disconnect('linear');
    resolveAccount(Response.json({ data: { viewer: { name: 'Stale account' } } }));
    await poll;
    expect(await tokenStore.get('linear')).toBeNull();
    expect(snapshot.workBacklog.connections.find(c => c.provider === 'linear')?.status).toBe('disconnected');
  });

  it('aborts an in-flight exchange on cancel and does not let it finish a replacement attempt', async () => {
    const { manager, callbackUri, upstream, tokenStore, realFetch } = await setup();
    const first = new URL((await manager.connect('linear')).authorization!.verificationUri);
    let finishExchange!: (response: Response) => void;
    let signal: AbortSignal | null | undefined;
    upstream.mockImplementationOnce((_url, init) => {
      signal = init?.signal;
      return new Promise(resolve => { finishExchange = resolve; });
    });
    const callback = realFetch(`${callbackUri}?state=${first.searchParams.get('state')}&code=old`);
    await vi.waitFor(() => expect(finishExchange).toBeDefined());
    await manager.disconnect('linear');
    expect(signal?.aborted).toBe(true);
    const next = await manager.connect('linear');
    finishExchange(Response.json({ access_token: 'stale', refresh_token: 'stale-refresh', token_type: 'Bearer', expires_in: 86400 }));
    expect((await callback).status).toBe(400);
    await manager.pollAuthorization('linear');
    expect(await tokenStore.get('linear')).toBeNull();
    expect(next.snapshot.workBacklog.connections.find(c => c.provider === 'linear')?.status).toBe('connecting');
  });

  it('coalesces rotating refreshes, restores after restart, and isolates GitHub on failure', async () => {
    const { manager, tokenStore, upstream, snapshot, options, tokenPath } = await setup();
    await tokenStore.set({ provider: 'github', accessToken: 'github-secret', tokenType: 'Bearer', connectedAt: '2026-01-01' });
    await tokenStore.set({ provider: 'linear', accessToken: 'expired', refreshToken: 'old-refresh', tokenType: 'Bearer', expiresAt: '2020-01-01', connectedAt: '2026-01-01', accountLabel: 'Alex' });
    expect(await Promise.all([manager.authorizationHeader('linear'), manager.authorizationHeader('linear')])).toEqual(['Bearer access-secret', 'Bearer access-secret']);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(String(upstream.mock.calls[0]![1]?.body)).get('refresh_token')).toBe('old-refresh');
    const restarted = new WorkIntegrationManager({ ...options, tokenStore: new FileWorkIntegrationTokenStore(tokenPath) });
    await restarted.hydrateConnections();
    expect(restarted.isConnected('linear')).toBe(true);
    upstream.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    await expect(restarted.authorizationHeader('linear', { forceRefresh: true })).rejects.toThrow();
    expect(restarted.isConnected('linear')).toBe(false);
    await restarted.hydrateConnections();
    expect(restarted.isConnected('linear')).toBe(false);
    expect(await restarted.authorizationHeader('github')).toBe('Bearer github-secret');
    expect(snapshot.workBacklog.connections.find(c => c.provider === 'github')?.status).toBe('connected');
  });

  it('rejects replay during exchange and a refresh completing after disconnect', async () => {
    const { manager, callbackUri, upstream, tokenStore, realFetch } = await setup();
    const url = new URL((await manager.connect('linear')).authorization!.verificationUri);
    let resolveExchange!: (response: Response) => void;
    upstream.mockImplementationOnce(() => new Promise(resolve => { resolveExchange = resolve; }));
    const callback = `${callbackUri}?state=${url.searchParams.get('state')}&code=once`;
    const response = realFetch(callback);
    await vi.waitFor(() => expect(resolveExchange).toBeDefined());
    expect((await realFetch(callback)).status).toBe(400);
    resolveExchange(Response.json({ access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 86400 }));
    expect((await response).status).toBe(200);
    await manager.pollAuthorization('linear');
    let resolveRefresh!: (response: Response) => void;
    upstream.mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve; }));
    const refresh = manager.authorizationHeader('linear', { forceRefresh: true });
    const rejection = expect(refresh).rejects.toThrow();
    await vi.waitFor(() => expect(resolveRefresh).toBeDefined());
    await manager.disconnect('linear');
    resolveRefresh(Response.json({ access_token: 'late', refresh_token: 'late-refresh', token_type: 'Bearer', expires_in: 86400 }));
    await rejection;
    expect(await tokenStore.get('linear')).toBeNull();
  });

  it('round trips Linear authorization through the app-owned backend protocol and snapshot decoder', async () => {
    const { manager, snapshot, callbackUri } = await setup();
    const server = new AppBackendServer({ version: 'test', snapshot, workIntegrations: manager });
    try {
      const result = await server.handleMessage({ jsonrpc: '2.0', id: 'connect', method: 'workProvider/connect', params: { provider: 'linear' } }) as { result: { snapshot: typeof snapshot; authorization: { verificationUri: string; flow: string } } };
      expect(result.result.authorization.flow).toBe('browser');
      expect(decodeAppSnapshot(result.result.snapshot)).not.toBeNull();
      const state = new URL(result.result.authorization.verificationUri).searchParams.get('state');
      await fetch(`${callbackUri}?state=${state}&code=accepted`);
      const completed = await server.handleMessage({ jsonrpc: '2.0', id: 'poll', method: 'workProvider/authorization/poll', params: { provider: 'linear' } }) as { result: typeof snapshot };
      expect(decodeAppSnapshot(completed.result)?.value.workBacklog.connections).toContainEqual({ provider: 'linear', status: 'connected', accountLabel: 'Alex · Example', connectedAt: expect.any(String) });
    } finally {
      await server.close();
    }
  });

  it('rejects stale state and disposes the listener on cancel without storing credentials', async () => {
    const { manager, tokenStore, callbackUri, upstream } = await setup();
    const first = new URL((await manager.connect('linear')).authorization!.verificationUri);
    const second = new URL((await manager.connect('linear')).authorization!.verificationUri);
    expect((await fetch(`${callbackUri}?state=${first.searchParams.get('state')}&code=old`)).status).toBe(400);
    expect(upstream.mock.calls.filter(([url]) => String(url).endsWith('/oauth/token'))).toHaveLength(0);
    await manager.disconnect('linear');
    await expect(fetch(`${callbackUri}?state=${second.searchParams.get('state')}&code=cancelled`)).rejects.toThrow();
    await manager.pollAuthorization('linear');
    expect(await tokenStore.get('linear')).toBeNull();
  });

  it('uses S256 PKCE and persists only after the browser callback succeeds', async () => {
    const { manager, snapshot, tokenStore, callbackUri, upstream } = await setup();
    const result = await manager.connect('linear');
    const url = new URL(result.authorization!.verificationUri);
    expect(url.origin + url.pathname).toBe('https://linear.app/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe('read,write');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5173/api/auth/callback/linear');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(await tokenStore.get('linear')).toBeNull();
    expect((await fetch(`${callbackUri}?state=${url.searchParams.get('state')}&code=accepted`)).status).toBe(200);
    await manager.pollAuthorization('linear');
    const exchange = upstream.mock.calls.find(([target]) => String(target).endsWith('/oauth/token'))!;
    const body = new URLSearchParams(String(exchange[1]?.body));
    expect(body.get('client_secret')).toBeNull();
    expect(body.get('redirect_uri')).toBe('http://127.0.0.1:5173/api/auth/callback/linear');
    expect(body.get('code')).toBe('accepted');
    expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
    expect(await tokenStore.get('linear')).toMatchObject({ provider: 'linear', accessToken: 'access-secret', refreshToken: 'refresh-secret', accountLabel: 'Alex · Example' });
    expect(snapshot.workBacklog.connections).toEqual([{ provider: 'github', status: 'disconnected' }, { provider: 'linear', status: 'connected', accountLabel: 'Alex · Example', connectedAt: expect.any(String) }]);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(snapshot)).not.toContain('secret');
  });
});
