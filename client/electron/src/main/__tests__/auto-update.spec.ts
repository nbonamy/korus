import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DesktopAutoUpdateService,
  resolveDesktopUpdateFeedUrl,
} from '../auto-update';

class AutoUpdaterMock extends EventEmitter {
  checkForUpdates = vi.fn();
  quitAndInstall = vi.fn();
  setFeedURL = vi.fn();
}

function createService(options: {
  app?: { getVersion: () => string; isPackaged: boolean };
  platform?: NodeJS.Platform;
  updater?: AutoUpdaterMock;
  executablePath?: string;
} = {}) {
  const updater = options.updater ?? new AutoUpdaterMock();
  const setIntervalFn = vi.fn() as unknown as typeof setInterval;
  const statuses: Array<{ state: string; error?: string; version?: string }> = [];
  const service = new DesktopAutoUpdateService({
    app: options.app ?? { getVersion: () => '0.3.0', isPackaged: true },
    arch: options.platform === 'win32' ? 'x64' : 'arm64',
    autoUpdater: updater,
    logger: { error: vi.fn(), log: vi.fn() },
    onStatusChanged: (status) => statuses.push(status),
    platform: options.platform ?? 'darwin',
    setIntervalFn,
    executablePath: options.executablePath,
  });

  return { service, statuses, updater, setIntervalFn };
}

describe('desktop auto-update', () => {
  it('resolves the platform and architecture feed URL', () => {
    expect(resolveDesktopUpdateFeedUrl(
      '0.27.0',
      'https://updates.example.test/releases/',
      'darwin',
      'arm64',
    )).toBe('https://updates.example.test/releases/nbonamy/korus/darwin-arm64/0.27.0');
  });

  it('rejects non-https feeds', () => {
    expect(() => resolveDesktopUpdateFeedUrl('0.27.0', 'http://localhost:3000/releases')).toThrow(
      'Desktop update URL must use https',
    );
  });

  it('disables updates in development and on unsupported platforms', () => {
    const development = createService({ app: { getVersion: () => '0.3.0', isPackaged: false } });
    development.service.start();
    expect(development.statuses).toStrictEqual([{ state: 'disabled' }]);
    expect(development.updater.checkForUpdates).not.toHaveBeenCalled();

    const windows = createService({ platform: 'win32', executablePath: '/missing/portable/app.exe' });
    windows.service.start();
    expect(windows.statuses).toStrictEqual([{ state: 'disabled' }]);
    expect(windows.updater.checkForUpdates).not.toHaveBeenCalled();
    const linux = createService({ platform: 'linux' });
    linux.service.start();
    expect(linux.service.getStatus()).toEqual({ state: 'disabled' });
    expect(linux.updater.setFeedURL).not.toHaveBeenCalled();
  });

  it('configures the packaged feed and reports updater phases', () => {
    const { service, statuses, updater, setIntervalFn } = createService();
    service.start();

    expect(updater.setFeedURL).toHaveBeenCalledWith({
      url: 'https://update.electronjs.org/nbonamy/korus/darwin-arm64/0.3.0',
    });
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 60 * 60 * 1000);

    updater.emit('checking-for-update');
    updater.emit('update-available');
    updater.emit('update-downloaded', {}, '', '0.4.0');
    expect(statuses.at(-3)).toStrictEqual({ state: 'checking' });
    expect(statuses.at(-2)).toStrictEqual({ state: 'downloading' });
    expect(statuses.at(-1)).toStrictEqual({ state: 'downloaded', version: '0.4.0' });
  });

  it('enables the GitHub-backed feed for a Squirrel-installed Windows copy', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'app-update-'));
    try {
      mkdirSync(path.join(directory, 'app-0.3.0'));
      writeFileSync(path.join(directory, 'Update.exe'), 'fixture');
      const { service, updater } = createService({ platform: 'win32', executablePath: path.join(directory, 'app-0.3.0', 'app.exe') });
      service.start();
      expect(updater.setFeedURL).toHaveBeenCalledWith({ url: 'https://update.electronjs.org/nbonamy/korus/win32-x64/0.3.0' });
      expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('reports synchronous check failures as an error status', () => {
    const { service, statuses, updater } = createService();
    updater.checkForUpdates.mockImplementation(() => {
      throw new Error('network unavailable');
    });

    service.start();

    expect(statuses.at(-1)).toStrictEqual({ state: 'error', error: 'network unavailable' });
  });

  it('installs only after an update is downloaded', async () => {
    const { service, updater } = createService();
    service.start();
    service.install();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    updater.emit('update-downloaded', {}, '', '0.4.0');
    service.install();
    await new Promise((resolve) => setImmediate(resolve));
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });
});
