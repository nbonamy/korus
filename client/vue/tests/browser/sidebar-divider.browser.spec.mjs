import assert from 'node:assert/strict';
import { test } from 'vitest';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

test('sidebar hover highlight stays on the pane edge without moving content', async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../../src/components/agent-sidebar-common.css', import.meta.url))],
    bundle: true, write: false,
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(2_500);
    // Cold module loading belongs to browser startup, not individual interactions.
    page.setDefaultNavigationTimeout(15_000);
    await page.setContent(`<style>${result.outputFiles[0].text}
      * { box-sizing: border-box; }
      body { margin: 0; }
      .shell { display: flex; height: 400px; }
      .content { flex: 1; }
    </style><div class="shell"><aside class="agent-sidebar">
      <nav class="agent-sidebar__list" tabindex="0"><div style="height: 1200px">Agents</div></nav>
      <div class="agent-sidebar__resize-handle" role="separator" tabindex="0"></div>
    </aside><main class="content">Conversation</main></div>`);
    const sidebar = page.locator('.agent-sidebar');
    const content = page.locator('.content');
    const handle = page.getByRole('separator');
    const before = [await sidebar.boundingBox(), await content.boundingBox()];
    await handle.hover();
    assert.deepEqual([await sidebar.boundingBox(), await content.boundingBox()], before);
    const lineRight = await handle.evaluate(el => {
      const style = getComputedStyle(el, '::after');
      return el.getBoundingClientRect().right - parseFloat(style.right);
    });
    assert.equal(lineRight, before[1].x, 'hover line ends at the conversation edge');
    await handle.focus();
    assert.deepEqual([await sidebar.boundingBox(), await content.boundingBox()], before);
    const list = page.locator('.agent-sidebar__list');
    assert.ok(await list.evaluate(el => el.scrollHeight > el.clientHeight));
    await list.hover();
    await page.mouse.wheel(0, 220);
    await page.waitForFunction(el => el.scrollTop > 0, await list.elementHandle());
    await page.keyboard.press('Tab');
    await list.focus();
    assert.equal(await list.evaluate(el => el.matches(':focus-visible')), true);
    assert.equal(await list.evaluate(el => getComputedStyle(el).scrollbarWidth), 'none');
    assert.equal(await list.evaluate(el => getComputedStyle(el, '::-webkit-scrollbar').display), 'none');
  } finally {
    await browser.close();
  }
});
