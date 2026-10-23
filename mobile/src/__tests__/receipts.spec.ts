import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompanionSession } from '../companion-port';
import { createDraftLedger } from '../draft-ledger';
import { createReceiptReconciler } from '../receipts';

afterEach(() => vi.useRealTimers());
const key = JSON.stringify(['laptop', 'agent']);
function fixture(statuses: ('accepted' | 'rejected' | 'pending' | 'unresolved' | 'notReceived')[]) {
  const ledger = createDraftLedger(undefined, vi.fn());
  ledger.drafts[key] = { text: 'ship it', selectionStart: 7, selectionEnd: 7 };
  ledger.uncertain[key] = true; ledger.commandIds[key] = 'command'; ledger.submittedTexts[key] = 'ship it';
  const commandStatus = vi.fn(async () => statuses.shift() ?? 'pending');
  const env = { session: { commandStatus } as unknown as CompanionSession | null, connection: 1 };
  const settled = vi.fn(); const outcome = vi.fn(); ledger.callbacks.set('command', outcome);
  const receipts = createReceiptReconciler({ ledger, session: () => env.session, connected: () => true, connection: () => env.connection, laptopId: () => 'laptop', disposed: () => false, settled });
  return { ledger, env, receipts, commandStatus, settled, outcome };
}

describe('delivery receipts', () => {
  it('settles an accepted send: the draft empties, the warning goes, and whoever waited is told', async () => {
    const f = fixture(['accepted']);
    await f.receipts.reconcile();
    expect(f.ledger.uncertain[key]).toBe(false);
    expect(f.ledger.drafts[key]?.text).toBe('');
    expect(f.outcome).toHaveBeenCalledWith('accepted'); expect(f.settled).toHaveBeenCalledWith(key, 'accepted');
  });

  it('keeps the words of a rejected send so the person can try again', async () => {
    const f = fixture(['rejected']);
    await f.receipts.reconcile();
    expect(f.ledger.uncertain[key]).toBe(false);
    expect(f.ledger.drafts[key]?.text).toBe('ship it');
    expect(f.settled).toHaveBeenCalledWith(key, 'rejected');
  });

  it('leaves a send the laptop cannot account for marked as unresolved, and never asks again', async () => {
    vi.useFakeTimers(); const f = fixture(['unresolved']);
    await f.receipts.reconcile(); await vi.advanceTimersByTimeAsync(10_000);
    expect(f.ledger.unresolved[key]).toBe(true); expect(f.ledger.uncertain[key]).toBe(true);
    expect(f.commandStatus).toHaveBeenCalledOnce(); expect(f.settled).not.toHaveBeenCalled();
  });

  it('asks again after two seconds while the laptop is still deciding', async () => {
    vi.useFakeTimers(); const f = fixture(['pending', 'accepted']);
    await f.receipts.reconcile();
    expect(f.ledger.uncertain[key]).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.ledger.uncertain[key]).toBe(false); expect(f.commandStatus).toHaveBeenCalledTimes(2);
  });

  it('ignores an answer that arrives after the connection was replaced', async () => {
    const f = fixture(['accepted']);
    f.commandStatus.mockImplementationOnce(async () => { f.env.connection = 2; return 'accepted'; });
    await f.receipts.reconcile();
    expect(f.ledger.uncertain[key]).toBe(true); expect(f.outcome).not.toHaveBeenCalled();
  });
});
