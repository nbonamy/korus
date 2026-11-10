import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerComputerUseTools as register, type ComputerUseClient } from 'multi-agents-sdk/computer-use';
export type { ComputerUseClient } from 'multi-agents-sdk/computer-use';
export function registerComputerUseTools(server: McpServer, client: ComputerUseClient): void {
  register(server, client, { instructions: 'Read korus-computer-use before GUI actions.' });
}
