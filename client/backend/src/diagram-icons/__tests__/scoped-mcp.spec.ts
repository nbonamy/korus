import { expect, it, vi } from 'vitest';
import { DiagramIconResolver } from '../resolver';
import { openIconMcpScope } from '../mcp';

it('exposes only fetch_tech_icon for one private job, returns self-contained base64 without IDs and revokes its endpoint on close', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#f00" d="M1 1h22v22H1z"/></svg>';
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(svg));
  const resolver = new DiagramIconResolver({ fetch: fetcher });
  const job = await openIconMcpScope(resolver);
  const request = async (method: string, params?: unknown, url = job.url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'test', method, params }),
    });
    return (await response.json()) as {
      result: {
        tools: { name: string }[];
        structuredContent: {
          mimeType: string;
          base64: string;
          sourceUrl: string;
          dark?: { base64: string; mimeType: string; whiteFill: boolean };
        };
        isError?: boolean;
      };
    };
  };
  try {
    expect((await request('tools/list')).result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'fetch_tech_icon',
    ]);
    const result = await request('tools/call', {
      name: 'fetch_tech_icon',
      arguments: { icon: 'logo=https://raw.githubusercontent.com/icons/logo.svg' },
    });
    expect(result.result.structuredContent).toMatchObject({
      found: true,
    });
    expect(result.result.structuredContent.mimeType).toBe('image/svg+xml');
    expect(Buffer.from(result.result.structuredContent.base64, 'base64').toString()).toBe(svg);
    expect(result.result.structuredContent.sourceUrl).toBe('https://raw.githubusercontent.com/icons/logo.svg');
    fetcher.mockImplementation(async (input) =>
      String(input).includes('api.svgl.app')
        ? Response.json([
            { title: 'Vue', route: { light: 'https://svgl.app/light.svg', dark: 'https://svgl.app/dark.svg' } },
          ])
        : new Response(String(input).includes('dark') ? svg.replace('#f00', '#fff') : svg),
    );
    const variants = await request('tools/call', { name: 'fetch_tech_icon', arguments: { icon: 'vue' } });
    expect(variants.result.structuredContent.dark).toMatchObject({ mimeType: 'image/svg+xml', whiteFill: true });
    expect(Buffer.from(variants.result.structuredContent.dark!.base64, 'base64').toString()).toContain('#fff');
    expect(result.result.structuredContent).not.toHaveProperty('assetId');
    expect((await request('tools/call', { name: 'send-message', arguments: {} })).result?.isError ?? true).toBe(true);
    expect((await fetch(job.url.replace(/[^/]+$/, 'wrong'), { method: 'POST' })).status).toBe(404);
    await job.close();
    await expect(fetch(job.url, { method: 'POST' })).rejects.toThrow();
  } finally {
    await job.close();
  }
});
