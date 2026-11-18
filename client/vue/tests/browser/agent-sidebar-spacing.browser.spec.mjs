import { sdkSourcePlugin } from '../../../../vite.sdk-aliases.ts';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

// The real sidebar in Activity view, rendered in Chromium: section spacing is layout, which jsdom cannot measure.
test('activity sections keep a 12px gap, except after a collapsed one', async () => {
  const repository = fileURLToPath(new URL('../../../../', import.meta.url));
  const server = await createServer({ configFile: false, root: `${repository}/client/vue/tests/browser/fixtures/agent-sidebar-activity`,
    resolve: { alias: { '@workspace/core': `${repository}/core/src` }, dedupe: ['vue'] }, plugins: [sdkSourcePlugin, vue()],
    server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] } }, logLevel: 'error' });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByRole('button', { name: 'Agent view', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Activity', exact: true }).click();
    const sections = page.locator('section.agent-sidebar__section[data-activity-group]');
    const gaps = () => sections.evaluateAll(nodes => nodes.slice(1).map((node, index) => node.getBoundingClientRect().top - nodes[index].getBoundingClientRect().bottom));
    assert.ok(await sections.count() >= 3, 'the fixture shows several activity sections');
    const expanded = await gaps();
    assert.deepEqual(expanded, expanded.map(() => 12), 'expanded sections keep the 12px gap');
    await sections.first().locator('.agent-sidebar__activity-toggle').click();
    await page.locator('section.agent-sidebar__section[data-activity-group][data-collapsed]').first().waitFor();
    const collapsed = await gaps();
    assert.equal(collapsed[0], 0, 'no gap after a collapsed section');
    assert.deepEqual(collapsed.slice(1), expanded.slice(1), 'the other sections keep the 12px gap');
  } finally { await browser?.close(); await server.close(); }
}, 60_000);
