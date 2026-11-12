import { describe, expect, it } from 'vitest';
import { runtimeStatusDetail, withStatusWording } from '../provider-status-wording';

describe('Korus words the status a harness reports', () => {
  it('words the runtime status line per provider, and keeps an error the provider explained', () => {
    expect(runtimeStatusDetail('codex', 'starting', undefined)).toStrictEqual({ key: 'backend.codexConnecting' });
    expect(runtimeStatusDetail('claude', 'running', undefined)).toStrictEqual({ key: 'backend.claudeConnected' });
    expect(runtimeStatusDetail('codex', 'error', 'app-server exited')).toBe('app-server exited');
    expect(runtimeStatusDetail('cursor', 'running', undefined)).toBeUndefined();
  });

  it('words why a conversation is waiting on the person', () => {
    const waiting = (reason: string) => withStatusWording('codex', { type: 'agent.statusChanged', payload: { type: 'awaitingInput', reason } });
    expect(waiting('approval').payload).toStrictEqual({ type: 'awaitingInput', reason: 'approval', detail: { key: 'backend.awaitingApproval' } });
    expect(waiting('input').payload).toMatchObject({ detail: { key: 'backend.awaitingUserInput' } });
    const status = withStatusWording('codex', { type: 'provider.statusChanged', payload: { provider: 'codex', status: 'running' } });
    expect(status.payload).toMatchObject({ detail: { key: 'backend.codexConnected' } });
    const other = { type: 'agent.updated', payload: { id: 'a' } };
    expect(withStatusWording('codex', other)).toBe(other);
  });
});
