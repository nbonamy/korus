import { isAppMcpServerName } from '@workspace/core/product';
export function presentClaudeMcpInput(mcp: { server: string; tool: string }, input: Record<string, unknown>): Record<string, unknown> {
  const tool = isAppMcpServerName(mcp.server) ? mcp.tool.replaceAll('_', '-') : '';
  return tool === 'set-status' ? statusInput(input) : tool === 'finish-turn' ? finishTurnInput(input) : input;
}
function statusInput(input: Record<string, unknown>): Record<string, unknown> {
  return typeof input.status === 'string' ? { status: input.status } : {};
}
function finishTurnInput(input: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(typeof input.flag === 'string' ? { flag: input.flag } : {}),
    ...(typeof input.celebration === 'boolean'
      ? { celebration: input.celebration }
      : {}),
  };
}
