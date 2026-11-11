import { describe, expect, it } from 'vitest';
import { enabledAgentProviders, resolveAgentProvider } from '../agent-providers';
import { supportsSubscriptionQuota } from '../provider-capabilities';
import type { HarnessProvider } from '../contracts';

describe('connected engines', () => {
  it('offers subscription quota for subscription providers, excluding Codex API keys and unsupported providers', () => {
    expect((['codex', 'claude', 'antigravity', 'cursor'] as const).filter(provider => supportsSubscriptionQuota(provider, { type: 'chatgpt' }))).toStrictEqual(['codex', 'claude', 'antigravity', 'cursor']);
    expect((['codex', 'claude', 'antigravity', 'cursor'] as const).filter(provider => supportsSubscriptionQuota(provider, { type: 'apiKey' }))).toStrictEqual(['claude', 'antigravity', 'cursor']);
  });
  it.each([
    { connected: [] }, { connected: ['codex'] }, { connected: ['claude'] }, { connected: ['codex', 'claude'] },
    { connected: ['cursor'] }, { connected: ['antigravity'] }, { connected: ['codex', 'claude', 'antigravity'] },
    { connected: ['codex', 'claude', 'antigravity', 'cursor'] },
  ] as { connected: HarnessProvider[] }[])('uses only authenticated engines: $connected', ({ connected }) => {
    const snapshot = { providerConnections: (['codex', 'claude', 'antigravity', 'cursor'] as const).map(provider => ({
      provider: provider, installed: true, connected: connected.includes(provider), checking: false,
    })) };
    expect(enabledAgentProviders(snapshot)).toStrictEqual(connected);
    if (connected.length) expect(resolveAgentProvider(snapshot)).toBe(connected[0]);
    else expect(() => resolveAgentProvider(snapshot)).toThrow('Connect');
    for (const backend of ['codex', 'claude', 'antigravity', 'cursor'] as const) {
      if (!connected.includes(backend)) expect(() => resolveAgentProvider(snapshot, backend)).toThrow('not connected');
    }
  });

  it('does not infer a connection when status is missing', () => {
    expect(enabledAgentProviders({})).toStrictEqual([]);
    expect(() => resolveAgentProvider({})).toThrow('Connect');
  });
});
