import type { Agent, AgentBackend, AppSnapshot } from './contracts';

export function supportsSubscriptionQuota(backend: AgentBackend, codexAccount?: { type: string } | null): boolean {
  return backend !== 'antigravity' && (backend !== 'codex' || codexAccount?.type !== 'apiKey');
}

export function enabledAgentBackends(snapshot: Pick<AppSnapshot, 'providerConnections'>): AgentBackend[] {
  return (snapshot.providerConnections ?? []).filter(provider => provider.installed && provider.connected && provider.enabled !== false).map(provider => provider.backend);
}

export function resolveAgentBackend(snapshot: Pick<AppSnapshot, 'providerConnections'>, requested?: AgentBackend): AgentBackend {
  const enabled = enabledAgentBackends(snapshot);
  const backend = requested ?? enabled[0];
  if (!backend) throw new Error('Connect a coding engine before starting new work.');
  if (!enabled.includes(backend)) throw new Error(`Engine is not connected or is disabled: ${backend}. Connect or enable it in Settings.`);
  return backend;
}

export function providerConnectionsForTeam(snapshot: AppSnapshot, teamId = snapshot.activeTeamId) {
  const connectionId = snapshot.teams.find(team => team.id === teamId)?.remoteConnectionId;
  if (!connectionId) return snapshot.providerConnections ?? [];
  const connection = snapshot.remoteConnections.connections.find(item => item.id === connectionId);
  return connection?.status === 'ready' ? connection.providerConnections ?? [] : [];
}

export function canSelectAgentBackend(agent: Agent): boolean {
  return !agent.hasSubmittedPrompt && !agent.backendSession && agent.status.type === 'idle';
}
