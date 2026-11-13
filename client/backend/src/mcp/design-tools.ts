import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { type DesignContent, type DesignEdit, type DesignNode, type DesignRequest } from '@workspace/core/design';
import type { DesignTweak } from '@workspace/core/design-tweaks';
import { designPrompt, type DesignService } from '../design-service';
import { loggedToolResult, type AppMcpToolModuleProvider } from './tool-modules';

const interaction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), artboardId: z.string() }),
  z.object({ type: z.literal('back') }),
  z.object({ type: z.enum(['toggle', 'show', 'hide', 'scroll']), nodeId: z.string() }),
]);
const node: z.ZodType<DesignNode> = z.lazy(() => z.object({
  id: z.string().min(1).max(100), tag: z.string(), text: z.string().max(20_000).optional(),
  styles: z.record(z.string(), z.string()).optional(), attributes: z.record(z.string(), z.string()).optional(),
  children: z.array(node).optional(), toggleTargetId: z.string().optional(), interaction: interaction.optional(),
}));
const target = { id: z.string(), label: z.string().min(1).max(100), nodeId: z.string(), property: z.string() };
const tweak: z.ZodType<DesignTweak> = z.discriminatedUnion('type', [
  z.object({ ...target, type: z.literal('range'), min: z.number(), max: z.number(), step: z.number().positive(), unit: z.enum(['', 'px', 'rem', 'em', '%', 'vh', 'vw', 'deg', 'ms', 's']) }),
  z.object({ ...target, type: z.literal('color') }),
  z.object({ ...target, type: z.literal('select'), options: z.array(z.object({ label: z.string(), value: z.string() })).min(1).max(20) }),
  z.object({ ...target, type: z.literal('toggle'), on: z.string(), off: z.string() }),
]);
const revision = { expectedRevision: z.number().int().positive() };
const designId = { designId: z.string().optional().describe('From create-design or read-design; required with several designs.') };
/** A design authored as a JSON file, so a large one is not pasted into the call. */
async function readDesignFile(file: string): Promise<DesignContent> {
  if (!path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.json') throw new Error('path must be an absolute path to a .json file holding the design content.');
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new Error(`Design file not found: ${file}`);
  if (info.size > 2_000_000) throw new Error('The design file is too large: a design holds at most 500000 characters.');
  try { return JSON.parse(await readFile(file, 'utf8')) as DesignContent; }
  catch { throw new Error('The design file is not valid JSON.'); }
}
const artboard = z.object({ id: z.string(), title: z.string().min(1).max(200), width: z.number().int().min(240).max(3840), height: z.number().int().min(160).max(3840), root: node, position: z.object({ x: z.number().min(-100000).max(100000), y: z.number().min(-100000).max(100000) }).describe('Canvas coordinates for free artboard arrangement. Omit for an automatic horizontal row.').optional(), css: z.string().max(50_000).describe('Complete standalone stylesheet for this artboard. Replaces content.css, which is used only when this field is omitted.').optional(), notes: z.string().max(4000).optional() });
export function createDesignToolModuleProvider(service: DesignService): AppMcpToolModuleProvider {
  return { id: 'design', resolve: ({ agentId }) => ({ id: 'design', register: server => register(server, service, agentId) }) };
}
const subtreeIds = (item: DesignNode): string[] => [item.id, ...(item.children ?? []).flatMap(subtreeIds)];
/** The nodes, artboards and tweaks an edit batch names, so the agent need not read the design back. */
const touchedBy = (edits: DesignEdit[]): string[] => [...new Set(edits.flatMap((edit): (string | null)[] => 'nodeId' in edit ? [edit.nodeId, ...(edit.type === 'insert' ? subtreeIds(edit.node) : [])]
  : 'artboard' in edit ? [edit.artboard.id] : 'artboardId' in edit ? [edit.artboardId] : 'tweakId' in edit ? [edit.tweakId] : 'tweak' in edit ? [edit.tweak.id] : []).filter((id): id is string => typeof id === 'string'))];
function register(server: McpServer, service: DesignService, agentId: string) {
  // Only read-design returns the whole document; the other tools answer compactly so a design is not echoed back on every call.
  const run = (request: DesignRequest, touched?: string[]) => loggedToolResult('design', { agentId, operation: request.type }, async () => {
    const { workspace, designs } = await service.execute(agentId, request);
    if (request.type !== 'read' && workspace.document) {
      const { document } = workspace;
      return { designId: document.id, title: document.content.title, revision: document.revision, artboards: document.content.artboards.map(({ id, title }) => ({ id, title })), selectedArtboardId: workspace.selectedArtboardId, checkpoints: workspace.checkpoints.map(({ id, title, revision }) => ({ id, title, revision })), ...(touched ? { touched } : {}), designs };
    }
    return { document: workspace.document, selectedArtboardId: workspace.selectedArtboardId, selectedNodeId: workspace.selectedNodeId, checkpoints: workspace.checkpoints.map(({ id, title, revision }) => ({ id, title, revision })), designs };
  });
  server.registerTool('open-design', {
    description: 'Open Design for this conversation, only after the user requests it or confirms your offer. Load korus-design with read-skill.',
  }, () => loggedToolResult('open-design', { agentId }, async () => {
    await service.execute(agentId, { type: 'open' });
    return { success: true, instructions: designPrompt('the exploration requested by the user') };
  }));
  server.registerTool('read-design', { description: 'Read the saved designs in full; the only Design tool that returns the whole document. Load korus-design with read-skill.', inputSchema: designId }, ({ designId: id }) => run({ type: 'read', ...(id ? { designId: id } : {}) }));
  server.registerTool('create-design', {
    description: 'Create a design from content or a .json path; returns a compact summary. Load korus-design with read-skill first.',
    inputSchema: { content: z.object({ title: z.string().min(1).max(200), css: z.string().max(50_000).describe('Fallback stylesheet for artboards without their own css. Not combined with artboard css.'), comments: z.array(z.never()).max(0), artboards: z.array(artboard).min(1).max(12), tweaks: z.array(tweak).max(200).optional() }).optional(), path: z.string().optional().describe('Absolute path of a .json file holding the content, instead of content.') },
  }, async ({ content, path: file }) => {
    if (Boolean(content) === Boolean(file)) return loggedToolResult('design', { agentId, operation: 'create' }, async () => { throw new Error('Provide exactly one of content or path.'); });
    if (!file) return run({ type: 'create', content: content as DesignContent });
    const loaded = await readDesignFile(file).then(value => ({ value }), (error: unknown) => ({ error }));
    return 'error' in loaded ? loggedToolResult('design', { agentId, operation: 'create' }, async () => { throw loaded.error; }) : run({ type: 'create', content: loaded.value });
  });
  server.registerTool('edit-design', {
    description: 'Apply one undoable batch of edits at the revision you read; returns a compact summary. Load korus-design with read-skill.',
    inputSchema: { ...revision, ...designId, edits: z.array(z.discriminatedUnion('type', [
      z.object({ type: z.literal('tweak-set'), tweak }),
      z.object({ type: z.literal('tweak-remove'), tweakId: z.string() }),
      z.object({ type: z.literal('tweak-value'), tweakId: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) }),
      z.object({ type: z.literal('text'), nodeId: z.string(), text: z.string().max(20_000) }),
      z.object({ type: z.literal('style'), nodeId: z.string(), styles: z.record(z.string(), z.string().nullable()) }),
      z.object({ type: z.literal('attributes'), nodeId: z.string(), attributes: z.record(z.string(), z.string().nullable()) }),
      z.object({ type: z.literal('interaction'), nodeId: z.string(), interaction: interaction.nullable() }),
      z.object({ type: z.literal('duplicate'), nodeId: z.string() }),
      z.object({ type: z.literal('move'), nodeId: z.string(), parentId: z.string(), index: z.number().int().nonnegative() }),
      z.object({ type: z.literal('insert'), nodeId: z.string(), node, index: z.number().int().nonnegative().optional() }),
      z.object({ type: z.literal('remove'), nodeId: z.string() }),
      z.object({ type: z.literal('artboard-add'), artboard, index: z.number().int().nonnegative().optional() }),
      z.object({ type: z.literal('artboard-duplicate'), artboardId: z.string(), title: z.string().min(1).max(200).optional() }),
      z.object({ type: z.literal('artboard-update'), artboardId: z.string(), changes: artboard.pick({ title: true, width: true, height: true, css: true, notes: true, position: true }).partial() }),
      z.object({ type: z.literal('artboard-remove'), artboardId: z.string() }),
      z.object({ type: z.literal('artboard-move'), artboardId: z.string(), index: z.number().int().nonnegative() }),
    ])).min(1).max(100) },
  }, ({ expectedRevision, edits, designId: id }) => run({ type: 'edit', expectedRevision, edits, ...(id ? { designId: id } : {}) }, touchedBy(edits as DesignEdit[])));
  server.registerTool('capture-design', { description: 'Capture an artboard as a PNG at its exact revision; needs the desktop host. Load korus-design with read-skill.', inputSchema: { ...revision, ...designId, artboardId: z.string().optional() } }, async ({ expectedRevision, artboardId, designId: id }) => {
    try {
      const result = await service.execute(agentId, { type: 'capture', expectedRevision, ...(artboardId ? { artboardId } : {}), ...(id ? { designId: id } : {}) });
      return { content: [{ type: 'image' as const, mimeType: 'image/png', data: result.screenshot!.split(',')[1] }] };
    } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: String(error) }] }; }
  });
  server.registerTool('checkpoint-design', { description: 'Save a named recovery point before a substantial change. Load korus-design with read-skill.', inputSchema: { ...revision, ...designId, title: z.string().min(1).max(200) } }, ({ designId: id, ...input }) => run({ type: 'checkpoint', ...input, ...(id ? { designId: id } : {}) }));
}
