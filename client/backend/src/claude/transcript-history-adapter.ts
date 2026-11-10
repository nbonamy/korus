export * from 'multi-agents-sdk/providers/claude/transcript-history-adapter';
import { loadClaudeTranscriptHistory as nativeLoad, claudeTranscriptToRendererMessages as nativeMessages } from 'multi-agents-sdk/providers/claude/transcript-history-adapter';
import { presentClaudeMcpInput } from './tool-presentation-policy';
export function loadClaudeTranscriptHistory(...[agent, options = {}]: Parameters<typeof nativeLoad>) {
  return nativeLoad(agent, { ...options, toolOptions: { ...options.toolOptions, presentMcpInput: presentClaudeMcpInput } });
}
export function claudeTranscriptToRendererMessages(...args: Parameters<typeof nativeMessages>) {
  args[9] = { ...args[9], presentMcpInput: presentClaudeMcpInput };
  return nativeMessages(...args);
}
