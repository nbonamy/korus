import { app, dialog, shell, type BrowserWindow } from 'electron';
import path from 'node:path';
import { mainT } from './i18n';
import { capturePerformanceProfile } from './performance-profile';

const recordingMs = 10_000;

/** Help menu flow: confirm, record, then point to the saved files. */
export async function runPerformanceCapture(window: BrowserWindow): Promise<void> {
  const choice = await dialog.showMessageBox(window, {
    type: 'question',
    title: mainT('profile.title'),
    message: mainT('profile.message'),
    detail: mainT('profile.detail'),
    buttons: [mainT('profile.record'), mainT('profile.recordWithMemory'), mainT('profile.cancel')],
    defaultId: 0,
    cancelId: 2,
  });
  if (choice.response === 2 || window.isDestroyed()) return;
  try {
    const result = await capturePerformanceProfile({
      debugger: window.webContents.debugger,
      directory: path.join(app.getPath('logs'), 'profiles'),
      durationMs: recordingMs,
      includeHeapSnapshot: choice.response === 1,
      appVersion: app.getVersion(),
      metrics: () => app.getAppMetrics(),
    });
    if (window.isDestroyed()) return;
    const done = await dialog.showMessageBox(window, {
      type: 'info',
      title: mainT('profile.title'),
      message: mainT('profile.done'),
      detail: `${mainT('profile.doneDetail')}\n\n${result.directory}`,
      buttons: [mainT('profile.showInFinder'), mainT('profile.ok')],
      defaultId: 0,
      cancelId: 1,
    });
    if (done.response === 0) shell.showItemInFolder(result.cpuProfilePath);
  } catch (error) {
    if (window.isDestroyed()) return;
    await dialog.showMessageBox(window, {
      type: 'error',
      title: mainT('profile.title'),
      message: mainT('profile.failed'),
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
