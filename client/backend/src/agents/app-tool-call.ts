import { appToolTitle } from '@workspace/core/app-tool-title';
import { isAppMcpServerName } from '@workspace/core/product';
import type { McpToolCall } from '@korus-dev/multi-agent-sdk';
import type { AgentRegistry } from '../harness-agent-driver';

/** The row title of one of Korus's own MCP tool calls; any other server's calls stay the harness's to show. */
export function presentAppToolCall(call: McpToolCall, agents: AgentRegistry): string | undefined {
  if (!isAppMcpServerName(call.server)) return undefined;
  const args = typeof call.input === 'object' && call.input !== null && !Array.isArray(call.input) ? call.input as Record<string, unknown> : {};
  return appToolTitle({
    tool: call.tool.replaceAll('_', '-'),
    args,
    result: call.result,
    phase: call.state,
    resolveAgentName: (identifier) => {
      try { return agents.get(identifier).name ?? undefined; } catch { return undefined; }
    },
  });
}
