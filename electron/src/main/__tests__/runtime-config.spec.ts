import { product } from '@workspace/core/product';
import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { homedir } from 'node:os';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('runtime config', () => {
  it('returns null when no backend command is configured', async () => {
    const { runtimeDaemonCommand } = await import('../runtime-config');

    expect(runtimeDaemonCommand({
      defaultApp: true,
      env: {},
      resourcesPath: '/app/resources',
    })).toBeNull();
  });

  it('reads the backend command and comma-separated args from the environment', async () => {
    const { runtimeDaemonCommand } = await import('../runtime-config');

    expect(runtimeDaemonCommand({
      cwd: process.cwd(),
      env: {
        APP_BACKEND_COMMAND: ' node ',
        APP_BACKEND_ARGS: ' dist/daemon.mjs, --stdio ',
      },
    })).toStrictEqual({
      command: 'node',
      args: ['dist/daemon.mjs', '--stdio'],
      env: {
        APP_ASSETS_PATH: path.resolve(process.cwd(), 'assets'),
        APP_HOME: path.join(homedir(), `${product.homeDirectory}`),
        HOME: homedir(),
      },
    });
  });

  it('defaults backend args to stdio mode', async () => {
    const { runtimeDaemonCommand } = await import('../runtime-config');

    expect(runtimeDaemonCommand({
      cwd: process.cwd(),
      env: {
        APP_BACKEND_COMMAND: 'daemon',
      },
    })).toStrictEqual({
      command: 'daemon',
      args: ['--stdio'],
      env: {
        APP_ASSETS_PATH: path.resolve(process.cwd(), 'assets'),
        APP_HOME: path.join(homedir(), `${product.homeDirectory}`),
        HOME: homedir(),
      },
    });
  });

  it('forwards public OAuth configuration when Electron starts daemon with it in its environment', async () => {
    const { runtimeDaemonCommand } = await import('../runtime-config');

    expect(runtimeDaemonCommand({
      cwd: process.cwd(),
      env: {
        APP_BACKEND_COMMAND: 'daemon',
        APP_GITHUB_CLIENT_ID: ' github-client-id ',
        APP_LINEAR_CLIENT_ID: ' linear-client-id ',
        APP_GITLAB_CLIENT_ID: ' gitlab-client-id ',
      },
    })).toStrictEqual({
      command: 'daemon',
      args: ['--stdio'],
      env: {
        APP_ASSETS_PATH: path.resolve(process.cwd(), 'assets'),
        APP_HOME: path.join(homedir(), `${product.homeDirectory}`),
        APP_GITHUB_CLIENT_ID: 'github-client-id',
        APP_LINEAR_CLIENT_ID: 'linear-client-id',
        APP_GITLAB_CLIENT_ID: 'gitlab-client-id',
        HOME: homedir(),
      },
    });
  });

  it('forwards an explicitly configured assets path to daemon', async () => {
    const { runtimeDaemonCommand } = await import('../runtime-config');

    expect(runtimeDaemonCommand({
      env: {
        APP_BACKEND_COMMAND: 'daemon',
        APP_ASSETS_PATH: '/app/resources',
      },
    })).toStrictEqual({
      command: 'daemon',
      args: ['--stdio'],
      env: {
        APP_ASSETS_PATH: '/app/resources',
        APP_HOME: path.join(homedir(), `${product.homeDirectory}`),
        HOME: homedir(),
      },
    });
  });

  it('does not forward obsolete bundled Codex configuration to the daemon', async () => {
    const { runtimeDaemonCommand } = await import('../runtime-config');

    expect(runtimeDaemonCommand({
      env: {
        APP_BACKEND_COMMAND: 'daemon',
        APP_BUNDLED_CODEX_PATH: '/app/resources/codex/codex',
      },
    })).toStrictEqual({
      command: 'daemon',
      args: ['--stdio'],
      env: {
        APP_ASSETS_PATH: path.resolve(process.cwd(), 'assets'),
        APP_HOME: path.join(homedir(), `${product.homeDirectory}`),
        HOME: homedir(),
      },
    });
  });

  it.each(['darwin', 'linux', 'win32'] as const)('uses private Node on %s without a system installation', async (platform) => {
    const { runtimeDaemonCommand } = await import('../runtime-config');

    expect(runtimeDaemonCommand({
      defaultApp: false,
      platform,
      env: {
        PATH: '/usr/bin',
      },
      execFileSync: vi.fn(() => {
        throw new Error('login shell unavailable');
      }),
      existsSync: (filePath) => filePath === `/app/resources/daemon/${product.daemonName}` ||
        filePath === `/app/resources/runtime/${platform === 'win32' ? 'node.exe' : 'node'}`,
      homedir: () => '/Users/nicolas',
      resourcesPath: '/app/resources',
    })).toStrictEqual({
      command: `/app/resources/runtime/${platform === 'win32' ? 'node.exe' : 'node'}`,
      args: [
        `/app/resources/daemon/${product.daemonName}`,
        '--stdio',
      ],
      env: {
        APP_ASSETS_PATH: '/app/resources',
        APP_HOME: `/Users/nicolas/${product.homeDirectory}`,
        HOME: '/Users/nicolas',
        PATH: `/usr/bin${platform === 'win32' ? ';' : ':'}/app/resources/runtime`,
      },
    });
  });

  it('converts the runtime command to serve mode for daemon launches', async () => {
    const { runtimeDaemonServeCommand } = await import('../runtime-config');

    expect(runtimeDaemonServeCommand({
      env: {
        APP_BACKEND_COMMAND: 'node',
        APP_BACKEND_ARGS: '/app/daemon.mjs,--stdio',
        APP_HOME: `/Users/nicolas/${product.homeDirectory}`,
      },
    })).toStrictEqual({
      command: 'node',
      args: ['/app/daemon.mjs', 'serve'],
      env: {
        APP_ASSETS_PATH: path.resolve(process.cwd(), 'assets'),
        APP_HOME: `/Users/nicolas/${product.homeDirectory}`,
        HOME: homedir(),
      },
    });
  });

  it('does not silently use system Node when the packaged runtime is missing', async () => {
    const { runtimeDaemonCommand } = await import('../runtime-config');

    expect(runtimeDaemonCommand({
      defaultApp: false,
      env: {
        PATH: '/usr/bin',
      },
      execFileSync: vi.fn(() => {
        throw new Error('login shell unavailable');
      }),
      existsSync: (filePath) => filePath === `/app/resources/daemon/${product.daemonName}` || filePath === '/usr/bin/node',
      resourcesPath: '/app/resources',
    })).toBeNull();
  });

  it('returns null for packaged apps when the bundled runtime is missing', async () => {
    const { runtimeDaemonCommand } = await import('../runtime-config');

    expect(runtimeDaemonCommand({
      defaultApp: false,
      env: {},
      existsSync: () => false,
      resourcesPath: '/app/resources',
    })).toBeNull();
  });

  it('defaults backend mode to auto and accepts explicit bundled or existing modes', async () => {
    const { runtimeDaemonBackendMode } = await import('../runtime-config');

    expect(runtimeDaemonBackendMode({ env: {} })).toBe('auto');
    expect(runtimeDaemonBackendMode({ env: { APP_BACKEND_MODE: 'bundled' } })).toBe('bundled');
    expect(runtimeDaemonBackendMode({ env: { APP_BACKEND_MODE: 'existing' } })).toBe('existing');
    expect(runtimeDaemonBackendMode({ env: { APP_BACKEND_MODE: 'nope' } })).toBe('auto');
  });

  it('resolves the local daemon socket path from APP_HOME or an explicit socket override', async () => {
    const { runtimeDaemonSocketPath } = await import('../runtime-config');

    expect(runtimeDaemonSocketPath({ env: { APP_HOME: '/tmp/agent-workspace' } })).toBe('/tmp/agent-workspace/daemon.sock');
    expect(runtimeDaemonSocketPath({ env: { APP_BACKEND_SOCKET: '/tmp/custom.sock' } })).toBe('/tmp/custom.sock');
  });
});
