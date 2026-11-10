export { claudeToolPartInputUpdate, completedClaudeToolPart, claudeToolFileActivity } from '@korus-dev/multi-agent-sdk/providers/claude';
import { claudeToolPart as nativeToolPart } from '@korus-dev/multi-agent-sdk/providers/claude';
import { presentClaudeMcpInput } from './tool-presentation-policy';
export function claudeToolPart(...[block, options = {}]: Parameters<typeof nativeToolPart>) {
  return nativeToolPart(block, { ...options, presentMcpInput: presentClaudeMcpInput });
}
