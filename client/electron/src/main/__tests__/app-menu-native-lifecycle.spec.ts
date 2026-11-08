// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';

// macOS keeps the application menu after closing the last window. Exercise real
// Electron so a mocked IPC sender cannot hide a destroyed BrowserWindow getter.
describe.skipIf(process.platform !== 'darwin')('native app menu', () => {
  let folder: string;
  const require = createRequire(import.meta.url);
  const root = fileURLToPath(new URL('../../../../../', import.meta.url));

  beforeAll(async () => {
    folder = await mkdtemp(path.join(os.tmpdir(), 'app-menu-native-'));
    await build({
      configFile: false,
      logLevel: 'error',
      resolve: { alias: { '@workspace/core': path.join(root, 'core/src') } },
      build: {
        target: 'node22', outDir: folder, emptyOutDir: false, minify: false,
        lib: { entry: path.join(root, 'client/electron/src/main/app-menu.ts'), formats: ['es'], fileName: () => 'app-menu.mjs' },
        rollupOptions: {
          external: ['electron', '@codex-app-sdk/electron'],
          output: { paths: { '@codex-app-sdk/electron': fileURLToPath(import.meta.resolve('@codex-app-sdk/electron')) } },
        },
      },
    });
    await writeFile(path.join(folder, 'main.cjs'), `
      const { app, BrowserWindow, Menu } = require('electron');
      const { writeFileSync } = require('node:fs');
      const path = require('node:path');
      const scenario = process.argv.at(-1);
      const result = { scenario, beforeQuit: false, willQuit: false };
      const save = () => writeFileSync(path.join(__dirname, scenario + '.json'), JSON.stringify(result, null, 2));
      const fail = error => { result.error = String(error); result.stack = error.stack; save(); app.exit(1); };
      process.on('uncaughtException', fail);
      process.on('unhandledRejection', fail);
      app.setPath('userData', path.join(__dirname, scenario + '-profile'));
      app.on('before-quit', () => { result.beforeQuit = true; save(); });
      app.on('will-quit', () => { result.willQuit = true; save(); });
      setTimeout(() => fail(new Error('Quit did not reach native shutdown')), 10000).unref();
      app.whenReady().then(async () => {
        app.dock?.hide();
        const { installAppMenu } = await import('./app-menu.mjs');
        const window = new BrowserWindow({ show: false });
        installAppMenu(window, { debugMode: false });
        if (scenario === 'zoom') {
          await window.loadURL('data:text/html,<input autofocus value="Zoom while editing"><p>Interface text</p>');
          const items = Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items ?? []);
          const levels = [window.webContents.getZoomLevel()];
          for (const [role, accelerator] of [
            ['zoomin', 'CommandOrControl+Plus'], ['zoomin', 'CommandOrControl+Plus'],
            ['zoomout', 'CommandOrControl+-'], ['zoomout', 'CommandOrControl+-'],
            ['zoomout', 'CommandOrControl+-'], ['resetzoom', 'CommandOrControl+0'],
          ]) {
            const item = items.find(item => item.role === role);
            if (!item || item.accelerator !== accelerator) throw new Error('Missing zoom shortcut: ' + role);
            item.click({}, window, window.webContents);
            levels.push(window.webContents.getZoomLevel());
          }
          result.levels = levels;
          result.text = await window.webContents.executeJavaScript('document.querySelector("input").value');
          save();
          app.quit();
          return;
        }
        const find = items => {
          for (const item of items) {
            if (scenario === 'file-closed' ? item.label === 'Quit' : item.label.startsWith('Quit ')) return item;
            const found = item.submenu && find(item.submenu.items);
            if (found) return found;
          }
        };
        const quit = find(Menu.getApplicationMenu().items);
        // The live-window case deliberately has no renderer or preload listener.
        if (scenario !== 'app-live') window.destroy();
        result.windowDestroyed = window.isDestroyed();
        save();
        quit.click();
      }).catch(fail);
    `);
  });
  afterAll(async () => { if (folder) await rm(folder, { recursive: true, force: true }); });

  it.each(['app-closed', 'file-closed', 'app-live', 'zoom'])('executes native menu actions (%s)', async scenario => {
    const executable = path.join(path.dirname(require.resolve('electron')), 'dist/Electron.app/Contents/MacOS/Electron');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(executable, [path.join(folder, 'main.cjs'), scenario], { env, encoding: 'utf8', timeout: 15000 });
    const result: unknown = JSON.parse(await readFile(path.join(folder, `${scenario}.json`), 'utf8'));
    const artifacts = process.env.APP_NATIVE_TEST_ARTIFACTS;
    if (artifacts) {
      await mkdir(artifacts, { recursive: true });
      await writeFile(path.join(artifacts, `${scenario}.json`), JSON.stringify({ result, status: child.status, stderr: child.stderr }, null, 2));
    }
    expect(child.error).toBeUndefined();
    expect(result).not.toHaveProperty('error');
    expect(result).toMatchObject({ beforeQuit: true, willQuit: true, ...(scenario === 'zoom' ? {} : { windowDestroyed: scenario !== 'app-live' }) });
    expect(child.status, child.stderr).toBe(0);
    if (scenario === 'zoom') {
      expect(result).toMatchObject({ levels: [0, 0.5, 1, 0.5, 0, -0.5, 0], text: 'Zoom while editing' });
    }
  }, 20000);
});
