import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, webkit } from 'playwright';

// Guards ignored file links, duplicate reads on tab changes, stale-agent replies and unusable narrow panes.
test('transcript files open Source and Diff on demand, fit phones and wide screens, and discard stale replies', async () => {
  const server = await createServer({ configFile: fileURLToPath(new URL('../web/vite.config.ts', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
  let browser;
  const evidence = [];
  try {
    await server.listen(); browser = await (process.env.TRANSCRIPT_BROWSER === 'webkit' ? webkit : chromium).launch();
    const page = await browser.newPage({ viewport: { width: 393, height: 740 } });
    await page.addInitScript(() => {
      window.fileRequests = []; window.holdFileReply = false; window.fileLineCount = 40;
      window.webkit = { messageHandlers: { transcript: { postMessage(json) {
        const event = JSON.parse(json);
        if (event.type !== 'readFilePreview') return;
        window.fileRequests.push(event);
        if (window.holdFileReply) return;
        queueMicrotask(() => window.companionTranscript.setContent(JSON.stringify({ type: 'conversationFile', requestId: event.requestId, agentId: event.agentId,
          preview: { path: event.input.path, source: { path: event.input.path, size: 100, kind: 'text', content: window.fileContent ?? Array.from({ length: window.fileLineCount }, (_, i) => `export const line${i + 1} = ${i};`).join('\n') },
            diff: window.fileDiff ?? 'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-oldValue\n+newValue\n', diffScope: 'uncommitted' } })));
      } } } };
    });
    await page.goto(`${server.resolvedUrls.local[0]}transcript.html`);
    await page.waitForFunction(() => window.companionTranscript);
    const select = (id, generation) => page.evaluate(async ({ id, generation }) => {
      const agent = { id, name: id, backend: 'codex', backendSession: { kind: 'codex', threadId: id }, status: { type: 'idle' }, createdAt: '', updatedAt: '', readState: { revision: 1 } };
      await window.companionTranscript.setConversation(JSON.stringify({ agentId: id, generation, ready: true, agent, peers: [],
        frame: { payload: { snapshot: { messages: [{ id: 'message', role: 'assistant', status: 'complete', createdAt: '', parts: [{ type: 'text', text: 'Read [app.ts](src/app.ts:8) for details.' }] }], turns: [], activeTurnId: null, busy: false } } } }));
    }, { id, generation });
    await select('one', 1);
    assert.equal(await page.evaluate(() => window.fileRequests.length), 0);
    await page.getByRole('link', { name: 'app.ts', exact: true }).click();
    const pane = page.getByRole('complementary', { name: 'File preview' });
    await pane.locator('.source-preview-panel__content .line').first().waitFor({ timeout: 2500 });
    assert.match(await pane.textContent(), /line8/);
    assert.equal(await page.evaluate(() => window.fileRequests.length), 1);
    assert.equal(await page.evaluate(() => window.fileRequests[0].input.line), 8);
    await page.waitForFunction(() => {
      const pane = document.querySelector('.transcript-file__content');
      const line = pane?.querySelectorAll('.source-preview-panel__content .line')[7];
      return line && line.getBoundingClientRect().top >= pane.getBoundingClientRect().top && line.getBoundingClientRect().top < pane.getBoundingClientRect().top + 80;
    });
    // The compact mode action stays between refresh and close, with no text tab row.
    const toolbar = pane.locator('header');
    const headerGap = await pane.evaluate(el => el.querySelector('.transcript-file__content').getBoundingClientRect().top - el.querySelector('header').getBoundingClientRect().bottom);
    assert.ok(headerGap <= 2, `extra row below file toolbar: ${headerGap}px`);
    assert.deepEqual(await toolbar.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))), ['Refresh file preview', 'Show diff', 'Close file preview']);
    assert.equal(await toolbar.getByRole('button', { name: 'Show diff', exact: true }).textContent(), '');
    await pane.getByRole('button', { name: 'Show diff', exact: true }).click();
    await pane.locator('.git-diff-preview-panel').waitFor();
    assert.match(await pane.textContent(), /newValue/);
    const navigation = pane.getByRole('group', { name: 'Diff navigation' });
    assert.equal(await navigation.count(), 1);
    assert.match(await navigation.textContent(), /\+1.*[−-]1/);
    assert.equal(await pane.getByRole('button', { name: 'Next change', exact: true }).count(), 0, 'one change needs only stats');
    await pane.getByRole('button', { name: 'Show source', exact: true }).click();
    assert.equal(await page.evaluate(() => window.fileRequests.length), 1, 'switching modes reuses the loaded file');
    for (const width of [320, 393, 1100]) {
      await page.setViewportSize({ width, height: 740 });
      const geometry = await pane.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, viewport: innerWidth, page: document.documentElement.scrollWidth }; });
      assert.ok(geometry.left >= 0 && geometry.right <= width + 1 && geometry.page <= width, JSON.stringify(geometry));
      if (width >= 1000) assert.ok(geometry.left > 0, 'wide screens keep the transcript beside the pane');
      else assert.ok(geometry.width >= width - 2, 'narrow phones use the full width');
      const gutter = await pane.locator('.source-preview-panel__content .line').first().evaluate(line => {
        const number = getComputedStyle(line, '::before');
        const canvas = document.createElement('canvas'); const context = canvas.getContext('2d'); context.font = number.font;
        const digit = context.measureText('0').width;
        return { width: parseFloat(number.width), digit, inset: line.getBoundingClientRect().left - line.closest('.transcript-file').getBoundingClientRect().left, codeOffset: parseFloat(getComputedStyle(line).paddingLeft) };
      });
      assert.ok(gutter.inset <= 6, JSON.stringify(gutter));
      assert.ok(gutter.width <= gutter.digit * 3.5 && gutter.codeOffset <= gutter.digit * 4.5, JSON.stringify(gutter));
      evidence.push({ ...geometry, gutter });
    }
    // Four-digit line numbers keep enough room without restoring the desktop gutter.
    await page.evaluate(() => { window.fileLineCount = 1000; });
    await pane.getByRole('button', { name: 'Refresh file preview' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.source-preview-panel__content .line').length === 1000);
    const largeGutter = await pane.locator('.source-preview-panel__content .line').last().evaluate(line => {
      const number = getComputedStyle(line, '::before');
      const canvas = document.createElement('canvas'); const context = canvas.getContext('2d'); context.font = number.font;
      return { width: parseFloat(number.width), numberWidth: context.measureText('1000').width, padding: parseFloat(number.paddingRight) };
    });
    assert.ok(largeGutter.width >= largeGutter.numberWidth + largeGutter.padding, JSON.stringify(largeGutter));
    evidence.push({ largeGutter });
    // Pseudo-element padding must be included when keeping log glyphs out of the gutter.
    await page.setViewportSize({ width: 393, height: 740 });
    await page.evaluate(() => { window.fileContent = 'ℹ pass 0\nℹ fail 1\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 1685.957416'; });
    await pane.getByRole('button', { name: 'Refresh file preview' }).click();
    await pane.getByText('ℹ pass 0', { exact: false }).first().waitFor();
    const logGutter = await pane.locator('.source-preview-panel__content .line').first().evaluate(line => {
      const number = getComputedStyle(line, '::before');
      const extras = number.boxSizing === 'border-box' ? 0 : parseFloat(number.paddingRight) + parseFloat(number.borderRightWidth);
      const gutterRight = line.getBoundingClientRect().left + parseFloat(number.width) + extras;
      const text = document.createTreeWalker(line, NodeFilter.SHOW_TEXT).nextNode();
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 1);
      return { gutterRight, textLeft: range.getBoundingClientRect().left, boxSizing: number.boxSizing };
    });
    assert.ok(logGutter.textLeft >= logGutter.gutterRight + 2, JSON.stringify(logGutter));
    evidence.push({ logGutter });
    await page.evaluate(() => { window.fileContent = undefined; });
    // Navigation stays pinned, jumps between actual change sections, and tracks manual scrolling.
    await page.evaluate(() => {
      window.fileDiff = ['diff --git a/src/app.ts b/src/app.ts', '--- a/src/app.ts', '+++ b/src/app.ts', ...Array.from({ length: 3 }, (_, i) => [
        `@@ -${i * 60 + 1},41 +${i * 60 + 1},41 @@`, `-before${i}`, `+after${i}`, ...Array.from({ length: 40 }, (_, j) => ` context${i}_${j}`),
      ]).flat()].join('\n');
    });
    await pane.getByRole('button', { name: 'Refresh file preview' }).click();
    await pane.locator('.source-preview-panel__content .line').first().waitFor();
    await pane.getByRole('button', { name: 'Show diff', exact: true }).click();
    await navigation.getByText('Change 1 of 3', { exact: true }).waitFor({ timeout: 2500 });
    assert.match(await navigation.textContent(), /\+3.*[−-]3/);
    assert.equal(await navigation.getByRole('button', { name: 'Previous change', exact: true }).isDisabled(), true);
    const pinnedTop = await navigation.evaluate(el => el.getBoundingClientRect().top);
    assert.ok(Math.abs(pinnedTop - await toolbar.evaluate(el => el.getBoundingClientRect().bottom)) <= 1);
    await navigation.getByRole('button', { name: 'Next change', exact: true }).click();
    await navigation.getByText('Change 2 of 3', { exact: true }).waitFor();
    const secondScroll = await pane.locator('.transcript-file__content').evaluate(el => el.scrollTop);
    assert.ok(secondScroll > 300);
    await navigation.getByRole('button', { name: 'Next change', exact: true }).click();
    await navigation.getByText('Change 3 of 3', { exact: true }).waitFor();
    assert.equal(await navigation.getByRole('button', { name: 'Next change', exact: true }).isDisabled(), true);
    assert.ok(Math.abs(await navigation.evaluate(el => el.getBoundingClientRect().top) - pinnedTop) <= 1);
    assert.equal(await pane.locator('.git-diff-preview-panel__file-header-row').first().isVisible(), false, 'the filename is not repeated');
    await pane.locator('.transcript-file__content').evaluate((el, top) => { el.scrollTop = top + 8; }, secondScroll);
    await navigation.getByText('Change 2 of 3', { exact: true }).waitFor();
    await pane.locator('.transcript-file__content').evaluate(el => { el.scrollTop = 0; });
    await navigation.getByText('Change 1 of 3', { exact: true }).waitFor();
    await navigation.getByRole('button', { name: 'Next change', exact: true }).focus(); await page.keyboard.press('Enter');
    await navigation.getByText('Change 2 of 3', { exact: true }).waitFor();
    await navigation.getByRole('button', { name: 'Previous change', exact: true }).click();
    await navigation.getByText('Change 1 of 3', { exact: true }).waitFor();
    for (const width of [320, 1100]) {
      await page.setViewportSize({ width, height: 740 });
      const bounds = await navigation.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, viewport: innerWidth, page: document.documentElement.scrollWidth }; });
      assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.page <= width, JSON.stringify(bounds));
    }
    evidence.push({ navigation: { pinnedTop, changes: 3, keyboard: true, tracksScroll: true } });
    await pane.getByRole('button', { name: 'Close file preview' }).click();
    assert.equal(await pane.count(), 0);
    await page.evaluate(() => { window.holdFileReply = true; });
    await page.getByRole('link', { name: 'app.ts', exact: true }).click();
    await pane.getByRole('button', { name: 'Refresh file preview' }).click();
    const request = await page.evaluate(() => window.fileRequests.at(-1));
    await select('two', 2);
    await page.evaluate(request => window.companionTranscript.setContent(JSON.stringify({ type: 'conversationFile', requestId: request.requestId, agentId: 'one', preview: { path: 'wrong', source: null, diff: 'secret', diffScope: 'turn' } })), request);
    assert.equal(await pane.count(), 0, 'late results cannot reopen the pane in another conversation');
    await page.getByRole('link', { name: 'app.ts', exact: true }).click();
    const failed = await page.evaluate(() => window.fileRequests.at(-1));
    await page.evaluate(request => window.companionTranscript.setContent(JSON.stringify({ type: 'conversationFile', requestId: request.requestId, agentId: 'two', error: 'Offline' })), failed);
    await pane.getByRole('alert').waitFor();
    await page.evaluate(() => { window.holdFileReply = false; });
    await pane.getByRole('button', { name: 'Retry', exact: true }).click();
    await pane.locator('.source-preview-panel__content .line').first().waitFor();
    assert.match(await pane.textContent(), /line8/);
    await page.evaluate(() => { window.holdFileReply = true; });
    await pane.getByRole('button', { name: 'Refresh file preview' }).click();
    const large = await page.evaluate(() => window.fileRequests.at(-1));
    await page.evaluate(request => window.companionTranscript.setContent(JSON.stringify({ type: 'conversationFile', requestId: request.requestId, agentId: 'two',
      preview: { path: 'src/app.ts', source: { path: 'src/app.ts', size: 9000000, kind: 'tooLarge' }, diff: null, diffScope: 'turn', diffUnavailable: true } })), large);
    await pane.getByText('This file is too large to preview.', { exact: true }).waitFor();
    await pane.getByRole('button', { name: 'Show diff', exact: true }).click();
    assert.ok(await pane.getByText('This diff is unavailable or too large to preview.', { exact: true }).isVisible());
    const dir = fileURLToPath(new URL('../../.app-dev/mobile-file-preview/', import.meta.url));
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/${process.env.TRANSCRIPT_BROWSER ?? 'chromium'}.json`, JSON.stringify({ passed: true, evidence }, null, 2));
  } finally { await browser?.close(); await server.close(); }
});
