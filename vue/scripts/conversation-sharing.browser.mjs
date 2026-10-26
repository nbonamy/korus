import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

// Reproducible owner UI captures using production components and redacted synthetic data.
const repository = fileURLToPath(new URL('../../', import.meta.url));
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error('Pass an absolute output directory outside the repository.');
if (path.resolve(output).startsWith(path.resolve(repository))) throw new Error('Capture output must be outside the repository.');
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: false, root: `${repository}/vue/src/components/__tests__/fixtures/conversation-sharing`, resolve: { alias: { '@workspace/core': `${repository}/core/src` }, dedupe: ['vue'] }, plugins: [vue()], server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] } }, logLevel: 'error' });
let browser;
try {
  await server.listen(); browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 740 } });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto(server.resolvedUrls.local[0]);
  const share = page.getByRole('button', { name: 'Share', exact: true });
  await share.waitFor();
  // Electron's frameless title bar consumes pointer input in draggable regions.
  // A DOM-dispatched click alone cannot catch a header action that remains draggable.
  assert.equal(await share.evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region')), 'no-drag');
  assert.equal(await share.innerText(), '');
  assert.equal(await share.locator('svg').count(), 1);
  assert.equal(await share.getAttribute('title'), 'Share');
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'header-share.png') });
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('button', { name: 'Create and copy link' }).waitFor();
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'header-share-dialog.png') });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.agent-sidebar__agent').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Share with guests', exact: true }).waitFor();
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'context-menu-share.png') });
  await page.getByRole('menuitem', { name: 'Share with guests', exact: true }).click();
  await page.getByRole('button', { name: 'Create and copy link' }).waitFor();
  await page.getByRole('button', { name: 'Create and copy link' }).click();
  await page.getByRole('button', { name: 'Copy link', exact: true }).waitFor();
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'active-share-copy-error.png') });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(server.resolvedUrls.local[0]).origin });
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await page.getByText('Copied', { exact: true }).waitFor();
  assert.equal(await page.locator('.app-dialog__footer button').count(), 2);
  assert.deepEqual(await page.locator('.app-dialog__footer button').allTextContents(), ['Stop sharing', 'Copy link']);
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'active-share-dialog.png') });
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'capture.json'), JSON.stringify({ fixture: 'production owner components; synthetic state and control port; no provider or relay', credentials: 'redacted fixture; no real bearer generated', entries: ['persistent header Share', 'conversation context menu Share with guests'], screenshots: ['header-share.png', 'header-share-dialog.png', 'context-menu-share.png', 'active-share-dialog.png', 'active-share-copy-error.png'], pageErrors: errors }, null, 2));
  console.log(`Redacted captures saved to ${output}`);
} finally { await browser?.close(); await server.close(); }
