import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareDevelopmentShell } from './start-electron.mjs';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const product = JSON.parse(readFileSync(new URL('../core/src/product.json', import.meta.url), 'utf8'));
test('generates startup metadata and an icon without modifying the workspace manifest', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'development-shell-'));
  try {
    mkdirSync(path.join(root, 'electron/assets'), { recursive: true });
    writeFileSync(path.join(root, 'electron/package.json'), JSON.stringify({ version: '1.2.3' }));
    writeFileSync(path.join(root, 'electron/assets/icon.png'), 'icon');
    writeFileSync(path.join(root, 'electron/assets/icon-dev.png'), 'development icon');
    const shell = prepareDevelopmentShell(root);
    assert.deepEqual(JSON.parse(readFileSync(path.join(shell, 'package.json'), 'utf8')), {
      name: 'desktop-development-shell', version: '1.2.3', productName: product.name,
      desktopName: `${product.appId}.development.desktop`, main: path.join(root, 'electron/.vite/build/main.js'),
    });
    assert.equal(readFileSync(path.join(shell, 'assets/icon-dev.png'), 'utf8'), 'development icon');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
