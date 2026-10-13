import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));

test('bookmark toolbar respects focus visibility and toggles a yellow saved star', async () => {
  const server = await createServer({
    configFile: false,
    root: path.join(repository, 'vue/src/components/__tests__/fixtures/browser-panel-focus'),
    resolve: { alias: { '@workspace/core': path.join(repository, 'core/src') }, dedupe: ['vue'] },
    plugins: [vue()],
    server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] } },
    logLevel: 'error',
  });
  let browser;
  try {
    await server.listen();
    const { port } = server.httpServer.address();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/`);
    const star = page.getByRole('button', { name: 'Bookmark this page', exact: true });
    const external = page.getByRole('button', { name: 'Open in external browser', exact: true });
    const outside = page.locator('#outside');
    const address = page.getByRole('textbox', { name: 'Browser address', exact: true });
    const opacity = control => control.evaluate(element => getComputedStyle(element).opacity);
    const toolbar = page.locator('.browser-panel__toolbar');
    const assertActionHovers = async bookmark => {
      const menu = page.getByRole('button', { name: 'Browser menu', exact: true });
      const background = control => control.evaluate(element => getComputedStyle(element).backgroundColor);
      await menu.hover();
      const hoverBackground = await background(menu);
      assert.notEqual(hoverBackground, 'rgba(0, 0, 0, 0)');
      await address.hover();
      const controls = [bookmark, external];
      const backgrounds = () => Promise.all(controls.map(background));
      assert.deepEqual(await backgrounds(), ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'], 'Address actions must be transparent until hovered');
      for (const [index, control] of controls.entries()) {
        await control.hover();
        const expected = ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'];
        expected[index] = hoverBackground;
        assert.deepEqual(await backgrounds(), expected, 'Only the hovered action should have the shared toolbar background');
      }
    };
    await star.waitFor({ state: 'attached' });
    await outside.click();
    assert.equal(await opacity(star), '0');
    for (const button of await toolbar.getByRole('button').all()) {
      const shape = await button.evaluate(element => {
        const css = getComputedStyle(element);
        return { radius: parseFloat(css.borderTopLeftRadius), width: parseFloat(css.width), height: parseFloat(css.height) };
      });
      assert.ok(shape.radius > 0 && shape.radius < Math.min(shape.width, shape.height) / 2, 'Toolbar buttons must have rounded rectangular corners');
    }
    const pickerBox = await page.getByRole('button', { name: 'Bookmarks', exact: true }).boundingBox();
    const addressBox = await page.locator('.browser-panel__address').boundingBox();
    const annotationBox = await toolbar.locator('.browser-panel__annotate').boundingBox();
    assert.ok(addressBox.x - pickerBox.x - pickerBox.width <= 8, 'Keep the bookmark picker close to the address bar');
    assert.ok(annotationBox.x - addressBox.x - addressBox.width <= 8, 'Keep the address bar close to toolbar actions');

    await assertActionHovers(star);
    await page.locator('.browser-panel__address').hover();
    await star.click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await opacity(star), '0', 'Mouse dismissal must hide the bookmark action');
    assert.equal(await opacity(external), '0');
    await address.focus();
    await page.keyboard.press('Tab');
    assert.ok(await star.evaluate(element => element === document.activeElement));
    assert.equal(await opacity(star), '1');
    await page.keyboard.press('Enter');
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.ok(await star.evaluate(element => element === document.activeElement));
    assert.equal(await opacity(star), '1', 'Keyboard dismissal must retain visible focus');
    await outside.click();
    assert.equal(await opacity(star), '0');
    await address.click();
    assert.equal(await opacity(star), '1');
    await outside.click();
    await page.locator('.browser-panel__address').hover();
    assert.equal(await opacity(star), '1');
    assert.equal(await opacity(external), '1');
    await outside.hover();
    assert.equal(await opacity(star), '0');

    await page.locator('.browser-panel__address').hover();
    await star.click();
    await page.getByRole('textbox', { name: 'Bookmark name', exact: true }).fill('Example preview');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const saved = page.getByRole('button', { name: 'Delete Example preview', exact: true });
    await saved.waitFor({ state: 'attached' });
    const starStyle = () => saved.locator('svg').evaluate(element => {
      const style = getComputedStyle(element);
      return { color: style.color, fill: style.fill };
    });
    assert.deepEqual(await starStyle(), { color: 'rgb(234, 179, 8)', fill: 'rgb(234, 179, 8)' });
    await assertActionHovers(saved);
    if (process.env.KORUS_BROWSER_TOOLBAR_SCREENSHOT) await toolbar.screenshot({ path: process.env.KORUS_BROWSER_TOOLBAR_SCREENSHOT });
    await page.locator('html').evaluate(element => element.classList.add('dark'));
    assert.deepEqual(await starStyle(), { color: 'rgb(250, 204, 21)', fill: 'rgb(250, 204, 21)' });
    await assertActionHovers(saved);
    await page.locator('html').evaluate(element => element.classList.remove('dark'));
    await page.locator('.browser-panel__address').hover();
    await saved.click();
    await star.waitFor({ state: 'attached' });
    assert.equal(await star.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.getByRole('dialog').isVisible(), false);
    await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
    await page.getByText('No bookmarks yet. Use the star to save this page.', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});
