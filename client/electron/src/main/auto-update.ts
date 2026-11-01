import { type App, autoUpdater } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { DesktopUpdateStatus } from '@workspace/core/contracts';
import { product } from '@workspace/core/product';

const DEFAULT_UPDATE_BASE_URL = product.updateBaseUrl;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

type DesktopAutoUpdater = {
  checkForUpdates(): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  quitAndInstall(): void;
  setFeedURL(options: Parameters<typeof autoUpdater.setFeedURL>[0]): void;
};

export type DesktopAutoUpdateOptions = {
  app: Pick<App, 'getVersion' | 'isPackaged'>;
  arch?: NodeJS.Architecture;
  autoUpdater?: DesktopAutoUpdater;
  checkIntervalMs?: number;
  logger?: Pick<Console, 'error' | 'log'>;
  onStatusChanged?: (status: DesktopUpdateStatus) => void;
  platform?: NodeJS.Platform;
  setIntervalFn?: typeof setInterval;
  updateBaseUrl?: string;
  executablePath?: string;
};

export function resolveDesktopUpdateFeedUrl(
  version: string,
  baseUrl = DEFAULT_UPDATE_BASE_URL,
  platform: NodeJS.Platform = process.platform,
  arch = process.arch,
): string {
  const parsedUrl = new URL(baseUrl);
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Desktop update URL must use https');
  }

  parsedUrl.pathname = [
    parsedUrl.pathname.replace(/\/+$/, ''),
    product.repository,
    `${platform}-${arch}`,
    encodeURIComponent(version),
  ].join('/');

  return parsedUrl.toString();
}

export class DesktopAutoUpdateService {
  private readonly app: Pick<App, 'getVersion' | 'isPackaged'>;
  private readonly arch: NodeJS.Architecture;
  private readonly autoUpdater: DesktopAutoUpdater;
  private readonly checkIntervalMs: number;
  private readonly logger: Pick<Console, 'error' | 'log'>;
  private readonly onStatusChanged?: (status: DesktopUpdateStatus) => void;
  private readonly platform: NodeJS.Platform;
  private readonly setIntervalFn: typeof setInterval;
  private readonly updateBaseUrl: string;
  private readonly executablePath: string;
  private interval: ReturnType<typeof setInterval> | undefined;
  private status: DesktopUpdateStatus = { state: 'idle' };
  private started = false;

  constructor(options: DesktopAutoUpdateOptions) {
    this.app = options.app;
    this.arch = options.arch ?? process.arch;
    this.autoUpdater = options.autoUpdater ?? autoUpdater;
    this.checkIntervalMs = options.checkIntervalMs ?? UPDATE_CHECK_INTERVAL_MS;
    this.logger = options.logger ?? console;
    this.onStatusChanged = options.onStatusChanged;
    this.platform = options.platform ?? process.platform;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.updateBaseUrl = options.updateBaseUrl ?? DEFAULT_UPDATE_BASE_URL;
    this.executablePath = options.executablePath ?? process.execPath;
  }

  getStatus(): DesktopUpdateStatus {
    return this.status;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    if (!this.app.isPackaged) {
      this.setStatus({ state: 'disabled' });
      this.logger.log('[update] skipping auto-update in development mode');
      return;
    }

    const installedWindows = this.platform === 'win32'
      && existsSync(path.resolve(path.dirname(this.executablePath), '..', 'Update.exe'));
    if (this.platform !== 'darwin' && !installedWindows) {
      this.setStatus({ state: 'disabled' });
      this.logger.log('[update] skipping auto-update on unsupported platform', this.platform);
      return;
    }

    const feedUrl = resolveDesktopUpdateFeedUrl(this.app.getVersion(), this.updateBaseUrl, this.platform, this.arch);
    this.logger.log('[update] feed URL', feedUrl, 'version', this.app.getVersion());
    this.autoUpdater.setFeedURL({ url: feedUrl });

    this.autoUpdater.on('checking-for-update', () => this.setStatus({ state: 'checking' }));
    this.autoUpdater.on('update-available', () => this.setStatus({ state: 'downloading' }));
    this.autoUpdater.on('update-not-available', () => this.setStatus({ state: 'idle' }));
    this.autoUpdater.on('update-downloaded', (_event, _releaseNotes, releaseName) => {
      this.setStatus({
        state: 'downloaded',
        ...(typeof releaseName === 'string' ? { version: releaseName } : {}),
      });
    });
    this.autoUpdater.on('error', (error) => {
      this.logger.error('[update] auto-update failed', error);
      this.setStatus({
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    });

    this.check();
    this.interval = this.setIntervalFn(() => this.check(), this.checkIntervalMs);
    this.interval?.unref?.();
  }

  check(): boolean {
    if (!this.started || this.status.state === 'disabled') return false;

    try {
      this.autoUpdater.checkForUpdates();
      return true;
    } catch (error) {
      this.logger.error('[update] unable to check for updates', error);
      this.setStatus({
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
  }

  install(): void {
    if (this.status.state !== 'downloaded') return;
    setImmediate(() => this.autoUpdater.quitAndInstall());
    setTimeout(() => this.autoUpdater.quitAndInstall(), 5000).unref?.();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
    this.started = false;
  }

  private setStatus(status: DesktopUpdateStatus): void {
    this.status = status;
    this.onStatusChanged?.(status);
  }
}
