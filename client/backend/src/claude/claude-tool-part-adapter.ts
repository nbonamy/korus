export * from 'multi-agents-sdk/providers/claude/claude-tool-part-adapter';
import { claudeToolPart as nativeToolPart } from 'multi-agents-sdk/providers/claude/claude-tool-part-adapter';
import { presentClaudeMcpInput } from './tool-presentation-policy';
export function claudeToolPart(...[block, options = {}]: Parameters<typeof nativeToolPart>) {
  return nativeToolPart(block, { ...options, presentMcpInput: presentClaudeMcpInput });
}
