import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createBackendDriver } from '../../driver-rpc';

const io = vi.hoisted(() => ({ keychain: vi.fn(), readFile: vi.fn(), platform: vi.fn(), fetch: vi.fn() }));
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), execFile: Object.assign(() => undefined, {
  [Symbol.for('nodejs.util.promisify.custom')]: io.keychain,
}) }));
vi.mock('node:fs/promises', async original => ({ ...await original<typeof import('node:fs/promises')>(), readFile: io.readFile }));
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), platform: io.platform, homedir: () => '/fixture-home' }));

beforeEach(() => {
  vi.resetAllMocks();
  io.platform.mockReturnValue('darwin');
  io.keychain.mockResolvedValue({ stdout: 'synthetic-native-token\n' });
  vi.stubEnv('XDG_CONFIG_HOME', undefined); vi.stubEnv('APPDATA', undefined);
  vi.stubGlobal('fetch', io.fetch);
  io.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(url.endsWith('/GetPlanInfo')
    ? { planInfo: { planName: 'Pro', includedAmountCents: 2000 } }
    : url.endsWith('/GetHardLimit') ? { hardLimit: 50 }
      : { billingCycleStart: '1793491200000', billingCycleEnd: '1796083200000',
        planUsage: { totalSpend: 500, limit: 2000, remaining: 1500, totalPercentUsed: 25 },
        spendLimitUsage: { individualLimit: 5000, individualUsed: 100, individualRemaining: 4900, limitType: 'user' } })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('reads native subscription balance and billing-cycle quota through the driver without a model turn or credential exposure', async () => {
  const driver = createBackendDriver('cursor');
  try {
    expect(driver.getAccountRateLimits).toBeTypeOf('function');
    const result = await driver.getAccountRateLimits!();
    expect(result).toMatchObject({
      limitId: 'cursor', planType: 'Pro', primary: { label: 'Included', usedPercent: 25, resetsAt: 1796083200, windowDurationMins: 43200 },
      secondary: { label: 'On-demand', usedPercent: 2 },
      credits: { hasCredits: true, unlimited: false, balance: '15.00' },
      individualLimit: { enabled: true, usedUsd: 1, limitUsd: 50, remainingUsd: 49 },
      billing: { includedBalanceUsd: '15.00', onDemand: { enabled: true, unlimited: false, usedUsd: 1, limitUsd: 50, remainingUsd: 49 } },
    });
    expect(JSON.stringify(result)).not.toContain('synthetic-native-token');
    for (const [url, options] of io.fetch.mock.calls) {
      expect(url).toMatch(/^https:\/\/api2\.cursor\.sh\/aiserver\.v1\.DashboardService\/Get/);
      expect(options).toMatchObject({ method: 'POST', body: '{}', redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer synthetic-native-token' }) });
    }
  } finally { await driver.close(); }
});

it('preserves Free and disabled usage-based billing without representing zero allowance as unlimited quota', async () => {
  io.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(url.endsWith('/GetPlanInfo')
    ? { planInfo: { planName: 'Free', price: 'Free' } }
    : url.endsWith('/GetHardLimit') ? { noUsageBasedAllowed: true }
      : { planUsage: { totalPercentUsed: 0 }, spendLimitUsage: { individualLimit: 0, limitType: 'user' } })));
  const driver = createBackendDriver('cursor');
  try {
    expect(await driver.getAccountRateLimits!()).toMatchObject({
      planType: 'Free', primary: null, secondary: null,
      credits: { hasCredits: false, unlimited: false, balance: '0.00' },
      individualLimit: { enabled: false, limitUsd: 0 },
      billing: { includedBalanceUsd: '0.00', onDemand: { enabled: false, unlimited: false, usedUsd: 0, limitUsd: 0, remainingUsd: 0 } },
    });
  } finally { await driver.close(); }
});

it.each([401, 403, 429, 500])('sanitizes native HTTP %s without returning a misleading empty balance', async status => {
  io.fetch.mockResolvedValue(new Response('private native error', { status }));
  const driver = createBackendDriver('cursor');
  try { await expect(driver.getAccountRateLimits!()).rejects.toThrow('Could not refresh Cursor usage'); }
  finally { await driver.close(); }
});

it('distinguishes signed out from inaccessible credentials without forwarding native diagnostics', async () => {
  const driver = createBackendDriver('cursor');
  try {
    io.keychain.mockRejectedValueOnce(Object.assign(new Error('private'), { code: 44 }));
    await expect(driver.getAccountRateLimits!()).resolves.toBeNull();
    io.keychain.mockRejectedValueOnce(new Error('private'));
    await expect(driver.getAccountRateLimits!()).rejects.toThrow('Could not read the Cursor login for usage.');
    expect(io.fetch).not.toHaveBeenCalled();
  } finally { await driver.close(); }
});

it('discards billing results when the native account changes during the read', async () => {
  io.keychain.mockResolvedValueOnce({ stdout: 'old-account-token' }).mockResolvedValueOnce({ stdout: 'new-account-token' });
  const driver = createBackendDriver('cursor');
  try { await expect(driver.getAccountRateLimits!()).rejects.toThrow('Cursor account changed. Refresh usage.'); }
  finally { await driver.close(); }
});

it.each(['linux', 'win32'])('reads the native credential location on %s, not the redirected config directory', async platform => {
  io.platform.mockReturnValue(platform);
  vi.stubEnv('CURSOR_CONFIG_DIR', '/different-config');
  io.readFile.mockResolvedValue(JSON.stringify({ accessToken: 'synthetic-native-token' }));
  const driver = createBackendDriver('cursor');
  try {
    expect((await driver.getAccountRateLimits!())?.planType).toBe('Pro');
    expect(io.readFile).toHaveBeenCalledWith(platform === 'linux' ? '/fixture-home/.config/cursor/auth.json' : '/fixture-home/AppData/Roaming/Cursor/auth.json', 'utf8');
    expect(io.keychain).not.toHaveBeenCalled();
  } finally { await driver.close(); }
});

it('does not turn a pooled team allowance into a personal spend limit or disable unlimited personal usage', async () => {
  io.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(url.endsWith('/GetPlanInfo')
    ? { planInfo: { planName: 'Teams' } }
    : url.endsWith('/GetHardLimit') ? { hardLimit: 500 }
      : { spendLimitUsage: { pooledLimit: '50000', pooledRemaining: '45000', individualUsed: 200, limitType: 'team' } })));
  const driver = createBackendDriver('cursor');
  try {
    expect(await driver.getAccountRateLimits!()).toMatchObject({
      planType: 'Teams', primary: null, secondary: null, credits: null,
      individualLimit: { enabled: true, unlimited: true, usedUsd: 2, limitUsd: null, remainingUsd: null },
    });
  } finally { await driver.close(); }
});

it.each([[], { planUsage: { limit: -1 } }, { planUsage: { limit: 100, totalPercentUsed: '25' } }])('rejects invalid usage data without manufacturing balance %j', async invalid => {
  const normal = io.fetch.getMockImplementation()!;
  io.fetch.mockImplementation((url: string) => url.endsWith('/GetCurrentPeriodUsage') ? new Response(JSON.stringify(invalid)) : normal(url));
  const driver = createBackendDriver('cursor');
  try { await expect(driver.getAccountRateLimits!()).rejects.toThrow('Could not refresh Cursor usage'); }
  finally { await driver.close(); }
});

it('rejects an unrecognized native billing switch instead of showing pay-as-you-go as enabled', async () => {
  const normal = io.fetch.getMockImplementation()!;
  io.fetch.mockImplementation((url: string) => url.endsWith('/GetHardLimit') ? new Response(JSON.stringify({ hardLimit: 50, noUsageBasedAllowed: 'true' })) : normal(url));
  const driver = createBackendDriver('cursor');
  try { await expect(driver.getAccountRateLimits!()).rejects.toThrow('Could not refresh Cursor usage'); }
  finally { await driver.close(); }
});
