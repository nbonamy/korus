import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexSurfaceRateLimits } from '@codex-app-sdk/core/surface';
import { codexSdkFixture, sdkSnapshot } from './sdk-surface-fixture';
import { BackendDriverRpc } from '../../driver-rpc';

const account = { type: 'chatgpt' as const, email: 'fixture@example.test', planType: 'plus' };
const credit = { id: 'opaque-secret-reset-id', resetType: 'fiveHour', status: 'available', grantedAt: 100, expiresAt: null, title: null, description: '<b>Plain text</b>' };
const quota = { limitId: null, limitName: null, primary: null, secondary: null, credits: null, individualLimit: null, planType: null, rateLimitReachedType: null };
function limits(availableCount: string, credits: typeof credit[] | null): CodexSurfaceRateLimits { return { rateLimits: quota, rateLimitsByLimitId: null, rateLimitResetCredits: { availableCount, credits } }; }
function fixture() {
  const f = codexSdkFixture();
  const snapshot = sdkSnapshot(); snapshot.authentication.account = account;
  f.surface.getSnapshot.mockReturnValue(snapshot);
  const read = vi.fn<(options: { excludeResetCreditDetails: boolean }) => Promise<CodexSurfaceRateLimits>>();
  Object.assign(f.surface, { readRateLimits: read });
  return { ...f, read, snapshot };
}
afterEach(() => { vi.useRealTimers(); });
describe('Codex banked reset driver boundary', () => {
  it('requests details, preserves exact authoritative count and bounds rows without exposing opaque IDs', async () => {
    const f = fixture(); f.read.mockResolvedValue(limits('9007199254740993', Array(101).fill(credit)));
    try {
      const result = await f.driver.getBankedResets();
      expect(f.read).toHaveBeenCalledExactlyOnceWith({ excludeResetCreditDetails: false });
      const { id: _id, ...detail } = credit;
      expect(result).toStrictEqual({ status: 'ready', accountCredits: null, summary: { availableCount: '9007199254740993', credits: Array(100).fill(detail), detailCount: 101 } });
    } finally { await f.adapter.close(); }
  });
  it.each([
    [null, null],
    [{ availableCount: '3', credits: null }, { availableCount: '3', credits: null, detailCount: null }],
    [{ availableCount: '0', credits: [] }, { availableCount: '0', credits: [], detailCount: 0 }],
  ])('preserves unknown/count-only/zero states %j', async (input, summary) => {
    const f = fixture(); f.read.mockResolvedValue({ rateLimits: quota, rateLimitsByLimitId: null, rateLimitResetCredits: input });
    try { expect(await f.driver.getBankedResets()).toStrictEqual({ status: 'ready', accountCredits: null, summary }); }
    finally { await f.adapter.close(); }
  });
  it('supports older SDKs and avoids reads for signed-out or non-ChatGPT accounts', async () => {
    const old = codexSdkFixture();
    try {
      expect(await old.driver.getBankedResets()).toStrictEqual({ status: 'unsupported' });
      await expect(old.driver.useBankedReset({ confirmed: true, redemptionToken: 'selection', idempotencyKey: 'attempt' })).rejects.toThrow('unsupported');
    }
    finally { await old.adapter.close(); }
    const f = fixture();
    try {
      f.read.mockResolvedValue(limits('1', [credit]));
      const { id: _id, ...detail } = credit;
      expect(await f.driver.getBankedResets()).toStrictEqual({
        status: 'ready', accountCredits: null,
        summary: { availableCount: '1', credits: [detail], detailCount: 1 },
      });
      await expect(f.driver.useBankedReset({ confirmed: true, redemptionToken: 'selection', idempotencyKey: 'attempt' })).rejects.toThrow('unsupported');
      f.snapshot.authentication.account = null;
      expect(await f.driver.getBankedResets()).toStrictEqual({ status: 'signedOut' });
      f.snapshot.authentication.account = { type: 'apiKey' };
      expect(await f.driver.getBankedResets()).toStrictEqual({ status: 'unsupported' });
      expect(f.read).toHaveBeenCalledOnce();
    } finally { await f.adapter.close(); }
  });
  it('surfaces provider and invalid-count errors rather than reporting zero', async () => {
    const f = fixture(); f.read.mockRejectedValueOnce(new Error('Provider unavailable')).mockResolvedValueOnce(limits('9.007e15', []));
    try {
      await expect(f.driver.getBankedResets()).rejects.toThrow('Provider unavailable');
      await expect(f.driver.getBankedResets()).rejects.toThrow('Invalid banked');
    } finally { await f.adapter.close(); }
  });
  it('cancels account-scoped reads and publishes authentication changes to invalidate settings', async () => {
    const f = fixture(); let resolve!: (value: CodexSurfaceRateLimits) => void;
    f.read.mockResolvedValueOnce(limits('3', [credit])).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    try {
      await f.driver.getBankedResets();
      const pending = f.driver.getBankedResets();
      const authentication = { ...f.snapshot.authentication, account: null };
      f.emit({ seq: 2, type: 'authentication.changed', origin: 'notification', occurredAt: '', payload: { authentication } });
      resolve(limits('99', [credit]));
      await expect(pending).rejects.toThrow('account changed');
      expect(f.events).toContainEqual({ backend: 'codex', type: 'provider.authenticationChanged', payload: { kind: 'codex', connected: true, state: { account: null, requiresOpenaiAuth: false, login: { status: 'idle', error: null } } }, occurredAt: '' });
    } finally { await f.adapter.close(); }
  });
  it('bounds a stalled SDK read and rejects completions after adapter disposal', async () => {
    vi.useFakeTimers(); const f = fixture();
    let resolve!: (value: CodexSurfaceRateLimits) => void;
    f.read.mockImplementation(() => new Promise(r => { resolve = r; }));
    try {
      const pending = f.driver.getBankedResets(); const failure = expect(pending).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(15_000); await failure;
      resolve(limits('3', null)); await Promise.resolve();
      const disposed = f.driver.getBankedResets(); await f.adapter.close(); resolve(limits('3', null));
      await expect(disposed).rejects.toThrow('account changed'); expect(vi.getTimerCount()).toBe(0);
    } finally { await f.adapter.close(); }
  });

  it('projects exact account credit balances independently of reset details', async () => {
    const f = fixture();
    const accountCredits = { hasCredits: true, unlimited: false, balance: '9007199254740993.25' };
    f.read.mockResolvedValue({ ...limits('3', null), rateLimits: { ...quota, credits: accountCredits } });
    try { expect(await f.driver.getBankedResets()).toStrictEqual({ status: 'ready', accountCredits, summary: { availableCount: '3', credits: null, detailCount: null } }); }
    finally { await f.adapter.close(); }
  });

  it('redeems only a confirmed account-bound selection and retains the attempt key across uncertain retries and refreshes', async () => {
    const f = fixture();
    const consume = vi.fn().mockRejectedValueOnce(new Error('Response lost')).mockResolvedValueOnce({ outcome: 'alreadyRedeemed' });
    Object.assign(f.surface, { consumeRateLimitResetCredit: consume });
    f.read.mockResolvedValue(limits('3', [credit]));
    const rpc = new BackendDriverRpc(new Map([['codex', f.driver]]));
    const use = (input: unknown) => rpc.handle('driver/codex/bankedResets/use', { input });
    try {
      const state = await f.driver.getBankedResets();
      if (state.status !== 'ready') throw new Error('Expected ready');
      const redemptionToken = state.summary!.credits![0]!.redemptionToken!;
      expect(redemptionToken).not.toBe(credit.id);
      const input = { redemptionToken, idempotencyKey: 'first-attempt', confirmed: true as const };
      await expect(use({ ...input, confirmed: false })).rejects.toThrow('confirmation');
      await expect(use({ ...input, redemptionToken: 'forged' })).rejects.toThrow('selection expired');
      expect(consume).not.toHaveBeenCalled();
      await expect(use(input)).rejects.toThrow('Response lost');
      f.read.mockResolvedValueOnce(limits('3', null));
      await f.driver.getBankedResets();
      await f.driver.getBankedResets();
      expect(await use({ ...input, idempotencyKey: 'new-ui-attempt' })).toStrictEqual({ outcome: 'alreadyRedeemed' });
      expect(consume.mock.calls).toStrictEqual([[{ creditId: credit.id, idempotencyKey: 'first-attempt' }], [{ creditId: credit.id, idempotencyKey: 'first-attempt' }]]);
      expect(f.read).toHaveBeenCalledTimes(3);
      f.snapshot.authentication.account = { ...account, email: 'other@example.test' };
      await expect(f.driver.useBankedReset(input)).rejects.toThrow('account changed');
      expect(consume).toHaveBeenCalledTimes(2);
    } finally { await f.adapter.close(); }
  });

  it.each(['reset', 'nothingToReset', 'noCredit'])('returns provider outcome %s without inferring limits or automatically re-reading', async outcome => {
    const f = fixture(); const consume = vi.fn().mockResolvedValue({ outcome });
    Object.assign(f.surface, { consumeRateLimitResetCredit: consume }); f.read.mockResolvedValue(limits('1', [credit]));
    try {
      const state = await f.driver.getBankedResets(); if (state.status !== 'ready') throw new Error('Expected ready');
      expect(await f.driver.useBankedReset({ redemptionToken: state.summary!.credits![0]!.redemptionToken!, idempotencyKey: 'attempt', confirmed: true })).toStrictEqual({ outcome });
      expect(consume).toHaveBeenCalledOnce(); expect(f.read).toHaveBeenCalledOnce();
    } finally { await f.adapter.close(); }
  });

  it('invalidates pending redemption on account changes and bounds uncertain outcomes without sending another attempt', async () => {
    vi.useFakeTimers(); const f = fixture(); let resolve!: (value: { outcome: 'reset' }) => void;
    const consume = vi.fn().mockImplementation(() => new Promise(r => { resolve = r; }));
    Object.assign(f.surface, { consumeRateLimitResetCredit: consume }); f.read.mockResolvedValue(limits('1', [credit]));
    try {
      const state = await f.driver.getBankedResets(); if (state.status !== 'ready') throw new Error('Expected ready');
      const input = { redemptionToken: state.summary!.credits![0]!.redemptionToken!, idempotencyKey: 'attempt', confirmed: true as const };
      const stalled = f.driver.useBankedReset(input); const failure = expect(stalled).rejects.toThrow('uncertain');
      await vi.advanceTimersByTimeAsync(15_000); await failure; resolve({ outcome: 'reset' });
      const pending = f.driver.useBankedReset(input);
      f.emit({ seq: 3, type: 'authentication.changed', origin: 'notification', occurredAt: '', payload: { authentication: { ...f.snapshot.authentication, account: null } } });
      resolve({ outcome: 'reset' }); await expect(pending).rejects.toThrow('account changed');
      expect(consume).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
    } finally { await f.adapter.close(); }
  });

  it('expires selections on an authoritative auth notification even when normalized account fields are unchanged', async () => {
    const f = fixture(); const consume = vi.fn();
    Object.assign(f.surface, { consumeRateLimitResetCredit: consume }); f.read.mockResolvedValue(limits('1', [credit]));
    try {
      const state = await f.driver.getBankedResets(); if (state.status !== 'ready') throw new Error('Expected ready');
      const input = { confirmed: true as const, redemptionToken: state.summary!.credits![0]!.redemptionToken!, idempotencyKey: 'attempt' };
      f.emit({ seq: 4, type: 'authentication.changed', origin: 'notification', occurredAt: '', payload: { authentication: f.snapshot.authentication } });
      await expect(f.driver.useBankedReset(input)).rejects.toThrow('selection expired'); expect(consume).not.toHaveBeenCalled();
    } finally { await f.adapter.close(); }
  });
});
