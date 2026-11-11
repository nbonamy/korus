import { openIconMcpScope } from '../diagram-icons/mcp';
import { diffVizInstructions, diffVizPrompt } from '../agents/prompts';
// import { diffVizReference } from './diff-viz-reference';
import { z } from 'zod';
import { diffVizIcons, diffVizStatuses, type DiffVizDiagram, type DiffVisualizationMode } from '@workspace/core/git-diff-viz';
import type { AgentGitDiffTarget, AgentGitDiffScope } from '@workspace/core/contracts';
import type { ProviderTextGenerationInput } from '@workspace/core/provider-driver';
import { isCanvasDocument, type CanvasElement } from '@workspace/core/visualize-canvas';
import { diffForPath } from '@workspace/core/file-diff';
import type { DiffVizNode, DiffVizLocation } from '@workspace/core/git-diff-viz';

const id = z.string().trim().min(1);
const binding = z.object({ elementId: id });
const coordinate = z.number();
const reviewSchema = z.object({ title: z.string().trim().min(1), changed: z.string().trim().min(1), impact: z.string().trim().min(1), question: z.string().trim().min(1) });
const locationSchema = z.object({ path: z.string().min(1).max(1000), line: z.number().int().min(1).max(10_000_000), endLine: z.number().int().min(1).max(10_000_000).optional(), side: z.enum(['old', 'new']).optional() });
const headingSchema = { title: z.string().trim().min(1).optional(), layout: z.string().trim().min(1).optional() };
const iconImageSchema = z.object({mimeType:z.enum(['image/svg+xml','image/png','image/jpeg','image/webp']),base64:z.string().min(1).max(3*1024*1024).regex(/^[A-Za-z0-9+/]+={0,2}$/),source:z.enum(['svgl','devicon','gilbarbara','lucide','explicit']),sourceUrl:z.string().url().startsWith('https://'),whiteFill:z.boolean()});
const nodeSchema = z.object({ id, label: z.string().trim().min(1), subtitle: z.string().trim().min(1).optional(), status: z.enum(diffVizStatuses), paths: z.array(z.string().min(1)), icon: z.enum(diffVizIcons).optional(), iconImage: iconImageSchema.optional(), review: reviewSchema.optional(), locations: z.array(locationSchema).optional() });
const componentSchema = nodeSchema.pick({ subtitle: true, status: true, paths: true, icon: true, iconImage: true, review: true, locations: true });
const fastSchema = z.object({ ...headingSchema, source: z.string().trim().min(1), nodes: z.array(nodeSchema) });
const draftSchema = z.object({
  ...headingSchema,
  elements: z.array(z.object({
    id, type: z.enum(['rectangle', 'ellipse', 'diamond', 'text', 'arrow', 'line']),
    x: coordinate, y: coordinate, width: z.number().min(0), height: z.number().min(0),
    text: z.string().optional(), fontSize: z.number().positive().optional(),
    containerId: id.optional(), textAlign: z.enum(['left', 'center', 'right']).optional(),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
    points: z.array(z.array(coordinate).length(2)).min(2).optional(),
    startBinding: binding.optional(), endBinding: binding.optional(),
    strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional(), startArrowhead: z.literal('arrow').optional(),
    groupIds: z.array(id).optional(),
    component: componentSchema.optional(),
    group: z.boolean().optional(),
  })).min(1),
});

export async function generateDiffViz(comparison: { target: AgentGitDiffTarget; scopes?: AgentGitDiffScope[]; paths: string[]; diff?: string }, cwd: string, generate: (input: ProviderTextGenerationInput) => Promise<unknown>, mode: DiffVisualizationMode = 'polished'): Promise<DiffVizDiagram> {
  const paths = new Set(comparison.paths);
  if (!paths.size) throw new Error('There are no changed files to visualize.');
  if ([...paths].some(path => path.startsWith('/') || path.split('/').includes('..'))) throw new Error('The patch contains an invalid changed file path.');
  // Text-only comparison: retain the reference setup so it is easy to restore.
  // const attachments = mode === 'polished' ? await diffVizReference() : undefined;
  const iconJob = mode === 'polished' ? await openIconMcpScope() : undefined;
  try {
  const response = await generate({ cwd, complexity: 'normal', timeoutMs: null,
    // ...(attachments ? {attachments} : {}),
    ...(iconJob ? {mcpServers:[{name:iconJob.name, url:iconJob.url, enabledTools:['fetch_tech_icon'] as const}]} : {}),
    developerInstructions: diffVizInstructions(mode),
    prompt: diffVizPrompt({ target: comparison.target, ...(comparison.scopes ? { scopes: comparison.scopes } : {}), diff: comparison.diff ?? '' }),
    outputSchema: z.toJSONSchema(mode === 'fast' ? fastSchema : draftSchema, { override: ({ jsonSchema }) => {
      if (!jsonSchema.properties) return;
      const required = new Set(jsonSchema.required ?? []);
      for (const [key, property] of Object.entries(jsonSchema.properties)) if (!required.has(key) && typeof property === 'object') jsonSchema.properties[key] = { anyOf: [property, { type: 'null' }] };
      jsonSchema.required = Object.keys(jsonSchema.properties);
    } }) as ProviderTextGenerationInput['outputSchema'],
  });
  let raw: unknown;
  try { raw = omitNullProperties(JSON.parse((response as { text: string }).text)); }
  catch { throw new Error('The provider returned an invalid Viz. Try generating it again.'); }
  raw = recoverAnnotations(raw, mode);
  if (mode === 'fast') {
    const result = fastSchema.safeParse(raw);
    if (!result.success) throw new Error('The provider returned an invalid Viz. Try generating it again.');
    const draft = result.data;
    draft.nodes = draft.nodes.filter((node,index,all) => all.findIndex(candidate => candidate.id === node.id) === index);
    normalizeNodePaths(draft.nodes, paths);
    normalizeLocations(draft.nodes, comparison.diff);
    if (!/^flowchart\s+(?:TB|TD|LR|RL|BT)\b/u.test(draft.source) || /%%|^\s*(?:click)\b|<(?:[a-z!/])|https?:|data:|javascript:|\b(?:img|icon)\s*:/imu.test(draft.source)) throw new Error('The provider returned an unsafe or unsupported Mermaid Viz. Try again.');
    return { format: 'mermaid', ...draft };
  }
  let draft: z.infer<typeof draftSchema>;
  try { draft = draftSchema.parse(raw); }
  catch { throw new Error('The provider returned an invalid Viz. Try generating it again.'); }
  const byId = new Map(draft.elements.map(element => [element.id, element]));
  if (byId.size !== draft.elements.length) throw new Error('The Viz contains duplicate elements. Try again.');
  const shape = (id: string) => { const element = byId.get(id); return element && ['rectangle', 'ellipse', 'diamond'].includes(element.type) && element.width > 0 && element.height > 0; };
  const components = draft.elements.filter(element => element.component && shape(element.id));
  const nodes = components.map(element => {
    const label = element.text?.trim() || draft.elements.filter(text => text.type === 'text' && text.containerId === element.id).map(text => text.text?.trim() ?? '').filter(Boolean).join('\n');
    const caption = label || element.id.replaceAll('_', ' ');
    if (!label) element.text = caption;
    return { id: element.id, label: caption, ...element.component! };
  });
  const groups = draft.elements.filter(element => element.group && !element.component && shape(element.id)).map(element => element.id);
  normalizeNodePaths(nodes, paths);
  normalizeLocations(nodes, comparison.diff);
  for (const element of draft.elements) {
    if (element.containerId && !byId.has(element.containerId)) delete element.containerId;
    if (['arrow', 'line'].includes(element.type) && !element.points) throw new Error('The Viz contains an invalid connection. Try again.');
    if (element.startBinding && !shape(element.startBinding.elementId)) delete element.startBinding;
    if (element.endBinding && !shape(element.endBinding.elementId)) delete element.endBinding;
  }
  const native = draft.elements.map(({ component: _component, group: _group, ...element }) => element);
  for (const element of draft.elements) {
    if (!shape(element.id) || !element.text?.trim()) continue;
    const bound = native.find(text => text.type === 'text' && text.containerId === element.id);
    if (bound) { if (!bound.text?.trim()) bound.text = element.text; continue; }
    let labelId = `${element.id}_label`;
    while (byId.has(labelId)) labelId += '_';
    const padding = Math.min(12, element.width / 4, element.height / 4);
    native.push({ id: labelId, type: 'text', x: element.x + padding, y: element.y + padding, width: element.width - padding * 2, height: element.height - padding * 2,
      text: element.text, containerId: element.id, fontSize: element.fontSize ?? 18, textAlign: element.group && !element.component ? 'left' : 'center', verticalAlign: element.group && !element.component ? 'top' : 'middle' });
  }
  const elements: CanvasElement[] = native.map(({ text, ...element }) => ({ ...element,
    ...(element.type === 'text' ? { text: text ?? '', originalText: text ?? '', fontFamily: 2, fontSize: Math.min(element.fontSize ?? 18,1000), lineHeight: 1.25, textAlign: element.textAlign ?? 'center', verticalAlign: element.verticalAlign ?? 'middle' } : {}),
    ...(element.type === 'arrow' ? { endArrowhead: 'arrow', startArrowhead: element.startArrowhead ?? null } : {}),
    ...(element.startBinding ? { startBinding: { ...element.startBinding, focus: 0, gap: 8 } } : {}),
    ...(element.endBinding ? { endBinding: { ...element.endBinding, focus: 0, gap: 8 } } : {}),
    boundElements: native.flatMap(other => other.containerId === element.id ? [{ id: other.id, type: 'text' }] : other.startBinding?.elementId === element.id || other.endBinding?.elementId === element.id ? [{ id: other.id, type: 'arrow' }] : []),
  }));
  if (!isCanvasDocument({ revision: 1, elements, files: {}, selectedElementIds: [], preview: '' })) throw new Error('The provider returned an invalid Viz canvas. Try again.');
  return { format: 'excalidraw', elements, groups, nodes, ...(draft.title ? { title: draft.title } : {}), ...(draft.layout ? { layout: draft.layout } : {}) };
  } finally { await iconJob?.close(); }
}

function omitNullProperties(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitNullProperties);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== null).map(([key, child]) => [key, omitNullProperties(child)]));
  return value;
}

function normalizeLocations(nodes: DiffVizNode[], diff?: string) {
  for (const node of nodes) if (node.locations) node.locations = node.locations.filter(location => node.paths.includes(location.path) && (location.endLine ?? location.line) >= location.line && (!diff || locationInDiff(diff, location)));
}
function locationInDiff(diff: string, location: DiffVizLocation): boolean {
  const patch = diffForPath(diff, location.path) ?? '';
  return [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gmu)].some(match => {
    const start = Number(match[location.side === 'old' ? 1 : 3]);
    const count = Number(match[location.side === 'old' ? 2 : 4] ?? 1);
    return location.line >= start && (location.endLine ?? location.line) < start + count;
  });
}

function normalizeNodePaths(nodes: DiffVizNode[], paths: Set<string>) {
  for (const node of nodes) node.paths = node.status === 'unchanged' ? [] : [...new Set(node.paths.filter(path => paths.has(path)))];
}

/** Optional review metadata cannot make an otherwise supported drawing unusable. */
function recoverAnnotations(value: unknown, mode: DiffVisualizationMode): unknown {
  if (!record(value)) return value;
  const drawing = { ...value };
  for (const key of ['title','layout']) if (typeof drawing[key] !== 'string' || !(drawing[key] as string).trim()) delete drawing[key];
  const metadata = (value: unknown) => {
    if (!record(value)) return undefined;
    const result: Record<string, unknown> = { ...value, paths: Array.isArray(value.paths) ? value.paths.filter(path => typeof path === 'string' && path.length > 0) : [] };
    for (const [key, schema] of [['subtitle', z.string().trim().min(1)], ['icon', z.enum(diffVizIcons)], ['iconImage', iconImageSchema], ['review', reviewSchema]] as const) {
      if (key in result && !schema.safeParse(result[key]).success) delete result[key];
    }
    if (Array.isArray(result.locations)) result.locations = result.locations.flatMap(location => {
      const parsed = locationSchema.safeParse(location);
      return parsed.success ? [parsed.data] : [];
    });
    else delete result.locations;
    const parsed = componentSchema.safeParse(result);
    return parsed.success ? parsed.data : undefined;
  };
  if (mode === 'fast') return { ...drawing, nodes: Array.isArray(drawing.nodes) ? drawing.nodes.flatMap(node => {
    if (!record(node)) return [];
    const fields = metadata(node);
    const parsed = fields && nodeSchema.safeParse({ id: node.id, label: node.label, ...fields });
    return parsed?.success ? [parsed.data] : [];
  }) : [] };
  return { ...drawing, ...(Array.isArray(drawing.elements) ? { elements: drawing.elements.map(element => {
    if (!record(element)) return element;
    const recovered: Record<string, unknown> = { ...element, component: metadata(element.component) };
    const fields = draftSchema.shape.elements.element.shape;
    for (const key of ['text','fontSize','containerId','textAlign','verticalAlign','strokeStyle','startArrowhead','groupIds','group','startBinding','endBinding'] as const) {
      if (key in recovered && !fields[key].safeParse(recovered[key]).success) delete recovered[key];
    }
    return recovered;
  }) } : {}) };
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
