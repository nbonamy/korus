import { approvalOutcome as nativeApprovalOutcome, type AgentRequestOutcome } from '@korus-dev/multi-agent-sdk/contracts';
export { isAgentRequestResponse, approvalAgentRequest, requestFromClientRequest, agentResponseFromClientResponse, clientResponseFromAgentResponse } from '@korus-dev/multi-agent-sdk/contracts';
export type { AgentRequest, AgentRequestOutcome, AgentRequestResponse } from '@korus-dev/multi-agent-sdk/contracts';

export function requestOutcomeToWire(outcome: AgentRequestOutcome): AgentRequestOutcome {
  if (outcome.kind !== 'cancelled' && outcome.kind !== 'completed') return outcome;
  const reason = outcome.reason === 'host_disconnected' ? 'surface_disconnected' : outcome.reason === 'host' ? 'surface' : outcome.reason;
  return reason === outcome.reason ? outcome : { ...outcome, reason };
}

export function approvalOutcome(...[decision, scope, reason]: Parameters<typeof nativeApprovalOutcome>): AgentRequestOutcome {
  return requestOutcomeToWire(nativeApprovalOutcome(decision, scope, reason === 'surface_disconnected' ? 'host_disconnected' : reason));
}
