import { app, dialog, shell } from 'electron';
import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mainT } from './i18n';
import { logMain, warnMain } from './log';

const installerMarker = 'pending-installer-eject.json';
const markerPath = () => path.join(app.getPath('userData'), installerMarker);

/** The mounted disk image the app runs from, or undefined when it runs from anywhere else. */
function runningFromDiskImage(executable: string): string | undefined {
  return /^\/Volumes\/[^/]+/.exec(executable)?.[0];
}

/** Best effort: failing to remember the disk image only skips the offer to eject it. */
function rememberInstaller(diskImage: string): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(markerPath(), JSON.stringify({ diskImage }));
  } catch (error) {
    warnMain('install', 'could not remember the installer', { diskImage, detail: String(error) });
  }
}

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
      // The copy in Applications relaunches as a new process, so it carries the offer to eject.
      const diskImage = runningFromDiskImage(app.getPath('exe'));
      if (diskImage) rememberInstaller(diskImage);
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
      if (!moved) {
        rmSync(markerPath(), { force: true });
        app.quit();
      }
    } catch (error) {
      rmSync(markerPath(), { force: true });
      warnMain('install', 'installation failed', { detail: String(error) });
      dialog.showErrorBox(mainT('install.failed'), `${mainT('install.manual')}\n\n${String(error)}`);
      app.quit();
    }
  });
  return true;
}

function run(command: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, (error, stdout) => error ? reject(error) : resolve(String(stdout)));
    if (input !== undefined) child.stdin?.end(input);
  });
}

/** The .dmg file a mounted volume comes from. */
async function diskImageFile(volume: string): Promise<string | undefined> {
  const info = JSON.parse(await run('plutil', ['-convert', 'json', '-o', '-', '-'], await run('hdiutil', ['info', '-plist']))) as {
    images?: { 'image-path'?: string; 'system-entities'?: { 'mount-point'?: string }[] }[];
  };
  return info.images?.find(image => image['system-entities']?.some(entity => entity['mount-point'] === volume))?.['image-path'];
}

/** After an install from a disk image, offers to eject that image and move its .dmg file to the Trash. */
export async function offerToTrashInstaller(): Promise<void> {
  if (process.platform !== 'darwin' || !app.isPackaged) return;
  let volume: unknown;
  try {
    volume = (JSON.parse(readFileSync(markerPath(), 'utf8')) as { diskImage?: unknown }).diskImage;
    rmSync(markerPath(), { force: true });
  } catch {
    return;
  }
  if (typeof volume !== 'string' || runningFromDiskImage(volume) !== volume || !existsSync(volume)) return;
  await app.whenReady();
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: mainT('install.title'),
    message: mainT('install.done'),
    detail: mainT('install.trashDetail'),
    buttons: [mainT('install.trash'), mainT('install.keep')],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;
  try {
    const file = await diskImageFile(volume);
    await run('hdiutil', ['detach', volume]);
    if (file) await shell.trashItem(file);
  } catch (error) {
    warnMain('install', 'could not remove the installer', { volume, detail: String(error) });
  }
}
