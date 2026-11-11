import type { AppText, HarnessProvider } from '@workspace/core/contracts';

// The harness reports structured status; Korus chooses the words people see for it.
const runtimeKeys: Partial<Record<HarnessProvider, Partial<Record<string, string>>>> = {
  codex: { starting: 'backend.codexConnecting', running: 'backend.codexConnected', notConfigured: 'backend.codexNotConnected' },
  claude: { notConfigured: 'backend.claudeNotStarted', running: 'backend.claudeConnected' },
};
const awaitingKeys = { approval: 'backend.awaitingApproval', input: 'backend.awaitingUserInput' } as const;

/** The status line for a provider runtime, unless the provider already explained an error. */
export function runtimeStatusDetail(provider: HarnessProvider, status: string, detail: unknown): AppText | undefined {
  if (detail !== undefined) return detail as AppText;
  const key = runtimeKeys[provider]?.[status];
  return key ? { key } : undefined;
}

/** Words the status events a harness emits, leaving every other event untouched. */
export function withStatusWording<E extends { type: string; provider?: string; payload?: unknown }>(provider: HarnessProvider, event: E): E {
  const payload = event.payload as Record<string, unknown> | undefined;
  if (!payload) return event;
  if (event.type === 'provider.statusChanged' && typeof payload.status === 'string') {
    const detail = runtimeStatusDetail(provider, payload.status, payload.detail);
    return detail === undefined ? event : { ...event, payload: { ...payload, detail } };
  }
  if (event.type === 'agent.statusChanged' && payload.type === 'awaitingInput' && payload.detail === undefined && (payload.reason === 'approval' || payload.reason === 'input')) {
    return { ...event, payload: { ...payload, detail: { key: awaitingKeys[payload.reason] } } };
  }
  return event;
}
