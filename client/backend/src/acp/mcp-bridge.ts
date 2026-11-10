import { product } from '@workspace/core/product';
import { sessionMcpServer as createSessionMcpServer } from '@korus-dev/multi-agent-sdk/acp/mcp-bridge';
export function sessionMcpServer(url: string, name = product.mcpServerName, allowedTools?: string[]) { return createSessionMcpServer(url, name, allowedTools); }
