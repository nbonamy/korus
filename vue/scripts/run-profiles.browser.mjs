// Run against the fixture's isolated owning backend:
// node vue/scripts/run-profiles.browser.mjs 'http://127.0.0.1:<fixture-port>/?backend=<web-port>' /tmp/run-profiles
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const [url, output = '/tmp/korus-run-profiles'] = process.argv.slice(2);
if (!url) throw new Error('Pass the run-profiles fixture URL with its isolated backend port.');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.setDefaultTimeout(15_000);
async function choose() {
  await page.getByRole('button', { name: 'Run profiles', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Choose commands…', exact: true }).click();
  await page.getByLabel('Available commands', { exact: true }).getByRole('button').first().waitFor();
}
try {
  await page.goto(url);
  await choose();
  for (const name of ['Remove UI smoke test', 'Remove pricing:update']) {
    const leftover = page.getByRole('button', { name, exact: true });
    if (await leftover.count()) { await leftover.click(); await leftover.waitFor({ state: 'detached' }); }
  }
  assert.equal(await page.getByRole('checkbox').count(), 0);
  await page.getByRole('textbox', { name: 'Search commands', exact: true }).fill('pricing:update');
  await page.getByRole('button', { name: 'Pin pricing:update', exact: true }).click();
  await page.getByRole('button', { name: 'Remove pricing:update', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await choose();
  await page.getByRole('button', { name: 'Remove pricing:update', exact: true }).click();
  await page.getByRole('button', { name: 'Remove pricing:update', exact: true }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Custom command', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('UI smoke test');
  await page.getByLabel('Command', { exact: true }).fill('node -e "console.log(\'run-profile-preview-ok\')"');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await page.getByRole('button', { name: 'Remove UI smoke test', exact: true }).waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Run profiles', exact: true }).click();
  await page.getByRole('menuitem', { name: /UI smoke test/ }).click();
  await page.getByRole('button', { name: 'Run command', exact: true }).click();
  await page.getByLabel('Command output', { exact: true }).filter({ hasText: 'run-profile-preview-ok' }).waitFor();
  await page.screenshot({ path: `${output}/runner.png` });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await choose();
  await page.getByRole('button', { name: 'Remove UI smoke test', exact: true }).click();
  await page.getByRole('button', { name: 'Remove UI smoke test', exact: true }).waitFor({ state: 'detached' });
  await page.getByLabel('Pinned commands', { exact: true }).evaluate(element => { element.scrollTop = 0; });
  await page.waitForTimeout(250);
  const controlHeights = await page.locator('.command-picker__toolbar').evaluate(element => [...element.children].map(control => control.getBoundingClientRect().height));
  assert.deepEqual(controlHeights, [36, 36], 'Source and search controls must have the same height.');
  assert.equal(await page.getByRole('button', { name: 'Change directory…', exact: true }).count(), 0);
  await page.screenshot({ path: `${output}/picker.png` });
  const geometry = await page.locator('.command-picker__columns').evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  assert.equal(geometry.scroll <= geometry.client + 1, true, 'Picker columns must not overflow horizontally.');
  await page.setViewportSize({ width: 760, height: 740 });
  await page.screenshot({ path: `${output}/picker-compact.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log(`Verified search, one-click pinning, persistence after reload, unpinning, custom execution and compact layout. Artifacts: ${output}`);
} finally { await browser.close(); }
