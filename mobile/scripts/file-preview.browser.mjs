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
      window.fileRequests = []; window.holdFileReply = false;
      window.webkit = { messageHandlers: { transcript: { postMessage(json) {
        const event = JSON.parse(json);
        if (event.type !== 'readFilePreview') return;
        window.fileRequests.push(event);
        if (window.holdFileReply) return;
        queueMicrotask(() => window.companionTranscript.setContent(JSON.stringify({ type: 'conversationFile', requestId: event.requestId, agentId: event.agentId,
          preview: { path: event.input.path, source: { path: event.input.path, size: 100, kind: 'text', content: Array.from({ length: 40 }, (_, i) => `export const line${i + 1} = ${i};`).join('\n') },
            diff: 'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-oldValue\n+newValue\n', diffScope: 'uncommitted' } })));
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
    await pane.getByText('Current file', { exact: true }).waitFor({ timeout: 2500 });
    assert.match(await pane.textContent(), /line8/);
    assert.equal(await page.evaluate(() => window.fileRequests.length), 1);
    assert.equal(await page.evaluate(() => window.fileRequests[0].input.line), 8);
    await page.waitForFunction(() => {
      const pane = document.querySelector('.transcript-file__content');
      const line = pane?.querySelectorAll('.source-preview-panel__content .line')[7];
      return line && line.getBoundingClientRect().top >= pane.getBoundingClientRect().top && line.getBoundingClientRect().top < pane.getBoundingClientRect().top + 80;
    });
    await pane.getByRole('button', { name: 'Diff', exact: true }).click();
    await pane.getByText('Uncommitted changes', { exact: true }).waitFor();
    assert.match(await pane.textContent(), /newValue/);
    await pane.getByRole('button', { name: 'Source', exact: true }).click();
    assert.equal(await page.evaluate(() => window.fileRequests.length), 1, 'switching modes reuses the loaded file');
    for (const width of [320, 393, 1100]) {
      await page.setViewportSize({ width, height: 740 });
      const geometry = await pane.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, viewport: innerWidth, page: document.documentElement.scrollWidth }; });
      assert.ok(geometry.left >= 0 && geometry.right <= width + 1 && geometry.page <= width, JSON.stringify(geometry));
      if (width >= 1000) assert.ok(geometry.left > 0, 'wide screens keep the transcript beside the pane');
      else assert.ok(geometry.width >= width - 2, 'narrow phones use the full width');
      evidence.push(geometry);
    }
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
    await pane.getByText('Current file', { exact: true }).waitFor();
    assert.match(await pane.textContent(), /line8/);
    await page.evaluate(() => { window.holdFileReply = true; });
    await pane.getByRole('button', { name: 'Refresh file preview' }).click();
    const large = await page.evaluate(() => window.fileRequests.at(-1));
    await page.evaluate(request => window.companionTranscript.setContent(JSON.stringify({ type: 'conversationFile', requestId: request.requestId, agentId: 'two',
      preview: { path: 'src/app.ts', source: { path: 'src/app.ts', size: 9000000, kind: 'tooLarge' }, diff: null, diffScope: 'turn', diffUnavailable: true } })), large);
    await pane.getByText('This file is too large to preview.', { exact: true }).waitFor();
    await pane.getByRole('button', { name: 'Diff', exact: true }).click();
    await pane.getByText('Changes in this turn', { exact: true }).waitFor();
    assert.ok(await pane.getByText('This diff is unavailable or too large to preview.', { exact: true }).isVisible());
    const dir = fileURLToPath(new URL('../../.app-dev/mobile-file-preview/', import.meta.url));
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/${process.env.TRANSCRIPT_BROWSER ?? 'chromium'}.json`, JSON.stringify({ passed: true, evidence }, null, 2));
  } finally { await browser?.close(); await server.close(); }
});
