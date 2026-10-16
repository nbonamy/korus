import type { Agent, AgentBackend } from './contracts';
import type { BackendSendResult } from './backend-driver';

/** Upper bound for user-authored delegation text; durable task persistence enforces the same limit. */
export const MAX_DELEGATION_INSTRUCTIONS_LENGTH = 100_000;

export type DelegationOverrides = {
  startingContext: DelegationStartingContext;
  instructions?: string;
};

type DelegationExecution = { backend: AgentBackend; conversationId: string; turnId: string };
export type TurnDelegationOverrides = DelegationOverrides & { execution?: DelegationExecution };

// Terminal notifications can precede admission receipts. Retain only identities
// for a pending prompt, not provider conversation state or transcript content.
const pendingTerminals = new WeakMap<TurnDelegationOverrides, Set<string>>();
const executionKey = (execution: DelegationExecution) => JSON.stringify([execution.backend, execution.conversationId, execution.turnId]);

export function captureUserDelegationOverrides(agent: Agent, input?: DelegationOverrides): TurnDelegationOverrides | undefined {
  const controls = input ? { startingContext: input.startingContext, ...(input.instructions !== undefined ? { instructions: input.instructions } : {}) } : undefined;
  if (controls) { agent.userDelegationOverrides = controls; pendingTerminals.set(controls, new Set()); }
  else delete agent.userDelegationOverrides;
  return controls;
}

export function bindUserDelegationOverrides(agent: Agent, controls: TurnDelegationOverrides | undefined, receipt: BackendSendResult): void {
  if (!controls || agent.userDelegationOverrides !== controls || !receipt.turnId) return;
  const session = receipt.backendSession;
  controls.execution = { backend: session.kind, conversationId: session.kind === 'codex' ? session.threadId : session.sessionId, turnId: receipt.turnId };
  if (pendingTerminals.get(controls)?.has(executionKey(controls.execution))) delete agent.userDelegationOverrides;
  pendingTerminals.delete(controls);
}

export function completeUserDelegationTurn(agent: Agent, execution: DelegationExecution): void {
  const controls = agent.userDelegationOverrides;
  if (!controls) return;
  if (controls.execution && executionKey(controls.execution) === executionKey(execution)) delete agent.userDelegationOverrides;
  else if (!controls.execution) pendingTerminals.get(controls)?.add(executionKey(execution));
}

export function isTurnDelegationOverrides(value: unknown): value is TurnDelegationOverrides {
  if (!isDelegationOverrides(value)) return false;
  const execution = (value as TurnDelegationOverrides).execution;
  return execution === undefined || Boolean(execution && typeof execution === 'object'
    && ['codex', 'claude', 'antigravity'].includes(execution.backend)
    && typeof execution.conversationId === 'string' && typeof execution.turnId === 'string');
}

export type DelegationStartingContext = 'conversation' | 'handoff';

/** Frozen user-authored constraints, separate from agent-generated assignment guidance. */
export type DelegationUserInstructions = { saved: string; taskSpecific?: string };

export function isDelegationUserInstructions(value: unknown): value is DelegationUserInstructions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const instructions = value as Record<string, unknown>;
  return isBoundedString(instructions.saved) && (instructions.taskSpecific === undefined || isBoundedString(instructions.taskSpecific));
}

export function isDelegationOverrides(value: unknown): value is DelegationOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const overrides = value as Record<string, unknown>;
  return (overrides.startingContext === 'conversation' || overrides.startingContext === 'handoff')
    && (overrides.instructions === undefined || isBoundedString(overrides.instructions));
}

/** App-owned description of how a worktree assignment actually started. */
export type DelegationContext = {
  requested: DelegationStartingContext;
  effective: DelegationStartingContext;
  reason?: 'cross-provider' | 'unsupported' | 'unavailable';
};

export function isDelegationContext(value: unknown): value is DelegationContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const context = value as Record<string, unknown>;
  return (context.requested === 'conversation' || context.requested === 'handoff')
    && (context.effective === 'conversation' || context.effective === 'handoff')
    && (context.requested !== 'handoff' || context.effective === 'handoff')
    && (context.reason === undefined || (context.requested === 'conversation' && context.effective === 'handoff'))
    && (context.reason === undefined || ['cross-provider', 'unsupported', 'unavailable'].includes(context.reason as string));
}

function isBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_DELEGATION_INSTRUCTIONS_LENGTH;
}
