import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import { HostedMcpGateway, hostedMcpServerUrl } from '../hosted-mcp-gateway';

describe('HostedMcpGateway', () => {
  it(`publishes connected provider servers under the ${product.name} loopback origin`, () => {
    const credentials = {
      isHostedMcpConnected: vi.fn(() => true),
      authorizationHeader: vi.fn(),
    };
    const gateway = new HostedMcpGateway({ credentials });

    expect(gateway.enabledServerUrls('http://127.0.0.1:4321/mcp')).toStrictEqual({
      github: 'http://127.0.0.1:4321/mcp/providers/github',
      gitlab: 'http://127.0.0.1:4321/mcp/providers/gitlab',
      linear: 'http://127.0.0.1:4321/mcp/providers/linear',
    });
    expect(gateway.hasServer('github')).toBe(true);
    expect(gateway.hasServer('unknown')).toBe(false);
    expect(hostedMcpServerUrl('http://127.0.0.1:4321/mcp?agentId=old', 'github')).toBe(
      'http://127.0.0.1:4321/mcp/providers/github',
    );
  });

  it('does not configure hosted servers whose shared integration is disconnected', () => {
    const gateway = new HostedMcpGateway({
      credentials: {
        isHostedMcpConnected: () => false,
        authorizationHeader: vi.fn(),
      },
    });

    expect(gateway.enabledServerUrls('http://127.0.0.1:4321/mcp')).toStrictEqual({});
  });

  it('rejects unknown catalog entries', async () => {
    const gateway = new HostedMcpGateway({
      credentials: {
        isHostedMcpConnected: () => true,
        authorizationHeader: vi.fn(),
      },
    });

    await expect(gateway.forward('unknown' as 'github', {
      method: 'POST',
      headers: new Headers(),
    })).rejects.toThrow('Unknown hosted MCP server: unknown');
  });

  it('injects a current provider credential without forwarding client authorization', async () => {
    const fetchUpstream = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    const credentials = {
      isHostedMcpConnected: vi.fn(() => true),
      authorizationHeader: vi.fn().mockResolvedValue('bearer ghu_fresh'),
    };
    const gateway = new HostedMcpGateway({ credentials, fetch: fetchUpstream });

    await gateway.forward('github', {
      method: 'POST',
      headers: new Headers({
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer must-not-leak',
        'content-type': 'application/json',
        'mcp-session-id': 'session-1',
      }),
      body: Buffer.from('{"jsonrpc":"2.0"}'),
    });

    const [, request] = fetchUpstream.mock.calls[0]!;
    const headers = new Headers(request?.headers);
    expect(credentials.authorizationHeader).toHaveBeenCalledWith('github', undefined);
    expect(headers.get('authorization')).toBe('bearer ghu_fresh');
    expect(headers.get('mcp-session-id')).toBe('session-1');
    expect(headers.get('host')).toBeNull();
  });

  it.each(['github', 'gitlab', 'linear'] as const)('force-refreshes %s once when the hosted server rejects a token', async (provider) => {
    const fetchUpstream = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const credentials = {
      isHostedMcpConnected: vi.fn(() => true),
      authorizationHeader: vi.fn()
        .mockResolvedValueOnce('bearer ghu_stale')
        .mockResolvedValueOnce('bearer ghu_rotated'),
    };
    const gateway = new HostedMcpGateway({ credentials, fetch: fetchUpstream });

    const response = await gateway.forward(provider, {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: Buffer.from('{}'),
    });

    expect(response.status).toBe(200);
    expect(credentials.authorizationHeader).toHaveBeenNthCalledWith(1, provider, undefined);
    expect(credentials.authorizationHeader).toHaveBeenNthCalledWith(2, provider, { forceRefresh: true });
    expect(new Headers(fetchUpstream.mock.calls[1]?.[1]?.headers).get('authorization')).toBe('bearer ghu_rotated');
  });
});
