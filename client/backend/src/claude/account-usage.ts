import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { platform, userInfo } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AccountRateLimits, AccountRateLimitWindow } from '@workspace/core/contracts';
import { claudeConfigDirectory, claudeConfigDirectoryOverride } from './config-directory';

const run = promisify(execFile);

/** Read Claude's own login in place. Never copy, persist, return, or log credentials. */
async function readCredentials(): Promise<Record<string, unknown> | null> {
  let keychainFailed = false;
  if (platform() === 'darwin') {
    const override = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? claudeConfigDirectoryOverride();
    const suffix = override ? `-${createHash('sha256').update(override.normalize('NFC')).digest('hex').slice(0, 8)}` : '';
    try {
      const { stdout } = await run('/usr/bin/security', ['find-generic-password', '-a', process.env.USER || userInfo().username, '-s', `Claude Code-credentials${suffix}`, '-w'], { timeout: 5_000, maxBuffer: 1024 * 1024 });
      const credentials: unknown = JSON.parse(stdout);
      if (isRecord(credentials)) return credentials;
    } catch (error) {
      keychainFailed = (error as { code?: unknown }).code !== 44;
    }
  }
  try {
    const credentials: unknown = JSON.parse(await readFile(path.join(claudeConfigDirectory(), '.credentials.json'), 'utf8'));
    if (isRecord(credentials)) return credentials;
    throw new Error();
  } catch (error) {
    if (!keychainFailed && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('Could not read the Claude login for usage.');
  }
}

export async function getClaudeAccountUsage(): Promise<AccountRateLimits | null> {
  // API and third-party billing have no Claude subscription quota.
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
    || ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'].some(key => ['1', 'true'].includes(process.env[key] ?? ''))) return null;
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR) {
    throw new Error('Claude usage requires a subscription login with profile access.');
  }
  const oauth = (await readCredentials())?.claudeAiOauth;
  if (!isRecord(oauth) || typeof oauth.accessToken !== 'string' || !oauth.accessToken) return null;
  if (!Array.isArray(oauth.scopes) || !oauth.scopes.includes('user:inference')) return null;
  if (!oauth.scopes.includes('user:profile')) throw new Error('Claude usage requires a subscription login with profile access.');
  if (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= Date.now()) {
    throw new Error('Your Claude login has expired. Reconnect Claude to refresh usage.');
  }
  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${oauth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
      redirect: 'error', signal: AbortSignal.timeout(5_000),
    });
  } catch { throw new Error('Could not refresh Claude usage.'); }
  if (!response.ok) throw new Error('Could not refresh Claude usage. Check your Claude subscription login.');
  let usage: unknown;
  try { usage = await response.json(); } catch { throw new Error('Claude returned invalid usage data.'); }
  if (!isRecord(usage)) throw new Error('Claude returned invalid usage data.');
  return {
    limitId: 'claude', limitName: null,
    primary: windowFromUsage(usage.five_hour, 300),
    secondary: windowFromUsage(usage.seven_day, 10_080),
    credits: null, individualLimit: null, planType: null, rateLimitReachedType: null,
  };
}

function windowFromUsage(value: unknown, duration: number): AccountRateLimitWindow | null {
  if (!isRecord(value) || typeof value.utilization !== 'number' || !Number.isFinite(value.utilization) || value.utilization < 0) return null;
  const reset = typeof value.resets_at === 'string' ? Date.parse(value.resets_at) : NaN;
  return { usedPercent: value.utilization, windowDurationMins: duration, resetsAt: Number.isFinite(reset) ? reset / 1000 : null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
