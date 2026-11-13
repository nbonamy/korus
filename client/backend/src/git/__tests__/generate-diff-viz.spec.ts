import { diagramIcons } from '../../diagram-icons/resolver';
import { readBundledSkill } from '../../bundled-skills/catalog';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { generateDiffViz } from '../generate-diff-viz';
import { diffVizReference } from '../diff-viz-reference';

const assets = path.resolve(import.meta.dirname, '../../../../electron/assets');
beforeEach(() => vi.stubEnv('APP_ASSETS_PATH', assets));
afterEach(() => vi.unstubAllEnvs());

const comparison = { target: { type: 'uncommitted' as const }, paths: ['new.ts'] };
const component = { status: 'changed', paths: ['new.ts'], subtitle: 'renderer' };
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

it('rejects ambiguous or unrenderable output', async () => {
  for (const draft of [
    {elements:[...elements,box]},
    {elements:[{id:'image',type:'image',x:0,y:0,width:100,height:100}]},
    withBox({width:-1}),
    {elements:[{id:'edge',type:'arrow',x:0,y:0,width:20,height:20}]},
  ]) await expect(generateDiffViz(comparison,'/repo',async()=>({text:JSON.stringify(draft)}))).rejects.toThrow();
  await expect(generateDiffViz(comparison,'/repo',async()=>({text:'not JSON'}))).rejects.toThrow(/invalid Viz/);
});

it('keeps a usable drawing while dropping unsupported annotations, unsafe links and dangling bindings', async () => {
  const draft = {elements:[
    {...box,link:'https://outside.test',component:{...component,subtitle:'a longer technical secondary label',paths:['new.ts','outside.ts'],icon:'unknown',iconImage:{base64:'invalid'},review:{title:'Incomplete'},locations:[{path:'outside.ts',line:1}]}},
    {id:'unnamed',type:'rectangle',x:400,y:0,width:80,height:80,component:{status:'changed',paths:[]}},
    {id:'context',type:'ellipse',x:600,y:0,width:80,height:80,text:'Context',component:{status:'unchanged',paths:['new.ts']}},
    {id:'edge',type:'arrow',x:100,y:0,width:200,height:0,points:[[0,0],[200,0]],endBinding:{elementId:'missing'}},
    {id:'label',type:'text',x:0,y:200,width:100,height:20,text:'Loose label',containerId:'missing',component:{status:'changed',paths:['new.ts']}},
  ]};
  const result = await generateDiffViz(comparison,'/repo',async()=>({text:JSON.stringify(draft)}));
  if(result.format!=='excalidraw')throw new Error('Expected native');
  expect(result.nodes.map(node=>({id:node.id,paths:node.paths}))).toEqual([{id:'choices',paths:['new.ts']},{id:'unnamed',paths:[]},{id:'context',paths:[]}]);
  expect(result.nodes[0]).not.toHaveProperty('icon');
  expect(result.nodes[0]).not.toHaveProperty('iconImage');
  expect(result.nodes[0]).not.toHaveProperty('review');
  expect(result.nodes[0].locations).toEqual([]);
  expect(result.elements.find(element=>element.id==='choices')).not.toHaveProperty('link');
  expect(result.elements.find(element=>element.id==='edge')).not.toHaveProperty('endBinding');
  expect(result.elements.find(element=>element.id==='label')).not.toHaveProperty('containerId');
  expect(result.nodes[1].label).toBe('unnamed');
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

it('sends the selected scope and its patch, bounded, to the normal utility tier without tools', async () => {
  const generate = vi.fn().mockResolvedValue({ text: JSON.stringify(diagram) });
  const selected = { ...comparison, target: { type: 'branch' as const, baseRef: 'origin/main' }, scopes: ['unstaged' as const], diff: 'diff --git a/new.ts b/new.ts\n+one\n' };
  await generateDiffViz(selected, '/repo/worktree', generate);
  const input = generate.mock.calls[0]![0];
  expect(input).toMatchObject({ cwd: '/repo/worktree', complexity: 'normal', timeoutMs: null });
  expect(input).not.toHaveProperty('tools');
  expect(input.prompt).toContain('origin/main');
  expect(input.prompt).toContain('unstaged');
  expect(input.prompt).toContain(selected.diff);
  expect(input.developerInstructions).not.toMatch(/Git and source tools|git diff, show and log/);
  const shared=readBundledSkill('korus-stack-diagram',{}).markdown;
  expect(input.developerInstructions).toContain(shared);
  expect(input.developerInstructions.indexOf(shared)).toBe(input.developerInstructions.lastIndexOf(shared));
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
  expect(generate.mock.calls[0]![0].developerInstructions).not.toContain('korus-stack-diagram');
  expect(generate.mock.calls[0]![0]).toMatchObject({ complexity: 'normal', outputSchema: { properties: { source: { type: 'string' } } } });
  generate.mockResolvedValueOnce({ text: JSON.stringify({ ...fast, source: fast.source + '\nclick choices "https://outside.test"' }) });
  await expect(generateDiffViz(comparison, '/repo', generate, 'fast')).rejects.toThrow(/unsafe/);
});

it('validates the bundled visual reference when requested', async () => {
  vi.stubEnv('APP_ASSETS_PATH', '/missing-viz-assets');
  await expect(diffVizReference()).rejects.toThrow(/reference/i);
});

it('embeds fetched payloads directly in polished output and closes the tool endpoint on every exit', async () => {
  const asset={mimeType:'image/svg+xml' as const,base64:'PHN2Zy8+',source:'lucide' as const,sourceUrl:'https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/database.svg',whiteFill:false};
  const fetchIcon=vi.spyOn(diagramIcons,'fetchIcon').mockResolvedValue({name:'database',asset});
  let endpoint='';
  try {
    const result=await generateDiffViz(comparison,'/repo',async input=>{
      endpoint=input.mcpServers![0].url;
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'fetch_tech_icon',arguments:{icon:'lucide/database'}}})});
      const {found:_,name:__,...iconImage}=(await response.json() as {result:{structuredContent:Record<string,unknown>}}).result.structuredContent;
      expect(iconImage).toEqual(asset);
      return {text:JSON.stringify(withBox({component:{...component,iconImage}}))};
    });
    expect(JSON.parse(JSON.stringify(result)).nodes[0].iconImage).toEqual(asset);
    expect(result).not.toHaveProperty('iconAssets');
    await expect(fetch(endpoint,{method:'POST'})).rejects.toThrow();
    await expect(generateDiffViz(comparison,'/repo',async input=>{endpoint=input.mcpServers![0].url;throw new Error('startup failed');})).rejects.toThrow('startup failed');
    await expect(fetch(endpoint,{method:'POST'})).rejects.toThrow();
    const recovered=await generateDiffViz(comparison,'/repo',async()=>({text:JSON.stringify(withBox({component:{...component,iconImage:{...asset,base64:'not base64!'}}}))}));
    expect(recovered.nodes[0]).not.toHaveProperty('iconImage');
  }finally{fetchIcon.mockRestore();}
});
