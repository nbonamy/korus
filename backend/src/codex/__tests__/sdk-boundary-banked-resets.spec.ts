import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexSurfaceRateLimits } from '@codex-app-sdk/core/surface';
import { codexSdkFixture, sdkSnapshot } from './sdk-surface-fixture';

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
      expect(result).toStrictEqual({ status: 'ready', summary: { availableCount: '9007199254740993', credits: Array(100).fill(detail), detailCount: 101 } });
    } finally { await f.adapter.close(); }
  });
  it.each([
    [null, null],
    [{ availableCount: '3', credits: null }, { availableCount: '3', credits: null, detailCount: null }],
    [{ availableCount: '0', credits: [] }, { availableCount: '0', credits: [], detailCount: 0 }],
  ])('preserves unknown/count-only/zero states %j', async (input, summary) => {
    const f = fixture(); f.read.mockResolvedValue({ rateLimits: quota, rateLimitsByLimitId: null, rateLimitResetCredits: input });
    try { expect(await f.driver.getBankedResets()).toStrictEqual({ status: 'ready', summary }); }
    finally { await f.adapter.close(); }
  });
  it('supports older SDKs and avoids reads for signed-out or non-ChatGPT accounts', async () => {
    const old = codexSdkFixture();
    try { expect(await old.driver.getBankedResets()).toStrictEqual({ status: 'unsupported' }); }
    finally { await old.adapter.close(); }
    const f = fixture();
    try {
      f.snapshot.authentication.account = null;
      expect(await f.driver.getBankedResets()).toStrictEqual({ status: 'signedOut' });
      f.snapshot.authentication.account = { type: 'apiKey' };
      expect(await f.driver.getBankedResets()).toStrictEqual({ status: 'unsupported' });
      expect(f.read).not.toHaveBeenCalled();
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
});
