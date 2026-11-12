import { describe, expect, it, vi } from 'vitest';
import { ProviderUpdateRuntime } from '../provider-update-runtime';

function fixture(resolved: string, options: Partial<ConstructorParameters<typeof ProviderUpdateRuntime>[0]> = {}) {
  const run = vi.fn(async (_file: string, args: string[]) => {
    if (args[0] === '--version') return 'codex-cli 1.0.0';
    if (args[1] === 'root') return '/tools/lib/node_modules';
    if (args[0] === '--prefix') return '/brew';
    if (args[0] === 'info') return JSON.stringify({ casks: [{ token: 'claude-code', version: '1.1.0' }, { token: 'codex', version: '1.2.0' }] });
    return '';
  });
  const fetchText = vi.fn(async () => JSON.stringify({ version: '1.2.0' }));
  const read = vi.fn(async () => JSON.stringify({ name: '@openai/codex' }));
  const realpath = vi.fn(async (file: string) => file === '/tools/bin/npm' ? '/tools/lib/node_modules/npm/bin/npm-cli.js' : file.startsWith('/tools/lib/') ? file : resolved);
  const runtime = new ProviderUpdateRuntime({ command: provider => provider, claudeHome: () => '/user/.claude', ...options }, {
    home: '/user', platform: 'darwin',
    resolve: command => command === '/tools/bin/node' ? command : command === 'npm' ? '/tools/bin/npm' : command === 'brew' ? '/brew/bin/brew' : `/user/.local/bin/${command}`,
    realpath,
    run, read, fetchText,
  });
  return { runtime, run, read, fetchText, realpath };
}

describe('installed provider updates', () => {
  it.each([
    { cliVersion: '2026.11.05-old', latestStatus: 'up_to_date', status: 'current' },
    { cliVersion: '2026.11.05-old', latestStatus: 'outdated', latestVersion: '2026.11.05-new', status: 'available' },
    { cliVersion: '2026.11.05-old', latestStatus: 'outdated', latestVersion: '2026.11.04-old', status: 'current' },
    { cliVersion: '2026.11.05-old', latestStatus: 'unavailable', status: 'manual' },
  ])('normalizes Cursor native build observation to $status ($latestStatus, $latestVersion)', async ({ status, ...about }) => {
    const f = fixture('/cursor/versions/current/cursor-agent');
    f.run.mockResolvedValue(JSON.stringify(about));
    expect(await f.runtime.inspect('cursor')).toMatchObject({ status });
    expect(f.run).toHaveBeenCalledExactlyOnceWith('/user/.local/bin/agent', ['about', '--format', 'json'], 15_000, expect.any(Object));
    expect(f.fetchText).not.toHaveBeenCalled();
  });

  it('observes a saved private Cursor home without allowing its updater to install a second CLI', async () => {
    const home = { homePath: '/private/cursor/.cursor', isolated: true, shareSkills: false };
    const f = fixture('/cursor/versions/current/cursor-agent', { cursorHome: () => home });
    f.run.mockResolvedValue(JSON.stringify({ cliVersion: '2026.10.22-old', latestStatus: 'outdated', latestVersion: '2026.11.03-new' }));
    const installation = await f.runtime.inspect('cursor');
    expect(installation).toMatchObject({ status: 'available', command: undefined });
    expect(f.run).toHaveBeenCalledExactlyOnceWith('/user/.local/bin/agent', ['about', '--format', 'json'], 15_000,
      expect.objectContaining({ HOME: '/private/cursor', CURSOR_CONFIG_DIR: home.homePath, NO_OPEN_BROWSER: '1' }));
    await expect(f.runtime.upgrade({ ...installation, command: { file: installation.executable!, args: ['update'] } })).rejects.toThrow('Manual');
    expect(f.run).toHaveBeenCalledTimes(1);
  });
  it('checks Cursor about through its native executable and upgrades only with the native command', async () => {
    const f = fixture('/cursor/versions/current/cursor-agent');
    f.run.mockImplementation(async (_file, args) => args[0] === 'about'
      ? JSON.stringify({ cliVersion: '2026.10.22-27dcf5f', latestVersion: '2026.11.03-abcdef', latestStatus: 'outdated' })
      : '');
    const installation = await f.runtime.inspect('cursor');
    expect(installation).toMatchObject({
      status: 'available', method: 'native', version: '2026.10.22-27dcf5f', latestVersion: '2026.11.03-abcdef',
      command: { file: '/user/.local/bin/agent', args: ['update'] },
    });
    expect(f.run.mock.calls.map(([, args]) => args)).toStrictEqual([['about', '--format', 'json']]);
    expect(f.read).not.toHaveBeenCalled();
    expect(f.fetchText).not.toHaveBeenCalled();
    await f.runtime.upgrade(installation);
    expect(f.run).toHaveBeenLastCalledWith('/user/.local/bin/agent', ['update'], 300_000, expect.objectContaining({ NO_OPEN_BROWSER: '1' }));
  });
  it.each([
    { installed: '1.5.6', latest: '1.5.7', status: 'available' },
    { installed: '1.5.7', latest: '1.5.7', status: 'current' },
    { installed: '1.6.0', latest: '1.5.7', status: 'current' },
    { installed: 'nightly', latest: '1.5.7', status: 'manual' },
  ])('compares the installed Antigravity CLI $installed with the latest release $latest: $status', async ({ installed, latest, status }) => {
    const f = fixture('/user/.local/bin/agy');
    f.run.mockImplementation(async (_file, args) => args[0] === '--version' ? `${installed}\n` : '');
    f.fetchText.mockResolvedValue(JSON.stringify({ version: latest, url: 'https://example.invalid/cli.tar.gz', sha512: 'x' }));
    const installation = await f.runtime.inspect('antigravity');
    expect(installation).toMatchObject({ status, provider: 'antigravity', method: 'native', executable: '/user/.local/bin/agy', version: installed, latestVersion: latest });
    // The release list is the one the CLI's own installer reads, for this machine's platform.
    expect(f.fetchText).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\/manifests\/darwin_(arm64|amd64)\.json$/));
    if (status === 'available') {
      expect(installation.command).toStrictEqual({ file: '/user/.local/bin/agy', args: ['update'] });
      await f.runtime.upgrade(installation);
      expect(f.run).toHaveBeenLastCalledWith('/user/.local/bin/agy', ['update'], 300_000);
    } else expect(installation.command).toBeUndefined();
  });
  it('reports Antigravity as unavailable when its CLI is not installed, without looking anything up', async () => {
    const f = new ProviderUpdateRuntime({ command: provider => provider, claudeHome: () => '/user/.claude' }, { home: '/user', platform: 'darwin', resolve: () => null, run: vi.fn(), read: vi.fn(), fetchText: vi.fn(), realpath: vi.fn() });
    expect(await f.inspect('antigravity')).toMatchObject({ status: 'unavailable', method: 'manual' });
  });
  it('checks and upgrades npm through its owning Node instead of the packaged Node on PATH', async () => {
    const f = fixture('/tools/lib/node_modules/@openai/codex/bin/codex.js');
    f.run.mockImplementation(async (file, args) => {
      if (args[0] === '--version') return 'codex-cli 1.0.0';
      // npm derives its default global prefix from the Node that executes it.
      if (file === '/tools/bin/npm' && args[0] === 'root') return '/app/resources/lib/node_modules';
      if (file === '/tools/bin/node' && args[1] === 'root') return '/tools/lib/node_modules';
      return '';
    });
    const installation = await f.runtime.inspect('codex');
    expect(installation).toMatchObject({ status: 'available', method: 'npm', version: '1.0.0', latestVersion: '1.2.0' });
    await f.runtime.upgrade(installation);
    expect(f.run).toHaveBeenLastCalledWith('/tools/bin/node', ['/tools/lib/node_modules/npm/bin/npm-cli.js', 'install', '-g', '@openai/codex@1.2.0'], 300_000, expect.any(Object));
  });

  it('uses the package manager owning the resolved executable and pins the checked target', async () => {
    const f = fixture('/tools/lib/node_modules/@openai/codex/bin/codex.js');
    const installation = await f.runtime.inspect('codex');
    expect(installation).toMatchObject({ method: 'npm', version: '1.0.0', latestVersion: '1.2.0' });
    expect(f.run.mock.calls.some(([, args]) => args.includes('install'))).toBe(false);
    await f.runtime.upgrade(installation);
    expect(f.run).toHaveBeenLastCalledWith('/tools/bin/node', ['/tools/lib/node_modules/npm/bin/npm-cli.js', 'install', '-g', '@openai/codex@1.2.0'], 300_000, expect.any(Object));
  });

  it('keeps a different npm prefix manual rather than upgrading an unrelated global installation', async () => {
    const f = fixture('/other/lib/node_modules/@openai/codex/bin/codex.js');
    const installation = await f.runtime.inspect('codex');
    expect(installation).toMatchObject({ method: 'manual', command: undefined });
    await expect(f.runtime.upgrade(installation)).rejects.toThrow('Manual');
  });

  it('updates an SSH-installed user-local Codex in the same prefix even when Node has another global root', async () => {
    const root = '/user/.local/lib/node_modules/@openai/codex';
    const f = fixture(`${root}/bin/codex.js`);
    f.realpath.mockImplementation(async file => file === root ? root : file === '/user/.local/bin/codex' ? `${root}/bin/codex.js` : file === '/tools/bin/npm' ? '/tools/lib/node_modules/npm/bin/npm-cli.js' : file);
    const installation = await f.runtime.inspect('codex');
    expect(installation.method).toBe('npm');
    await f.runtime.upgrade(installation);
    expect(f.run).toHaveBeenLastCalledWith('/tools/bin/node', ['/tools/lib/node_modules/npm/bin/npm-cli.js', 'install', '-g', '--prefix', '/user/.local', '@openai/codex@1.2.0'], 300_000, expect.any(Object));
  });

  it('uses Homebrew availability rather than npm latest and preserves the stable cask', async () => {
    const f = fixture('/brew/Caskroom/claude-code/1.0.0/claude');
    const installation = await f.runtime.inspect('claude');
    expect(installation).toMatchObject({ method: 'homebrew', channel: 'stable', latestVersion: '1.1.0' });
    expect(f.fetchText).not.toHaveBeenCalled();
    await f.runtime.upgrade(installation);
    expect(f.run).toHaveBeenLastCalledWith('/brew/bin/brew', ['upgrade', '--cask', 'claude-code'], 300_000, expect.any(Object));
  });

  it('respects the native Claude release channel and uses its own updater', async () => {
    const f = fixture('/user/.local/share/claude/versions/1.0.0');
    f.read.mockResolvedValue(JSON.stringify({ autoUpdatesChannel: 'stable' }));
    f.fetchText.mockResolvedValue('1.1.0\n');
    const installation = await f.runtime.inspect('claude');
    expect(installation).toMatchObject({ method: 'native', channel: 'stable', latestVersion: '1.1.0' });
    expect(f.fetchText).toHaveBeenCalledWith('https://downloads.claude.ai/claude-code-releases/stable');
    await f.runtime.upgrade(installation);
    expect(f.run).toHaveBeenLastCalledWith('/user/.local/bin/claude', ['update'], 300_000, { CLAUDE_CONFIG_DIR: '/user/.claude' });
  });

  it('keeps the native Codex home without injecting another provider home into its updater', async () => {
    const f = fixture('/user/.codex/packages/standalone/releases/1.0.0/codex');
    f.run.mockImplementation(async (_file, args) => args[0] === '--version' ? 'codex-cli 1.0.0' : 'Usage: codex update');
    const installation = await f.runtime.inspect('codex');
    expect(installation).toMatchObject({ status: 'available', method: 'native', command: { file: '/user/.local/bin/codex', args: ['update'] } });
    await f.runtime.upgrade(installation);
    expect(f.run).toHaveBeenLastCalledWith('/user/.local/bin/codex', ['update'], 300_000, { CODEX_HOME: '/user/.codex' });
  });

  it.each(['codex', 'claude'] as const)('keeps a custom %s wrapper manual and preserves the registry fallback', async provider => {
    const f = fixture('/user/scripts/codex-wrapper');
    f.read.mockResolvedValue(JSON.stringify({ autoUpdatesChannel: 'stable' }));
    const installation = await f.runtime.inspect(provider);
    expect(installation).toMatchObject({ status: 'available', latestVersion: '1.2.0', method: 'manual', command: undefined });
    expect(f.fetchText).toHaveBeenCalledWith(`https://registry.npmjs.org/${provider === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code'}/latest`);
  });

  it('reports registry failures instead of claiming the installed provider is current', async () => {
    const f = fixture('/tools/lib/node_modules/@openai/codex/bin/codex.js');
    f.fetchText.mockRejectedValue(new Error('offline'));
    await expect(f.runtime.inspect('codex')).rejects.toThrow('offline');
  });
  it('keeps prerelease package installations manual instead of offering stable replacement', async () => {
    const f = fixture('/tools/lib/node_modules/@openai/codex/bin/codex.js');
    f.run.mockImplementation(async (_file, args) => args[0] === '--version' ? 'codex-cli 1.1.0-alpha.1' : '/tools/lib/node_modules');
    expect(await f.runtime.inspect('codex')).toMatchObject({ status: 'manual', version: '1.1.0-alpha.1', latestVersion: '1.2.0' });
  });
});
