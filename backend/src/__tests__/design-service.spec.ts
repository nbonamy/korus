import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { designNodes, type DesignContent, type DesignEdit, type DesignRequest } from '@workspace/core/design';
import { AppStateStore } from '../persistence/store';
import { DesignService } from '../design-service';

const content: DesignContent = {
  title: 'Launch', css: 'body { font-family: sans-serif; }', comments: [],
  artboards: [{ id: 'desktop', title: 'Desktop', width: 960, height: 640, root: {
    id: 'root', tag: 'main', children: [
      { id: 'heading', tag: 'h1', text: 'Hello' },
      { id: 'cta', tag: 'button', text: 'Start' },
    ],
  } }],
};
let directory: string | undefined;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

// Generated controls must mutate authored styles without losing manual edits;
// invalid values, stale revisions and copied/removed targets are owner boundaries.
it('preserves generated tweaks, manual content and recovery across agent edits and reload', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'design-tweaks-'));
  const store = new AppStateStore(directory);
  let snapshot = createInitialSnapshot();
  const agentId = snapshot.agents[0].id;
  let service = new DesignService({ snapshot, persist: () => store.save(snapshot), publish: () => undefined });
  const run = (request: DesignRequest) => service.execute(agentId, request);
  const edit = async (edits: DesignEdit[]) => run({ type: 'edit', expectedRevision: (await run({ type: 'read' })).workspace.document!.revision, edits });
  await run({ type: 'open' });
  await run({ type: 'create', content });
  await edit([
    { type: 'tweak-set', tweak: { id: 'spacing', label: 'Spacing', nodeId: 'root', property: '--spacing', type: 'range', min: 8, max: 64, step: 8, unit: 'px' } },
    { type: 'tweak-set', tweak: { id: 'accent', label: 'Accent', nodeId: 'heading', property: 'color', type: 'color' } },
    { type: 'tweak-set', tweak: { id: 'weight', label: 'Weight', nodeId: 'heading', property: 'font-weight', type: 'select', options: [{ label: 'Regular', value: '400' }, { label: 'Bold', value: '700' }] } },
    { type: 'tweak-set', tweak: { id: 'quiet', label: 'Quiet', nodeId: 'cta', property: 'opacity', type: 'toggle', on: '0.5', off: '1' } },
    { type: 'text', nodeId: 'heading', text: 'My manual headline' },
  ]);
  const chosen = (await edit([
    { type: 'tweak-value', tweakId: 'spacing', value: 40 },
    { type: 'tweak-value', tweakId: 'accent', value: '#336699' },
    { type: 'tweak-value', tweakId: 'weight', value: '700' },
    { type: 'tweak-value', tweakId: 'quiet', value: true },
  ])).workspace;
  await expect(run({ type: 'edit', expectedRevision: chosen.document!.revision - 1, edits: [{ type: 'tweak-value', tweakId: 'spacing', value: 8 }] })).rejects.toThrow('Stale');
  for (const invalid of [
    { type: 'tweak-value', tweakId: 'spacing', value: 41 },
    { type: 'tweak-value', tweakId: 'spacing', value: 80 },
    { type: 'tweak-value', tweakId: 'weight', value: '900' },
    { type: 'tweak-value', tweakId: 'accent', value: 'url(https://bad.test)' },
    { type: 'tweak-value', tweakId: 'quiet', value: 'true' },
    { type: 'tweak-set', tweak: { id: 'broken', label: 'Broken', nodeId: 'missing', property: 'color', type: 'color' } },
  ] as DesignEdit[]) {
    await expect(edit([{ type: 'text', nodeId: 'heading', text: 'Must roll back' }, invalid])).rejects.toThrow();
    expect((await run({ type: 'read' })).workspace).toStrictEqual(chosen);
  }
  await edit([{ type: 'text', nodeId: 'cta', text: 'Agent update' }]);
  snapshot = await store.load();
  service = new DesignService({ snapshot, persist: () => store.save(snapshot), publish: () => undefined });
  const saved = (await run({ type: 'read' })).workspace;
  expect(saved.document!.content.artboards[0].root.styles).toMatchObject({ '--spacing': '40px' });
  expect(designNodes(saved.document!.content).find(node => node.id === 'heading')).toMatchObject({ text: 'My manual headline', styles: { color: '#336699', 'font-weight': '700' } });
  const copy = (await edit([{ type: 'artboard-duplicate', artboardId: 'desktop' }])).workspace.document!.content;
  expect(copy.tweaks).toHaveLength(8);
  const copiedSpacing = copy.tweaks!.find(tweak => tweak.nodeId === copy.artboards[1].root.id)!;
  expect(copiedSpacing.id).not.toBe('spacing');
  await edit([{ type: 'tweak-value', tweakId: copiedSpacing.id, value: 16 }, { type: 'remove', nodeId: 'heading' }]);
  const removed = (await run({ type: 'read' })).workspace;
  expect(removed.document!.content.tweaks!.some(tweak => tweak.nodeId === 'heading')).toBe(false);
  expect(removed.document!.content.artboards[0].root.styles).toMatchObject({ '--spacing': '40px' });
  await run({ type: 'undo', expectedRevision: removed.document!.revision });
  expect((await run({ type: 'read' })).workspace.document!.content).toStrictEqual(copy);
  await edit([{ type: 'tweak-remove', tweakId: 'accent' }]);
  expect(designNodes((await run({ type: 'read' })).workspace.document!.content).find(node => node.id === 'heading')!.styles!.color).toBe('#336699');
});

// Broken flow references must reject atomically; copies and removals must keep
// their own targets, including after persistence and undo.
it('persists prototype actions and maintains their targets through copy, removal and recovery', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'design-flow-'));
  const store = new AppStateStore(directory);
  let snapshot = createInitialSnapshot();
  const agentId = snapshot.agents[0].id;
  let service = new DesignService({ snapshot, persist: () => store.save(snapshot), publish: () => undefined });
  const run = (request: DesignRequest) => service.execute(agentId, request);
  const edit = async (edits: DesignEdit[]) => run({ type: 'edit', expectedRevision: (await run({ type: 'read' })).workspace.document!.revision, edits });
  await run({ type: 'open' });
  await run({ type: 'create', content });
  await edit([
    { type: 'artboard-add', artboard: { id: 'detail', title: 'Detail', width: 600, height: 500, root: { id: 'detail-root', tag: 'main', children: [
      { id: 'back', tag: 'button', text: 'Back', interaction: { type: 'back' } },
      { id: 'again', tag: 'button', text: 'Again', interaction: { type: 'navigate', artboardId: 'detail' } },
      { id: 'show', tag: 'button', text: 'Show', interaction: { type: 'show', nodeId: 'extra' } },
      { id: 'extra', tag: 'p', text: 'Detail', attributes: { hidden: '' } },
    ] } } },
    { type: 'interaction', nodeId: 'cta', interaction: { type: 'navigate', artboardId: 'detail' } },
  ]);
  const before = (await run({ type: 'read' })).workspace;
  for (const interaction of [{ type: 'navigate', artboardId: 'missing' }, { type: 'show', nodeId: 'extra' }, { type: 'execute', script: 'alert(1)' }]) {
    await expect(edit([{ type: 'text', nodeId: 'heading', text: 'Must roll back' }, { type: 'interaction', nodeId: 'cta', interaction } as DesignEdit])).rejects.toThrow();
    expect((await run({ type: 'read' })).workspace).toStrictEqual(before);
  }
  const copy = (await edit([{ type: 'artboard-duplicate', artboardId: 'detail' }])).workspace.document!.content.artboards[2];
  expect(copy.root.children![1].interaction).toStrictEqual({ type: 'navigate', artboardId: copy.id });
  expect(copy.root.children![2].interaction).toStrictEqual({ type: 'show', nodeId: copy.root.children![3].id });
  await edit([{ type: 'remove', nodeId: 'extra' }]);
  expect(designNodes((await run({ type: 'read' })).workspace.document!.content).find(node => node.id === 'show')!.interaction).toBeUndefined();
  await edit([{ type: 'artboard-remove', artboardId: 'detail' }]);
  snapshot = await store.load();
  service = new DesignService({ snapshot, persist: () => store.save(snapshot), publish: () => undefined });
  const saved = (await run({ type: 'read' })).workspace;
  expect(designNodes(saved.document!.content).find(node => node.id === 'cta')!.interaction).toBeUndefined();
  await run({ type: 'undo', expectedRevision: saved.document!.revision });
  expect(designNodes((await run({ type: 'read' })).workspace.document!.content).find(node => node.id === 'cta')!.interaction).toStrictEqual({ type: 'navigate', artboardId: 'detail' });
  await edit([{ type: 'interaction', nodeId: 'cta', interaction: null }]);
  expect(designNodes((await store.load()).agents[0].designWorkspace!.document!.content).find(node => node.id === 'cta')!.interaction).toBeUndefined();
});

// Structural editing can lose authored identity, break target references or create
// cycles. Exercise it through saved edits and reload, including atomic rejection.
it('edits layers without losing manual content, linked targets or recovery across reload', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'design-layers-'));
  const store = new AppStateStore(directory);
  let snapshot = createInitialSnapshot();
  const agentId = snapshot.agents[0].id;
  let service = new DesignService({ snapshot, persist: () => store.save(snapshot), publish: () => undefined });
  const run = (request: DesignRequest) => service.execute(agentId, request);
  const edit = async (edits: DesignEdit[]) => run({ type: 'edit', expectedRevision: (await run({ type: 'read' })).workspace.document!.revision, edits });
  await run({ type: 'open' });
  await run({ type: 'create', content: { ...content, css: '#card { color: #abc; } @media(min-width: 400px){#heading {font-size: 28px}}', artboards: [{ ...content.artboards[0], root: { id: 'root', tag: 'main', children: [
    { id: 'card', tag: 'section', children: [
      { id: 'heading', tag: 'h1', text: 'My own headline', styles: { color: 'purple', padding: '12px' } },
      { id: 'toggle', tag: 'button', text: 'More', toggleTargetId: 'details' },
      { id: 'details', tag: 'p', text: 'Details', attributes: { hidden: '' } },
    ] },
    { id: 'footer', tag: 'footer', children: [] },
    { id: 'input', tag: 'input', attributes: { placeholder: 'Name', disabled: '' } },
  ] } }] } });
  await run({ type: 'comment', expectedRevision: 1, nodeId: 'heading', text: 'Keep this' });
  const duplicated = (await edit([{ type: 'duplicate', nodeId: 'card' }])).workspace;
  const copy = duplicated.document!.content.artboards[0].root.children![1];
  const [copiedHeading, copiedToggle, copiedDetails] = copy.children!;
  expect(copy.id).not.toBe('card');
  expect(copiedHeading.text).toBe('My own headline');
  expect(copiedToggle.toggleTargetId).toBe(copiedDetails.id);
  const css = duplicated.document!.content.artboards[0].css ?? duplicated.document!.content.css;
  expect(css).toContain(`#${copy.id}`);
  expect(css).toContain(`#${copiedHeading.id}`);
  expect(css).toContain('#abc');
  expect(duplicated.document!.content.comments).toHaveLength(1);
  await run({ type: 'select', artboardId: 'desktop', nodeId: 'heading' });
  await edit([
    { type: 'move', nodeId: 'heading', parentId: 'footer', index: 0 },
    { type: 'move', nodeId: 'footer', parentId: 'root', index: 0 },
    { type: 'style', nodeId: 'heading', styles: { padding: null, 'font-weight': '600' } },
    { type: 'attributes', nodeId: 'input', attributes: { disabled: null, placeholder: 'Your name', 'aria-label': 'Name' } },
  ]);
  const beforeInvalid = (await run({ type: 'read' })).workspace;
  for (const invalid of [
    { type: 'move', nodeId: 'footer', parentId: 'heading', index: 0 },
    { type: 'move', nodeId: 'root', parentId: 'footer', index: 0 },
    { type: 'insert', nodeId: 'input', node: { id: 'bad', tag: 'span', text: 'Invisible' } },
    { type: 'attributes', nodeId: 'input', attributes: { onclick: 'alert(1)' } },
  ] as DesignEdit[]) {
    await expect(edit([{ type: 'text', nodeId: copiedHeading.id, text: 'Must roll back' }, invalid])).rejects.toThrow();
    expect((await run({ type: 'read' })).workspace).toStrictEqual(beforeInvalid);
  }
  await edit([{ type: 'remove', nodeId: 'details' }]);
  snapshot = await store.load();
  service = new DesignService({ snapshot, persist: () => store.save(snapshot), publish: () => undefined });
  const saved = (await run({ type: 'read' })).workspace;
  const nodes = designNodes(saved.document!.content);
  expect(saved.selectedNodeId).toBe('heading');
  expect(saved.document!.content.artboards[0].root.children![0].id).toBe('footer');
  expect(nodes.find(node => node.id === 'heading')).toStrictEqual({ id: 'heading', tag: 'h1', text: 'My own headline', styles: { color: 'purple', 'font-weight': '600' } });
  expect(nodes.find(node => node.id === 'input')!.attributes).toStrictEqual({ placeholder: 'Your name', 'aria-label': 'Name' });
  expect(nodes.find(node => node.id === 'toggle')!.toggleTargetId).toBeUndefined();
  expect(nodes.find(node => node.id === copiedToggle.id)!.toggleTargetId).toBe(copiedDetails.id);
  expect(saved.document!.content.comments[0].nodeId).toBe('heading');
  await run({ type: 'undo', expectedRevision: saved.document!.revision });
  const restored = (await run({ type: 'read' })).workspace;
  expect(designNodes(restored.document!.content).find(node => node.id === 'toggle')!.toggleTargetId).toBe('details');
  await run({ type: 'redo', expectedRevision: restored.document!.revision });
  expect((await store.load()).agents[0].designWorkspace!.document!.content).toStrictEqual(saved.document!.content);
});

// Owner-boundary regression: manual edits, targeted agent edits and recovery must
// survive a real persistence reload, including competing writes and disk failure.
it('preserves user changes through agent edits, reload, undo, checkpoint recovery and export', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'design-workflow-'));
  const store = new AppStateStore(directory);
  const snapshot = createInitialSnapshot();
  const agentId = snapshot.agents[0].id;
  snapshot.agents[0].backendSession = { kind: 'codex', threadId: 'original' };
  let service = new DesignService({ capture: async () => 'data:image/png;base64,YQ==', snapshot, persist: () => store.save(snapshot), publish: () => undefined });
  const run = (request: DesignRequest) => service.execute(agentId, request);
  await run({ type: 'open' });
  await run({ type: 'create', content });
  await run({ type: 'edit', expectedRevision: 1, edits: [
    { type: 'text', nodeId: 'heading', text: 'Written by me' },
    { type: 'style', nodeId: 'heading', styles: { color: 'rebeccapurple', padding: '24px' } },
  ] });
  await run({ type: 'select', artboardId: 'desktop', nodeId: 'heading' });
  await run({ type: 'comment', expectedRevision: 2, nodeId: 'heading', text: 'Keep this headline' });
  const checkpoint = (await run({ type: 'checkpoint', expectedRevision: 3, title: 'My version' })).workspace.checkpoints[0];
  const outcomes = await Promise.allSettled([
    run({ type: 'edit', expectedRevision: 3, edits: [{ type: 'text', nodeId: 'cta', text: 'Explore' }] }),
    run({ type: 'edit', expectedRevision: 3, edits: [{ type: 'text', nodeId: 'heading', text: 'Stale overwrite' }] }),
  ]);
  expect(outcomes.map(result => result.status)).toStrictEqual(['fulfilled', 'rejected']);
  const reloaded = await store.load();
  service = new DesignService({ capture: async () => 'data:image/png;base64,YQ==', snapshot: reloaded, persist: () => store.save(reloaded), publish: () => undefined });
  const saved = (await run({ type: 'read' })).workspace;
  expect(saved.document!.revision).toBe(4);
  expect(saved.selectedNodeId).toBe('heading');
  expect(saved.document!.content.artboards[0].root.children).toStrictEqual([
    { id: 'heading', tag: 'h1', text: 'Written by me', styles: { color: 'rebeccapurple', padding: '24px' } },
    { id: 'cta', tag: 'button', text: 'Explore' },
  ]);
  expect(saved.document!.content.comments).toMatchObject([{ nodeId: 'heading', text: 'Keep this headline', revision: 3 }]);
  await run({ type: 'undo', expectedRevision: 4 });
  expect((await run({ type: 'read' })).workspace.document!.content.artboards[0].root.children![1].text).toBe('Start');
  await run({ type: 'edit', expectedRevision: 5, edits: [{ type: 'text', nodeId: 'cta', text: 'Another version' }] });
  await run({ type: 'restore', expectedRevision: 6, checkpointId: checkpoint.id });
  const exported = await run({ type: 'export' });
  expect(exported.screenshot).toBe('data:image/png;base64,YQ==');
  expect(exported.html).toContain('Written by me');
  expect(exported.html).toContain('rebeccapurple');
  expect(exported.html).toContain('data-design-id="heading"');
  expect(exported.handoff).toContain('Keep this headline');
  expect(exported.html).not.toContain('Another version');
  await writeFile(path.join(directory, 'acceptance.html'), exported.html!);
  expect((await store.load()).agents[0].designWorkspace).toStrictEqual(exported.workspace);
  await expect(run({ type: 'create', content })).rejects.toThrow('already');
  delete reloaded.agents[0].backendSession;
  await expect(run({ type: 'read' })).resolves.toMatchObject({ workspace: { document: { revision: 7 } } });
  const resumed = await run({ type: 'comment', expectedRevision: 7, nodeId: 'heading', text: 'Continue from my saved design.' });
  expect(resumed.workspace.conversationRef).toBeNull();
  reloaded.agents[0].backendSession = { kind: 'codex', threadId: 'recovered-session' };
  await run({ type: 'edit', expectedRevision: 8, edits: [{ type: 'text', nodeId: 'cta', text: 'Recovered agent edit' }] });
  expect((await run({ type: 'read' })).workspace.document!.content.artboards[0].root.children![0].text).toBe('Written by me');
  reloaded.agents[0].backendSession = { kind: 'codex', threadId: 'different' };
  await expect(run({ type: 'edit', expectedRevision: 7, edits: [{ type: 'text', nodeId: 'cta', text: 'Wrong conversation' }] })).rejects.toThrow('conversation');
});

it('rejects unsafe content, invalid targets and edits atomically, and rolls back failed persistence', async () => {
  const snapshot = createInitialSnapshot();
  const agentId = snapshot.agents[0].id;
  const persist = vi.fn().mockResolvedValue(undefined);
  const service = new DesignService({ snapshot, persist, publish: vi.fn() });
  const run = (request: DesignRequest) => service.execute(agentId, request);
  await run({ type: 'open' });
  for (const unsafe of [
    { ...content, css: '@import "https://evil.test";' },
    { ...content, artboards: [{ ...content.artboards[0], root: { id: 'script', tag: 'script', text: 'alert(1)' } }] },
    { ...content, artboards: [{ ...content.artboards[0], root: { id: 'image', tag: 'img', attributes: { src: 'https://evil.test/track' } } }] },
  ]) await expect(run({ type: 'create', content: unsafe })).rejects.toThrow('Invalid design');
  await run({ type: 'create', content });
  await expect(run({ type: 'edit', expectedRevision: 1, edits: [
    { type: 'text', nodeId: 'heading', text: 'Should roll back' },
    { type: 'text', nodeId: 'missing', text: 'No target' },
  ] })).rejects.toThrow('node');
  persist.mockRejectedValueOnce(new Error('Disk full'));
  await expect(run({ type: 'edit', expectedRevision: 1, edits: [{ type: 'text', nodeId: 'heading', text: 'Unsaved' }] })).rejects.toThrow('Disk full');
  const current = (await run({ type: 'read' })).workspace;
  expect(current.document!.revision).toBe(1);
  expect(current.document!.content).toStrictEqual(content);
  await expect(run({ type: 'comment', expectedRevision: 1, nodeId: 'missing', text: 'Wrong target' })).rejects.toThrow('node');
  await run({ type: 'close' });
  await expect(run({ type: 'edit', expectedRevision: 1, edits: [{ type: 'remove', nodeId: 'heading' }] })).rejects.toThrow('open');
});

// Exploration must never alias a copy's identities, styles or interaction targets
// to the original. Editing, removing and recovering alternatives must survive disk.
it('branches independent artboards, preserves the chosen direction and recovers exploration after reload', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'design-alternatives-'));
  const store = new AppStateStore(directory);
  let snapshot = createInitialSnapshot();
  const agentId = snapshot.agents[0].id;
  let service = new DesignService({ snapshot, persist: () => store.save(snapshot), publish: () => undefined });
  const run = (request: DesignRequest) => service.execute(agentId, request);
  const edit = async (edits: DesignEdit[]) => run({ type: 'edit', expectedRevision: (await run({ type: 'read' })).workspace.document!.revision, edits });
  await run({ type: 'open' });
  await run({ type: 'create', content: { ...content, css: '#abc { color: #abc; } [data-design-id="details"] { padding: 12px; }', artboards: [{
    ...content.artboards[0], position: { x: -320, y: 180 }, notes: 'Editorial hierarchy', root: { id: 'root', tag: 'main', children: [
      { id: 'abc', tag: 'h1', text: 'My headline', styles: { 'font-size': '48px' } },
      { id: 'toggle', tag: 'button', text: 'Details', toggleTargetId: 'details' },
      { id: 'link', tag: 'a', text: 'Jump', attributes: { href: '#details' } },
      { id: 'details', tag: 'p', text: 'Original detail', attributes: { hidden: '' } },
    ] },
  }] } });
  await run({ type: 'comment', expectedRevision: 1, nodeId: 'abc', text: 'Keep this text' });
  const original = structuredClone((await run({ type: 'read' })).workspace.document!.content.artboards[0]);
  const duplicated = await edit([{ type: 'artboard-duplicate', artboardId: 'desktop', title: 'Alternative' }]);
  const copy = duplicated.workspace.document!.content.artboards[1];
  expect(copy.position).toStrictEqual({ x: 720, y: 180 });
  const [heading, toggle, link, details] = copy.root.children!;
  expect(new Set(designNodes(duplicated.workspace.document!.content).map(node => node.id)).size).toBe(10);
  expect(toggle.toggleTargetId).toBe(details.id);
  expect(link.attributes!.href).toBe(`#${details.id}`);
  expect(copy.css).toContain(`#${heading.id}`);
  expect(copy.css).toContain('color: #abc');
  expect(copy.css).toContain(`data-design-id="${details.id}"`);
  expect(duplicated.workspace.document!.content.comments).toMatchObject([{ nodeId: 'abc', text: 'Keep this text' }]);
  await edit([
    { type: 'text', nodeId: heading.id, text: 'Different direction' },
    { type: 'artboard-update', artboardId: copy.id, changes: { title: 'Compact', width: 480, position: { x: 240, y: -160 }, notes: 'Less scrolling', css: 'h1 { color: teal; }' } },
    { type: 'artboard-add', artboard: { id: 'third', title: 'Third', width: 800, height: 600, root: { id: 'third-root', tag: 'h1', text: 'New alternative' } } },
    { type: 'choose-artboard', artboardId: 'desktop' },
  ]);
  const revision = (await run({ type: 'read' })).workspace.document!.revision;
  await expect(run({ type: 'edit', expectedRevision: revision - 1, edits: [{ type: 'artboard-remove', artboardId: 'desktop' }] })).rejects.toThrow('Stale');
  await expect(edit([{ type: 'artboard-update', artboardId: copy.id, changes: { css: '@import "https://bad.test";' } }])).rejects.toThrow('Invalid');
  await expect(edit([{ type: 'artboard-update', artboardId: copy.id, changes: { title: 'Unsaved' } }, { type: 'artboard-add', artboard: original }])).rejects.toThrow('Invalid');
  for (const position of [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: 100001, y: 0 }, { x: 0, y: -100001 }]) {
    await expect(edit([{ type: 'text', nodeId: heading.id, text: 'Must roll back' }, { type: 'artboard-update', artboardId: copy.id, changes: { position } }])).rejects.toThrow('Invalid');
  }
  snapshot = await store.load();
  service = new DesignService({ snapshot, persist: () => store.save(snapshot), publish: () => undefined });
  const saved = (await run({ type: 'read' })).workspace.document!.content;
  expect(saved.artboards[0]).toStrictEqual(original);
  expect(saved.chosenArtboardId).toBe('desktop');
  expect(saved.artboards.map(board => board.title)).toStrictEqual(['Desktop', 'Compact', 'Third']);
  expect(saved.artboards[1].position).toStrictEqual({ x: 240, y: -160 });
  expect(saved.artboards[1].root.children![0].text).toBe('Different direction');
  await run({ type: 'select', artboardId: copy.id, nodeId: heading.id });
  await edit([{ type: 'artboard-remove', artboardId: copy.id }]);
  expect((await run({ type: 'read' })).workspace.selectedArtboardId).toBe('desktop');
  await run({ type: 'undo', expectedRevision: revision + 1 });
  expect((await run({ type: 'read' })).workspace.document!.content.artboards).toHaveLength(3);
  expect((await run({ type: 'read' })).workspace.document!.content.artboards[1].position).toStrictEqual({ x: 240, y: -160 });
  await run({ type: 'redo', expectedRevision: revision + 2 });
  expect((await run({ type: 'read' })).workspace.document!.content.artboards).toHaveLength(2);
  await edit([{ type: 'artboard-remove', artboardId: 'third' }]);
  await expect(edit([{ type: 'artboard-remove', artboardId: 'desktop' }])).rejects.toThrow('last artboard');
  const exported = await run({ type: 'export', artboardId: 'desktop' });
  expect(exported.html).toContain('My headline');
  expect(exported.html).not.toContain('Different direction');
  expect(exported.handoff).toContain('Editorial hierarchy');
  expect(exported.handoff).toContain('Chosen direction: Desktop');
  expect((await store.load()).agents[0].designWorkspace).toStrictEqual(exported.workspace);
});
