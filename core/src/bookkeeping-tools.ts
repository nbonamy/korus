import type { ToolPart } from '@korus-dev/multi-agent-sdk';
import { isAppMcpServerName } from './product';

/** Korus's own status tools report on a turn; they are not work, so the text before them is still the answer. */
export function isBookkeepingTool(tool: ToolPart): boolean {
  const name = tool.metadata?.tool;
  return isAppMcpServerName(tool.metadata?.server) && typeof name === 'string' && ['finish-turn', 'set-status'].includes(name.replaceAll('_', '-'));
}
