import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { visualizationSuggestionLimits } from '@workspace/core/visualize';
import type { VisualizeService } from '../visualize-service';
import { loggedToolResult, type AppMcpToolModuleProvider } from './tool-modules';

const visualizationContent = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['mermaid', 'svg']),
    source: z.string().trim().min(1).max(250_000),
  }),
  z.object({
    kind: z.literal('image'),
    generatedImagePath: z.string().trim().min(1).max(4_096),
    alt: z.string().trim().min(1).max(500),
  }),
]);

export function createVisualizeToolModuleProvider(visualize: VisualizeService): AppMcpToolModuleProvider {
  return {
    id: 'visualize',
    resolve: ({ agentId }) => ({
      id: 'visualize',
      register: server => registerVisualizeTools(server, visualize, agentId),
    }),
  };
}

function registerVisualizeTools(server: McpServer, visualize: VisualizeService, agentId: string): void {
  server.registerTool('read-visualization-canvas', {
    description: 'Read current selected canvas elements and revision. Set selectedOnly false only when the whole canvas is needed.',
    inputSchema: { visualizationId: z.string().min(1), selectedOnly: z.boolean().default(true) },
  }, ({ visualizationId, selectedOnly }) => loggedToolResult('read-visualization-canvas', { agentId, visualizationId },
    () => visualize.readCanvas(agentId, visualizationId, selectedOnly)));
  server.registerTool('edit-visualization-canvas', {
    description: 'Apply one undoable batch to existing stable element IDs at the exact revision read. Preserves all other elements. Supports geometry, text, styling, locked and isDeleted; no code execution.',
    inputSchema: {
      visualizationId: z.string().min(1), expectedRevision: z.number().int().positive(),
      edits: z.array(z.object({ id: z.string().min(1), changes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])) })).min(1).max(100),
    },
  }, ({ visualizationId, expectedRevision, edits }) => loggedToolResult('edit-visualization-canvas', { agentId, visualizationId },
    () => visualize.editCanvas(agentId, visualizationId, expectedRevision, edits)));
  server.registerTool('view-visualization-canvas', {
    description: 'Get the latest saved PNG visual context for a canvas when structured element context is insufficient.',
    inputSchema: { visualizationId: z.string().min(1) },
  }, async ({ visualizationId }) => {
    try {
      const data = visualize.canvasPreview(agentId, visualizationId).split(',')[1]!;
      return { content: [{ type: 'image' as const, mimeType: 'image/png', data }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
    }
  });
  server.registerTool('suggest-visualizations', {
    description: 'Publish 1 to 4 compact visualization suggestions for the active Visualize conversation. Use short titles and one-sentence descriptions instead of listing suggestions only in chat.',
    inputSchema: {
      suggestions: z.array(z.object({
        title: z.string().trim().min(1).max(visualizationSuggestionLimits.title),
        description: z.string().trim().min(1).max(visualizationSuggestionLimits.description),
      })).min(1).max(4),
    },
  }, ({ suggestions }) => loggedToolResult(
    'suggest-visualizations',
    { agentId, suggestionCount: suggestions.length },
    () => visualize.suggest(agentId, suggestions),
  ));

  server.registerTool('add-visualization', {
    description: 'Add a complete Mermaid, SVG, or generated-image visualization to the active Visualize conversation and select it.',
    inputSchema: {
      title: z.string().trim().min(1).max(200),
      suggestionId: z.string().trim().min(1).optional(),
      content: visualizationContent,
    },
  }, input => loggedToolResult(
    'add-visualization',
    { agentId, kind: input.content.kind, suggestionId: input.suggestionId },
    () => visualize.add(agentId, input),
  ));

  server.registerTool('get-visualization', {
    description: 'Read the complete current source of one visualization before replacing it.',
    inputSchema: {
      visualizationId: z.string().trim().min(1),
    },
  }, ({ visualizationId }) => loggedToolResult(
    'get-visualization',
    { agentId, visualizationId },
    () => visualize.get(agentId, visualizationId),
  ));

  server.registerTool('list-visualizations', {
    description: 'List the visualizations currently available in the open Visualize pane, including their IDs, kinds, and selection state.',
  }, () => loggedToolResult(
    'list-visualizations',
    { agentId },
    () => visualize.list(agentId),
  ));

  server.registerTool('delete-visualization', {
    description: 'Delete one visualization from the open Visualize pane.',
    inputSchema: {
      visualizationId: z.string().trim().min(1),
    },
  }, ({ visualizationId }) => loggedToolResult(
    'delete-visualization',
    { agentId, visualizationId },
    () => visualize.delete(agentId, visualizationId),
  ));

  server.registerTool('replace-visualization', {
    description: 'Replace one existing visualization with a complete revised Mermaid, SVG, or generated-image visualization.',
    inputSchema: {
      visualizationId: z.string().trim().min(1),
      title: z.string().trim().min(1).max(200),
      suggestionId: z.string().trim().min(1).optional(),
      content: visualizationContent,
    },
  }, input => loggedToolResult(
    'replace-visualization',
    { agentId, visualizationId: input.visualizationId, kind: input.content.kind },
    () => visualize.replace(agentId, input),
  ));
}
