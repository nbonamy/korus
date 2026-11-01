import { product } from '@workspace/core/product';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { AppStateStore } from '../persistence/store';
import { VisualizeService, generateVisualizationSuggestionPrompt } from '../visualize-service';

let temporaryDirectory: string | null = null;

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = null;
});

describe('VisualizeService', () => {
  it('shares repository diagrams across a worktree and main agent while keeping pane state separate', async () => {
    const snapshot = createInitialSnapshot();
    const [worker, main] = snapshot.agents;
    worker.folder = '/projects/app-feature';
    worker.workspace = { kind: 'git', folder: worker.folder, repositoryName: 'app', repositoryRoot: worker.folder,
      branch: 'feature', isLinkedWorktree: true, primaryWorktreeRoot: '/projects/app', updatedAt: worker.updatedAt };
    main.folder = '/projects/app';
    main.workspace = { kind: 'git', folder: main.folder, repositoryName: 'app', repositoryRoot: main.folder,
      branch: 'main', isLinkedWorktree: false, primaryWorktreeRoot: '/projects/app', updatedAt: main.updatedAt };
    const service = new VisualizeService({ snapshot, generatedImagesRoot: os.tmpdir(), persist: async () => undefined, publish: () => undefined });

    await service.enter(worker.id);
    const { visualizationId } = await service.add(worker.id, { title: 'Shared map', content: { kind: 'mermaid', source: 'flowchart LR; A --> B' } });
    expect((await service.enter(main.id)).created).toBe(false);

    expect(service.list(main.id).visualizations).toStrictEqual([{ id: visualizationId, title: 'Shared map', kind: 'mermaid', selected: true }]);
    expect(snapshot.repositoryVisualizations?.['/projects/app']).toStrictEqual(worker.visualize?.visualizations);
    expect(main.visualize?.id).not.toBe(worker.visualize?.id);
    const source = JSON.stringify(service.get(main.id, visualizationId).visualization.content);
    const document = { elements: [], files: {}, selectedElementIds: [], preview: '' };
    const saves = await Promise.allSettled([
      service.saveCanvas(worker.id, { visualizationId, sessionId: worker.visualize!.id, expectedSource: source, expectedRevision: 0, document }),
      service.saveCanvas(main.id, { visualizationId, sessionId: main.visualize!.id, expectedSource: source, expectedRevision: 0, document }),
    ]);
    expect(saves.map(result => result.status)).toStrictEqual(['fulfilled', 'rejected']);
    expect(service.readCanvas(main.id, visualizationId).revision).toBe(1);
    await service.setOpen(worker.id, false);
    expect(service.list(main.id).visualizations).toHaveLength(1);
    await service.delete(main.id, visualizationId);
    expect(worker.visualize?.visualizations).toStrictEqual([]);
    expect(worker.visualize?.selectedVisualizationId).toBeNull();
  });

  it('persists user-edited canvases and assets, rejects stale batches and preserves untouched edits across reload', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'app-canvas-'));
    const persistence = new AppStateStore(temporaryDirectory);
    const snapshot = createInitialSnapshot();
    const agentId = snapshot.agents[0].id;
    const service = new VisualizeService({ snapshot, generatedImagesRoot: temporaryDirectory, persist: () => persistence.save(snapshot), publish: () => undefined });
    await service.enter(agentId);
    const { visualizationId } = await service.add(agentId, { title: 'Map', content: { kind: 'mermaid', source: 'flowchart LR; A --> B' } });
    const document = {
      elements: [{ id: 'a', type: 'text', x: 200, y: 90, width: 100, height: 24, text: 'User edit' }, { id: 'b', type: 'rectangle', x: 400, y: 90, width: 100, height: 80 }],
      files: { image: { id: 'image', mimeType: 'image/png', dataURL: 'data:image/png;base64,YQ==', created: 1 } }, selectedElementIds: ['a'], preview: 'data:image/png;base64,YQ==',
    };
    await service.saveCanvas(agentId, { visualizationId, sessionId: snapshot.agents[0].visualize!.id, expectedSource: JSON.stringify(service.get(agentId, visualizationId).visualization.content), expectedRevision: 0, document });
    expect(service.readCanvas(agentId, visualizationId)).toStrictEqual({ revision: 1, selectedElementIds: ['a'], elements: [document.elements[0]] });
    await expect(service.editCanvas(agentId, visualizationId, 0, [{ id: 'a', changes: { text: 'Stale' } }])).rejects.toThrow('Stale');
    await service.editCanvas(agentId, visualizationId, 1, [{ id: 'a', changes: { text: 'Agent edit' } }]);
    await expect(service.replace(agentId, { visualizationId, title: 'Replace', content: { kind: 'mermaid', source: 'flowchart LR; A --> C' } })).rejects.toThrow('authoritative');
    const reloaded = await persistence.load();
    const canvas = reloaded.agents[0].visualize!.visualizations[0].canvas!;
    expect(canvas.revision).toBe(2);
    expect(canvas.elements[0]).toMatchObject({ text: 'Agent edit', x: 200, y: 90 });
    expect(canvas.elements[1]).toStrictEqual(document.elements[1]);
    expect(canvas.files).toStrictEqual(document.files);
    const copy = service.get(agentId, visualizationId).visualization.canvas!;
    copy.elements[0].text = 'Leak';
    expect(service.readCanvas(agentId, visualizationId).elements[0].text).toBe('Agent edit');
    await service.setOpen(agentId, false);
    expect(() => service.readCanvas(agentId, visualizationId)).toThrow('not active');
    await service.saveCanvas(agentId, { visualizationId, sessionId: snapshot.agents[0].visualize!.id, expectedSource: '', expectedRevision: 2, document });
    await expect(service.saveCanvas(agentId, { visualizationId, sessionId: 'old-session', expectedSource: '', expectedRevision: 3, document })).rejects.toThrow('not active');
    await service.setOpen(agentId, true);
    snapshot.agents[0].visualize!.conversationRef = { backend: 'codex', threadId: 'other-conversation' };
    await expect(service.saveCanvas(agentId, { visualizationId, sessionId: snapshot.agents[0].visualize!.id, expectedSource: '', expectedRevision: 2, document })).rejects.toThrow('not active');
  });

  it('rolls back failed saves and serializes competing canvas revisions', async () => {
    const snapshot = createInitialSnapshot();
    const persist = vi.fn().mockResolvedValue(undefined);
    const service = new VisualizeService({ snapshot, generatedImagesRoot: os.tmpdir(), persist, publish: vi.fn() });
    const agentId = snapshot.agents[0].id;
    await service.enter(agentId);
    const { visualizationId } = await service.add(agentId, { title: 'Map', content: { kind: 'svg', source: '<svg />' } });
    const input = { visualizationId, sessionId: snapshot.agents[0].visualize!.id, expectedSource: JSON.stringify(service.get(agentId, visualizationId).visualization.content), expectedRevision: 0, document: { elements: [], files: {}, selectedElementIds: [], preview: '' } };
    await expect(service.saveCanvas(agentId, { ...input, expectedSource: 'outdated import' })).rejects.toThrow('source changed');
    expect(service.get(agentId, visualizationId).visualization.canvas).toBeUndefined();
    persist.mockRejectedValueOnce(new Error('Disk full'));
    await expect(service.saveCanvas(agentId, input)).rejects.toThrow('Disk full');
    expect(service.get(agentId, visualizationId).visualization.canvas).toBeUndefined();
    const results = await Promise.allSettled([service.saveCanvas(agentId, input), service.saveCanvas(agentId, input)]);
    expect(results.map(result => result.status)).toStrictEqual(['fulfilled', 'rejected']);
    expect(service.readCanvas(agentId, visualizationId).revision).toBe(1);
  });

  it('runs the durable suggest, add, select, read, and replace workflow', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0];
    agent.backendSession = { kind: 'codex', threadId: 'thread-visualize' };
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-visualize-'));
    const generatedImagesRoot = path.join(temporaryDirectory, 'generated_images');
    await mkdir(generatedImagesRoot);
    await writeFile(path.join(generatedImagesRoot, 'system.png'), Buffer.from('visualization'));
    const persist = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn();
    let sequence = 0;
    const service = new VisualizeService({
      snapshot,
      generatedImagesRoot,
      createId: prefix => `${prefix}-${++sequence}`,
      now: () => new Date('2026-09-21T12:00:00.000Z'),
      persist,
      publish,
    });

    const entered = await service.enter(agent.id);
    expect(entered.created).toBe(true);
    expect(entered.visualize.isOpen).toBe(true);
    expect(entered.visualize.conversationRef).toStrictEqual({ backend: 'codex', threadId: 'thread-visualize' });

    const suggested = await service.suggest(agent.id, [
      { title: 'System map', description: 'Show services and data movement.' },
      { title: 'Request sequence', description: 'Show the critical request path.' },
    ]);
    const suggestionId = suggested.suggestions[0].id;
    const added = await service.add(agent.id, {
      title: 'System map',
      suggestionId,
      content: { kind: 'mermaid', source: 'flowchart LR\n  A --> B' },
    });
    await service.add(agent.id, {
      title: 'Generated concept',
      content: { kind: 'image', generatedImagePath: 'system.png', alt: 'A system concept visualization' },
    });
    await service.select(agent.id, added.visualizationId);
    const replaced = await service.replace(agent.id, {
      visualizationId: added.visualizationId,
      title: 'System map, revised',
      content: { kind: 'svg', source: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>' },
    });

    expect(replaced.title).toBe('System map, revised');
    expect(service.get(agent.id, added.visualizationId).visualization).toMatchObject({
      title: 'System map, revised',
      content: { kind: 'svg' },
    });
    expect(agent.visualize?.suggestions[0].visualizationId).toBe(added.visualizationId);
    const image = agent.visualize?.visualizations.find(visualization => visualization.content.kind === 'image');
    await expect(service.readAsset(agent.id, image!.id)).resolves.toMatchObject({
      mimeType: 'image/png',
      dataUrl: expect.stringMatching(/^data:image\/png;base64,/u),
    });
    expect(persist).toHaveBeenCalledTimes(6);
    expect(publish).toHaveBeenCalledTimes(6);
  });

  it('lists and deletes visualizations, rejects calls when closed, and restarts suggestions after the last deletion', async () => {
    const snapshot = createInitialSnapshot();
    const persist = vi.fn().mockResolvedValue(undefined);
    const service = new VisualizeService({
      snapshot,
      generatedImagesRoot: os.tmpdir(),
      persist,
      publish: () => undefined,
    });
    const agentId = snapshot.agents[0].id;

    await service.enter(agentId);
    const suggestions = await service.suggest(agentId, [{ title: 'System', description: 'Show the system.' }]);
    const first = await service.add(agentId, {
      title: 'System',
      suggestionId: suggestions.suggestions[0].id,
      content: { kind: 'mermaid', source: 'flowchart LR\n A --> B' },
    });
    const second = await service.add(agentId, {
      title: 'Sequence',
      content: { kind: 'svg', source: '<svg xmlns="http://www.w3.org/2000/svg" />' },
    });

    expect(service.list(agentId).visualizations).toStrictEqual([
      { id: first.visualizationId, title: 'System', kind: 'mermaid', selected: false },
      { id: second.visualizationId, title: 'Sequence', kind: 'svg', selected: true },
    ]);
    await expect(service.delete(agentId, second.visualizationId)).resolves.toMatchObject({
      selectedVisualizationId: first.visualizationId,
    });
    await service.delete(agentId, first.visualizationId);
    expect(snapshot.agents[0].visualize).toMatchObject({
      visualizations: [],
      selectedVisualizationId: null,
    });
    expect(snapshot.agents[0].visualize?.suggestions[0]).not.toHaveProperty('visualizationId');

    await service.setOpen(agentId, false);
    expect(service.contextForAgent(agentId)).toBeUndefined();
    expect(() => service.list(agentId)).toThrow('Visualize mode is not active for this conversation.');

    const reopened = await service.enter(agentId);
    expect(reopened).toMatchObject({ created: true, visualize: { isOpen: true, suggestions: [] } });
    expect(persist).toHaveBeenCalled();
  });

  it('keeps visualization suggestions compact for the Visualize pane', async () => {
    const snapshot = createInitialSnapshot();
    const service = new VisualizeService({
      snapshot,
      generatedImagesRoot: os.tmpdir(),
      persist: () => Promise.resolve(),
      publish: () => undefined,
    });
    await service.enter(snapshot.agents[0].id);

    const result = await service.suggest(snapshot.agents[0].id, [{
      title: '  System\nmap  ',
      description: '  Services,\n boundaries,   and data flow.  ',
    }]);

    expect(result.suggestions[0]).toMatchObject({
      title: 'System map',
      description: 'Services, boundaries, and data flow.',
    });
    await expect(service.suggest(snapshot.agents[0].id, [{
      title: '界'.repeat(80),
      description: '图'.repeat(120),
    }])).resolves.toMatchObject({
      suggestions: [{ title: '界'.repeat(80), description: '图'.repeat(120) }],
    });
    await expect(service.suggest(snapshot.agents[0].id, [{
      title: 'System map',
      description: 'x'.repeat(121),
    }])).rejects.toThrow('Suggestion description');
  });

  it('splits a generated-visualization request into visible copy and model-only context', () => {
    const prompt = generateVisualizationSuggestionPrompt({
      id: 'visualize-1',
      conversationRef: null,
      isOpen: true,
      suggestions: [{
        id: 'suggestion-flow',
        title: 'Deployment flow',
        description: 'Show the deployment path.',
      }],
      visualizations: [],
      selectedVisualizationId: null,
      createdAt: '2026-09-21T12:00:00.000Z',
      updatedAt: '2026-09-21T12:00:00.000Z',
    }, 'suggestion-flow');

    expect(prompt.slice(0, prompt.indexOf('<context>')).trim()).toBe('Generate the “Deployment flow” visualization.');
    expect(prompt).toContain('suggestion-flow');
    expect(prompt).toMatch(/Do not browse,[\s\S]*background research/u);
    expect(prompt).toMatch(/<context>[\s\S]*<\/context>$/u);
  });

  it('rejects invalid replacement suggestions and generated images outside the owned folder', async () => {
    const snapshot = createInitialSnapshot();
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-visualize-'));
    const generatedImagesRoot = path.join(temporaryDirectory, 'generated_images');
    await mkdir(generatedImagesRoot);
    const outside = path.join(temporaryDirectory, 'outside.png');
    await writeFile(outside, Buffer.from('outside'));
    const service = new VisualizeService({
      snapshot,
      generatedImagesRoot,
      persist: () => Promise.resolve(),
      publish: () => undefined,
    });
    await service.enter(snapshot.agents[0].id);
    const added = await service.add(snapshot.agents[0].id, {
      title: 'Current',
      content: { kind: 'mermaid', source: 'flowchart LR\n A --> B' },
    });

    const beforeInvalidSuggestion = service.get(snapshot.agents[0].id, added.visualizationId).visualization;
    await expect(service.replace(snapshot.agents[0].id, {
      visualizationId: added.visualizationId,
      suggestionId: 'missing-suggestion',
      title: 'Rejected replacement',
      content: { kind: 'mermaid', source: 'flowchart LR\n A --> D' },
    })).rejects.toThrow('Visualize suggestion not found');
    expect(service.get(snapshot.agents[0].id, added.visualizationId).visualization).toStrictEqual(beforeInvalidSuggestion);
    await expect(service.add(snapshot.agents[0].id, {
      title: 'Outside',
      content: { kind: 'image', generatedImagePath: outside, alt: 'Outside image' },
    })).rejects.toThrow(`inside the ${product.name} generated-images folder`);
  });

  it('rejects Mermaid diagram families the renderer cannot display', async () => {
    const snapshot = createInitialSnapshot();
    const service = new VisualizeService({
      snapshot,
      generatedImagesRoot: os.tmpdir(),
      persist: () => Promise.resolve(),
      publish: () => undefined,
    });
    const agentId = snapshot.agents[0].id;
    await service.enter(agentId);

    await expect(service.add(agentId, {
      title: 'Release schedule',
      content: { kind: 'mermaid', source: 'gantt\n title Release schedule' },
    })).rejects.toThrow('support only flowchart, state, sequence, class, ER, and XY diagrams');
    expect(snapshot.agents[0].visualize?.visualizations).toStrictEqual([]);
  });

  it('rejects repeated generation of the same suggestion', async () => {
    const snapshot = createInitialSnapshot();
    const service = new VisualizeService({
      snapshot,
      generatedImagesRoot: os.tmpdir(),
      persist: () => Promise.resolve(),
      publish: () => undefined,
    });
    const agentId = snapshot.agents[0].id;
    await service.enter(agentId);
    const suggested = await service.suggest(agentId, [{ title: 'System', description: 'Show the system.' }]);
    const suggestionId = suggested.suggestions[0].id;
    await service.add(agentId, {
      title: 'System',
      suggestionId,
      content: { kind: 'mermaid', source: 'flowchart LR\n A --> B' },
    });
    const session = snapshot.agents[0].visualize!;

    expect(() => generateVisualizationSuggestionPrompt(session, suggestionId)).toThrow('already generated');
    await expect(service.add(agentId, {
      title: 'Duplicate system',
      suggestionId,
      content: { kind: 'mermaid', source: 'flowchart LR\n A --> C' },
    })).rejects.toThrow('already generated');
    expect(session.visualizations).toHaveLength(1);
  });

  it('does not expose a Visualize session after its owning conversation is released', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0];
    agent.backendSession = { kind: 'codex', threadId: 'thread-visualize' };
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-visualize-'));
    const generatedImagesRoot = path.join(temporaryDirectory, 'generated_images');
    await mkdir(generatedImagesRoot);
    const service = new VisualizeService({
      snapshot,
      generatedImagesRoot,
      persist: () => Promise.resolve(),
      publish: () => undefined,
    });

    await service.enter(agent.id);
    expect(service.contextForAgent(agent.id)).toBeDefined();

    delete agent.backendSession;

    expect(service.contextForAgent(agent.id)).toBeUndefined();
  });
});
