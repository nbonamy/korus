import { DiagramIconResolver } from '../../diagram-icons/resolver';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { VisualizeService as RealVisualizeService } from '../../visualize-service';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import type { VisualizeService } from '../../visualize-service';
import { createVisualizeToolModuleProvider } from '../visualize-tools';

describe('Visualize MCP tool module', () => {
  it('registers for every agent and delegates domain inputs to the owning session', async () => {
    const service = {
      fetchIcon: vi.fn().mockResolvedValue({found:false,icon:'vue'}),
      readCanvas: vi.fn().mockReturnValue({ revision: 2, elements: [], selectedElementIds: [] }),
      editCanvas: vi.fn().mockResolvedValue({ success: true, revision: 3 }),
      canvasPreview: vi.fn().mockReturnValue('data:image/png;base64,YQ=='),
      suggest: vi.fn().mockResolvedValue({ success: true, suggestions: [] }),
      add: vi.fn().mockResolvedValue({ success: true, visualizationId: 'visualization-1', title: 'System' }),
      get: vi.fn().mockReturnValue({ success: true, visualization: { id: 'visualization-1' } }),
      list: vi.fn().mockReturnValue({ success: true, visualizations: [] }),
      delete: vi.fn().mockResolvedValue({ success: true, visualizationId: 'visualization-1', selectedVisualizationId: null }),
      replace: vi.fn().mockResolvedValue({ success: true, visualizationId: 'visualization-1', title: 'System' }),
    } as unknown as VisualizeService;
    const provider = createVisualizeToolModuleProvider(service);

    expect(provider.resolve({ agentId: 'agent-other', url: new URL('http://localhost/mcp') })).toBeDefined();
    const module = provider.resolve({ agentId: 'agent-visualize', url: new URL('http://localhost/mcp') });
    const handlers = new Map<string, (input: never) => Promise<{ structuredContent?: unknown }>>();
    module?.register({
      registerTool: (name: string, _definition: unknown, handler: (input: never) => Promise<{ structuredContent?: unknown }>) => {
        handlers.set(name, handler);
      },
    } as never, { proposedActions: true });

    expect([...handlers.keys()]).toStrictEqual([
      'fetch_tech_icon',
      'read-visualization-canvas',
      'edit-visualization-canvas',
      'view-visualization-canvas',
      'suggest-visualizations',
      'add-visualization',
      'get-visualization',
      'list-visualizations',
      'delete-visualization',
      'replace-visualization',
    ]);
    await handlers.get('suggest-visualizations')!({ suggestions: [{ title: 'System', description: 'Architecture' }] } as never);
    await handlers.get('add-visualization')!({
      title: 'System',
      suggestionId: 'suggestion-1',
      content: { kind: 'mermaid', source: 'flowchart LR\n A --> B' },
    } as never);
    await handlers.get('get-visualization')!({ visualizationId: 'visualization-1' } as never);
    await handlers.get('list-visualizations')!({} as never);
    await handlers.get('delete-visualization')!({ visualizationId: 'visualization-1' } as never);
    await handlers.get('replace-visualization')!({
      visualizationId: 'visualization-1', title: 'System', content: { kind: 'svg', source: '<svg />' },
    } as never);

    await handlers.get('read-visualization-canvas')!({ visualizationId: 'visualization-1', selectedOnly: true } as never);
    await handlers.get('edit-visualization-canvas')!({ visualizationId: 'visualization-1', expectedRevision: 2, edits: [{ id: 'a', changes: { x: 30 } }], add: [{ id: 'n', type: 'rectangle', x: 0, y: 0, width: 5, height: 5 }] } as never);
    expect(await handlers.get('view-visualization-canvas')!({ visualizationId: 'visualization-1' } as never)).toStrictEqual({ content: [{ type: 'image', mimeType: 'image/png', data: 'YQ==' }] });
    expect(service.readCanvas).toHaveBeenCalledWith('agent-visualize', 'visualization-1', true);
    expect(service.editCanvas).toHaveBeenCalledWith('agent-visualize', 'visualization-1', 2, [{ id: 'a', changes: { x: 30 } }], [{ id: 'n', type: 'rectangle', x: 0, y: 0, width: 5, height: 5 }]);
    expect(service.suggest).toHaveBeenCalledWith('agent-visualize', [{ title: 'System', description: 'Architecture' }]);
    expect(service.add).toHaveBeenCalledWith('agent-visualize', expect.objectContaining({ suggestionId: 'suggestion-1' }));
    expect(service.get).toHaveBeenCalledWith('agent-visualize', 'visualization-1');
    expect(service.list).toHaveBeenCalledWith('agent-visualize');
    expect(service.delete).toHaveBeenCalledWith('agent-visualize', 'visualization-1');
    expect(service.replace).toHaveBeenCalledWith('agent-visualize', expect.objectContaining({ visualizationId: 'visualization-1' }));
  });
});

it('keeps fetch_tech_icon listed and callable before opening and after closing Visualize',async()=>{
  const snapshot=createInitialSnapshot();const agent=snapshot.agents[0];
  const resolver=new DiagramIconResolver();vi.spyOn(resolver,'fetchIcon').mockResolvedValue(null);
  const service=new RealVisualizeService({snapshot,iconResolver:resolver,generatedImagesRoot:'/tmp',persist:async()=>{},publish:()=>{}});
  const connect=async()=>{
    const server=new McpServer({name:'test',version:'1'});
    createVisualizeToolModuleProvider(service).resolve({agentId:agent.id,url:new URL('http://localhost/mcp')})!.register(server,{proposedActions:true});
    const [clientSide,serverSide]=InMemoryTransport.createLinkedPair();
    const client=new Client({name:'test',version:'1'});
    await server.connect(serverSide);await client.connect(clientSide);
    return {server,client};
  };
  const closed=await connect();
  expect((await closed.client.listTools()).tools.map(tool=>tool.name)).toContain('fetch_tech_icon');
  expect((await closed.client.callTool({name:'fetch_tech_icon',arguments:{icon:'vue'}})).isError).not.toBe(true);
  await closed.client.close();await closed.server.close();
  await service.enter(agent.id);
  const open=await connect();
  try {
    expect((await open.client.listTools()).tools.map(tool=>tool.name)).toContain('fetch_tech_icon');
    await service.setOpen(agent.id,false);
    expect((await open.client.callTool({name:'fetch_tech_icon',arguments:{icon:'vue'}})).isError).not.toBe(true);
  } finally {await open.client.close();await open.server.close();}
});
