export * from 'multi-agents-sdk/providers/claude/skills';
import { listClaudeSkills as nativeList } from 'multi-agents-sdk/providers/claude/skills';
import type { Agent } from '@workspace/core/contracts';
export function listClaudeSkills(agent: Agent, options?: Parameters<typeof nativeList>[1]) { return nativeList(agent, options); }
