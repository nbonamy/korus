import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
    expect(tool!.description).toContain('only after the user requests it or confirms your offer');
    const opened = await client.callTool({ name: 'open-design', arguments: {} });
    expect(opened.isError).toBe(false);
    expect(opened.structuredContent).toMatchObject({ instructions: expect.stringContaining('read-design') });
    expect(owner.designWorkspaces?.[0]).toMatchObject({ isOpen: true, document: null });
    expect(other.designWorkspaces).toBeUndefined();
    expect(persist).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(owner);
    await client.callTool({ name: 'create-design', arguments: { content: { title: 'Saved exploration', css: '', comments: [], artboards: [{ id: 'desktop', title: 'Desktop', width: 800, height: 600, root: { id: 'headline', tag: 'h1', text: 'My design' } }] } } });
    const saved = structuredClone(owner.designWorkspaces![0]!.document);
    await service.execute(owner.id, { type: 'close' });
    await client.callTool({ name: 'open-design', arguments: {} });
    expect(owner.designWorkspaces?.[0]).toMatchObject({ isOpen: true, document: saved });
    expect(other.designWorkspaces).toBeUndefined();
    await service.execute(owner.id, { type: 'close' });
    publish.mockClear();
    persist.mockRejectedValueOnce(new Error('Disk unavailable'));
    expect(await client.callTool({ name: 'open-design', arguments: {} })).toMatchObject({ isError: true });
    expect(owner.designWorkspaces?.[0]).toMatchObject({ isOpen: false, document: saved });
    expect(publish).not.toHaveBeenCalled();
  } finally { await client.close(); await server.close(); }
});

it('creates a design from a JSON file with inline SVG, so a large design is not pasted into the call', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'design-file-'));
  try {
    const snapshot = createInitialSnapshot();
    const service = new DesignService({ snapshot, persist: async () => undefined, publish: () => undefined });
    const owner = snapshot.agents[0]!;
    await service.execute(owner.id, { type: 'open' });
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    createDesignToolModuleProvider(service).resolve({ agentId: owner.id, url: new URL('http://localhost/mcp') })!.register({ registerTool: (name: string, _schema: unknown, fn: (input: unknown) => Promise<unknown>) => handlers.set(name, fn) } as never, undefined as never);
    const file = path.join(directory, 'design.json');
    const icon = { id: 'icon', tag: 'svg', attributes: { viewBox: '0 0 24 24', fill: 'currentColor' }, children: [{ id: 'shape', tag: 'path', attributes: { d: 'M12 2L22 22H2Z' } }] };
    await writeFile(file, JSON.stringify({ title: 'From file', css: '', comments: [], artboards: [{ id: 'phone', title: 'Phone', width: 390, height: 844, root: { id: 'root', tag: 'main', children: [icon] } }] }));
    const created = await handlers.get('create-design')!({ path: file }) as { structuredContent: { designId: string; title: string; revision: number; artboards: unknown[]; document?: unknown } };
    expect(created.structuredContent).toMatchObject({ title: 'From file', revision: 1, artboards: [{ id: 'phone', title: 'Phone' }] });
    const edited = await handlers.get('edit-design')!({ expectedRevision: 1, designId: created.structuredContent.designId, edits: [{ type: 'insert', nodeId: 'root', node: { id: 'badge', tag: 'span', children: [{ id: 'badge-text', tag: 'em', text: 'New' }] } }, { type: 'text', nodeId: 'badge-text', text: 'Newer' }] }) as { structuredContent: { revision: number; touched: string[] } };
    expect(edited.structuredContent).toMatchObject({ revision: 2, touched: ['root', 'badge', 'badge-text'] });
    expect(JSON.stringify(edited.structuredContent)).not.toContain('Newer');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
