
import { listClaudeSkills as nativeList } from '@korus-dev/multi-agent-sdk/providers/claude';
import type { Agent } from '@workspace/core/contracts';
export function listClaudeSkills(agent: Agent, options?: Parameters<typeof nativeList>[1]) { return nativeList(agent, options); }
