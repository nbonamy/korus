import { describe, expect, it } from 'vitest';
import { statusFromSnapshot } from '../codex-status';
import { sdkSnapshot } from './sdk-surface-fixture';

describe('agent status from a Codex conversation', () => {
  it('keeps saying working while a turn retries after an error, and only says error once nothing is running', () => {
    const retrying = sdkSnapshot('a', { busy: true, activeTurnId: 'turn', error: 'Reconnecting… 2/5' });
    expect(statusFromSnapshot(retrying)).toStrictEqual({ type: 'working' });
    expect(statusFromSnapshot({ ...retrying, busy: false, activeTurnId: null })).toStrictEqual({ type: 'error', message: 'Reconnecting… 2/5' });
  });

  it('still asks for input first, then reports work, then idle', () => {
    const waiting = sdkSnapshot('a', { busy: true, error: 'Retrying', approvals: [{ id: 'approval' } as never] });
    expect(statusFromSnapshot(waiting)).toStrictEqual({ type: 'awaitingInput', detail: { key: 'backend.awaitingUserInput' } });
    expect(statusFromSnapshot(sdkSnapshot('a', { busy: true }))).toStrictEqual({ type: 'working' });
    expect(statusFromSnapshot(sdkSnapshot('a', { busy: false }))).toStrictEqual({ type: 'idle' });
  });
});
