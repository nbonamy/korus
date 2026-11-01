import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveCodexLaunch } from '../codex-command';
import { createCodexLifecycle } from '../provider-lifecycle';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';

const host = vi.hoisted(() => ({ files: new Set<string>() }));
vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  existsSync: (file: string) => host.files.has(file),
}));
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFileSync: () => '__APP_RUNTIME_PATH_START__/user/bin__APP_RUNTIME_PATH_END__',
}));

const embeddedDirectory = '/Applications/ChatGPT.app/Contents/Resources/codex-cli';
const embedded = `${embeddedDirectory}/bin/codex`;

describe('Codex executable selection', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); host.files.clear(); });

  // The owning host boundary must keep detection and launch consistent: PATH wins,
  // ChatGPT is a macOS fallback, and a broken explicit override stays authoritative.
  it.each([
    { name: 'prefers the CLI when ChatGPT is also installed', platform: 'darwin', files: ['/user/bin/codex', embedded], configured: '', command: '/user/bin/codex', installed: true },
    { name: 'uses ChatGPT when the CLI is absent', platform: 'darwin', files: [embedded], configured: '', command: embedded, installed: true },
    { name: 'does not mistake the package directory for an executable', platform: 'darwin', files: [embeddedDirectory], configured: '', command: 'codex', installed: false },
    { name: 'reports not installed when both are absent', platform: 'darwin', files: [], configured: '', command: 'codex', installed: false },
    { name: 'keeps an explicit executable authoritative', platform: 'darwin', files: ['/custom/codex', '/user/bin/codex', embedded], configured: ' /custom/codex ', command: '/custom/codex', installed: true },
    { name: 'does not mask a broken explicit override', platform: 'darwin', files: ['/user/bin/codex', embedded], configured: '/missing/codex', command: '/missing/codex', installed: false },
    { name: 'does not use a macOS bundle on Linux', platform: 'linux', files: [embedded], configured: '', command: 'codex', installed: false },
    { name: 'does not use a macOS bundle on Windows', platform: 'win32', files: [embedded], configured: '', command: 'codex', installed: false },
  ])('$name', ({ platform, files, configured, command, installed }) => {
    vi.stubGlobal('process', { ...process, platform });
    vi.stubEnv('PATH', '/user/bin');
    host.files = new Set(files);
    const snapshot = createTestSnapshot();
    snapshot.general.codexBinaryPath = configured;
    expect(createCodexLifecycle().installed(snapshot)).toBe(installed);
    const launch = resolveCodexLaunch(configured);
    expect(launch.command).toBe(command);
    expect(launch.env.PATH).toBe('/user/bin');
  });
});
