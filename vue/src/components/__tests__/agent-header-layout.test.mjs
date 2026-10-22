import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

// Protect identity priority, bounded long-name fallback and reassignment using
// real layout; jsdom does not calculate flex sizes or text clipping.
test('conversation headers preserve agent identity before branch and status context', async () => {
  const repository = fileURLToPath(new URL('../../../../', import.meta.url));
  const server = await createServer({
    configFile: false,
    root: `${repository}/vue/src/components/__tests__/fixtures/agent-header`,
    resolve: { alias: { '@workspace/core': `${repository}/core/src` }, dedupe: ['vue'] },
    plugins: [vue()],
    server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] } },
    logLevel: 'error',
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1300, height: 500 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(server.resolvedUrls.local[0]);
    const title = page.locator('header strong');
    await title.waitFor({ state: 'attached' });
    const layout = () => page.locator('header').evaluate(header => {
      const title = header.querySelector('strong');
      const line = title.parentElement;
      const controls = header.querySelector('.agent-header__activity');
      const repository = header.querySelector('.agent-header__folder');
      const bounds = element => element.getBoundingClientRect().toJSON();
      return { header: bounds(header), line: bounds(line), title: bounds(title), controls: bounds(controls),
        repository: { ...bounds(repository), clipped: repository.scrollWidth > repository.clientWidth },
        clipped: title.scrollWidth > title.clientWidth, overflow: getComputedStyle(title).textOverflow };
    });
    for (const width of [480, 320, 760, 1200]) {
      await page.getByRole('combobox', { name: 'Pane width' }).selectOption(String(width));
      for (const [index, name] of ['MartinXP', 'KentXP', 'DaveXP'].entries()) {
        await page.getByRole('combobox', { name: 'Assigned agent' }).selectOption(String(index));
        assert.equal(await title.textContent(), name);
        const measured = await layout();
        assert.equal(measured.clipped, false, `${name} must remain fully visible in a ${width}px pane`);
        assert.ok(measured.title.right <= measured.line.right + 1, 'name stays within the visible identity line');
        assert.ok(measured.title.right <= measured.controls.left, 'name and controls must not overlap');
        assert.ok(measured.controls.right <= measured.header.right, 'controls stay inside the pane');
        assert.ok(measured.repository.width > 0, 'repository context remains visible beside the name');
        assert.ok(measured.repository.right <= measured.line.right + 1, 'repository stays within the identity line');
        if (width <= 480) assert.equal(measured.repository.clipped, true, 'repository truncates before the agent name');
      }
    }
    await page.getByRole('combobox', { name: 'Pane width' }).selectOption('480');
    const beforeScroll = await title.boundingBox();
    await page.locator('#conversation').evaluate(element => { element.scrollTop = element.scrollHeight; });
    assert.deepEqual(await title.boundingBox(), beforeScroll, 'identity stays in the header while conversation scrolls');
    if (process.env.AGENT_HEADER_SCREENSHOT) await page.screenshot({ path: process.env.AGENT_HEADER_SCREENSHOT });

    await page.getByRole('combobox', { name: 'Assigned agent' }).selectOption('3');
    for (const width of [320, 480]) {
      await page.getByRole('combobox', { name: 'Pane width' }).selectOption(String(width));
      const measured = await layout();
      assert.equal(measured.clipped, true, 'an exceptionally long name has a bounded fallback');
      assert.equal(measured.overflow, 'ellipsis');
      assert.equal(await title.getAttribute('title'), await title.textContent(), 'full identity remains available on hover');
      assert.ok(measured.title.right <= measured.line.right + 1);
      assert.ok(measured.title.right <= measured.controls.left);
    }
    await page.setViewportSize({ width: 375, height: 500 });
    await page.getByRole('combobox', { name: 'Assigned agent' }).selectOption('0');
    assert.equal((await layout()).clipped, false, 'phone layout also preserves the agent name');
    assert.ok((await layout()).repository.width > 0, 'phone layout retains repository context');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});
