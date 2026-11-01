import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAppMcpToolModules,
  resolveAppMcpToolModules,
  type AppMcpToolModuleProvider,
  type AppMcpToolRequest,
} from './tool-modules';

export function createAppMcpServer(
  request: AppMcpToolRequest,
  providers: readonly AppMcpToolModuleProvider[],
): McpServer {
  const server = new McpServer({
    name: 'agent-workspace-mcp',
    version: '1.0.0',
  });
  registerAppMcpToolModules(server, resolveAppMcpToolModules(providers, request));
  return server;
}
