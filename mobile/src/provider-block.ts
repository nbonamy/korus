import type { Agent } from '@workspace/core/contracts';
import { hasUnreadActivity } from '@workspace/core/agent-read-state';
import { providerSafetyBlockDetails } from '@workspace/core/provider-safety-block';

export function providerBlockFor(agent: Agent | null | undefined): { details: string } | null {
  if (agent?.status.type !== 'error') return null;
  const details = providerSafetyBlockDetails(agent.status.message);
  return details === null ? null : { details: agent.status.safetyReview?.explanation || details };
}

/** Acknowledging attention changes presentation, never the provider's admission state. */
export function mobileAgentStatus(agent: Agent): Agent['status'] {
  return agent.readState && !hasUnreadActivity(agent) && providerBlockFor(agent)
    ? { type: 'idle' } : agent.status;
}
