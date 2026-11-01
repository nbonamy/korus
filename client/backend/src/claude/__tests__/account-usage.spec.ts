import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClaudeAccountUsage } from '../account-usage';

const io = vi.hoisted(() => ({ keychain: vi.fn(), readFile: vi.fn(), platform: vi.fn(), fetch: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: Object.assign(() => undefined, {
  [Symbol.for('nodejs.util.promisify.custom')]: io.keychain,
}) }));
vi.mock('node:fs/promises', () => ({ readFile: io.readFile }));
vi.mock('node:os', () => ({ platform: io.platform, homedir: () => '/home/user', userInfo: () => ({ username: 'user' }) }));

const credentials = { claudeAiOauth: { accessToken: 'test-only-token', scopes: ['user:inference', 'user:profile'], expiresAt: 4_000_000_000_000 } };
beforeEach(() => {
  vi.resetAllMocks();
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR']) vi.stubEnv(key, undefined);
  vi.stubEnv('CLAUDE_CONFIG_DIR', '/tmp/claude-usage-home');
  io.platform.mockReturnValue('darwin');
  io.keychain.mockResolvedValue({ stdout: JSON.stringify(credentials) });
  io.readFile.mockRejectedValue(Object.assign(new Error('absent'), { code: 'ENOENT' }));
  io.fetch.mockResolvedValue(new Response(JSON.stringify({ five_hour: { utilization: 1, resets_at: '2026-10-03T03:00:00Z' }, seven_day: { utilization: 0, resets_at: null } })));
  vi.stubGlobal('fetch', io.fetch);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Claude subscription usage', () => {
  it('reads the configured home login and returns quota without exposing credentials or multiplying API percentages', async () => {
    const result = await getClaudeAccountUsage();
    expect(result).toMatchObject({ primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: 1_790_996_400 }, secondary: { usedPercent: 0, windowDurationMins: 10_080, resetsAt: null } });
    expect(JSON.stringify(result)).not.toContain('test-only-token');
    expect(io.keychain).toHaveBeenCalledWith('/usr/bin/security', expect.arrayContaining(['Claude Code-credentials-d7485453']), expect.anything());
    expect(io.fetch).toHaveBeenCalledWith('https://api.anthropic.com/api/oauth/usage', expect.objectContaining({ redirect: 'error', headers: { Authorization: 'Bearer test-only-token', 'anthropic-beta': 'oauth-2025-04-20' } }));
    expect(io.readFile).not.toHaveBeenCalled();
  });

  it('uses the unsuffixed keychain service for the default home', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/home/user/.claude');
    await getClaudeAccountUsage();
    expect(io.keychain).toHaveBeenCalledWith('/usr/bin/security', expect.arrayContaining(['Claude Code-credentials']), expect.anything());
  });

  it.each(['linux', 'win32'])('uses Claude’s credential file on %s', async platform => {
    io.platform.mockReturnValue(platform);
    io.readFile.mockResolvedValue(JSON.stringify(credentials));
    expect((await getClaudeAccountUsage())?.primary?.usedPercent).toBe(1);
    expect(io.keychain).not.toHaveBeenCalled();
    expect(io.readFile).toHaveBeenCalledWith('/tmp/claude-usage-home/.credentials.json', 'utf8');
  });

  it('falls back to the configured credential file when keychain storage is unavailable', async () => {
    io.keychain.mockRejectedValue(Object.assign(new Error('private keychain error'), { code: 44 }));
    io.readFile.mockResolvedValue(JSON.stringify(credentials));
    expect((await getClaudeAccountUsage())?.primary?.usedPercent).toBe(1);
  });

  it.each(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'])('does not fetch subscription quota for %s billing', async key => {
    vi.stubEnv(key, '1');
    await expect(getClaudeAccountUsage()).resolves.toBeNull();
    expect(io.keychain).not.toHaveBeenCalled();
    expect(io.fetch).not.toHaveBeenCalled();
  });

  it.each([{}, { claudeAiOauth: { accessToken: 'console-token', scopes: ['user:profile'] } }])('does not fetch for non-subscription credentials %j', async value => {
    io.keychain.mockResolvedValue({ stdout: JSON.stringify(value) });
    await expect(getClaudeAccountUsage()).resolves.toBeNull();
    expect(io.fetch).not.toHaveBeenCalled();
  });

  it('distinguishes an absent login from inaccessible credentials without leaking diagnostics', async () => {
    io.keychain.mockRejectedValue(Object.assign(new Error('test-only-secret'), { code: 44 }));
    await expect(getClaudeAccountUsage()).resolves.toBeNull();
    io.keychain.mockRejectedValue(new Error('test-only-secret'));
    await expect(getClaudeAccountUsage()).rejects.toThrow('Could not read the Claude login for usage.');
    expect(io.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...credentials.claudeAiOauth, expiresAt: 1 }, 'Your Claude login has expired'],
    [{ ...credentials.claudeAiOauth, scopes: ['user:inference'] }, 'profile access'],
  ])('rejects unusable subscription credentials without sending them', async (oauth, message) => {
    io.keychain.mockResolvedValue({ stdout: JSON.stringify({ claudeAiOauth: oauth }) });
    await expect(getClaudeAccountUsage()).rejects.toThrow(message as string);
    expect(io.fetch).not.toHaveBeenCalled();
  });

  it('sanitizes HTTP, transport, and malformed-response failures', async () => {
    io.fetch.mockResolvedValueOnce(new Response('private response', { status: 401 }));
    await expect(getClaudeAccountUsage()).rejects.toThrow('Could not refresh Claude usage. Check your Claude subscription login.');
    io.fetch.mockRejectedValueOnce(new Error('test-only-secret'));
    await expect(getClaudeAccountUsage()).rejects.toThrow('Could not refresh Claude usage.');
    io.fetch.mockResolvedValueOnce(new Response('not json'));
    await expect(getClaudeAccountUsage()).rejects.toThrow('Claude returned invalid usage data.');
  });
});
