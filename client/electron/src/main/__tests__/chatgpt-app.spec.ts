import { product } from '@workspace/core/product';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { launchChatGptApp } from '../chatgpt-app';

describe('launchChatGptApp', () => {
  it(`opens the application from /Applications with ${product.name} isolated Codex home`, async () => {
    const execFile = vi.fn().mockImplementation(async (command: string) => {
      if (command === '/usr/bin/pgrep') {
        throw Object.assign(new Error('No matching process'), { code: 1 });
      }
      return undefined;
    });
    const existsSync = vi.fn().mockReturnValue(true);

    await expect(launchChatGptApp({}, {
      appHome: `/Users/nico/${product.homeDirectory}`,
      execFile,
      existsSync,
      platform: 'darwin',
    })).resolves.toStrictEqual({ status: 'launched' });

    expect(existsSync).toHaveBeenCalledWith('/Applications/ChatGPT.app');
    expect(execFile).toHaveBeenNthCalledWith(1, '/usr/bin/pgrep', ['-x', 'ChatGPT']);
    expect(execFile).toHaveBeenCalledWith('/usr/bin/open', [
      '-n',
      '--env',
      `CODEX_HOME=${path.join(`/Users/nico/${product.homeDirectory}`, 'codex-home')}`,
      '-a',
      '/Applications/ChatGPT.app',
    ]);
  });

  it('reports an already-running instance without quitting or launching it', async () => {
    const execFile = vi.fn().mockResolvedValue(undefined);

    await expect(launchChatGptApp({}, {
      execFile,
      existsSync: () => true,
      platform: 'darwin',
    })).resolves.toStrictEqual({ status: 'alreadyRunning' });

    expect(execFile).toHaveBeenCalledOnce();
    expect(execFile).toHaveBeenCalledWith('/usr/bin/pgrep', ['-x', 'ChatGPT']);
  });

  it('quits a running instance before relaunching it with the isolated Codex home', async () => {
    let processLookupCount = 0;
    const execFile = vi.fn().mockImplementation(async (command: string) => {
      if (command === '/usr/bin/pgrep') {
        processLookupCount += 1;
        if (processLookupCount === 1) return undefined;
        throw Object.assign(new Error('No matching process'), { code: 1 });
      }
      return undefined;
    });

    await expect(launchChatGptApp({ quitRunning: true }, {
      appHome: `/Users/nico/${product.homeDirectory}`,
      execFile,
      existsSync: () => true,
      platform: 'darwin',
      wait: vi.fn().mockResolvedValue(undefined),
    })).resolves.toStrictEqual({ status: 'launched' });

    expect(execFile).toHaveBeenNthCalledWith(2, '/usr/bin/osascript', [
      '-e',
      'tell application "ChatGPT" to quit',
    ]);
    expect(execFile).toHaveBeenNthCalledWith(3, '/usr/bin/pgrep', ['-x', 'ChatGPT']);
    expect(execFile).toHaveBeenNthCalledWith(4, '/usr/bin/open', [
      '-n',
      '--env',
      `CODEX_HOME=${path.join(`/Users/nico/${product.homeDirectory}`, 'codex-home')}`,
      '-a',
      '/Applications/ChatGPT.app',
    ]);
  });

  it('reports when ChatGPT is not installed in /Applications', async () => {
    await expect(launchChatGptApp({}, {
      existsSync: () => false,
      platform: 'darwin',
    })).rejects.toThrow('ChatGPT is not installed at /Applications/ChatGPT.app.');
  });

  it('rejects unsupported platforms without attempting to launch', async () => {
    const execFile = vi.fn();

    await expect(launchChatGptApp({}, {
      execFile,
      platform: 'linux',
    })).rejects.toThrow('Launching the ChatGPT app is only supported on macOS.');

    expect(execFile).not.toHaveBeenCalled();
  });
});
