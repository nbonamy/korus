import { product } from '@workspace/core/product';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';
import { PRIMARY_BROWSER_ID } from '@workspace/core/contracts';
import { parseBrowserViewport } from '@workspace/core/browser-viewport';
import { errorToolResult, structuredToolResult } from './tool-result';

const clickTarget = z.union([
  z.strictObject({ selector: z.string().trim().min(1) }),
  z.strictObject({ x: z.number().finite().min(0), y: z.number().finite().min(0) }),
]);

export type InAppBrowserClient = {
  open(input: { agentId: string; browserId: string; url: string }): Promise<unknown>;
  execute(input: { agentId: string; browserId: string; command: string; arguments: Record<string, unknown> }): Promise<unknown>;
};

export function registerInAppBrowserTools(server: McpServer, agentId: string, browser: InAppBrowserClient): void {
  server.registerTool('browser-set-viewport', {
    description: 'Resize your open in-app browser in CSS pixels; returns measured viewport and resets zoom to 100%. Read korus-browser for responsive testing. Presets resize only, without touch, user-agent or pixel-density emulation.',
    inputSchema: {
      preset: z.enum(['fit', 'responsive', 'phone', 'tablet', 'desktop']).optional(),
      width: z.number().int().min(240).max(2000).optional(),
      height: z.number().int().min(320).max(2000).optional(),
    },
  }, input => browserResult(() => {
    parseBrowserViewport(input);
    return browser.execute({ agentId, browserId: PRIMARY_BROWSER_ID, command: 'viewport', arguments: input });
  }));
  const run = (command: string, arguments_: Record<string, unknown>) => browserResult(() => browser.execute({ agentId, browserId: PRIMARY_BROWSER_ID, command, arguments: arguments_ }));
  server.registerTool('browser-open', { description: `Open your ${product.name} browser pane and wait for load. Read korus-browser first. Accepts HTTP/HTTPS or file URLs inside your project folder.`, inputSchema: { url: z.string().trim().min(1).describe('HTTP, HTTPS, or workspace-local file URL to open.') } }, ({ url }) => browserResult(() => browser.open({ agentId, browserId: PRIMARY_BROWSER_ID, url })));
  server.registerTool('browser-get-dom', { description: 'Inspect the current in-app browser page or one CSS selector. Returns URL, title, text, HTML, and bounds. Use this before browser interactions.', inputSchema: { selector: z.string().optional() } }, ({ selector }) => run('dom', selector ? { selector } : {}));
  server.registerTool('browser-screenshot', { description: 'Capture the current in-app browser viewport as a PNG screenshot for visual debugging.', inputSchema: {} }, async () => {
    try {
      const value = await browser.execute({ agentId, browserId: PRIMARY_BROWSER_ID, command: 'screenshot', arguments: {} }) as { data: string; mimeType: string };
      return { content: [{ type: 'image', data: value.data, mimeType: value.mimeType }], structuredContent: { mimeType: value.mimeType }, isError: false } as CallToolResult;
    } catch (error) { return errorToolResult(error instanceof Error ? error.message : String(error)); }
  });
  server.registerTool('browser-click', {
    description: 'Focus the in-app browser and click using real mouse input. Provide either a unique CSS selector inspected with browser-get-dom, or x and y in viewport CSS pixels inspected with browser-screenshot.',
    inputSchema: {
      selector: z.string().trim().min(1).optional(),
      x: z.number().finite().min(0).describe('Horizontal coordinate in viewport CSS pixels; use with y instead of selector.').optional(),
      y: z.number().finite().min(0).describe('Vertical coordinate in viewport CSS pixels; use with x instead of selector.').optional(),
    },
  }, input => browserResult(() => browser.execute({ agentId, browserId: PRIMARY_BROWSER_ID, command: 'click', arguments: clickTarget.parse(input) })));

  server.registerTool('browser-type', { description: 'Focus a CSS-selected editable element and replace its value with text in the in-app browser.', inputSchema: { selector: z.string().min(1), text: z.string().max(100_000), clear: z.boolean().optional() } }, ({ selector, text, clear }) => run('type', { selector, text, ...(clear === undefined ? {} : { clear }) }));
  server.registerTool('browser-scroll', { description: 'Scroll the in-app browser window or a CSS-selected scroll container.', inputSchema: { selector: z.string().optional(), deltaY: z.number().finite().optional() } }, ({ selector, deltaY }) => run('scroll', { ...(selector ? { selector } : {}), ...(deltaY === undefined ? {} : { deltaY }) }));
  server.registerTool('browser-console-logs', { description: 'Read recent console messages captured from the in-app browser for debugging.', inputSchema: { limit: z.number().int().positive().max(100).optional() } }, ({ limit }) => run('console', limit === undefined ? {} : { limit }));
}

async function browserResult(run: () => Promise<unknown>): Promise<CallToolResult> {
  try { return structuredToolResult(await run()); } catch (error) { return errorToolResult(error instanceof Error ? error.message : String(error)); }
}
