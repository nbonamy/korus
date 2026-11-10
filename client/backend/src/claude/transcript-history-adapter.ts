export { claudeTranscriptGoal, claudeTranscriptSettings, listClaudeTranscriptSummaries, type ClaudeTranscriptHistory } from '@korus-dev/multi-agent-sdk/providers/claude';
import { loadClaudeTranscriptHistory as nativeLoad, claudeTranscriptToRendererMessages as nativeMessages } from '@korus-dev/multi-agent-sdk/providers/claude';
import { presentClaudeMcpInput } from './tool-presentation-policy';
export function loadClaudeTranscriptHistory(...[agent, options = {}]: Parameters<typeof nativeLoad>) {
  return nativeLoad(agent, { ...options, toolOptions: { ...options.toolOptions, presentMcpInput: presentClaudeMcpInput } });
}
export function claudeTranscriptToRendererMessages(...args: Parameters<typeof nativeMessages>) {
  args[9] = { ...args[9], presentMcpInput: presentClaudeMcpInput };
  return nativeMessages(...args);
}
