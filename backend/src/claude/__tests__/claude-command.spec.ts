import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolveClaudeLaunch } from '../claude-command';
import { createClaudeLifecycle } from '../provider-lifecycle';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';

const host = vi.hoisted(() => ({ files: new Set<string>() }));
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(), existsSync: (file: string) => host.files.has(file) }));
vi.mock('node:child_process', async original => ({
  ...await original<typeof import('node:child_process')>(),
  execFileSync: () => '__APP_RUNTIME_PATH_START__/user/bin__APP_RUNTIME_PATH_END__',
}));
const sdkBinary = createRequire(import.meta.url).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/${process.platform === 'win32' ? 'claude.exe' : 'claude'}`);
const packaged = '/app/resources/claude/claude';

afterEach(() => { vi.unstubAllEnvs(); host.files.clear(); });

describe('Claude runtime selection', () => {
  // Missing PATH, stale overrides and absent bundled resources must not produce
  // contradictory installed/launch observations or select another installation.
  it.each([
    { name: 'prefers the installed CLI', files: ['/user/bin/claude', packaged, sdkBinary], configured: '', selected: '/user/bin/claude', installed: true },
    { name: 'uses the packaged runtime without a CLI', files: [packaged, sdkBinary], configured: '', selected: packaged, installed: true },
    { name: 'uses the SDK runtime in development', files: [sdkBinary], configured: '', selected: sdkBinary, installed: true },
    { name: 'reports missing when no runtime exists', files: [], configured: '', selected: 'claude', installed: false },
    { name: 'honors an explicit override', files: ['/custom/claude', '/user/bin/claude', packaged], configured: '/custom/claude', selected: '/custom/claude', installed: true },
    { name: 'does not hide a broken override', files: ['/user/bin/claude', packaged, sdkBinary], configured: '/missing/claude', selected: '/missing/claude', installed: false },
  ])('$name', ({ files, configured, selected, installed }) => {
    host.files = new Set(files);
    vi.stubEnv('APP_CLAUDE_COMMAND', configured);
    vi.stubEnv('APP_ASSETS_PATH', '/app/resources');
    vi.stubEnv('PATH', '/user/bin');
    expect(createClaudeLifecycle().installed(createTestSnapshot())).toBe(installed);
    const launch = resolveClaudeLaunch();
    expect(launch.command).toBe(selected);
    expect(launch.env.PATH).toBe('/user/bin');
  });
});
