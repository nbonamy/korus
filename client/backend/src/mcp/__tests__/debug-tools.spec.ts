import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAppMcpServer } from '../tools';
import { createDebugToolModuleProvider } from '../debug-tools';

describe('debug restart MCP', () => {
  it.each([false, true])('exposes restart only in debug and binds the requesting agent (debug=%s)', async enabled => {
    const restart = vi.fn().mockResolvedValue({ scheduled: true });
    const server = createAppMcpServer({ agentId: 'caller', url: new URL('http://localhost/mcp') }, [createDebugToolModuleProvider(enabled, restart)]);
    const client = new Client({ name: 'test', version: '1' });
    const [local, remote] = InMemoryTransport.createLinkedPair();
    await server.connect(remote);
    await client.connect(local);
    try {
      if (!enabled) {
        await expect(client.listTools()).rejects.toThrow('Method not found');
        expect(restart).not.toHaveBeenCalled();
        return;
      }
      expect((await client.listTools()).tools.map(tool => tool.name)).toStrictEqual(['restart-backend']);
      const result = await client.callTool({ name: 'restart-backend', arguments: { reason: 'Load the fix', agentId: 'victim', confirmed: true } });
      expect(restart).toHaveBeenCalledExactlyOnceWith('caller', 'Load the fix');
      expect(result.structuredContent).toStrictEqual({ scheduled: true });
      restart.mockRejectedValueOnce(new Error('Desktop unavailable'));
      expect((await client.callTool({ name: 'restart-backend', arguments: { reason: 'Retry' } })).isError).toBe(true);
    } finally { await client.close(); await server.close(); }
  });
});
