import { expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { DesignService } from '../../design-service';
import { createDesignToolModuleProvider } from '../design-tools';

it('binds agent tools to their own document and rejects mutation when the user closes Design', async () => {
  const snapshot = createInitialSnapshot();
  let captured = '';
  const service = new DesignService({ snapshot, persist: async () => undefined, publish: () => undefined, capture: async input => { captured = input.html; return 'data:image/png;base64,YQ=='; } });
  const [owner, other] = snapshot.agents;
  await service.execute(owner.id, { type: 'open' });
  const register = (agentId: string) => {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    createDesignToolModuleProvider(service).resolve({ agentId, url: new URL('http://localhost/mcp') })!.register({ registerTool: (name: string, _schema: unknown, fn: (input: unknown) => Promise<unknown>) => handlers.set(name, fn) } as never, {} as never);
    return handlers;
  };
  const ownerTools = register(owner.id);
  expect(await ownerTools.get('create-design')!({ content: { title: 'App', css: '', comments: [], artboards: [{ id: 'desktop', title: 'Desktop', width: 800, height: 600, root: { id: 'headline', tag: 'h1', text: 'Hello' } }] } })).not.toHaveProperty('isError', true);
  expect(await register(other.id).get('read-design')!({})).toHaveProperty('isError', true);
  await service.execute(owner.id, { type: 'comment', expectedRevision: 1, nodeId: 'headline', text: 'Keep this' });
  expect(JSON.stringify(await ownerTools.get('read-design')!({}))).toContain('Keep this');
  expect(await ownerTools.get('edit-design')!({ expectedRevision: 2, edits: [{ type: 'artboard-add', artboard: { id: 'second', title: 'Alternative', width: 500, height: 600, root: { id: 'other-headline', tag: 'h1', text: 'Another layout' } } }] })).not.toHaveProperty('isError', true);
  expect(await ownerTools.get('capture-design')!({ expectedRevision: 3, artboardId: 'second' })).toMatchObject({ content: [{ type: 'image', mimeType: 'image/png' }] });
  expect(captured).toContain('Another layout');
  expect(captured).not.toContain('Hello');
  await service.execute(owner.id, { type: 'close' });
  expect(await ownerTools.get('edit-design')!({ expectedRevision: 2, edits: [{ type: 'text', nodeId: 'headline', text: 'Forbidden' }] })).toHaveProperty('isError', true);
});

it('opens the authenticated caller’s Design pane through MCP and preserves saved work when reopened', async () => {
  const snapshot = createInitialSnapshot();
  const [owner, other] = snapshot.agents;
  const persist = vi.fn().mockResolvedValue(undefined);
  const publish = vi.fn();
  const service = new DesignService({ snapshot, persist, publish });
  const server = new McpServer({ name: 'test-design', version: '1' });
  createDesignToolModuleProvider(service).resolve({ agentId: owner.id, url: new URL('http://localhost/mcp') })!.register(server, { proposedActions: true });
  const client = new Client({ name: 'test', version: '1' });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(remote);
    await client.connect(local);
    const tool = (await client.listTools()).tools.find(tool => tool.name === 'open-design');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.properties ?? {}).not.toHaveProperty('agentId');
    expect(tool!.description).toContain('Only after the user explicitly requests it or confirms your offer');
    const opened = await client.callTool({ name: 'open-design', arguments: {} });
    expect(opened.isError).toBe(false);
    expect(opened.structuredContent).toMatchObject({ instructions: expect.stringContaining('read-design') });
    expect(owner.designWorkspace).toMatchObject({ isOpen: true, document: null });
    expect(other.designWorkspace).toBeUndefined();
    expect(persist).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(owner);
    await client.callTool({ name: 'create-design', arguments: { content: { title: 'Saved exploration', css: '', comments: [], artboards: [{ id: 'desktop', title: 'Desktop', width: 800, height: 600, root: { id: 'headline', tag: 'h1', text: 'My design' } }] } } });
    const saved = structuredClone(owner.designWorkspace!.document);
    await service.execute(owner.id, { type: 'close' });
    await client.callTool({ name: 'open-design', arguments: {} });
    expect(owner.designWorkspace).toMatchObject({ isOpen: true, document: saved });
    expect(other.designWorkspace).toBeUndefined();
    await service.execute(owner.id, { type: 'close' });
    publish.mockClear();
    persist.mockRejectedValueOnce(new Error('Disk unavailable'));
    expect(await client.callTool({ name: 'open-design', arguments: {} })).toMatchObject({ isError: true });
    expect(owner.designWorkspace).toMatchObject({ isOpen: false, document: saved });
    expect(publish).not.toHaveBeenCalled();
  } finally { await client.close(); await server.close(); }
});
