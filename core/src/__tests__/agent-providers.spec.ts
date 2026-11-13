import { describe, expect, it } from 'vitest';
import { enabledAgentProviders, resolveAgentProvider } from '../agent-providers';
import { supportsSubscriptionQuota } from '../provider-capabilities';
import type { HarnessProvider } from '../contracts';

describe('connected engines', () => {
  it('offers subscription quota unless the account is billed per use, whichever harness it signs in to', () => {
    expect(supportsSubscriptionQuota({ kind: 'subscription' })).toBe(true);
    expect(supportsSubscriptionQuota({ kind: 'cloud' })).toBe(true);
    // A harness that names no account may still report quota.
    expect(supportsSubscriptionQuota(null)).toBe(true);
    expect(supportsSubscriptionQuota({ kind: 'apiKey' })).toBe(false);
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
