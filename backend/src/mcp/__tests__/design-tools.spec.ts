import { expect, it } from 'vitest';
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
