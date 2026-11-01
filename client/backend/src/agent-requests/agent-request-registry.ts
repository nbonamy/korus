import type { Agent, AgentBackend, AppSnapshot, BackendPublishedEvent } from '@workspace/core/contracts';
import type { AgentRequest, AgentRequestResponse } from '@workspace/core/agent-request';

export type AgentRequestOwner = { kind: 'driver'; backend: AgentBackend; remoteConnectionId?: string };

export type AgentRequestRegistryOptions = {
  getSnapshot: () => AppSnapshot;
  remoteConnectionIdForAgent: (agent: Pick<Agent, 'remoteConnectionId'>) => string | null;
};

/** Tracks the backend or remote daemon responsible for each pending client request. */
export class AgentRequestRegistry {
  private readonly owners = new Map<string, AgentRequestOwner>();
  private readonly requests = new Map<string, AgentRequest>();
  private readonly responding = new Set<string>();
  private readonly agents = new Map<string, string>();

  constructor(private readonly options: AgentRequestRegistryOptions) {}

  owner(requestId: string): AgentRequestOwner | undefined {
    const key = this.findKey(requestId);
    return key ? this.owners.get(key) : undefined;
  }

  private delete(requestId: string): void {
    this.owners.delete(requestId);
    this.requests.delete(requestId);
    this.agents.delete(requestId);
  }

  clearAgent(agentId: string): void {
    for (const [id, owner] of this.agents) if (owner === agentId) this.delete(id);
  }

  async respond(response: AgentRequestResponse, send: (owner: AgentRequestOwner) => Promise<void>): Promise<void> {
    const key = this.findKey(response.id, response.agentId);
    const owner = key ? this.owners.get(key) : undefined;
    const request = key ? this.requests.get(key) : undefined;
    if (!key || !owner || !request) throw new Error(`Agent request '${response.id}' is no longer pending.`);
    if (this.responding.has(key)) throw new Error('An answer is already being submitted for this request.');
    const outcome = response.outcome;
    if ((request.kind === 'question' && outcome.kind === 'decision')
      || (request.kind !== 'question' && outcome.kind === 'answered')) throw new Error('Response does not match the request kind.');
    if (request.kind === 'approval' && outcome.kind === 'decision') {
      if (outcome.decision === 'deny' && request.approval.canDeny === false) throw new Error('This approval cannot be denied.');
      if (outcome.decision === 'always_allow') throw new Error('This approval does not support permanent authorization.');
      const scope = outcome.decision === 'allow_conversation' ? 'session' : 'once';
      if (outcome.decision !== 'deny' && request.approval.allowedScopes && !request.approval.allowedScopes.includes(scope)) throw new Error('Unsupported approval scope.');
    }
    if (request.kind === 'toolConfirmation' && outcome.kind === 'decision') {
      if ((outcome.decision === 'always_allow' && !request.confirmation.allowAlways)
        || (outcome.decision === 'allow_conversation' && !request.confirmation.allowConversation)) throw new Error('Unsupported confirmation scope.');
    }
    this.responding.add(key);
    try { await send(owner); if (this.requests.get(key) === request) this.delete(key); }
    finally { this.responding.delete(key); }
  }

  private findKey(id: string, agentId?: string): string | undefined {
    if (agentId) return JSON.stringify([agentId, id]);
    const matches = [...this.requests].filter(([, request]) => request.id === id);
    if (matches.length > 1) throw new Error('Agent identity is required for this request.');
    return matches[0]?.[0];
  }

  record(event: BackendPublishedEvent, remoteConnectionIdOverride?: string): void {
    if (event.type === 'agent.conversationAttached') {
      for (const [key, agentId] of this.agents) {
        if (agentId === event.agentId && this.requests.get(key)?.conversationId !== event.conversationId) this.delete(key);
      }
      return;
    }
    if (event.type === 'agentRequest.resolved') {
      const key = JSON.stringify([event.agentId, event.payload.id]);
      if (!event.conversationId || this.requests.get(key)?.conversationId === event.conversationId) this.delete(key);
      return;
    }
    if (event.type !== 'agentRequest.created') return;
    const requestId = event.payload.request.id;
    if (!requestId) return;

    const snapshot = this.options.getSnapshot();
    const ownerAgent = event.agentId
      ? snapshot.agents.find((agent) => agent.id === event.agentId)
      : undefined;
    const backend = event.backend ?? ownerAgent?.backend;
    if (!backend) return;
    const key = JSON.stringify([event.agentId, requestId]);
    this.requests.set(key, event.payload.request);
    this.agents.set(key, event.agentId);

    const remoteConnectionId = remoteConnectionIdOverride
      ?? (ownerAgent ? this.options.remoteConnectionIdForAgent(ownerAgent) : null);
    this.owners.set(key, {
      kind: 'driver',
      backend,
      ...(remoteConnectionId ? { remoteConnectionId } : {}),
    });
  }

}
