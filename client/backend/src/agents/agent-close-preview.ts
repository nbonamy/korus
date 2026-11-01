import type { AgentGitWorkflow, AppSnapshot } from '@workspace/core/contracts';
import type { AgentClosePreview } from '@workspace/core/agent-close';
import { matchingBranchUpstream } from '@workspace/core/git-remote';

export async function readAgentClosePreview(snapshot: Pick<AppSnapshot, 'agents'>, agentId: string,
  readWorkflow: () => Promise<Pick<AgentGitWorkflow, 'isLinkedWorktree' | 'branch' | 'upstream' | 'baseBranch' | 'files'>>): Promise<AgentClosePreview> {
  const agent = snapshot.agents.find(candidate => candidate.id === agentId);
  if (!agent) throw new Error('Agent not found.');
  const plain = { isLinkedWorktree: false, branch: null, upstream: null, hasChanges: false };
  if (agent.folder && snapshot.agents.some(other => other.id !== agent.id && other.folder === agent.folder && other.remoteConnectionId === agent.remoteConnectionId)) return plain;
  try {
    const workflow = await readWorkflow();
    return { isLinkedWorktree: workflow.isLinkedWorktree, branch: workflow.branch ?? null,
      upstream: matchingBranchUpstream(workflow.branch, workflow.upstream, workflow.baseBranch) ?? null, hasChanges: workflow.files.length > 0 };
  } catch { return plain; }
}
