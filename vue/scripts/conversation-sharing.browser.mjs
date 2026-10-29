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
  await share.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Copy link', exact: true }).waitFor();
  const switches = dialog.getByRole('switch');
  assert.equal(await switches.count(), 3);
  assert.deepEqual(await switches.evaluateAll(elements => elements.map(element => element.getAttribute('aria-checked'))), ['false', 'false', 'false']);
  assert.match(await dialog.innerText(), /1234abcd/);
  assert.match(await dialog.innerText(), /5678efab/);
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'guest-access-default.png') });
  await dialog.locator('.el-switch').nth(0).click();
  await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true');
  assert.deepEqual(await switches.evaluateAll(elements => elements.map(element => element.getAttribute('aria-checked'))), ['true', 'false', 'false']);
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'guest-access-enabled.png') });
  await dialog.locator('.el-switch').nth(0).click();
  await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'false');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.agent-sidebar__agent').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Share with guests', exact: true }).click();
  await dialog.getByRole('button', { name: 'Copy link', exact: true }).waitFor();
  assert.deepEqual(await switches.evaluateAll(elements => elements.map(element => element.getAttribute('aria-checked'))), ['false', 'false', 'false']);
  assert.deepEqual(await page.locator('.app-dialog__footer button').allTextContents(), ['Close', 'Stop sharing', 'Copy link']);
  // Small-window layout must keep names and write controls inside the dialog.
  await page.setViewportSize({ width: 640, height: 740 });
  const layout = await dialog.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
  assert.equal(layout.scrollWidth <= layout.width, true);
  const footer = await dialog.locator('.app-dialog__footer').boundingBox();
  assert.equal(footer.y + footer.height <= 740, true);
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'guest-access-small-window.png') });
  await page.setViewportSize({ width: 1200, height: 740 });
  await dialog.getByRole('button', { name: 'Stop sharing', exact: true }).click();
  await page.locator('.agent-sidebar__agent').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Share with guests', exact: true }).click();
  await dialog.getByRole('button', { name: 'Share', exact: true }).waitFor();
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'inactive-share-dialog.png') });
  // The clipboard is the host boundary: failed copying must retain the created share.
  await page.evaluate(() => {
    window.restoreClipboard = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async () => { throw new Error('Synthetic clipboard failure'); };
  });
  await dialog.getByRole('button', { name: 'Share', exact: true }).click();
  await dialog.getByText('The link is saved, but copying failed. Try Copy link again.', { exact: true }).waitFor();
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'active-share-copy-error.png') });
  await page.evaluate(() => { navigator.clipboard.writeText = window.restoreClipboard; delete window.restoreClipboard; });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(server.resolvedUrls.local[0]).origin });
  await dialog.getByRole('button', { name: 'Copy link', exact: true }).click();
  await page.getByText('Invite link copied to clipboard', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '[REDACTED SYNTHETIC LINK]');
  for (const mode of ['queue', 'steer', 'readonly']) {
    await page.goto(`${server.resolvedUrls.local[0]}?guest=${mode}`);
    const label = mode === 'readonly' ? 'Send prompt' : mode === 'steer' ? 'Steer prompt' : 'Queue prompt';
    const send = page.getByRole('button', { name: label, exact: true });
    await send.waitFor();
    assert.equal(await send.isDisabled(), true);
    await page.getByRole('textbox').fill('Guest follow-up');
    await page.screenshot({ animations: 'disabled', path: path.join(output, `guest-send-${mode}.png`) });
    await send.click();
    await page.waitForFunction(() => document.querySelector('main')?.getAttribute('data-guest-control')?.includes('Guest follow-up'));
    const request = JSON.parse(await page.locator('main').getAttribute('data-guest-control'));
    assert.equal(request.text, 'Guest follow-up');
    assert.equal(request.followUpBehavior, mode === 'readonly' ? undefined : mode);
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'capture.json'), JSON.stringify({ fixture: 'production owner and guest components; synthetic state and control port; no provider or relay', credentials: 'redacted fixture; no real bearer generated', entries: ['persistent header Share', 'conversation context menu Share with guests'], screenshots: ['header-share.png', 'guest-access-default.png', 'guest-access-enabled.png', 'guest-access-small-window.png', 'inactive-share-dialog.png', 'active-share-copy-error.png', 'guest-send-queue.png', 'guest-send-steer.png', 'guest-send-readonly.png'], checks: ['read-only by default', 'individual write access', 'revocation', 'header and context-menu entry points', 'small-window overflow', 'create and stop sharing', 'clipboard failure and retry', 'guest queue and steer actions', 'read-only suggestions omit queue/steer'], pageErrors: errors }, null, 2));
  console.log(`Redacted captures saved to ${output}`);
} finally { await browser?.close(); await server.close(); }
