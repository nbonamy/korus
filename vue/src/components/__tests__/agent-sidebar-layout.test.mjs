import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

test('Activity sidebar actions share one row at supported sidebar widths', async () => {
  const repository = fileURLToPath(new URL('../../../../', import.meta.url));
  const server = await createServer({ configFile: false, root: `${repository}/vue/src/components/__tests__/fixtures/agent-sidebar`,
    resolve: { alias: { '@workspace/core': `${repository}/core/src` }, dedupe: ['vue'] }, plugins: [vue()],
    server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] } }, logLevel: 'error' });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByRole('button', { name: 'Agent view', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Activity', exact: true }).click();
    const project = page.getByRole('button', { name: 'Add project', exact: true });
    const chat = page.getByRole('button', { name: 'Quick chat', exact: true });
    for (const hasMission of [true, false]) {
      if (!hasMission) await page.getByRole('button', { name: 'Toggle existing mission' }).click();
      for (const width of [200, 260, 420]) {
        await page.getByRole('combobox', { name: 'Sidebar width' }).selectOption(String(width));
        const first = await project.boundingBox();
        const second = await chat.boundingBox();
        assert.ok(Math.abs(first.y - second.y) < 1, `${width}px: actions must share a row`);
        assert.ok(second.x >= first.x + first.width, `${width}px: actions must not overlap`);
        const sidebar = await page.getByRole('complementary', { name: 'Agents', exact: true }).boundingBox();
        const last = hasMission ? second : await page.getByRole('button', { name: 'New mission', exact: true }).boundingBox();
        assert.ok(Math.abs(first.y - last.y) < 1);
        assert.ok(last.x + last.width <= sidebar.x + sidebar.width);
        if (hasMission && width === 260) await page.getByRole('complementary', { name: 'Agents', exact: true }).screenshot({ path: '/tmp/korus-sidebar-actions.png' });
      }
    }
    await chat.click();
    assert.equal(await page.getByLabel('Selected action').textContent(), 'quick-chat');
    await project.click();
    await page.getByRole('menu', { name: 'Add project from' }).waitFor();
  } finally { await browser?.close(); await server.close(); }
});
