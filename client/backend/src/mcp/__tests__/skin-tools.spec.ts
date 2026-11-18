import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { AppMcpService } from '../service';
import { createSkinToolModuleProvider } from '../skin-tools';
import type { SkinControlInput } from '@workspace/core/custom-themes';

describe('set-skin MCP', () => {
  it('binds the caller, supports definition/name-only reload/disable, and surfaces desktop failures', async () => {
    const setSkin = vi.fn(async (_agentId: string, input: SkinControlInput) => ({ enabled: input.name !== null, name: input.name }));
    const snapshot = createInitialSnapshot();
    const agentId = snapshot.agents[0]!.id;
    const server = new AppMcpService({ snapshot, toolModuleProviders: [createSkinToolModuleProvider(setSkin)] });
    const url = new URL(await server.start()); url.searchParams.set('agentId', agentId);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(url));
    try {
      expect((await client.listTools()).tools.map(tool => tool.name)).toContain('set-skin');
      const skill = await client.callTool({ name: 'read-skill', arguments: { name: 'korus-skin' } });
      expect(skill.structuredContent).toMatchObject({ name: 'korus-skin', loaded: true, markdown: expect.any(String) });
      const definition = { name: 'Ocean', appearance: 'dark', colors: { canvas: '#07151f' } };
      for (const input of [{ name: 'ocean', definition }, { name: 'ocean' }, { name: null }]) {
        expect((await client.callTool({ name: 'set-skin', arguments: input })).isError).toBe(false);
        expect(setSkin).toHaveBeenLastCalledWith(agentId, input);
      }
      expect((await client.callTool({ name: 'set-skin', arguments: { name: '../outside' } })).isError).toBe(true);
      expect(setSkin).toHaveBeenCalledTimes(3);
      setSkin.mockRejectedValueOnce(new Error('Desktop unavailable'));
      const failed = await client.callTool({ name: 'set-skin', arguments: { name: 'ocean' } });
      expect(failed.isError).toBe(true);
      expect(failed.content).toContainEqual({ type: 'text', text: 'Desktop unavailable' });
    } finally { await client.close(); await server.stop(); }
  });
});
