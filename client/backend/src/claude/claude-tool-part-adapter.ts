export { claudeToolPartInputUpdate, completedClaudeToolPart, claudeToolFileActivity } from 'multi-agents-sdk/providers/claude';
import { claudeToolPart as nativeToolPart } from 'multi-agents-sdk/providers/claude';
import { presentClaudeMcpInput } from './tool-presentation-policy';
export function claudeToolPart(...[block, options = {}]: Parameters<typeof nativeToolPart>) {
  return nativeToolPart(block, { ...options, presentMcpInput: presentClaudeMcpInput });
}
