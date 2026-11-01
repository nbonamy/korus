import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { logMain, warnMain } from '../log';
import { McpToolError } from './agent-coordinator';
import { errorToolResult, structuredToolResult } from './tool-result';

export type AppMcpToolRequest = {
  agentId: string;
  url: URL;
};

export type AppMcpToolModule = {
  id: string;
  owns?: {
    proposedActions?: true;
  };
  register(server: McpServer, surface: AppMcpToolSurface): void;
};

type AppMcpToolSurface = {
  proposedActions: boolean;
};

export type AppMcpToolModuleProvider = {
  id: string;
  resolve(request: AppMcpToolRequest): AppMcpToolModule | undefined;
};

export function resolveAppMcpToolModules(
  providers: readonly AppMcpToolModuleProvider[],
  request: AppMcpToolRequest,
): AppMcpToolModule[] {
  const providerIds = new Set<string>();
  const moduleIds = new Set<string>();
  const modules: AppMcpToolModule[] = [];

  for (const provider of providers) {
    if (providerIds.has(provider.id)) throw new Error(`Duplicate MCP tool module provider '${provider.id}'.`);
    providerIds.add(provider.id);
    const module = provider.resolve(request);
    if (!module) continue;
    if (moduleIds.has(module.id)) throw new Error(`Duplicate MCP tool module '${module.id}'.`);
    moduleIds.add(module.id);
    modules.push(module);
  }

  return modules;
}

export function registerAppMcpToolModules(server: McpServer, modules: readonly AppMcpToolModule[]): void {
  const surface: AppMcpToolSurface = {
    proposedActions: !modules.some(module => module.owns?.proposedActions),
  };
  for (const module of modules) module.register(server, surface);
}

export async function loggedToolResult(
  tool: string,
  details: Record<string, unknown>,
  run: () => unknown,
): Promise<CallToolResult> {
  logMain('mcp-tool', 'start', { tool, ...details });
  try {
    const result = structuredToolResult(await run());
    logMain('mcp-tool', 'success', {
      tool,
      structuredKeys: Object.keys(result.structuredContent ?? {}),
    });
    return result;
  } catch (error) {
    const message = error instanceof McpToolError || error instanceof Error ? error.message : String(error);
    warnMain('mcp-tool', 'error', { tool, message });
    return errorToolResult(message);
  }
}
