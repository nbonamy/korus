import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAppMcpServer } from '../tools';
import { createMobileSimulatorToolModuleProvider } from '../mobile-simulator-tools';

describe('provider-independent simulator MCP', () => {
  it('binds the caller, validates actions and returns native image content separately from metadata', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({
        attachment: null,
        frame: { data: 'cG5n', mimeType: 'image/png', width: 1206, height: 2622, scale: 3, attachmentId: 'session' },
      });
    const server = createAppMcpServer({ agentId: 'caller', url: new URL('http://localhost/mcp') }, [
      createMobileSimulatorToolModuleProvider(execute),
    ]);
    const client = new Client({ name: 'test', version: '1' });
    const [local, remote] = InMemoryTransport.createLinkedPair();
    await server.connect(remote);
    await client.connect(local);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toStrictEqual(['simulator']);
      // Clients read argument types from a flat object schema; a top-level union leaves them guessing.
      const schema = tools.tools[0]!.inputSchema as { type: string; properties: Record<string, { type?: string }> };
      expect(schema.type).toBe('object');
      expect(schema.properties.x?.type).toBe('number');
      expect(schema.properties.attachmentId?.type).toBe('string');
      const result = await client.callTool({
        name: 'simulator',
        arguments: { action: 'screenshot', attachmentId: 'session', agentId: 'victim' },
      });
      expect(execute).toHaveBeenCalledWith('caller', { action: 'screenshot', attachmentId: 'session' });
      expect(result.content).toContainEqual({ type: 'image', mimeType: 'image/png', data: 'cG5n' });
      expect(result.structuredContent).toStrictEqual({
        attachment: null,
        screen: { width: 1206, height: 2622, scale: 3 },
      });
      execute.mockClear();
      const invalid = await client.callTool({
        name: 'simulator',
        arguments: {
          action: 'swipe',
          attachmentId: 'session',
          x: -1,
          y: 10,
          toX: 20,
          toY: 30,
          width: 100,
          height: 200,
          durationMs: 500,
        },
      });
      expect(invalid.isError).toBe(true);
      expect(execute).not.toHaveBeenCalled();
      execute.mockRejectedValueOnce(new Error('Device unavailable'));
      expect((await client.callTool({ name: 'simulator', arguments: { action: 'status' } })).isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('lists devices grouped by platform and lets the agent power off its attachment', async () => {
    const execute = vi.fn().mockResolvedValueOnce({
      attachment: null,
      catalog: {
        devices: [
          { id: 'ios-1', name: 'iPhone 17', platform: 'ios', state: 'booted' },
          { id: 'ios-2', name: 'iPhone Air', platform: 'ios', state: 'shutdown', owner: 'other' },
          { id: 'avd:Pixel', name: 'Pixel', platform: 'android', state: 'shutdown' },
        ],
        setup: [],
      },
    }).mockResolvedValueOnce({ attachment: null });
    const server = createAppMcpServer({ agentId: 'caller', url: new URL('http://localhost/mcp') }, [
      createMobileSimulatorToolModuleProvider(execute),
    ]);
    const client = new Client({ name: 'test', version: '1' });
    const [local, remote] = InMemoryTransport.createLinkedPair();
    await server.connect(remote);
    await client.connect(local);
    try {
      const listed = await client.callTool({ name: 'simulator', arguments: { action: 'list' } });
      expect(listed.structuredContent).toStrictEqual({
        attachment: null,
        catalog: {
          platforms: {
            ios: {
              booted: [{ id: 'ios-1', name: 'iPhone 17' }],
              shutdown: [{ id: 'ios-2', name: 'iPhone Air', attachedToAnotherAgent: true }],
            },
            android: { booted: [], shutdown: [{ id: 'avd:Pixel', name: 'Pixel' }] },
          },
          setup: [],
        },
      });
      await client.callTool({ name: 'simulator', arguments: { action: 'shutdown', attachmentId: 'session' } });
      expect(execute).toHaveBeenLastCalledWith('caller', { action: 'shutdown', attachmentId: 'session' });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('pauses only when the caller asks: after actions, before reads, never on its own', async () => {
    const calls: { action: string; at: number }[] = [];
    const execute = vi.fn(async (_agent: string, input: { action: string }) => {
      calls.push({ action: input.action, at: Date.now() });
      return { attachment: null };
    });
    const server = createAppMcpServer({ agentId: 'caller', url: new URL('http://localhost/mcp') }, [
      createMobileSimulatorToolModuleProvider(execute),
    ]);
    const client = new Client({ name: 'test', version: '1' });
    const [local, remote] = InMemoryTransport.createLinkedPair();
    await server.connect(remote);
    await client.connect(local);
    try {
      const tap = { action: 'tap', attachmentId: 's', x: 1, y: 1, width: 10, height: 10 };
      let started = Date.now();
      await client.callTool({ name: 'simulator', arguments: tap });
      expect(Date.now() - started).toBeLessThan(60);
      started = Date.now();
      await client.callTool({ name: 'simulator', arguments: { ...tap, waitMs: 120 } });
      expect(Date.now() - started).toBeGreaterThanOrEqual(115);
      expect(execute).toHaveBeenLastCalledWith('caller', tap);
      started = Date.now();
      await client.callTool({ name: 'simulator', arguments: { action: 'screenshot', attachmentId: 's', waitMs: 120 } });
      expect(calls.at(-1)!.at - started).toBeGreaterThanOrEqual(115);
      execute.mockClear();
      const tooLong = await client.callTool({ name: 'simulator', arguments: { ...tap, waitMs: 60_000 } });
      expect(tooLong.isError).toBe(true);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('offers the hardware buttons and rejects others', async () => {
    const execute = vi.fn().mockResolvedValue({ attachment: null });
    const server = createAppMcpServer({ agentId: 'caller', url: new URL('http://localhost/mcp') }, [
      createMobileSimulatorToolModuleProvider(execute),
    ]);
    const client = new Client({ name: 'test', version: '1' });
    const [local, remote] = InMemoryTransport.createLinkedPair();
    await server.connect(remote);
    await client.connect(local);
    try {
      for (const button of ['volumeUp', 'volumeDown', 'power'])
        await client.callTool({ name: 'simulator', arguments: { action: 'button', attachmentId: 's', button } });
      expect(execute.mock.calls.map(([, input]) => input.button)).toEqual(['volumeUp', 'volumeDown', 'power']);
      expect(
        (await client.callTool({ name: 'simulator', arguments: { action: 'button', attachmentId: 's', button: 'eject' } })).isError,
      ).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('does not advertise simulator tools without the desktop host port', () => {
    expect(
      createMobileSimulatorToolModuleProvider(undefined).resolve({ agentId: 'a', url: new URL('http://localhost') }),
    ).toBeUndefined();
  });
});
