import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = fileURLToPath(new URL('../.native-build/browser/', import.meta.url));
const server = await preview({ root, configFile: `${root}vite.config.ts`, preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.getByRole('heading', { name: 'Connect your laptop' }).waitFor();
  await page.getByText('Native services are unavailable.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Open laptop', exact: true }).count(), 0);
  assert.equal(await page.locator('[contenteditable=true]').count(), 0);
  // A browser cannot substitute an insecure credential store for the native vault.
  const viewports = [];
  await mkdir(artifacts, { recursive: true });
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [768, 1024]]) {
    await page.setViewportSize({ width, height });
    const bounds = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(bounds.scrollWidth <= width, 'native setup must fit horizontally');
    viewports.push(bounds);
    await page.screenshot({ path: `${artifacts}${width}x${height}.png` });
  }
  assert.deepEqual(errors, []);
  await writeFile(`${artifacts}result.json`, JSON.stringify({ errors, viewports, nativeVaultRequired: true }, null, 2));
  console.log('Browser boundary check passed: native storage required and setup fits four viewports. Native relay workflows require the native acceptance harness.');
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
