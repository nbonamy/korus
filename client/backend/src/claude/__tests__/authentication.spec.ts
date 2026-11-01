import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalClaudeAuthentication } from '../authentication';
import { ClaudeBackendDriver } from '../claude-driver';
import { homedir } from 'node:os';
import path from 'node:path';

const cli = vi.hoisted(() => ({ bundled: false, stdout: '', error: null as null | { code: number | string }, calls: vi.fn() }));
vi.mock('node:child_process', () => ({
  execFile: Object.assign(() => undefined, {
    [Symbol.for('nodejs.util.promisify.custom')]: async (command: string, args: string[], options: unknown) => {
      cli.calls(command, args, options);
      if (cli.error) throw Object.assign(new Error('private CLI diagnostic'), cli.error, { stdout: cli.stdout });
      return { stdout: cli.stdout, stderr: 'private account' };
    },
  }),
}));
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(), existsSync: (file: string) => cli.bundled && file === '/app/resources/claude/claude' }));
vi.mock('@workspace/core/runtime-discovery', () => ({ resolveRuntimeLaunch: (command: string, env: unknown) => ({ command, env: { ...(env as object), ...(cli.bundled ? { APP_ASSETS_PATH: process.env.APP_ASSETS_PATH } : {}) } }) }));

beforeEach(() => { cli.error = null; cli.calls.mockClear(); });

describe('local Claude authentication', () => {
  it.each(['/tmp/app-auth-home', path.join(homedir(), '.claude')])('logs out through the CLI in the selected home: %s', async (directory) => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', directory);
    vi.stubEnv('APP_CLAUDE_COMMAND', '/custom/bin/claude');
    cli.stdout = 'Logged out';
    const driver = new ClaudeBackendDriver();
    try {
      const configDirectory = directory === path.join(homedir(), '.claude') ? null : directory;
      await expect(driver.authenticate({ action: 'logout' })).resolves.toEqual({
        kind: 'claude', connected: false, state: { loggedIn: false, configDirectory, executablePath: '/custom/bin/claude' },
      });
      expect(cli.calls).toHaveBeenCalledExactlyOnceWith('/custom/bin/claude', ['auth', 'logout'], expect.objectContaining({
        env: { CLAUDE_CONFIG_DIR: configDirectory ?? undefined }, timeout: 15_000,
      }));
    } finally { await driver.close(); vi.unstubAllEnvs(); }
  });

  it('reports failed logout without exposing CLI output or pretending to disconnect', async () => {
    cli.error = { code: 1 };
    const driver = new ClaudeBackendDriver();
    try {
      await expect(driver.authenticate({ action: 'logout' })).rejects.toThrow('Could not sign out of Claude Code. Please try again.');
    } finally { await driver.close(); }
  });

  it('leaves the default home implicit so Claude can find the normal login', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', path.join(homedir(), '.claude'));
    cli.stdout = JSON.stringify({ loggedIn: true });
    try {
      await expect(getLocalClaudeAuthentication()).resolves.toStrictEqual({ loggedIn: true, configDirectory: null });
      expect(cli.calls.mock.calls[0]![2].env.CLAUDE_CONFIG_DIR).toBeUndefined();
    } finally { vi.unstubAllEnvs(); }
  });

  it.each([true, false])('returns only login state and the configured home, loggedIn=%s', async (loggedIn) => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/tmp/app-auth-home');
    cli.stdout = JSON.stringify({ loggedIn, email: 'private', accessToken: 'private' });
    if (!loggedIn) cli.error = { code: 1 };
    await expect(getLocalClaudeAuthentication()).resolves.toStrictEqual({ loggedIn, configDirectory: '/tmp/app-auth-home' });
    expect(cli.calls).toHaveBeenCalledWith(expect.any(String), ['auth', 'status', '--json'], expect.objectContaining({ env: { CLAUDE_CONFIG_DIR: '/tmp/app-auth-home' } }));
    vi.unstubAllEnvs();
  });

  it.each([
    { metadata: { authMethod: 'claude.ai', email: 'user@example.com', subscriptionType: 'max' }, account: { type: 'subscription', email: 'user@example.com', subscription: 'max' } },
    { metadata: { authMethod: 'claude.ai', email: null, subscriptionType: null }, account: { type: 'subscription' } },
    { metadata: { authMethod: 'api_key', email: 'private' }, account: { type: 'apiKey' } },
  ])('exposes safe account metadata for $metadata.authMethod without credentials or organization details', async ({ metadata, account }) => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/tmp/app-auth-home');
    cli.stdout = JSON.stringify({ loggedIn: true, ...metadata, accessToken: 'secret', orgId: 'private' });
    try {
      await expect(getLocalClaudeAuthentication()).resolves.toStrictEqual({ loggedIn: true, configDirectory: '/tmp/app-auth-home', account });
    } finally { vi.unstubAllEnvs(); }
  });

  it.each(['invalid json', '{"loggedIn":"yes"}'])('rejects malformed status without exposing raw output', async (output) => {
    cli.stdout = output;
    await expect(getLocalClaudeAuthentication()).rejects.toThrow('invalid authentication status');
  });

  it('reports missing CLI safely instead of treating the connection as signed out', async () => {
    cli.error = { code: 'ENOENT' };
    await expect(getLocalClaudeAuthentication()).rejects.toThrow('Make sure Claude Code is installed');
  });
});


it('checks authentication with the bundled runtime and exposes its path for sign-in', async () => {
  cli.bundled = true;
  vi.stubEnv('APP_CLAUDE_COMMAND', '');
  vi.stubEnv('APP_ASSETS_PATH', '/app/resources');
  vi.stubEnv('CLAUDE_CONFIG_DIR', '/app/claude-home');
  cli.stdout = JSON.stringify({ loggedIn: false });
  try {
    await expect(getLocalClaudeAuthentication()).resolves.toStrictEqual({ loggedIn: false, configDirectory: '/app/claude-home', executablePath: '/app/resources/claude/claude' });
    expect(cli.calls).toHaveBeenCalledWith('/app/resources/claude/claude', ['auth', 'status', '--json'], expect.any(Object));
  } finally { cli.bundled = false; vi.unstubAllEnvs(); }
});
