import { describe, expect, it, vi } from 'vitest';
import {
  discoveredRuntimePath,
  discoveredRuntimePathEntries,
  resolveRuntimeExecutable,
  resolveRuntimeLaunch,
  withDiscoveredRuntimePath,
} from '../runtime-discovery';

const shellPath = (value: string) => `__APP_RUNTIME_PATH_START__${value}__APP_RUNTIME_PATH_END__`;

describe('runtime discovery', () => {
  describe('engines linked into the private bin', () => {
    const linked = (existing: string[]) => ({
      env: { PATH: '/usr/bin:/opt/bin', SHELL: '/bin/bash' },
      execFileSync: vi.fn(() => { throw new Error('no shell should start'); }),
      existsSync: (file: string) => existing.includes(file),
      homedir: () => '/home/me', platform: 'linux' as const,
    });

    it('resolves a linked engine without starting any shell', () => {
      const dependencies = linked(['/home/me/.korus/bin/codex']);
      expect(resolveRuntimeExecutable('codex', dependencies)).toBe('/home/me/.korus/bin/codex');
      const launch = resolveRuntimeLaunch('codex', { CODEX_HOME: '/h' }, dependencies);
      expect(launch.command).toBe('/home/me/.korus/bin/codex');
      expect(launch.env.PATH?.startsWith('/home/me/.korus/bin:/usr/bin:/opt/bin')).toBe(true);
      expect(launch.env.CODEX_HOME).toBe('/h');
      expect(dependencies.execFileSync).not.toHaveBeenCalled();
    });

    it('launches the absolute linked path that detection resolved without starting any shell', () => {
      const dependencies = linked(['/home/me/.korus/bin/claude']);
      const launch = resolveRuntimeLaunch('/home/me/.korus/bin/claude', undefined, dependencies);
      expect(launch.command).toBe('/home/me/.korus/bin/claude');
      expect(dependencies.execFileSync).not.toHaveBeenCalled();
    });

    it('falls back to full discovery for an engine that is not linked or whose link dangles', () => {
      const dependencies = { ...linked(['/usr/bin/codex']), execFileSync: vi.fn(() => shellPath('/usr/bin')) };
      expect(resolveRuntimeExecutable('codex', dependencies)).toBe('/usr/bin/codex');
      expect(dependencies.execFileSync).toHaveBeenCalled();
      expect(resolveRuntimeExecutable('claude', linked(['/home/me/.korus/bin/codex']))).toBeNull();
    });

    it('does not link absolute commands or tools other than engines', () => {
      const dependencies = linked(['/home/me/.korus/bin/gh']);
      expect(() => resolveRuntimeExecutable('gh', dependencies)).not.toThrow();
      expect(dependencies.execFileSync).toHaveBeenCalled();
    });
  });

  it('ignores shell startup output around the requested PATH instead of skipping its first executable', () => {
    expect(resolveRuntimeExecutable('codex', {
      env: { PATH: '/old/bin', SHELL: '/bin/bash' },
      execFileSync: () => '\u001b(B\u001b[mWelcome\n__APP_RUNTIME_PATH_START__/user/bin:/old/bin__APP_RUNTIME_PATH_END__\n',
      existsSync: file => ['/user/bin/codex', '/old/bin/codex'].includes(file),
      homedir: () => '/user', platform: 'darwin',
    })).toBe('/user/bin/codex');
  });

  it.each(['codex', 'claude', 'npm'])('prefers the login-shell %s over an inherited nvm installation for detection and child PATH', (command) => {
    const dependencies = {
      env: { PATH: '/app/runtime:/old-nvm/bin:/usr/bin', SHELL: '/bin/zsh' },
      execFileSync: vi.fn(() => shellPath('/user/bin:/new-nvm/bin:/usr/bin')),
      existsSync: (file: string) => file === `/user/bin/${command}` || file === `/old-nvm/bin/${command}`,
      homedir: () => '/user', platform: 'darwin' as const,
    };
    expect(resolveRuntimeExecutable(command, dependencies)).toBe(`/user/bin/${command}`);
    expect(withDiscoveredRuntimePath(dependencies.env, dependencies).PATH)
      .toBe('/user/bin:/new-nvm/bin:/usr/bin:/app/runtime:/old-nvm/bin');
    const launch = resolveRuntimeLaunch(command, dependencies.env, dependencies);
    expect(launch.command).toBe(`/user/bin/${command}`);
    expect(launch.env.PATH).toBe('/user/bin:/new-nvm/bin:/usr/bin:/app/runtime:/old-nvm/bin');
  });

  it('merges login-shell PATH, current PATH, common user bins, and nvm command bin', () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce(shellPath('/usr/local/bin:/usr/bin'))
      .mockReturnValueOnce('/Users/nicolas/.nvm/versions/node/v22.19.0/bin/node');
    const existsSync = vi.fn((filePath: string) => [
      '/Users/nicolas/.local/bin',
      '/Users/nicolas/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/Users/nicolas/.nvm/versions/node/v22.19.0/bin/node',
    ].includes(filePath));

    expect(discoveredRuntimePathEntries({
      env: {
        PATH: '/usr/bin:/bin',
        SHELL: '/bin/zsh',
      },
      execFileSync,
      existsSync,
      homedir: () => '/Users/nicolas',
      pathDelimiter: ':',
      platform: 'darwin',
    })).toStrictEqual([
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/Users/nicolas/.local/bin',
      '/Users/nicolas/bin',
      '/opt/homebrew/bin',
      '/Users/nicolas/.nvm/versions/node/v22.19.0/bin',
    ]);
  });

  it('falls back to nvm files when the nvm shell command is unavailable', () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce(shellPath('/usr/bin:/bin'))
      .mockImplementationOnce(() => {
        throw new Error('nvm missing');
      });
    const existsSync = vi.fn((filePath: string) => [
      '/Users/nicolas/.nvm/alias/default',
      '/Users/nicolas/.nvm/versions/node',
    ].includes(filePath));
    const readFileSync = vi.fn().mockReturnValue('22');
    const readdirSync = vi.fn().mockReturnValue(['v20.11.1', 'v22.19.0', 'v22.20.0']);

    expect(discoveredRuntimePath({
      env: {
        PATH: '/usr/bin:/bin',
        SHELL: '/bin/zsh',
      },
      execFileSync,
      existsSync,
      homedir: () => '/Users/nicolas',
      pathDelimiter: ':',
      platform: 'darwin',
      readFileSync,
      readdirSync,
    })).toBe('/usr/bin:/bin:/Users/nicolas/.nvm/versions/node/v22.20.0/bin');
  });

  it('resolves executables from the discovered runtime path', () => {
    const existsSync = vi.fn((filePath: string) => filePath === '/Users/nicolas/.nvm/versions/node/v22.19.0/bin/node');

    expect(resolveRuntimeExecutable('node', {
      env: {
        PATH: '/usr/bin:/Users/nicolas/.nvm/versions/node/v22.19.0/bin',
      },
      execFileSync: vi.fn(() => {
        throw new Error('shell unavailable');
      }),
      existsSync,
      homedir: () => '/Users/nicolas',
      pathDelimiter: ':',
      platform: 'darwin',
    })).toBe('/Users/nicolas/.nvm/versions/node/v22.19.0/bin/node');
  });

  it('returns a copy of env with the discovered PATH', () => {
    const env = withDiscoveredRuntimePath({ PATH: '/usr/bin', TEST_FLAG: '1' }, {
      execFileSync: vi.fn(() => shellPath('/opt/homebrew/bin:/usr/bin')),
      existsSync: vi.fn(() => false),
      homedir: () => '/Users/nicolas',
      pathDelimiter: ':',
      platform: 'darwin',
    });

    expect(env.TEST_FLAG).toBe('1');
    expect(env.PATH).toBe('/opt/homebrew/bin:/usr/bin');
  });

  it('handles absolute and Windows executable candidates', () => {
    const noShell = { execFileSync: () => { throw new Error('shell unavailable'); }, existsSync: () => false, platform: 'linux' as const };
    expect(resolveRuntimeLaunch('/explicit/missing/codex', { PATH: '/bin' }, noShell).command).toBe('/explicit/missing/codex');
    expect(resolveRuntimeLaunch('codex', { PATH: '/bin' }, noShell).command).toBe('codex');
    expect(resolveRuntimeExecutable('/opt/bin/node', {
      existsSync: (filePath) => filePath === '/opt/bin/node',
    })).toBe('/opt/bin/node');
    expect(resolveRuntimeExecutable('/missing/node', { existsSync: () => false })).toBeNull();
    expect(resolveRuntimeExecutable('missing', {
      env: { PATH: '/bin' },
      execFileSync: vi.fn(() => ''),
      existsSync: () => false,
      homedir: () => '/home/nicolas',
      pathDelimiter: ':',
      platform: 'linux',
    })).toBeNull();

    const existsSync = vi.fn((filePath: string) => filePath === 'C:\\bin/codex.cmd');
    expect(resolveRuntimeExecutable('codex', {
      env: { PATH: 'C:\\bin', PATHEXT: '.EXE;.CMD' },
      existsSync,
      pathDelimiter: ';',
      platform: 'win32',
    })).toBe('C:\\bin/codex.cmd');
    expect(discoveredRuntimePathEntries({ env: {}, pathDelimiter: ';', platform: 'win32' })).toStrictEqual([]);
    expect(resolveRuntimeLaunch('codex', { PATH: 'C:\\bin', PATHEXT: '.EXE;.CMD' }, {
      existsSync, pathDelimiter: ';', platform: 'win32',
    }).command).toBe('C:\\bin/codex.cmd');
  });

  it('handles nushell paths and unusable nvm aliases', () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce(shellPath('/nu/bin'))
      .mockImplementationOnce(() => { throw new Error('nvm unavailable'); });
    expect(discoveredRuntimePathEntries({
      env: { SHELL: '/opt/nu' },
      execFileSync,
      existsSync: () => false,
      homedir: () => '/home/nicolas',
      pathDelimiter: ':',
      platform: 'linux',
    })).toStrictEqual(['/nu/bin']);

    expect(discoveredRuntimePathEntries({
      env: { PATH: '/usr/bin' },
      execFileSync: vi.fn(() => { throw new Error('no shell'); }),
      existsSync: (filePath) => filePath.endsWith('/.nvm/alias/default') || filePath.endsWith('/.nvm/versions/node'),
      homedir: () => '/home/nicolas',
      pathDelimiter: ':',
      platform: 'linux',
      readFileSync: () => '',
      readdirSync: () => [],
    })).toStrictEqual(['/usr/bin']);
    expect(discoveredRuntimePathEntries({
      env: { PATH: '/usr/bin' },
      execFileSync: vi.fn(() => { throw new Error('no shell'); }),
      existsSync: (filePath) => filePath.endsWith('/.nvm/alias/default') || filePath.endsWith('/.nvm/versions/node'),
      homedir: () => '/home/nicolas',
      pathDelimiter: ':',
      platform: 'linux',
      readFileSync: () => { throw new Error('unreadable'); },
      readdirSync: () => [],
    })).toStrictEqual(['/usr/bin']);
  });
});
