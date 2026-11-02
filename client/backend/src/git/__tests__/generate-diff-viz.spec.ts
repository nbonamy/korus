import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { generateDiffViz } from '../generate-diff-viz';

const assets = path.resolve(import.meta.dirname, '../../../../electron/assets');
beforeEach(() => vi.stubEnv('APP_ASSETS_PATH', assets));
afterEach(() => vi.unstubAllEnvs());

const comparison = { target: { type: 'uncommitted' as const }, paths: ['new.ts'] };
const component = { status: 'changed', paths: ['new.ts'] };
const box = { id: 'choices', type: 'rectangle', x: 30, y: 60, width: 240, height: 70, text: 'Conversation\nchoices', component };
const elements = [
  { id: 'system', type: 'rectangle', x: 0, y: 0, width: 400, height: 400, text: 'Conversation system', group: true },
  box,
  { id: 'provider', type: 'ellipse', x: 50, y: 240, width: 160, height: 70, text: 'AI provider', component: { status: 'unchanged', paths: [] } },
  { id: 'connection', type: 'arrow', x: 150, y: 138, width: 0, height: 94, points: [[0, 0], [0, 94]], startBinding: { elementId: 'choices' }, endBinding: { elementId: 'provider' } },
];
const diagram = { elements };
const nodes = [{ id: 'choices', label: 'Conversation\nchoices', ...component }, { id: 'provider', label: 'AI provider', status: 'unchanged', paths: [] }];
const withBox = (changes: Record<string, unknown>) => ({ elements: elements.map(element => element.id === box.id ? { ...element, ...changes } : element) });

it('derives native component identities, labels and click targets from the boxes that own them', async () => {
  const generate = vi.fn().mockResolvedValue({ text: JSON.stringify(diagram) });
  const result = await generateDiffViz(comparison, '/repo', generate);
  expect(result).toMatchObject({ format: 'excalidraw', nodes, groups: ['system'] });
  if (result.format !== 'excalidraw') throw new Error('Expected native scene');
  const shape = result.elements.find(element => element.id === 'choices')!;
  expect(shape).toMatchObject({ x: box.x, y: box.y, width: box.width, height: box.height });
  expect(shape.component).toBeUndefined();
  expect(result.elements).toContainEqual(expect.objectContaining({ type: 'text', text: box.text, containerId: box.id }));
  expect(shape.boundElements).toContainEqual(expect.objectContaining({ type: 'text' }));
  const schema = generate.mock.calls[0]![0].outputSchema;
  expect(schema.properties.elements).toBeDefined();
  expect(schema.properties.nodes).toBeUndefined();
});

it.each(['inline', 'bound', 'empty bound'])('preserves native labels without duplicated identity matching (%s)', async label => {
  const text = { id: 'details', type: 'text', x: 42, y: 78, width: 210, height: 26, text: label === 'empty bound' ? '' : 'Restore choices\nProvider and effort stay selected', containerId: 'choices' };
  const generate = vi.fn().mockResolvedValue({ text: JSON.stringify({ elements: [...elements.map(element => label === 'bound' && element.id === box.id ? { ...element, text: undefined } : element), text] }) });
  const result = await generateDiffViz(comparison, '/repo', generate);
  if (result.format !== 'excalidraw') throw new Error('Expected native scene');
  expect(result.nodes[0]).toMatchObject({ ...nodes[0]!, label: label === 'bound' ? text.text : box.text });
  expect(result.elements.filter(element => element.containerId === 'choices')).toHaveLength(1);
  expect(result.elements.find(element => element.id === 'details')).toMatchObject({ ...text, text: label === 'empty bound' ? box.text : text.text });
});

it('rejects invalid native components, unsafe content and out-of-comparison navigation', async () => {
  const generate = vi.fn();
  for (const [draft, failure] of [
    [withBox({ component: { ...component, paths: ['old.ts'] } }), /changed files/],
    [{ elements: [...elements, box] }, /duplicate/],
    [withBox({ type: 'text' }), /component.*shape/i],
    [withBox({ text: '' }), /label/i],
    [withBox({ component: { ...component, status: 'unchanged' } }), /context/],
    [withBox({ component: { ...component, paths: [] } }), /changed.*file/],
    [{ elements: elements.map(element => element.id === 'connection' ? { ...element, endBinding: { elementId: 'outside' } } : element) }, /connection/],
    [{ elements: [{ id: 'image', type: 'image', x: 0, y: 0, width: 100, height: 100 }] }, /invalid Viz/],
    [withBox({ link: 'https://outside.test' }), /invalid Viz/],
    [{ elements: Array.from({ length: 13 }, (_, i) => ({ ...box, id: `node${i}` })) }, /components/i],
    [withBox({ component: { ...component, icon: 'https://outside.test/icon.svg' } }), /invalid Viz/],
  ] as const) {
    generate.mockResolvedValueOnce({ text: JSON.stringify(draft) });
    await expect(generateDiffViz(comparison, '/repo', generate)).rejects.toThrow(failure);
  }
  generate.mockResolvedValueOnce({ text: 'not JSON' });
  await expect(generateDiffViz(comparison, '/repo', generate)).rejects.toThrow(/invalid Viz/);
});

it('keeps supporting components, nested subsystem boundaries, role icons and cross-cutting dependencies', async () => {
  const draft = { elements: [
    { id: 'core', type: 'rectangle', x: 0, y: 0, width: 1100, height: 700, group: true, text: 'Activity core' },
    { id: 'storage', type: 'rectangle', x: 500, y: 70, width: 500, height: 400, group: true, text: 'Storage' },
    ...Array.from({ length: 11 }, (_, i) => ({ ...box, id: `node${i}`, component: { ...component, icon: i === 0 ? 'repository' : i === 1 ? 'database' : 'service' } })),
    { id: 'dependency', type: 'arrow', x: 80, y: 130, width: 150, height: 0, points: [[0, 0], [150, 0]], strokeStyle: 'dashed', startArrowhead: 'arrow', startBinding: { elementId: 'node0' }, endBinding: { elementId: 'node1' } },
  ] };
  const result = await generateDiffViz(comparison, '/repo', vi.fn().mockResolvedValue({ text: JSON.stringify(draft) }));
  if (result.format !== 'excalidraw') throw new Error('Expected native scene');
  expect(result.groups).toStrictEqual(['core', 'storage']);
  expect(result.nodes).toHaveLength(11);
  expect(result.nodes[0]).toMatchObject({ id: 'node0', icon: 'repository' });
  expect(result.nodes[1]).toMatchObject({ id: 'node1', icon: 'database' });
  expect(result.elements.find(element => element.id === 'dependency')).toMatchObject({ strokeStyle: 'dashed', startArrowhead: 'arrow', endArrowhead: 'arrow' });
});

it('keeps the review title, visual brief and code-backed box annotations, dropping unsupported line anchors', async () => {
  const review = { title: 'Preserve conversation choices', changed: 'Selected providers survive a restart.', impact: 'Resuming work keeps the intended model.', question: 'Does restoring a session preserve its effort too?' };
  const locations = [{ path: 'new.ts', line: 2, endLine: 3, side: 'new' }, { path: 'new.ts', line: 999, side: 'new' }];
  const draft = { ...withBox({ component: { ...component, review, locations } }), title: 'Conversation choices survive session restores', layout: 'Session state feeds restored conversation choices, with the provider as unchanged context.' };
  const selected = { ...comparison, diff: 'diff --git a/new.ts b/new.ts\n--- a/new.ts\n+++ b/new.ts\n@@ -1 +1,3 @@\n-old\n+one\n+two\n+three\n' };
  const result = await generateDiffViz(selected, '/repo', vi.fn().mockResolvedValue({ text: JSON.stringify(draft) }));
  expect(result).toMatchObject({ title: draft.title, layout: draft.layout, nodes: [{ review, locations: [locations[0]] }, { id: 'provider' }] });
});

it('sends only the working folder and selected scope with the normal tool-enabled utility tier', async () => {
  const generate = vi.fn().mockResolvedValue({ text: JSON.stringify(diagram) });
  const selected = { ...comparison, target: { type: 'branch' as const, baseRef: 'origin/main' }, scopes: ['unstaged' as const] };
  await generateDiffViz(selected, '/repo/worktree', generate);
  const input = generate.mock.calls[0]![0];
  expect(input).toMatchObject({ cwd: '/repo/worktree', complexity: 'normal', tools: true, attachments: [{type:'image',path:path.join(assets,'viz/reference.png'),mimeType:'image/png'}] });
  expect(input.prompt).toContain('/repo/worktree');
  expect(input.prompt).toContain('origin/main');
  expect(input.prompt).toContain('unstaged');
  expect(input.prompt).not.toMatch(/diff --git|Current working-tree context/);
});

it('rejects an empty comparison or unsafe navigation paths before asking the provider', async () => {
  const generate = vi.fn();
  await expect(generateDiffViz({ ...comparison, paths: [] }, '/repo', generate)).rejects.toThrow(/no changed files/i);
  await expect(generateDiffViz({ ...comparison, paths: ['../outside'] }, '/repo', generate)).rejects.toThrow(/changed file path/i);
  expect(generate).not.toHaveBeenCalled();
});

it('uses a strict structured-output schema and accepts null for irrelevant native shape fields', async () => {
  const generate = vi.fn().mockImplementation(async input => {
    const element = input.outputSchema.properties.elements.items;
    expect(new Set(element.required)).toEqual(new Set(Object.keys(element.properties)));
    const complete = elements.map(item => {
      const value = Object.fromEntries(Object.keys(element.properties).map(key => [key, (item as Record<string, unknown>)[key] ?? null]));
      if (value.component) value.component = { ...(value.component as Record<string, unknown>), icon: null, review: null, locations: null };
      return value;
    });
    return { text: JSON.stringify({ title: null, layout: null, elements: complete }) };
  });
  await expect(generateDiffViz(comparison, '/repo', generate)).resolves.toMatchObject({ format: 'excalidraw', nodes });
});

it('generates Fast Mermaid with the same navigation contract', async () => {
  const fast = { source: 'flowchart TB\nchoices["Conversation choices"]\nprovider["AI provider"]\nchoices -->|restores selection| provider', nodes };
  const generate = vi.fn().mockResolvedValue({ text: JSON.stringify(fast) });
  await expect(generateDiffViz(comparison, '/repo', generate, 'fast')).resolves.toStrictEqual({ format: 'mermaid', ...fast });
  expect(generate.mock.calls[0]![0].attachments).toBeUndefined();
  expect(generate.mock.calls[0]![0]).toMatchObject({ complexity: 'normal', outputSchema: { properties: { source: { type: 'string' } } } });
  generate.mockResolvedValueOnce({ text: JSON.stringify({ ...fast, source: fast.source + '\nclick choices "https://outside.test"' }) });
  await expect(generateDiffViz(comparison, '/repo', generate, 'fast')).rejects.toThrow(/unsafe/);
});

it('fails before calling the provider when the bundled visual reference is unavailable', async () => {
  vi.stubEnv('APP_ASSETS_PATH', '/missing-viz-assets');
  const generate=vi.fn();
  await expect(generateDiffViz(comparison,'/repo',generate)).rejects.toThrow(/reference/i);
  expect(generate).not.toHaveBeenCalled();
});
