import { afterEach, describe, expect, it, vi } from 'vitest';
import { product } from '@workspace/core/product';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { WorkProviderKind } from '@workspace/core/contracts';
import { WorkIntegrationManager } from '../../work-integrations/manager';
import { MemoryWorkIntegrationTokenStore } from '../../work-integrations/memory-token-store';
import { LinearWorkProviderDriver } from '../../work-integrations/linear-driver';
import { GitHubWorkProviderDriver } from '../../work-integrations/github-driver';
import { HostedMcpGateway } from '../hosted-mcp-gateway';
import { AppMcpService } from '../service';
import { appSurfaceOptions } from '../../driver-rpc';
import { ClaudeBackendDriver } from '../../claude/claude-driver';
import { ClaudeAgentSdkTransport } from '../../claude/agent-sdk-transport';
import { createQueryHarness } from '../../claude/__tests__/sdk-query-fixture';

vi.mock('@workspace/core/runtime-discovery', () => ({
  resolveRuntimeExecutable: () => '/test/bin/codex',
  resolveRuntimeLaunch: (command: string, env: NodeJS.ProcessEnv | undefined) => ({ command, env: { ...process.env, ...env } }),
}));

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
  vi.unstubAllGlobals();
});

async function setup() {
  const snapshot = createInitialSnapshot();
  const tokenStore = new MemoryWorkIntegrationTokenStore();
  const seed = async (provider: WorkProviderKind) => tokenStore.set({
    provider, accessToken: `${provider}-secret`, refreshToken: `${provider}-refresh`,
    tokenType: 'Bearer', scope: 'read write', connectedAt: new Date().toISOString(),
  });
  await seed('github');
  await seed('linear');
  const manager = new WorkIntegrationManager({
    drivers: [new GitHubWorkProviderDriver('github-public'), new LinearWorkProviderDriver(() => ({
      oauthClientId: 'linear-public',
    }))],
    tokenStore, getSnapshot: () => snapshot, saveSnapshot: async () => {},
  });
  await manager.hydrateConnections();
  const upstream = vi.fn<typeof fetch>();
  const gateway = new HostedMcpGateway({ credentials: manager, fetch: upstream });
  const service = new AppMcpService({ snapshot, hostedMcpGateway: gateway });
  const url = await service.start();
  cleanups.push(async () => { manager.close(); await service.stop(); });
  const post = (provider: string, body: unknown, agentId = snapshot.agents[0]!.id) => fetch(
    `${new URL(url).origin}/mcp/providers/${provider}?agentId=${agentId}`,
    { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json',
      authorization: 'Bearer caller-must-not-win', 'mcp-session-id': `${provider}-session` }, body: JSON.stringify(body) },
  );
  return { snapshot, tokenStore, seed, manager, upstream, gateway, service, url, post };
}

describe('Linear hosted MCP through daemon', () => {
  it('preserves initialize, native tools and issue calls while isolating concurrent GitHub traffic', async () => {
    const { upstream, post, url } = await setup();
    const exchanges = [
      { method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
        result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'Linear', version: '1' } } },
      { method: 'tools/list', params: {}, result: { tools: [{ name: 'get_issue', description: 'Read an issue',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }] } },
      { method: 'tools/call', params: { name: 'get_issue', arguments: { id: 'ENG-12' } },
        result: { content: [{ type: 'text', text: '{"id":"issue-uuid","identifier":"ENG-12"}' }] } },
      { method: 'tools/call', params: { name: 'create_comment', arguments: { issueId: 'issue-uuid', body: 'Controlled test comment' } },
        result: { content: [{ type: 'text', text: '{"id":"comment-uuid"}' }] } },
    ];
    for (const [id, exchange] of exchanges.entries()) {
      const body = { jsonrpc: '2.0', id, method: exchange.method, params: exchange.params };
      const reply = { jsonrpc: '2.0', id, result: exchange.result };
      upstream.mockResolvedValueOnce(Response.json(reply, { headers: { 'mcp-session-id': 'linear-session' } }));
      const response = await post('linear', body);
      expect(response.status).toBe(200);
      expect(response.headers.get('mcp-session-id')).toBe('linear-session');
      expect(await response.json()).toStrictEqual(reply);
      const [target, request] = upstream.mock.lastCall!;
      expect(target).toBe('https://mcp.linear.app/mcp');
      expect(JSON.parse(Buffer.from(request!.body as Uint8Array).toString())).toStrictEqual(body);
      expect(new Headers(request!.headers).get('authorization')).toBe('Bearer linear-secret');
      expect(new Headers(request!.headers).get('mcp-session-id')).toBe('linear-session');
    }
    upstream.mockImplementation(async () => Response.json({ result: { tools: [] } }));
    await Promise.all(['github', 'linear'].map(provider => post(provider, { method: 'tools/list' })));
    expect(upstream.mock.calls.slice(-2).map(([target, init]) => [target, new Headers(init!.headers).get('authorization')]))
      .toEqual(expect.arrayContaining([
        ['https://api.githubcopilot.com/mcp/', 'Bearer github-secret'],
        ['https://mcp.linear.app/mcp', 'Bearer linear-secret'],
      ]));
    upstream.mockClear();
    expect((await post('linear', {}, 'unknown-agent')).status).toBe(500);
    expect((await fetch(`${new URL(url).origin}/mcp/providers/linear`, { method: 'POST' })).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('passes upstream failures and Streamable HTTP events and deletion through unchanged', async () => {
    const { upstream, url, snapshot } = await setup();
    const target = `${new URL(url).origin}/mcp/providers/linear?agentId=${snapshot.agents[0]!.id}`;
    for (const exchange of [
      { method: 'POST', status: 403, contentType: 'application/json', body: '{"error":"insufficient_scope"}' },
      { method: 'GET', status: 200, contentType: 'text/event-stream', body: 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n' },
      { method: 'DELETE', status: 204, contentType: 'application/json', body: null },
    ]) {
      upstream.mockResolvedValueOnce(new Response(exchange.body, { status: exchange.status, headers: { 'content-type': exchange.contentType } }));
      const response = await fetch(target, { method: exchange.method, headers: { 'mcp-session-id': 'linear-session', 'mcp-protocol-version': '2025-03-26' } });
      expect(response.status).toBe(exchange.status);
      expect(await response.text()).toBe(exchange.body ?? '');
      const init = upstream.mock.lastCall![1]!;
      expect(init.method).toBe(exchange.method);
      expect(new Headers(init.headers).get('mcp-protocol-version')).toBe('2025-03-26');
      expect(new Headers(init.headers).get('mcp-session-id')).toBe('linear-session');
    }
  });

  it('uses live integration state for Codex configuration and rejects cached URLs after disconnect', async () => {
    const { snapshot, manager, service, url, post, upstream, seed } = await setup();
    const options = appSurfaceOptions({ appMcpServerUrl: url, hostedMcpServerUrls: () => service.hostedMcpServerUrls() });
    const configure = () => options.extensions![0]!.configureConversation!({ extensionContext: snapshot.agents[0] } as never);
    const enabled = await configure();
    expect(enabled.config).toMatchObject({
      'mcp_servers.linear.url': `${new URL(url).origin}/mcp/providers/linear?agentId=${snapshot.agents[0]!.id}`,
      'mcp_servers.github.url': `${new URL(url).origin}/mcp/providers/github?agentId=${snapshot.agents[0]!.id}`,
      'apps.connector_76869538009648d5b282a4bb21c3d157.enabled': false,
    });
    expect(Object.keys(enabled.config!).filter(key => key.endsWith('default_tools_approval_mode'))).toStrictEqual([`mcp_servers.${product.mcpServerName}.default_tools_approval_mode`]);
    expect(JSON.stringify(enabled)).not.toMatch(/linear-secret|github-secret|linear-refresh|github-refresh/);
    await manager.disconnect('linear');
    const disabled = await configure();
    expect(disabled.config).not.toHaveProperty('mcp_servers.linear.url');
    expect(disabled.config).toHaveProperty('mcp_servers.github.url');
    expect((await post('linear', { method: 'tools/list' })).status).toBe(500);
    expect(upstream).not.toHaveBeenCalled();
    await seed('linear'); // Restored OAuth credential; OAuth completion is covered by linear-oauth.spec.
    await manager.hydrateConnections();
    expect((await configure()).config).toHaveProperty('mcp_servers.linear.url');
    upstream.mockResolvedValueOnce(Response.json({ result: { tools: [] } }));
    expect((await post('linear', { method: 'tools/list' })).status).toBe(200);
  });

  it('supplies credential-free Linear URLs to new and resumed Claude SDK sessions using live connection state', async () => {
    const { snapshot, service, url, manager, seed } = await setup();
    const sdk = createQueryHarness();
    const agent = { ...snapshot.agents[0]!, backend: 'claude' as const, backendSession: undefined };
    for (const [index, connected] of [true, false, true].entries()) {
      if (!connected) await manager.disconnect('linear');
      if (index === 2) { await seed('linear'); await manager.hydrateConnections(); }
      const driver = new ClaudeBackendDriver(new ClaudeAgentSdkTransport({ createQuery: sdk.createQuery }), async () => null, {
        appMcpServerUrl: url, hostedMcpServerUrls: () => service.hostedMcpServerUrls(),
      });
      const approvalIds: string[] = [];
      driver.onEvent((event) => {
        if (event.type === 'claude.conversationEventReceived' && event.payload.event.type === 'approval.requested') {
          approvalIds.push(event.payload.event.payload.id);
        }
      });
      try {
        const currentAgent = index === 0 ? agent : { ...agent, backendSession: { kind: 'claude' as const, sessionId: 'persisted-session', transport: 'stdio' as const } };
        const send = driver.sendPrompt(currentAgent, 'Read ENG-12');
        await vi.waitFor(() => expect(sdk.options).toHaveLength(index + 1));
        const options = sdk.options[index]!;
        expect(options.mcpServers?.github).toStrictEqual({ type: 'http', url: `${new URL(url).origin}/mcp/providers/github?agentId=${agent.id}` });
        if (connected) expect(options.mcpServers?.linear).toStrictEqual({ type: 'http', url: `${new URL(url).origin}/mcp/providers/linear?agentId=${agent.id}` });
        else expect(options.mcpServers).not.toHaveProperty('linear');
        if (index > 0) expect(options.resume).toBe('persisted-session');
        expect(JSON.stringify(options.mcpServers)).not.toMatch(/secret|refresh|Bearer/);
        sdk.emit({ type: 'system', subtype: 'init', session_id: 'persisted-session' }, index);
        await send;
        const canUseTool = options.canUseTool!;
        const context = (requestId: string) => ({ signal: new AbortController().signal, toolUseID: requestId, requestId });
        await expect(canUseTool(`mcp__${product.mcpServerName}__list-agents`, {}, context('korus')))
          .resolves.toEqual({ behavior: 'allow', updatedInput: {} });
        expect(approvalIds).toEqual([]);
        for (const provider of connected ? ['github', 'linear'] : ['github']) {
          const requestId = `${provider}-${index}`;
          const permission = canUseTool(`mcp__${provider}__list_issues`, {}, context(requestId));
          expect(approvalIds).toContain(requestId);
          await driver.respondToAgentRequest({ id: requestId, outcome: { kind: 'decision', decision: 'deny' } });
          await expect(permission).resolves.toMatchObject({ behavior: 'deny' });
        }
        sdk.emit({ type: 'result', subtype: 'success', session_id: 'persisted-session', is_error: false }, index);
      } finally { await driver.close(); }
    }
  });

  it('refreshes through the real Linear driver, bounds rejected-token retries, and isolates reconnect failures', async () => {
    const { manager, gateway, tokenStore, upstream, service } = await setup();
    const oauth = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      access_token: 'linear-rotated', refresh_token: 'linear-next-refresh', token_type: 'Bearer', expires_in: 3600, scope: 'read write',
    }));
    vi.stubGlobal('fetch', oauth);
    upstream.mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(Response.json({ result: { content: [] } }));
    const input = { method: 'POST', headers: new Headers(), body: Buffer.from('{"method":"tools/list"}') };
    expect((await gateway.forward('linear', input)).status).toBe(200);
    expect(oauth).toHaveBeenCalledOnce();
    expect(oauth.mock.calls[0]![0]).toBe('https://api.linear.app/oauth/token');
    expect(new URLSearchParams(oauth.mock.calls[0]![1]!.body as string).get('refresh_token')).toBe('linear-refresh');
    expect(new Headers(upstream.mock.calls[1]![1]!.headers).get('authorization')).toBe('Bearer linear-rotated');
    expect(await tokenStore.get('linear')).toMatchObject({ accessToken: 'linear-rotated', refreshToken: 'linear-next-refresh' });

    upstream.mockClear();
    upstream.mockImplementation(async () => new Response('revoked', { status: 401 }));
    oauth.mockImplementation(async () => Response.json({ access_token: 'linear-retry', refresh_token: 'linear-retry-refresh', token_type: 'Bearer', expires_in: 3600 }));
    expect((await gateway.forward('linear', input)).status).toBe(401);
    expect(upstream).toHaveBeenCalledTimes(2);
    oauth.mockResolvedValueOnce(Response.json({ error: 'invalid_grant' }, { status: 400 }));
    await expect(gateway.forward('linear', input)).rejects.toThrow();
    expect(manager.isConnected('linear')).toBe(false);
    expect(await tokenStore.get('linear')).toBeNull();
    expect(service.hostedMcpServerUrls()).not.toHaveProperty('linear');
    expect(manager.isConnected('github')).toBe(true);
    expect(await manager.authorizationHeader('github')).toBe('Bearer github-secret');
  });
});
