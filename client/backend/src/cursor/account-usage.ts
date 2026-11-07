import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AccountRateLimits, AccountRateLimitWindow } from '@workspace/core/contracts';
import { cursorRuntime, type CursorRuntime } from './runtime';
import { record } from '../acp/acp-connection';

const run = promisify(execFile);
const unavailable = 'Could not refresh Cursor usage. Check your Cursor subscription login.';

/** Native login remains owned by Cursor. Read in place; never store or expose its token. */
async function token(runtime: CursorRuntime): Promise<string | null> {
  try {
    if (platform() === 'darwin' && !runtime.isolated) {
      const { stdout } = await run('/usr/bin/security', ['find-generic-password', '-s', 'cursor-access-token', '-a', 'cursor-user', '-w'], { timeout: 5_000, maxBuffer: 64 * 1024 });
      return stdout.trim() || null;
    }
    // Saved private contexts retain their credential reader; new private setup is unavailable.
    // The native credential library uses OS paths, independently of CURSOR_CONFIG_DIR.
    const env = runtime.environment;
    const home = env.HOME || homedir();
    const file = platform() === 'darwin' ? path.join(home, '.cursor', 'auth.json') : platform() === 'win32'
      ? path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cursor', 'auth.json')
      : path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'cursor', 'auth.json');
    const raw = await readFile(file, 'utf8');
    if (Buffer.byteLength(raw) > 64 * 1024) throw new Error();
    const value: unknown = JSON.parse(raw);
    return record(value) && typeof value.accessToken === 'string' && value.accessToken.trim() ? value.accessToken.trim() : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || (error as { code?: unknown }).code === 44) return null;
    throw new Error('Could not read the Cursor login for usage.');
  }
}

export async function getCursorAccountUsage(runtime: CursorRuntime = cursorRuntime()): Promise<AccountRateLimits | null> {
  const accessToken = await token(runtime);
  if (!accessToken) return null;
  async function query(method: string): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(`https://api2.cursor.sh/aiserver.v1.DashboardService/${method}`, {
        method: 'POST', body: '{}', redirect: 'error', signal: AbortSignal.timeout(5_000),
        headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error();
      const text = await response.text();
      if (Buffer.byteLength(text) > 64 * 1024) throw new Error();
      const result: unknown = JSON.parse(text);
      if (!record(result)) throw new Error();
      return result;
    } catch { throw new Error(unavailable); }
  }
  const [usage, hard, plan] = await Promise.all([query('GetCurrentPeriodUsage'), query('GetHardLimit'), query('GetPlanInfo')]);
  if (await token(runtime) !== accessToken) throw new Error('Cursor account changed. Refresh usage.');
  for (const key of ['noUsageBasedAllowed', 'onDemandSpendDisabledByOrganization']) {
    if (hard[key] !== undefined && typeof hard[key] !== 'boolean') throw new Error(unavailable);
  }
  const included = record(usage.planUsage) ? usage.planUsage : null;
  const spend = record(usage.spendLimitUsage) ? usage.spendLimitUsage : null;
  const info = record(plan.planInfo) ? plan.planInfo : null;
  const start = timestamp(usage.billingCycleStart), end = timestamp(usage.billingCycleEnd);
  const duration = start !== null && end !== null && end > start ? (end - start) / 60_000 : null;
  const includedLimit = included ? amount(included.limit) : null;
  const includedUsed = included ? amount(included.totalSpend) : null;
  const remaining = included ? amount(included.remaining) : null;
  const individualLimit = spend && spend.individualLimit !== undefined ? amount(spend.individualLimit) : null;
  const hardLimit = amount(hard.hardLimit);
  const limit = individualLimit ?? (spend?.limitType !== 'team' ? hardLimit * 100 : null);
  const used = spend ? amount(spend.individualUsed) : null;
  const billingAllowed = hard.noUsageBasedAllowed !== true && hard.onDemandSpendDisabledByOrganization !== true;
  const unlimited = billingAllowed && spend?.limitType === 'team' && individualLimit === null && hardLimit > 0;
  const enabled = billingAllowed && (unlimited || (limit !== null && limit > 0));
  const onDemand = { enabled, unlimited, usedUsd: used === null ? null : used / 100, limitUsd: limit === null ? null : limit / 100,
    remainingUsd: enabled && used !== null && limit !== null ? Math.max(0, limit - used) / 100 : enabled ? null : 0 };
  function window(label: string, used: number | null, limit: number | null, percent?: unknown): AccountRateLimitWindow | null {
    if (used === null || limit === null || limit <= 0) return null;
    if (percent !== undefined && (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0)) throw new Error(unavailable);
    return { label, usedPercent: typeof percent === 'number' ? percent : used / limit * 100, windowDurationMins: duration, resetsAt: end === null ? null : end / 1000 };
  }
  return {
    limitId: 'cursor', limitName: null,
    primary: window('Included', includedUsed, includedLimit, included?.totalPercentUsed),
    secondary: enabled ? window('On-demand', used, limit) : null,
    credits: remaining === null ? null : { hasCredits: remaining > 0, unlimited: false, balance: (remaining / 100).toFixed(2) },
    individualLimit: onDemand,
    billing: { includedBalanceUsd: remaining === null ? null : (remaining / 100).toFixed(2), onDemand },
    planType: typeof info?.planName === 'string' ? info.planName.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 100) || null : null,
    rateLimitReachedType: null,
  };
}

/** Protobuf JSON omits default-valued scalars. Only callers with a present bucket use defaults. */
function amount(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1e12) throw new Error(unavailable);
  return value;
}
function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number > 0 && number <= 8_640_000_000_000_000 ? number : null;
}
