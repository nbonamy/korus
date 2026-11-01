import { product } from '@workspace/core/product';
import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { getDaemonStatus, getResolvedDaemonVersion, installDaemon, refreshDaemon, setDaemonEnabled } from '../daemon-launch-agent';

describe('daemon launch agent', () => {
  it('buffers health responses and closes probes on malformed replies or timeout', async () => {
    for (const response of ['healthy', 'malformed', 'timeout'] as const) {
      const socket = fakeSocket();
      const pending = getDaemonStatus({
        access: vi.fn().mockResolvedValue(undefined),
        connectSocket: vi.fn(() => socket) as never,
        env: { APP_BACKEND_COMMAND: 'node' },
        homedir: () => '/test/home', platform: 'darwin',
      });
      await Promise.resolve();
      await Promise.resolve();
      socket.emit('connect');
      expect(socket.write).toHaveBeenCalledWith(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'backend/health/get' }) + '\n');
      if (response === 'healthy') {
        socket.emit('data', '{"jsonrpc":"2.0","id":1,');
        expect(socket.destroy).not.toHaveBeenCalled();
        socket.emit('data', '"result":{"version":"test","pid":42}}\n');
        expect(await pending).toMatchObject({ running: true, version: 'test', pid: 42 });
      } else {
        if (response === 'malformed') socket.emit('data', 'invalid\n');
        else socket.emit('timeout');
        expect(await pending).toMatchObject({ running: false, detail: expect.any(String) });
      }
      socket.emit('timeout');
      expect(socket.destroy).toHaveBeenCalledOnce();
    }
  });

  it('refuses unsupported installations and propagates meaningful uninstall failures', async () => {
    const execFile = vi.fn();
    const base = { env: {}, homedir: () => '/test/home', execFile };
    await expect(installDaemon({ ...base, platform: 'linux' })).rejects.toThrow('only supported on macOS');
    await expect(installDaemon({ ...base, platform: 'darwin' })).rejects.toThrow('No daemon runtime');
    await expect(setDaemonEnabled(false, {
      ...base, platform: 'darwin',
      unlink: vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' })),
    })).rejects.toThrow('denied');
  });

  it('reports unsupported status when no daemon runtime is available', async () => {
    await expect(getDaemonStatus({
      access: vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
      connectSocket: failingSocket('connect ENOENT'),
      env: {},
      homedir: () => '/Users/nicolas',
      platform: 'darwin',
    })).resolves.toStrictEqual({
      supported: false,
      installed: false,
      running: false,
      socketPath: expect.stringContaining(`${product.homeDirectory}/daemon.sock`),
      launchAgentPath: `/Users/nicolas/Library/LaunchAgents/${product.appId}.daemon.plist`,
      detail: 'No packaged daemon runtime was found.',
    });
  });

  it('reports non-macOS platforms as unsupported', async () => {
    await expect(getDaemonStatus({
      access: vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
      connectSocket: failingSocket('connect ENOENT'),
      env: {
        APP_BACKEND_COMMAND: 'node',
      },
      homedir: () => '/Users/nicolas',
      platform: 'linux',
    })).resolves.toMatchObject({
      supported: false,
      installed: false,
      running: false,
      detail: 'Background daemon installation is only supported on macOS.',
    });
  });

  it('installs and starts a per-user macOS LaunchAgent for daemon serve', async () => {
    const access = vi.fn().mockResolvedValue(undefined);
    const execFile = vi.fn().mockResolvedValue({});
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);

    await expect(installDaemon({
      access,
      connectSocket: healthySocket(),
      defaultApp: false,
      env: {
        PATH: '/usr/bin:/Users/nicolas/.nvm/versions/node/v22.19.0/bin',
        APP_GITHUB_CLIENT_ID: 'github-client-id',
        APP_HOME: `/Users/nicolas/${product.homeDirectory}`,
      },
      execFile,
      execFileSync: vi.fn(() => {
        throw new Error('login shell unavailable');
      }),
      existsSync: (filePath) => filePath === `/Applications/${product.name}.app/Contents/Resources/daemon/${product.daemonName}` ||
        filePath === `/Applications/${product.name}.app/Contents/Resources/runtime/node`,
      getuid: () => 501,
      homedir: () => '/Users/nicolas',
      mkdir,
      platform: 'darwin',
      resourcesPath: `/Applications/${product.name}.app/Contents/Resources`,
      writeFile,
    })).resolves.toMatchObject({
      supported: true,
      installed: true,
      running: true,
      launchAgentPath: `/Users/nicolas/Library/LaunchAgents/${product.appId}.daemon.plist`,
      socketPath: `/Users/nicolas/${product.homeDirectory}/daemon.sock`,
      version: '0.1.0',
      pid: 123,
    });

    expect(mkdir).toHaveBeenCalledWith('/Users/nicolas/Library/LaunchAgents', { recursive: true });
    expect(mkdir).toHaveBeenCalledWith(`/Users/nicolas/Library/Logs/${product.name}`, { recursive: true });
    expect(mkdir).toHaveBeenCalledWith(`/Users/nicolas/${product.homeDirectory}`, { recursive: true, mode: 0o700 });
    expect(writeFile).toHaveBeenCalledWith(
      `/Users/nicolas/Library/LaunchAgents/${product.appId}.daemon.plist`,
      expect.stringContaining(`<string>/Applications/${product.name}.app/Contents/Resources/runtime/node</string>`),
    );

    const plist = writeFile.mock.calls[0][1] as string;
    expect(plist).toContain(`<string>/Applications/${product.name}.app/Contents/Resources/daemon/${product.daemonName}</string>`);
    expect(plist).toContain('<string>serve</string>');
    expect(plist).toContain('<key>APP_HOME</key>');
    expect(plist).toContain(`<string>/Users/nicolas/${product.homeDirectory}</string>`);
    expect(plist).toContain('<key>HOME</key>');
    expect(plist).toContain('<string>/Users/nicolas</string>');
    expect(plist).toContain('<key>APP_GITHUB_CLIENT_ID</key>');
    expect(plist).toContain('<string>github-client-id</string>');
    expect(execFile).toHaveBeenNthCalledWith(1, 'launchctl', [
      'bootout',
      'gui/501',
      `/Users/nicolas/Library/LaunchAgents/${product.appId}.daemon.plist`,
    ]);
    expect(execFile).toHaveBeenNthCalledWith(2, 'launchctl', [
      'bootstrap',
      'gui/501',
      `/Users/nicolas/Library/LaunchAgents/${product.appId}.daemon.plist`,
    ]);
    expect(execFile).toHaveBeenNthCalledWith(3, 'launchctl', [
      'kickstart',
      '-k',
      `gui/501/${product.appId}.daemon`,
    ]);
  });

  it('refreshes the installed LaunchAgent with endpoint additions and removals without inventing a default', async () => {
    const env: NodeJS.ProcessEnv = { APP_BACKEND_COMMAND: 'node', APP_BACKEND_ARGS: '/app/daemon.mjs,--stdio', APP_HOME: '/test/home/profile' };
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const execFile = vi.fn().mockResolvedValue({});
    const deps = {
      env, platform: 'darwin' as const, homedir: () => '/test/home', getuid: () => 501,
      access: vi.fn().mockResolvedValue(undefined), connectSocket: healthySocket(),
      mkdir: vi.fn().mockResolvedValue(undefined), writeFile, execFile,
    };
    await installDaemon(deps);
    expect(writeFile.mock.lastCall![1]).not.toContain('APP_TELEMETRY_ENDPOINT');
    env.APP_TELEMETRY_ENDPOINT = ' https://collector.invalid/v1/telemetry/daily ';
    await refreshDaemon(deps);
    const configuredPlist = writeFile.mock.lastCall![1] as string;
    expect(configuredPlist).toContain('<key>APP_TELEMETRY_ENDPOINT</key>');
    expect(configuredPlist).toContain('<string>https://collector.invalid/v1/telemetry/daily</string>');
    delete env.APP_TELEMETRY_ENDPOINT;
    await refreshDaemon(deps);
    expect(writeFile.mock.lastCall![1]).not.toContain('APP_TELEMETRY_ENDPOINT');
    expect(execFile.mock.calls.filter(([, args]) => args[0] === 'bootstrap')).toHaveLength(3);
  });

  it('resolves the packaged daemon version through the runtime command', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: `${product.daemonName} 0.2.0\n` });

    await expect(getResolvedDaemonVersion({
      defaultApp: false,
      env: {
        PATH: '/usr/bin:/Users/nicolas/.nvm/versions/node/v22.19.0/bin',
      },
      execFile,
      execFileSync: vi.fn(() => {
        throw new Error('login shell unavailable');
      }),
      existsSync: (filePath) => filePath === `/Applications/${product.name}.app/Contents/Resources/daemon/${product.daemonName}` ||
        filePath === `/Applications/${product.name}.app/Contents/Resources/runtime/node`,
      homedir: () => '/Users/nicolas',
      resourcesPath: `/Applications/${product.name}.app/Contents/Resources`,
    })).resolves.toBe('0.2.0');

    expect(execFile).toHaveBeenCalledWith(`/Applications/${product.name}.app/Contents/Resources/runtime/node`, [
      `/Applications/${product.name}.app/Contents/Resources/daemon/${product.daemonName}`,
      '--version',
    ]);
  });

  it('removes the LaunchAgent when disabled', async () => {
    const execFile = vi.fn().mockResolvedValue({});
    const unlink = vi.fn().mockResolvedValue(undefined);

    await expect(setDaemonEnabled(false, {
      access: vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
      connectSocket: failingSocket('connect ENOENT'),
      env: {
        APP_BACKEND_COMMAND: 'node',
        APP_BACKEND_ARGS: '/app/daemon.mjs,--stdio',
      },
      execFile,
      getuid: () => 501,
      homedir: () => '/Users/nicolas',
      platform: 'darwin',
      unlink,
    })).resolves.toMatchObject({
      installed: false,
      running: false,
    });

    expect(execFile).toHaveBeenCalledWith('launchctl', [
      'bootout',
      'gui/501',
      `/Users/nicolas/Library/LaunchAgents/${product.appId}.daemon.plist`,
    ]);
    expect(unlink).toHaveBeenCalledWith(`/Users/nicolas/Library/LaunchAgents/${product.appId}.daemon.plist`);
  });
});

function healthySocket() {
  return vi.fn(() => {
    const socket = fakeSocket();
    socket.write = vi.fn(() => {
      queueMicrotask(() => {
        socket.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { version: '0.1.0', pid: 123 } })}\n`);
      });
      return true;
    }) as never;
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  }) as never;
}

function failingSocket(message: string) {
  return vi.fn(() => {
    const socket = fakeSocket();
    queueMicrotask(() => socket.emit('error', new Error(message)));
    return socket;
  }) as never;
}

function fakeSocket(): Socket {
  const socket = new EventEmitter() as Socket;
  socket.setTimeout = vi.fn() as never;
  socket.destroy = vi.fn() as never;
  socket.write = vi.fn() as never;
  return socket;
}
