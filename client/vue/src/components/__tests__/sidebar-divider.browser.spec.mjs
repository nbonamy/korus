import assert from 'node:assert/strict';
import { test } from 'vitest';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

test('sidebar hover highlight stays on the pane edge without moving content', async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../agent-sidebar-common.css', import.meta.url))],
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
  } finally {
    await browser.close();
  }
});
