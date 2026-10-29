import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { DesignNode, DesignRequest } from '@workspace/core/design';
import type { DesignTweak } from '@workspace/core/design-tweaks';
import type { DesignService } from '../design-service';
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
const artboard = z.object({ id: z.string(), title: z.string().min(1).max(200), width: z.number().int().min(240).max(3840), height: z.number().int().min(160).max(3840), root: node, position: z.object({ x: z.number().min(-100000).max(100000), y: z.number().min(-100000).max(100000) }).describe('Canvas coordinates for free artboard arrangement. Omit for an automatic horizontal row.').optional(), css: z.string().max(50_000).describe('Complete standalone stylesheet for this artboard. Replaces content.css, which is used only when this field is omitted.').optional(), notes: z.string().max(4000).optional() });
export function createDesignToolModuleProvider(service: DesignService): AppMcpToolModuleProvider {
  return { id: 'design', resolve: ({ agentId }) => ({ id: 'design', register: server => register(server, service, agentId) }) };
}
function register(server: McpServer, service: DesignService, agentId: string) {
  const run = (request: DesignRequest) => loggedToolResult('design', { agentId, operation: request.type }, async () => {
    const { workspace } = await service.execute(agentId, request);
    return { document: workspace.document, selectedArtboardId: workspace.selectedArtboardId, selectedNodeId: workspace.selectedNodeId, checkpoints: workspace.checkpoints.map(({ id, title, revision }) => ({ id, title, revision })) };
  });
  server.registerTool('read-design', { description: 'Read this conversation’s saved Design document, stable node IDs, exact revision, selection and element comments. Use before every edit. The user must open Design first.' }, () => run({ type: 'read' }));
  server.registerTool('create-design', {
    description: 'Create the initial design in an open Design pane. Authored HTML trees only: unique immutable IDs, text on leaves, CSS, inline styles and embedded data images. Optional tweaks expose range/color/select/toggle controls bound to node styles or CSS variables; initialize the bound styles. Color controls use six-digit hex. No scripts, event handlers, network URLs or frameworks. Existing designs can only be changed through edit-design.',
    inputSchema: { content: z.object({ title: z.string().min(1).max(200), css: z.string().max(50_000).describe('Fallback stylesheet for artboards without their own css. Not combined with artboard css.'), comments: z.array(z.never()).max(0), artboards: z.array(artboard).min(1).max(12), tweaks: z.array(tweak).max(200).optional() }) },
  }, ({ content }) => run({ type: 'create', content }));
  server.registerTool('edit-design', {
    description: 'Apply one undoable batch at the exact revision just read. Preserve manual edits. Text targets a leaf; insert/remove/duplicate targets a subtree. Move uses a destination container and its final zero-based child index within the same artboard. Null style or attribute values remove overrides. Artboard add/duplicate creates an independent alternative; update changes only metadata, size, notes or its own CSS. Duplicate remaps stable IDs and interaction targets. Choose records the user’s preferred direction. Never regenerate unchanged nodes.',
    inputSchema: { ...revision, edits: z.array(z.discriminatedUnion('type', [
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
      z.object({ type: z.literal('choose-artboard'), artboardId: z.string().nullable() }),
    ])).min(1).max(100) },
  }, ({ expectedRevision, edits }) => run({ type: 'edit', expectedRevision, edits }));
  server.registerTool('capture-design', { description: 'Capture a saved artboard as a PNG at its exact revision. Supply artboardId to inspect each alternative without changing the user’s selection. Requires the desktop host.', inputSchema: { ...revision, artboardId: z.string().optional() } }, async ({ expectedRevision, artboardId }) => {
    try {
      const result = await service.execute(agentId, { type: 'capture', expectedRevision, ...(artboardId ? { artboardId } : {}) });
      return { content: [{ type: 'image' as const, mimeType: 'image/png', data: result.screenshot!.split(',')[1] }] };
    } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: String(error) }] }; }
  });
  server.registerTool('checkpoint-design', { description: 'Save a named persistent recovery point before a substantial design change.', inputSchema: { ...revision, title: z.string().min(1).max(200) } }, input => run({ type: 'checkpoint', ...input }));
}
