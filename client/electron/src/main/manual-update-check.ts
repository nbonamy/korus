import type {
  BrowserWindow,
  MessageBoxOptions,
  MessageBoxReturnValue,
} from 'electron';
import type { DesktopUpdateStatus } from '@workspace/core/contracts';
import { mainT } from './i18n';

type ManualUpdateCheckOptions = {
  getWindow: () => BrowserWindow | null;
  installUpdate: () => void;
  showMessageBox: (
    window: BrowserWindow | null,
    options: MessageBoxOptions,
  ) => Promise<MessageBoxReturnValue>;
};

export class ManualUpdateCheckController {
  private readonly getWindow: () => BrowserWindow | null;
  private readonly installUpdate: () => void;
  private readonly showMessageBox: (
    window: BrowserWindow | null,
    options: MessageBoxOptions,
  ) => Promise<MessageBoxReturnValue>;
  private waitingForResult = false;
  private promptOpen = false;

  constructor(options: ManualUpdateCheckOptions) {
    this.getWindow = options.getWindow;
    this.installUpdate = options.installUpdate;
    this.showMessageBox = options.showMessageBox;
  }

  begin(currentStatus: DesktopUpdateStatus): boolean {
    if (currentStatus.state === 'downloaded') {
      void this.promptInstall(currentStatus);
      return false;
    }

    if (currentStatus.state === 'disabled') {
      void this.showDisabledMessage();
      return false;
    }

    this.waitingForResult = true;
    return true;
  }

  cancel(): void {
    this.waitingForResult = false;
  }

  handleStatus(status: DesktopUpdateStatus): void {
    if (!this.waitingForResult) return;
    if (status.state === 'checking' || status.state === 'downloading') return;

    this.waitingForResult = false;
    if (status.state === 'downloaded') {
      void this.promptInstall(status);
      return;
    }
    if (status.state === 'error') {
      void this.showErrorMessage(status);
      return;
    }
    if (status.state === 'idle') void this.showUpToDateMessage();
  }

  private async promptInstall(status: DesktopUpdateStatus): Promise<void> {
    if (this.promptOpen) return;
    this.promptOpen = true;
    try {
      const result = await this.showMessageBox(this.getWindow(), {
        buttons: [mainT('update.install'), mainT('update.later')],
        cancelId: 1,
        defaultId: 0,
        detail: status.version
          ? mainT('update.downloadedVersion', { version: status.version })
          : mainT('update.downloaded'),
        message: mainT('update.ready'),
        noLink: true,
        type: 'question',
      });
      if (result.response === 0) this.installUpdate();
    } finally {
      this.promptOpen = false;
    }
  }

  private async showDisabledMessage(): Promise<void> {
    await this.showMessageBox(this.getWindow(), {
      buttons: [mainT('update.ok')],
      defaultId: 0,
      message: mainT('update.unavailable'),
      noLink: true,
      type: 'info',
    });
  }

  private async showErrorMessage(status: DesktopUpdateStatus): Promise<void> {
    await this.showMessageBox(this.getWindow(), {
      buttons: [mainT('update.ok')],
      defaultId: 0,
      detail: status.error,
      message: mainT('update.checkFailed'),
      noLink: true,
      type: 'error',
    });
  }

  private async showUpToDateMessage(): Promise<void> {
    await this.showMessageBox(this.getWindow(), {
      buttons: [mainT('update.ok')],
      defaultId: 0,
      detail: mainT('update.latestDetail'),
      message: mainT('update.latest'),
      noLink: true,
      type: 'info',
    });
  }
}
