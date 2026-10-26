import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AppMcpService } from '../service';
import { afterEach, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { decodeAppSnapshot } from '@workspace/core/snapshot-guards';
import { WorkIntegrationManager } from '../../work-integrations/manager';
import { MemoryWorkIntegrationTokenStore } from '../../work-integrations/memory-token-store';
import { GitLabWorkProviderDriver } from '../../work-integrations/gitlab-driver';
import { GitHubWorkProviderDriver } from '../../work-integrations/github-driver';
import { HostedMcpGateway } from '../hosted-mcp-gateway';
import { AppBackendServer } from '../../server';
import { buildAppThreadConfig } from '../codex-config';

const nativeFetch = fetch;
const managers: WorkIntegrationManager[] = [];
afterEach(() => { managers.splice(0).forEach(manager => manager.close()); vi.unstubAllGlobals(); });
async function setup(scope = 'api') {
  const snapshot = createInitialSnapshot();
  const tokenStore = new MemoryWorkIntegrationTokenStore();
  for (const provider of ['github', 'gitlab'] as const) await tokenStore.set({ provider, scope, accessToken: `${provider}-secret`, refreshToken: `${provider}-refresh`, tokenType: 'Bearer', accountLabel: `${provider}-user`, connectedAt: 'then' });
  const upstream = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/oauth/authorize_device')) return Response.json({ device_code: 'device-secret', user_code: 'CODE', verification_uri: 'https://gitlab.com/oauth/device', expires_in: 300, interval: 1 });
    if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'gitlab-upgraded-secret', refresh_token: 'rotated-secret', scope: 'api mcp', token_type: 'Bearer', expires_in: 7200 });
    if (url.endsWith('/user')) return Response.json({ username: 'gitlab-user' });
    if (url.includes('/projects?')) return Response.json([]);
    if (url.endsWith('/mcp')) {
      const request = init?.body ? JSON.parse(String(init.body)) : {};
      if (request.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'gitlab', version: '1' } } });
      if (request.method === 'tools/call') return Response.json({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: JSON.stringify({ project: 'group/subgroup/repo', issue: 1 }) }] } });
      if (request.method === 'tools/list') return Response.json({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'get_issue', inputSchema: { type: 'object' } }] } });
      return new Response(null, { status: 202 });
    }
    throw new Error('Unexpected external request');
  });
  vi.stubGlobal('fetch', upstream);
  const options = { drivers: [new GitHubWorkProviderDriver('github-public'), new GitLabWorkProviderDriver('gitlab-public')], tokenStore, getSnapshot: () => snapshot, saveSnapshot: async () => {} };
  const manager = new WorkIntegrationManager(options); managers.push(manager);
  await manager.hydrateConnections();
  const gateway = new HostedMcpGateway({ credentials: manager, fetch: upstream });
  return { snapshot, manager, tokenStore, upstream, gateway, options };
}
const input = () => ({ method: 'POST', headers: new Headers({ 'content-type': 'application/json', authorization: 'Bearer client-secret' }), body: Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/list' })) });

it('requires an explicit MCP grant upgrade, restores it and supplies only local URLs alongside GitHub', async () => {
  const { snapshot, manager, upstream, tokenStore, gateway, options } = await setup();
  expect(manager.isHostedMcpConnected('github')).toBe(true);
  expect(manager.isHostedMcpConnected('gitlab')).toBe(false);
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'gitlab')?.hostedMcp?.status).toBe('authorizationRequired');
  expect(await manager.listSources('gitlab')).toStrictEqual([]);
  const server = new AppBackendServer({ version: 'test', snapshot, workIntegrations: manager });
  const response = await server.handleMessage({ jsonrpc: '2.0', id: 'mcp-connect', method: 'workProvider/connect', params: { provider: 'gitlab', options: { hostedMcp: true } } });
  expect(response).toHaveProperty('result.authorization.userCode', 'CODE');
  await expect(server.handleMessage({ jsonrpc: '2.0', id: 'invalid', method: 'workProvider/connect', params: { provider: 'gitlab', options: { hostedMcp: 'yes' } } })).rejects.toThrow('hostedMcp must be a boolean.');
  expect(new URLSearchParams(upstream.mock.calls.find(([url]) => String(url).endsWith('/authorize_device'))![1]!.body as string).get('scope')).toBe('api mcp');
  expect(await manager.authorizationHeader('gitlab')).toBe('Bearer gitlab-secret');
  await manager.pollAuthorization('gitlab');
  expect(manager.isHostedMcpConnected('gitlab')).toBe(true);
  expect(await tokenStore.get('gitlab')).toMatchObject({ scope: 'api mcp' });
  const urls = gateway.enabledServerUrls('http://127.0.0.1:4321/mcp');
  expect(urls).toStrictEqual({ github: 'http://127.0.0.1:4321/mcp/providers/github', gitlab: 'http://127.0.0.1:4321/mcp/providers/gitlab' });
  const config = buildAppThreadConfig(snapshot.agents[0]!, 'http://127.0.0.1:4321/mcp', undefined, {}, urls);
  expect(config.config).toHaveProperty('mcp_servers.gitlab.url', `http://127.0.0.1:4321/mcp/providers/gitlab?agentId=${snapshot.agents[0]!.id}`);
  expect(config.config).not.toHaveProperty('mcp_servers.gitlab.default_tools_approval_mode');
  expect(JSON.stringify([config, snapshot])).not.toMatch(/gitlab-secret|github-secret|rotated-secret|upgraded-secret|device-secret|Bearer /);
  expect(decodeAppSnapshot(snapshot)).toStrictEqual({ value: snapshot });
  const restored = new WorkIntegrationManager(options); managers.push(restored);
  await restored.hydrateConnections();
  expect(restored.isHostedMcpConnected('gitlab')).toBe(true);
  await manager.disconnect('gitlab');
  expect(manager.isHostedMcpConnected('gitlab')).toBe(false);
  await expect(gateway.forward('gitlab', input())).rejects.toThrow();
  expect(manager.isHostedMcpConnected('github')).toBe(true);
  await server.close();
});

it.each(['denied', 'cancelled', 'expired', 'account-switch'] as const)('retains native credentials and GitHub when MCP upgrade is %s', async outcome => {
  const { manager, upstream, tokenStore } = await setup();
  await manager.connect('gitlab', { hostedMcp: true });
  if (outcome === 'cancelled') await manager.disconnect('gitlab');
  else {
    const original = upstream.getMockImplementation()!;
    upstream.mockImplementation(async (url, init) => String(url).endsWith('/oauth/token') && outcome !== 'account-switch'
      ? Response.json({ error: outcome === 'expired' ? 'expired_token' : 'access_denied' })
      : String(url).endsWith('/user') ? Response.json({ username: 'unexpected-user' }) : original(url, init));
    await manager.pollAuthorization('gitlab');
  }
  expect(await manager.authorizationHeader('gitlab')).toBe('Bearer gitlab-secret');
  expect(manager.isConnected('gitlab')).toBe(true);
  expect(manager.isHostedMcpConnected('gitlab')).toBe(false);
  expect(await manager.listSources('gitlab')).toStrictEqual([]);
  expect(await tokenStore.get('github')).toMatchObject({ accessToken: 'github-secret' });
});

it('requests the MCP scope up front on a first GitLab connection and ends with a usable MCP grant', async () => {
  const { manager, upstream, tokenStore, snapshot } = await setup();
  await manager.disconnect('gitlab');
  const result = await manager.connect('gitlab', { hostedMcp: true });
  expect(result.authorization).toHaveProperty('userCode', 'CODE');
  expect(new URLSearchParams(upstream.mock.calls.find(([url]) => String(url).endsWith('/authorize_device'))![1]!.body as string).get('scope')).toBe('api mcp');
  await manager.pollAuthorization('gitlab');
  expect(await tokenStore.get('gitlab')).toMatchObject({ scope: 'api mcp' });
  expect(manager.isHostedMcpConnected('gitlab')).toBe(true);
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'gitlab')).toMatchObject({ status: 'connected', source: 'api', hostedMcp: { status: 'available' } });
});

it('isolates a refused eligibility check from API connectivity', async () => {
  const { manager, upstream, snapshot, options } = await setup('api mcp');
  expect(manager.isHostedMcpConnected('gitlab')).toBe(true);
  upstream.mockResolvedValue(new Response('private secret upstream details', { status: 403 }));
  const restored = new WorkIntegrationManager(options); managers.push(restored);
  await restored.hydrateConnections();
  expect(restored.isHostedMcpConnected('gitlab')).toBe(false);
  expect(restored.isConnected('gitlab')).toBe(true);
  expect(restored.isHostedMcpConnected('github')).toBe(true);
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'gitlab')?.hostedMcp?.status).toBe('unavailable');
  expect(JSON.stringify(snapshot)).not.toContain('private secret');
});

it('rejects cached MCP URLs without a grant and isolates a later refusal', async () => {
  const { manager, gateway, upstream, tokenStore, snapshot } = await setup();
  upstream.mockClear();
  await expect(gateway.forward('gitlab', input())).rejects.toThrow();
  expect(upstream).not.toHaveBeenCalled();
  await tokenStore.set({ ...(await tokenStore.get('gitlab'))!, scope: 'api mcp' });
  // Revalidate the same direct connection after the owner grants MCP scope.
  const original = (await setup('api mcp')).upstream.getMockImplementation()!;
  upstream.mockImplementation(original);
  await manager.hydrateConnections();
  upstream.mockResolvedValueOnce(new Response('sensitive upstream details', { status: 403 }));
  expect((await gateway.forward('gitlab', input())).status).toBe(403);
  expect(manager.isConnected('gitlab')).toBe(true);
  expect(manager.isHostedMcpConnected('gitlab')).toBe(false);
  expect(manager.isHostedMcpConnected('github')).toBe(true);
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'gitlab')?.hostedMcp?.status).toBe('unavailable');
  expect(JSON.stringify(snapshot)).not.toContain('sensitive upstream details');
});

it('shares rotating refreshes and refuses late credentials after disconnect or scope loss', async () => {
  const { manager, gateway, upstream, tokenStore } = await setup('api mcp');
  const original = upstream.getMockImplementation()!;
  let finish!: (response: Response) => void;
  let refreshing = false;
  upstream.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/oauth/token')) { refreshing = true; return new Promise(resolve => { finish = resolve; }); }
    return original(url, init);
  });
  const first = manager.authorizationHeader('gitlab', { forceRefresh: true });
  const second = manager.authorizationHeader('gitlab', { forceRefresh: true });
  await vi.waitFor(() => expect(refreshing).toBe(true));
  finish(Response.json({ access_token: 'next-secret', refresh_token: 'next-refresh', scope: 'api', token_type: 'Bearer', expires_in: 7200 }));
  expect(await Promise.all([first, second])).toStrictEqual(['Bearer next-secret', 'Bearer next-secret']);
  expect(upstream.mock.calls.filter(([url]) => String(url).endsWith('/oauth/token'))).toHaveLength(1);
  await expect(gateway.forward('gitlab', input())).rejects.toThrow();
  expect(manager.isConnected('gitlab')).toBe(true);
  expect(manager.isHostedMcpConnected('gitlab')).toBe(false);
  refreshing = false;
  const late = manager.authorizationHeader('gitlab', { forceRefresh: true });
  const rejected = expect(late).rejects.toThrow();
  await vi.waitFor(() => expect(refreshing).toBe(true));
  await manager.disconnect('gitlab');
  finish(Response.json({ access_token: 'late-secret', refresh_token: 'late-refresh', scope: 'api mcp', token_type: 'Bearer', expires_in: 7200 }));
  await rejected;
  expect(await tokenStore.get('gitlab')).toBeNull();
  expect(manager.isHostedMcpConnected('github')).toBe(true);
});

it.each(['start', 'cancel'] as const)('keeps an in-flight native refresh usable across MCP upgrade %s', async phase => {
  const { manager, upstream, tokenStore } = await setup();
  const original = upstream.getMockImplementation()!;
  let finish!: (response: Response) => void;
  let refreshing = false;
  upstream.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/oauth/token')) { refreshing = true; return new Promise(resolve => { finish = resolve; }); }
    return original(url, init);
  });
  if (phase === 'cancel') await manager.connect('gitlab', { hostedMcp: true });
  const refresh = manager.authorizationHeader('gitlab', { forceRefresh: true });
  const expected = expect(refresh).resolves.toBe('Bearer native-rotated-secret');
  await vi.waitFor(() => expect(refreshing).toBe(true));
  if (phase === 'start') await manager.connect('gitlab', { hostedMcp: true });
  else await manager.disconnect('gitlab');
  finish(Response.json({ access_token: 'native-rotated-secret', refresh_token: 'native-rotated-refresh', scope: 'api', token_type: 'Bearer', expires_in: 7200 }));
  await expected;
  expect(await tokenStore.get('gitlab')).toMatchObject({ accessToken: 'native-rotated-secret' });
  expect(await manager.authorizationHeader('github')).toBe('Bearer github-secret');
});

it('rolls back only the pending MCP credential if cancellation races its storage write', async () => {
  const { manager, tokenStore, upstream } = await setup();
  const original = upstream.getMockImplementation()!;
  upstream.mockImplementation(async (url, init) => String(url).endsWith('/oauth/token') && new URLSearchParams(String(init?.body)).get('grant_type') === 'refresh_token'
    ? Response.json({ access_token: 'native-rotated-secret', refresh_token: 'native-rotated-refresh', scope: 'api', token_type: 'Bearer', expires_in: 7200 }) : original(url, init));
  await manager.connect('gitlab', { hostedMcp: true });
  const write = tokenStore.set.bind(tokenStore);
  let finish!: () => void;
  let writing = false;
  vi.spyOn(tokenStore, 'set').mockImplementation(async token => {
    if (token.accessToken === 'gitlab-upgraded-secret') { writing = true; await new Promise<void>(resolve => { finish = resolve; }); }
    await write(token);
  });
  const poll = manager.pollAuthorization('gitlab');
  await vi.waitFor(() => expect(writing).toBe(true));
  const refresh = manager.authorizationHeader('gitlab', { forceRefresh: true });
  const refreshed = expect(refresh).resolves.toBe('Bearer native-rotated-secret');
  await new Promise(resolve => setTimeout(resolve, 10));
  const cancel = manager.disconnect('gitlab');
  finish();
  await Promise.all([poll, cancel, refreshed]);
  expect(await manager.authorizationHeader('gitlab')).toBe('Bearer native-rotated-secret');
  expect(manager.isConnected('gitlab')).toBe(true);
  expect(manager.isHostedMcpConnected('gitlab')).toBe(false);
});

it('does not let late eligibility failure overwrite a canceled upgrade or a fresh grant', async () => {
  const { manager, upstream, snapshot } = await setup();
  await manager.connect('gitlab', { hostedMcp: true });
  const original = upstream.getMockImplementation()!;
  let finish!: (response: Response) => void;
  let checking = false;
  upstream.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/mcp')) { checking = true; return new Promise(resolve => { finish = resolve; }); }
    return original(url, init);
  });
  const poll = manager.pollAuthorization('gitlab');
  await vi.waitFor(() => expect(checking).toBe(true));
  await manager.disconnect('gitlab');
  finish(new Response('upstream denial', { status: 403 }));
  await poll;
  expect(await manager.authorizationHeader('gitlab')).toBe('Bearer gitlab-secret');
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'gitlab')).toMatchObject({ status: 'connected', hostedMcp: { status: 'authorizationRequired' } });
});

it('initializes, lists and calls native tools through the agent-authorized daemon URL', async () => {
  const { snapshot, manager, gateway, upstream } = await setup('api mcp');
  const service = new AppMcpService({ snapshot, hostedMcpGateway: gateway });
  const client = new Client({ name: 'test-client', version: '1' });
  try {
    await service.start();
    const url = `${service.hostedMcpServerUrls().gitlab}?agentId=${snapshot.agents[0]!.id}`;
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { fetch: nativeFetch }));
    expect((await client.listTools()).tools.map(tool => tool.name)).toStrictEqual(['get_issue']);
    expect(await client.callTool({ name: 'get_issue', arguments: { project: 'group/subgroup/repo', issue: 1 } })).toMatchObject({ content: [{ type: 'text', text: JSON.stringify({ project: 'group/subgroup/repo', issue: 1 }) }] });
    expect(upstream.mock.calls.filter(([target]) => String(target).endsWith('/mcp')).every(([, init]) => new Headers(init?.headers).get('authorization') === 'Bearer gitlab-secret')).toBe(true);
    expect((await nativeFetch(`${service.hostedMcpServerUrls().gitlab}?agentId=unknown`, { method: 'POST', body: '{}' })).status).toBe(500);
    expect(manager.isHostedMcpConnected('github')).toBe(true);
  } finally { await client.close(); await service.stop(); }
});

it('refreshes simultaneous GitLab gateway rejections once without touching GitHub credentials', async () => {
  const { manager, gateway, upstream, tokenStore } = await setup('api mcp');
  const original = upstream.getMockImplementation()!;
  upstream.mockClear();
  upstream.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/mcp') && new Headers(init?.headers).get('authorization') === 'Bearer gitlab-secret') return new Response('expired', { status: 401 });
    return original(url, init);
  });
  expect((await Promise.all([gateway.forward('gitlab', input()), gateway.forward('gitlab', input())])).map(response => response.status)).toStrictEqual([200, 200]);
  expect(upstream.mock.calls.filter(([url]) => String(url).endsWith('/oauth/token'))).toHaveLength(1);
  expect(await tokenStore.get('gitlab')).toMatchObject({ accessToken: 'gitlab-upgraded-secret', refreshToken: 'rotated-secret', scope: 'api mcp' });
  expect(await manager.authorizationHeader('github')).toBe('Bearer github-secret');
  upstream.mockResolvedValue(new Response('still rejected', { status: 401 }));
  // A failed refresh disconnects only its revoked direct credential.
  await expect(gateway.forward('gitlab', input())).rejects.toThrow();
  expect(manager.isHostedMcpConnected('gitlab')).toBe(false);
  expect(manager.isHostedMcpConnected('github')).toBe(true);
});

it('rechecks eligibility without another OAuth grant and clears stale authorization errors', async () => {
  const { manager, snapshot, upstream } = await setup('api mcp');
  const connection = snapshot.workBacklog.connections.find(c => c.provider === 'gitlab')!;
  connection.hostedMcp = { status: 'unavailable' };
  connection.detail = 'Previous authorization failed';
  upstream.mockClear();
  const result = await manager.connect('gitlab', { hostedMcp: true });
  expect(result.authorization).toBeUndefined();
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'gitlab')).toMatchObject({ status: 'connected', hostedMcp: { status: 'available' } });
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'gitlab')?.detail).toBeUndefined();
  expect(upstream.mock.calls.some(([url]) => String(url).includes('/oauth/'))).toBe(false);
});

it('does not let hydration overwrite a permission upgrade that starts during its credential read', async () => {
  const { manager, tokenStore, snapshot } = await setup();
  const read = tokenStore.get.bind(tokenStore);
  let finish!: () => void;
  let reading = false;
  vi.spyOn(tokenStore, 'get').mockImplementationOnce(read).mockImplementationOnce(async provider => {
    reading = true; await new Promise<void>(resolve => { finish = resolve; }); return read(provider);
  });
  const hydration = manager.hydrateConnections();
  await vi.waitFor(() => expect(reading).toBe(true));
  await manager.connect('gitlab', { hostedMcp: true });
  finish(); await hydration;
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'gitlab')?.status).toBe('connecting');
  await manager.disconnect('gitlab');
});

it('explains missing application MCP scope without replacing native credentials', async () => {
  const { manager, upstream, snapshot } = await setup();
  upstream.mockResolvedValueOnce(Response.json({ error: 'invalid_scope' }, { status: 400 }));
  const result = await manager.connect('gitlab', { hostedMcp: true });
  expect(result.authorization).toBeUndefined();
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'gitlab')?.detail).toMatch(/mcp/);
  expect(await manager.authorizationHeader('gitlab')).toBe('Bearer gitlab-secret');
});
