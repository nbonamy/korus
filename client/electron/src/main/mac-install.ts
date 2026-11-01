import { app, dialog, shell } from 'electron';
import { accessSync, constants, existsSync } from 'node:fs';
import path from 'node:path';
import { mainT } from './i18n';
import { logMain, warnMain } from './log';

/** Claims startup while Electron installs/relaunches the packaged Mac app. */
export function installMacAppBeforeStartup(): boolean {
  if (process.platform !== 'darwin' || !app.isPackaged || app.isInApplicationsFolder()) return false;

  void app.whenReady().then(async () => {
    try {
      // Match Electron's destination using the actual bundle name, even if renamed.
      const applications = '/Applications';
      const bundleName = path.basename(path.resolve(app.getPath('exe'), '../../..'));
      const destination = path.join(applications, bundleName);
      let blockedPath = applications;
      try {
        accessSync(applications, constants.W_OK);
        blockedPath = destination;
        if (existsSync(destination)) accessSync(destination, constants.W_OK);
      } catch (error) {
        // Electron's privileged path deletes the old app before copying and
        // bypasses conflictHandler. Let Finder handle this case instead.
        warnMain('install', 'manual installation required', { path: blockedPath, detail: String(error) });
        const choice = dialog.showMessageBoxSync({
          type: 'info',
          title: mainT('install.title'),
          message: mainT('install.finderRequired'),
          detail: mainT('install.manual'),
          buttons: [mainT('install.openApplications'), mainT('install.cancel')],
          defaultId: 0,
          cancelId: 1,
        });
        if (choice === 0) {
          const openError = await shell.openPath(applications);
          if (openError) throw new Error(openError);
        }
        app.quit();
        return;
      }
      logMain('install', 'installing without elevated permissions', { destination });
      const moved = app.moveToApplicationsFolder({
        conflictHandler: (conflict) => conflict === 'existsAndRunning' || dialog.showMessageBoxSync({
          type: 'question',
          title: mainT('install.title'),
          message: mainT('install.replace'),
          detail: mainT('install.replaceDetail'),
          buttons: [mainT('install.replaceButton'), mainT('install.cancel')],
          defaultId: 1,
          cancelId: 1,
        }) === 0,
      });
      // Electron owns successful relaunch (or focuses an already running copy).
      if (!moved) app.quit();
    } catch (error) {
      warnMain('install', 'installation failed', { detail: String(error) });
      dialog.showErrorBox(mainT('install.failed'), `${mainT('install.manual')}\n\n${String(error)}`);
      app.quit();
    }
  });
  return true;
}
