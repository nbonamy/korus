import { describe, expect, it } from 'vitest';
import { enabledAgentBackends, resolveAgentBackend, supportsSubscriptionQuota } from '../agent-backends';
import type { AgentBackend } from '../contracts';

describe('connected engines', () => {
  it('offers subscription quota for subscription providers, excluding Codex API keys and unsupported providers', () => {
    expect((['codex', 'claude', 'antigravity'] as const).filter(backend => supportsSubscriptionQuota(backend, { type: 'chatgpt' }))).toStrictEqual(['codex', 'claude']);
    expect((['codex', 'claude', 'antigravity'] as const).filter(backend => supportsSubscriptionQuota(backend, { type: 'apiKey' }))).toStrictEqual(['claude']);
  });
  it.each([
    { connected: [] }, { connected: ['codex'] }, { connected: ['claude'] }, { connected: ['codex', 'claude'] },
    { connected: ['antigravity'] }, { connected: ['codex', 'claude', 'antigravity'] },
  ] as { connected: AgentBackend[] }[])('uses only authenticated engines: $connected', ({ connected }) => {
    const snapshot = { providerConnections: (['codex', 'claude', 'antigravity'] as const).map(backend => ({
      backend, installed: true, connected: connected.includes(backend), checking: false,
    })) };
    expect(enabledAgentBackends(snapshot)).toStrictEqual(connected);
    if (connected.length) expect(resolveAgentBackend(snapshot)).toBe(connected[0]);
    else expect(() => resolveAgentBackend(snapshot)).toThrow('Connect');
    for (const backend of ['codex', 'claude', 'antigravity'] as const) {
      if (!connected.includes(backend)) expect(() => resolveAgentBackend(snapshot, backend)).toThrow('not connected');
    }
  });

  it('does not infer a connection when status is missing', () => {
    expect(enabledAgentBackends({})).toStrictEqual([]);
    expect(() => resolveAgentBackend({})).toThrow('Connect');
  });
});
