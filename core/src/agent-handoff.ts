import type { ExecutionSelection } from './contracts/execution';
import { isExecutionSelection, readPersistedExecutionSelection } from './execution-selection';
import type { Agent, AppSnapshot, BackendConversationRef } from './contracts';

export type AgentHandoffInput = {
  operationId: string;
  selection: ExecutionSelection;
  instructions?: string;
};

/** Product workflow metadata, never a replacement for provider-owned history. */
export type AgentHandoff = AgentHandoffInput & {
  sourceAgentId: string;
  sourceTitle: string;
  sourceRef: BackendConversationRef;
  targetAgentId?: string;
  phase: 'preparing' | 'closing' | 'starting' | 'complete' | 'failed';
  note?: string;
  error?: string;
};

export const handoffNoteLimit = 32_000;

export function handoffInProgress(agent: Agent): boolean {
  return Boolean(agent.handoff && !['complete', 'failed'].includes(agent.handoff.phase));
}

export function agentHandoffBlocker(snapshot: AppSnapshot, agent: Agent): string | null {
  if (!agent.folder || agent.sessionKind === 'quickChat') return 'Hand off is available for agents with a workspace.';
  if (!agent.backendSession) return 'Start a conversation before handing it off.';
  if (agent.status.type !== 'idle' || handoffInProgress(agent)) return 'Wait for the agent to finish before handing it off.';
  if ((snapshot.queuedPrompts ?? []).some(prompt => prompt.agentId === agent.id)) return 'Resolve queued prompts before handing off.';
  if ((snapshot.agentRequests?.[agent.id]?.length ?? 0) > 0) return 'Resolve pending requests before handing off.';
  if (agent.goal && agent.goal.status !== 'complete') return 'Finish or clear the goal before handing off.';
  if (agent.codeReview || agent.planReview?.status === 'pending') return 'Finish the review before handing off.';
  if ((snapshot.missions ?? []).some(mission => mission.execution?.runs.some(run => run.workerId === agent.id))) return 'Mission workers cannot be handed off.';
  if (Object.values(snapshot.subagentTrees[agent.id]?.nodes ?? {}).some(node => ['pendingInit', 'running'].includes(node.status))) return 'Finish the subagents before handing off.';
  if (snapshot.agents.some(candidate => candidate.delegatedByAgentId === agent.id && ['working', 'awaitingInput'].includes(candidate.status.type))) return 'Wait for delegated agents to finish before handing off.';
  return null;
}

export function isAgentHandoff(value: unknown): value is AgentHandoff {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const ref = v.sourceRef as Record<string, unknown> | undefined;
  return typeof v.operationId === 'string' && v.operationId.length > 0 && v.operationId.length <= 128
    && isExecutionSelection(v.selection)
    && typeof v.sourceAgentId === 'string' && typeof v.sourceTitle === 'string'
    && ['preparing', 'closing', 'starting', 'complete', 'failed'].includes(String(v.phase))
    && (v.targetAgentId === undefined || typeof v.targetAgentId === 'string')
    && (v.instructions === undefined || (typeof v.instructions === 'string' && v.instructions.length <= 4000))
    && (v.note === undefined || (typeof v.note === 'string' && v.note.length <= handoffNoteLimit))
    && (v.error === undefined || typeof v.error === 'string')
    && Boolean(ref && !Array.isArray(ref) && ((ref.backend === 'codex' && typeof ref.threadId === 'string')
      || ((ref.backend === 'claude' || ref.backend === 'antigravity') && typeof ref.sessionId === 'string' && (typeof ref.folder === 'string' || ref.folder === null))));
}

export function readPersistedAgentHandoff(value: unknown): AgentHandoff | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { backend: _backend, model: _model, ...record } = value as Record<string, unknown>;
  const selection = readPersistedExecutionSelection(record.selection ?? value);
  const migrated = { ...record, selection };
  return isAgentHandoff(migrated) ? migrated : undefined;
}
