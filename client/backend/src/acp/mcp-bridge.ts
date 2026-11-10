import { product } from '@workspace/core/product';
import { sessionMcpServer as createSessionMcpServer } from 'multi-agents-sdk/acp/mcp-bridge';
export function sessionMcpServer(url: string, name = product.mcpServerName, allowedTools?: string[]) { return createSessionMcpServer(url, name, allowedTools); }
