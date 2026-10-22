import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(new URL('../electron/package.json', import.meta.url));
const { MakerZIP } = require('@electron-forge/maker-zip');
const extract = require('extract-zip');

// Protect both initial creation and replacement of a valid Windows ZIP. Only
// PowerShell is substituted on other hosts; Forge and filesystem operations are real.
test('the installed Windows ZIP maker creates and replaces an extractable archive', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-windows-zip-'));
  const dir = path.join(root, 'app-win32-x64');
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const nativeWindows = process.platform === 'win32';
  const execFile = cp.execFile;
  if (!nativeWindows) {
    t.mock.method(cp, 'execFile', (command, args, options, callback) => {
      assert.equal(command, 'powershell.exe');
      const input = args[args.indexOf('-myInPath') + 1].slice(1, -1);
      const output = args[args.indexOf('-myOutPath') + 1].slice(1, -1);
      return execFile('zip', ['-qr', output, '.'], { ...options, cwd: input }, callback);
    });
  }
  try {
    await mkdir(dir);
    const maker = new MakerZIP({}, ['win32']);
    await maker.prepareConfig('x64');
    for (const content of ['first build', 'replacement build']) {
      await writeFile(path.join(dir, 'app.txt'), content);
      let artifacts;
      try {
        if (!nativeWindows) Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
        artifacts = await maker.make({
          dir, makeDir: path.join(root, 'make'), appName: 'app',
          packageJSON: { version: '1.0.0' }, targetArch: 'x64', targetPlatform: 'win32',
        });
      } finally {
        if (!nativeWindows) Object.defineProperty(process, 'platform', platform);
      }
      const expected = path.join(root, 'make', 'zip', 'win32', 'x64', 'app-win32-x64-1.0.0.zip');
      assert.deepEqual(artifacts, [expected]);
      const destination = path.join(root, content);
      await extract(expected, { dir: destination });
      assert.equal(await readFile(path.join(destination, 'app.txt'), 'utf8'), content);
    }
  } finally {
    if (!nativeWindows) Object.defineProperty(process, 'platform', platform);
    t.mock.restoreAll();
    await rm(root, { recursive: true, force: true });
  }
});
