import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

test('the embedded transcript scrolls, requests earlier history, and keeps its reading position', async () => {
  const server = await createServer({
    configFile: fileURLToPath(new URL('../web/vite.config.ts', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 402, height: 740 } });
    // Only the native ready notification is replaced; render the actual shared pane.
    await page.addInitScript(() => {
      window.nativeEvents = [];
      window.webkit = { messageHandlers: { transcript: { postMessage(message) { window.nativeEvents.push(JSON.parse(message)); } } } };
    });
    await page.goto(`${server.resolvedUrls.local[0]}transcript.html`);
    await page.waitForFunction(() => window.companionTranscript);
    // The native loading overlay must outlive both data delivery and Vue's DOM update.
    // A superseded selection must never reveal the wrong/empty transcript.
    const presentation = await page.evaluate(async () => {
      const agent = { id: 'presentation-agent', teamId: 'scroll-team', name: 'Presentation test', folder: null,
        backend: 'codex', status: { type: 'idle' }, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
      const conversation = { agent, agents: [agent], frame: { payload: { snapshot: {
        messages: [{ id: 'presentation-message', role: 'assistant', status: 'complete', createdAt: '2026-01-01',
          parts: [{ type: 'text', text: 'The selected conversation has rendered.' }] }], turns: [], activeTurnId: null, busy: false,
      } } } };
      let paintReached = false;
      requestAnimationFrame(() => { paintReached = true; });
      const pending = window.companionTranscript.setConversation(JSON.stringify(conversation));
      const before = document.body.textContent.includes('The selected conversation has rendered.');
      const ready = await pending;
      const after = paintReached && document.body.textContent.includes('The selected conversation has rendered.');
      const stale = window.companionTranscript.setConversation(JSON.stringify(conversation));
      const cleared = window.companionTranscript.setConversation(JSON.stringify({ ...conversation, frame: null }));
      const superseded = await stale;
      const empty = await cleared;
      // A genuinely empty, loaded thread is ready too; a null frame is not.
      const newThread = await window.companionTranscript.setConversation(JSON.stringify({ ...conversation,
        ready: true, frame: null,
      }));
      return { before, ready, after, superseded, empty, newThread };
    });
    assert.deepEqual(presentation, { before: false, ready: 'presentation-agent', after: true, superseded: null, empty: null, newThread: 'presentation-agent' });
    // Cached switches reuse the mounted pane and may arrive while the previous paint is pending.
    for (let index = 0; index < 6; index++) {
      const expected = `Cached chat ${index}`;
      await page.evaluate(async ({ index, expected }) => {
        const id = `cached-${index % 2}`;
        const agent = { id, teamId: 'scroll-team', name: expected, folder: null, backend: 'claude', status: { type: 'idle' }, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
        const message = { agent, agents: [agent], ready: true, frame: { agentId: id, backend: 'claude', payload: { snapshot: {
          messages: [{ id: 'shared-message-id', role: 'assistant', status: 'complete', createdAt: '2026-01-01', parts: [{ type: 'text', text: expected }] }], turns: [], activeTurnId: null, busy: false,
        } } } };
        await window.companionTranscript.setConversation(JSON.stringify(message));
      }, { index, expected });
      assert.ok(await page.getByText(expected, { exact: true }).isVisible(), `one selection must show ${expected}`);
    }
    const initialConversation = await page.evaluate(() => {
      const agent = { id: 'scroll-agent', teamId: 'scroll-team', name: 'Scroll test', folder: null,
        backend: 'codex', status: { type: 'idle' }, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
      const messages = Array.from({ length: 30 }, (_, i) => ({ id: `message-${i}`, role: i % 2 ? 'assistant' : 'user',
        status: 'complete', createdAt: '2026-01-01', parts: [{ type: 'text', text: `Message ${i}: conversation content that should remain reachable by scrolling.` }] }));
      window.companionTranscript.setInsets(60, 100);
      const conversation = { agent, agents: [agent], history: { hasOlder: true, loadingOlder: false, failed: false }, frame: {
        payload: { snapshot: { messages, turns: [], activeTurnId: null, busy: false } },
      } };
      window.companionTranscript.setConversation(JSON.stringify(conversation));
      return conversation;
    });
    await page.getByText('Message 29:', { exact: false }).waitFor();
    const metrics = () => page.evaluate(() => {
      const scroller = [...document.querySelectorAll('.transcript *')].find((element) =>
        /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 20);
      return { documentHeight: document.documentElement.scrollHeight, viewport: innerHeight,
        scrollTop: scroller?.scrollTop ?? null, height: scroller?.clientHeight ?? null };
    });
    const initial = await metrics();
    assert.ok(initial.documentHeight <= initial.viewport + 1, `transcript escaped viewport: ${JSON.stringify(initial)}`);
    assert.ok(initial.height > 0 && initial.height <= 580, `missing bounded conversation scroller: ${JSON.stringify(initial)}`);
    await page.mouse.move(200, 350);
    // The SDK initially follows the newest message. Scroll toward older messages.
    await page.mouse.wheel(0, -900);
    await page.waitForFunction((before) => [...document.querySelectorAll('.transcript *')].some((element) =>
      /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 20 && element.scrollTop < before - 100), initial.scrollTop);
    // Native composer heights change when it expands or the keyboard appears.
    const jump = page.getByRole('button', { name: 'Scroll to bottom', exact: true });
    await jump.waitFor();
    for (const bottom of [100, 170, 400]) {
      await page.evaluate((inset) => window.companionTranscript.setInsets(60, inset), bottom);
      await page.waitForFunction((inset) => {
        const button = document.querySelector('.codex-message-list__scroll-to-bottom');
        return button && button.getBoundingClientRect().bottom <= innerHeight - inset - 8;
      }, bottom, { timeout: 1000 });
      const box = await jump.boundingBox();
      assert.ok(box.height >= 32, 'jump button must retain a usable hit target');
      assert.ok(await jump.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.bottom - 2));
      }), 'the bottom of the jump button must remain clickable');
    }
    await page.evaluate(() => window.companionTranscript.setInsets(60, 100));
    const older = await metrics();
    await page.mouse.wheel(0, 500);
    await page.waitForFunction((before) => [...document.querySelectorAll('.transcript *')].some((element) =>
      /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 20 && element.scrollTop > before + 100), older.scrollTop);
    assert.equal(await page.evaluate(() => window.nativeEvents.filter((event) => event.type === 'loadOlder').length), 0);
    // The SDK may first reveal rows from its local lazy window before asking the host.
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.mouse.wheel(0, -10000);
      try { await page.waitForFunction(() => window.nativeEvents.some((event) => event.type === 'loadOlder'), undefined, { timeout: 1000 }); break; } catch { /* reveal another local window */ }
    }
    assert.deepEqual(await page.evaluate(() => window.nativeEvents.filter((event) => event.type === 'loadOlder')), [{ type: 'loadOlder', agentId: 'scroll-agent' }]);
    await page.evaluate((conversation) => window.companionTranscript.setConversation(JSON.stringify({ ...conversation,
      history: { hasOlder: true, loadingOlder: false, failed: true },
    })), initialConversation);
    await page.getByRole('button', { name: 'Couldn’t load earlier messages. Retry' }).click();
    assert.equal(await page.evaluate(() => window.nativeEvents.filter((event) => event.type === 'loadOlder').length), 2);
    const anchor = page.getByText('Message 0:', { exact: false });
    const before = await anchor.boundingBox();
    const earlier = Array.from({ length: 10 }, (_, i) => ({ ...initialConversation.frame.payload.snapshot.messages[0], id: `earlier-${i}`,
      parts: [{ type: 'text', text: `Earlier message ${i}` }] }));
    const loaded = { ...initialConversation, history: { hasOlder: false, loadingOlder: false, failed: false }, frame: {
      payload: { snapshot: { ...initialConversation.frame.payload.snapshot, messages: [...earlier, ...initialConversation.frame.payload.snapshot.messages] } },
    } };
    await page.evaluate((conversation) => window.companionTranscript.setConversation(JSON.stringify(conversation)), loaded);
    await page.getByText('Earlier message 0', { exact: true }).waitFor();
    const after = await anchor.boundingBox();
    assert.ok(Math.abs(after.y - before.y) < 4, `reading position moved from ${before.y} to ${after.y}`);
    await page.mouse.wheel(0, -10000);
    await page.waitForFunction(() => [...document.querySelectorAll('.transcript *')].some((element) =>
      /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 20 && element.scrollTop === 0));
    assert.equal(await page.evaluate(() => window.nativeEvents.filter((event) => event.type === 'loadOlder').length), 2);
  } finally {
    await browser?.close();
    await server.close();
  }
});
