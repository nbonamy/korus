import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { webkit } from 'playwright';

// Owns the engine/native/transcript contract: zero transcript bytes on a warm
// switch, ordered deltas, lost-page recovery, and preserved reading position.
test('retained conversations switch locally and apply incremental refreshes through the real transcript', async () => {
  const server = await createServer({ configFile: fileURLToPath(new URL('../web/vite.config.ts', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await server.listen(); browser = await webkit.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    await page.addInitScript(() => { window.webkit = { messageHandlers: { transcript: { postMessage() {} } } }; });
    await page.goto(`${server.resolvedUrls.local[0]}transcript.html`);
    await page.waitForFunction(() => window.companionTranscript);
    const result = await page.evaluate(async () => {
      const agent = id => ({ id, teamId: 'team', backend: 'claude', backendSession: { kind: 'claude', sessionId: id }, name: id, status: { type: 'idle' } });
      const context = id => ({ agentId: id, agent: agent(id), peers: [], ready: true, generation: 1, history: { hasOlder: false, loadingOlder: false, failed: false } });
      const reset = id => ({ type: 'claude.conversationSnapshotChanged', backend: 'claude', agentId: id, payload: { revision: 1, snapshot: { agentId: id, sessionId: id, activeTurnId: null, turnIds: [], turns: [], messages: Array.from({ length: 70 }, (_, i) => ({ id: `${id}-${i}`, agentId: id, role: 'assistant', status: 'complete', parts: [{ type: 'text', text: `${id} message ${i}. `.repeat(20) }] })), answeredClientRequestIds: [], busy: false, historyLoading: false, historyState: { hasOlder: false, loadingOlder: false }, contextUsage: null, plan: null, error: null } } });
      const transfer = (id, revision, frames) => ({ type: 'conversationTransfer', identity: id, checkpoint: { epoch: id, revision }, ...context(id), frames });
      const api = window.companionTranscript;
      await api.setTransfer(JSON.stringify(transfer('a', 1, [reset('a')])));
      const scroller = () => [...document.querySelectorAll('.transcript *')].find(el => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 20);
      scroller().scrollTop -= 200; scroller().dispatchEvent(new Event('scroll'));
      const position = scroller().scrollTop;
      await api.setTransfer(JSON.stringify(transfer('b', 1, [reset('b')])));
      const warm = transfer('a', 1, []); const start = performance.now();
      const receipt = await api.setTransfer(JSON.stringify(warm)); const elapsedMs = performance.now() - start;
      const restoredPosition = scroller().scrollTop;
      const event = { type: 'claude.conversationEventReceived', backend: 'claude', agentId: 'a', payload: { revision: 2, event: { type: 'message.replaced', agentId: 'a', backend: 'claude', backendSessionId: 'a', occurredAt: 'now', payload: { message: { id: 'new-answer', agentId: 'a', role: 'assistant', status: 'complete', parts: [{ type: 'text', text: 'Incremental answer received' }] } } } } };
      const incremental = transfer('a', 2, [event]);
      await api.setTransfer(JSON.stringify(incremental));
      await api.setTransfer(JSON.stringify(incremental));
      const text = document.body.textContent;
      const missing = await api.setTransfer(JSON.stringify(transfer('lost-page', 1, [])));
      return { elapsedMs, position, restoredPosition, warmBytes: JSON.stringify(warm).length, resetBytes: JSON.stringify(transfer('a', 1, [reset('a')])).length, deltaBytes: JSON.stringify(incremental).length, receipt, matches: text.split('Incremental answer received').length - 1, missing };
    });
    assert.equal(result.receipt.identity, 'a');
    assert.equal(result.restoredPosition, result.position, 'warm selection restores the SDK reading position');
    assert.equal(result.matches, 1, 'a replayed event must not duplicate its message');
    assert.equal(result.missing.needsReset, true, 'a lost WebView replica requests a safe baseline');
    assert.ok(result.warmBytes < result.resetBytes / 20);
    assert.ok(result.deltaBytes < result.resetBytes / 20);
    await writeFile('/tmp/korus-ios-conversation-refresh-browser.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await browser?.close(); await server.close(); }
});
