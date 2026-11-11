import type { Agent, HarnessProvider, AppSnapshot } from './contracts';

export function supportsSubscriptionQuota(provider: HarnessProvider, codexAccount?: { type: string } | null): boolean {
  return provider !== 'codex' || codexAccount?.type !== 'apiKey';
}

export function enabledAgentProviders(snapshot: Pick<AppSnapshot, 'providerConnections'>): HarnessProvider[] {
  return (snapshot.providerConnections ?? []).filter(provider => provider.installed && provider.connected && provider.enabled !== false).map(provider => provider.provider);
}

export function resolveAgentProvider(snapshot: Pick<AppSnapshot, 'providerConnections'>, requested?: HarnessProvider): HarnessProvider {
  const enabled = enabledAgentProviders(snapshot);
  const provider = requested ?? enabled[0];
  if (!provider) throw new Error('Connect a coding engine before starting new work.');
  if (!enabled.includes(provider)) throw new Error(`Engine is not connected or is disabled: ${provider}. Connect or enable it in Settings.`);
  return provider;
}

/** Engines available on one host: local when no connection is given. */
export function providerConnectionsForHost(snapshot: AppSnapshot, connectionId?: string | null) {
  if (!connectionId) return snapshot.providerConnections ?? [];
  const connection = snapshot.remoteConnections.connections.find(item => item.id === connectionId);
  return connection?.status === 'ready' ? connection.providerConnections ?? [] : [];
}

export function canSelectAgentProvider(agent: Agent): boolean {
  return !agent.hasSubmittedPrompt && !agent.providerSession && agent.status.type === 'idle';
}
