import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

test('the transcript retrieves deferred Claude content only on demand through bounded native replies', async () => {
  const server = await createServer({ configFile: fileURLToPath(new URL('../web/vite.config.ts', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await server.listen(); browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 402, height: 740 } });
    await page.addInitScript(() => {
      window.contentRequests = [];
      window.webkit = { messageHandlers: { transcript: { postMessage(json) {
        const command = JSON.parse(json);
        if (command.type !== 'readConversationContent') return;
        window.contentRequests.push(command);
        const bytes = window.fullContentBytes;
        const end = Math.min(command.input.offset + 64 * 1024, bytes.length);
        const data = btoa(Array.from(bytes.slice(command.input.offset, end), (byte) => String.fromCharCode(byte)).join(''));
        queueMicrotask(() => window.companionTranscript.setContent(JSON.stringify({ requestId: command.requestId, agentId: command.agentId, sessionId: command.input.sessionId,
          chunk: { data, nextOffset: end < bytes.length ? end : null, totalBytes: bytes.length } })));
      } } } };
    });
    await page.goto(`${server.resolvedUrls.local[0]}transcript.html`);
    await page.waitForFunction(() => window.companionTranscript);
    await page.evaluate(async () => {
      const agent = { id: 'content-agent', name: 'Content', folder: null, backend: 'claude', backendSession: { kind: 'claude', sessionId: 'content-session', transport: 'stdio' }, status: { type: 'idle' }, createdAt: '', updatedAt: '' };
      const message = { id: 'deferred-message', agentId: agent.id, role: 'assistant', status: 'complete', createdAt: '', parts: [{ type: 'text', text: '工具🙂 '.repeat(15_000) + 'Lossless content reached the transcript.' }] };
      window.fullContentBytes = new TextEncoder().encode(JSON.stringify(message));
      const preview = { ...message, parts: [{ type: 'text', text: 'Preview only' }], deferredContent: { contentId: 'a'.repeat(64), byteLength: window.fullContentBytes.length } };
      await window.companionTranscript.setConversation(JSON.stringify({ agentId: agent.id, agent, ready: true, peers: [], history: { hasOlder: false, loadingOlder: false, failed: false }, engines: null,
        frame: { agentId: agent.id, backend: 'claude', payload: { snapshot: { messages: [preview], turns: [], activeTurnId: null, busy: false } } } }));
    });
    assert.equal(await page.evaluate(() => window.contentRequests.length), 0);
    await page.getByRole('button', { name: 'Load full content', exact: true }).click();
    await page.getByText('Lossless content reached the transcript.', { exact: false }).waitFor();
    const requests = await page.evaluate(() => window.contentRequests);
    assert.ok(requests.length > 1);
    assert.deepEqual(requests.map((request) => request.input.offset), requests.map((_, index) => index * 64 * 1024));
    assert.ok(requests.every((request) => request.agentId === 'content-agent' && request.input.sessionId === 'content-session'));
    assert.equal(await page.getByText('Preview only', { exact: true }).count(), 0);
  } finally { await browser?.close(); await server.close(); }
});

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
      const agent = { id: 'presentation-agent', teamId: 'scroll-team', name: 'Presentation test', folder: null, readState: { revision: 3, readRevision: 1 },
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
        ready: true, frame: null, agent: { ...agent, name: null, sessionKind: 'quickChat' },
        engines: { current: 'codex', choices: ['codex', 'claude'] },
      }));
      return { before, ready, after, superseded, empty, newThread };
    });
    assert.deepEqual(presentation, { before: false, ready: { agentId: 'presentation-agent', revision: 3 }, after: true, superseded: null, empty: null, newThread: { agentId: 'presentation-agent', revision: 3 } });
    assert.ok(await page.locator('.conversation-pane__empty h1').isVisible(), 'the empty quick chat shows its welcome headline');
    assert.equal(await page.getByRole('radio', { name: 'Codex', exact: true }).getAttribute('aria-checked'), 'true');
    await page.getByRole('radio', { name: 'Claude', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.nativeEvents.at(-1)), { type: 'backend', backend: 'claude' });
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

test('a context update changes the chat around the transcript without redrawing it, and only for the chat it was made for', async () => {
  const server = await createServer({ configFile: fileURLToPath(new URL('../web/vite.config.ts', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 402, height: 740 } });
    await page.addInitScript(() => { window.webkit = { messageHandlers: { transcript: { postMessage() {} } } }; });
    await page.goto(`${server.resolvedUrls.local[0]}transcript.html`);
    await page.waitForFunction(() => window.companionTranscript);
    const result = await page.evaluate(async () => {
      const agent = { id: 'a', teamId: 't', name: 'First', folder: null, backend: 'codex', status: { type: 'idle' }, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
      const messages = Array.from({ length: 200 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? 'assistant' : 'user', status: 'complete', createdAt: '2026-01-01', parts: [{ type: 'text', text: `message ${index} ${'x'.repeat(900)}` }] }));
      const full = { agentId: 'a', ready: true, agent, peers: [{ id: 'a', label: 'First' }], history: { hasOlder: false, loadingOlder: false, failed: false }, engines: null,
        frame: { agentId: 'a', backend: 'codex', payload: { snapshot: { messages, turns: [], activeTurnId: null, busy: false } } } };
      let started = performance.now();
      await window.companionTranscript.setConversation(JSON.stringify(full));
      const conversationMs = performance.now() - started;
      const last = [...document.querySelectorAll('p, div, span')].reverse().find((element) => element.children.length === 0 && element.textContent.includes('message 199'));
      const rendered = Boolean(last);
      const { frame: _frame, ...context } = full;
      started = performance.now();
      window.companionTranscript.setContext(JSON.stringify({ ...context, agent: { ...agent, statusText: 'Working' } }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const contextMs = performance.now() - started;
      // The same element, not a redrawn copy of it.
      const stillThere = document.body.textContent.includes('message 199') && last.isConnected;
      const elementKept = last.isConnected;
      // A context for another chat must not touch this one.
      window.companionTranscript.setContext(JSON.stringify({ ...context, agentId: 'other', agent: { ...agent, id: 'other', name: 'Other' } }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return { rendered, stillThere, elementKept, conversationMs: Math.round(conversationMs), contextMs: Math.round(contextMs), hasOther: document.body.textContent.includes('Other') };
    });
    console.info(`[page] 200 x 1KB messages, each including a ~32 ms two-frame wait: full conversation ${result.conversationMs} ms, context update ${result.contextMs} ms`);
    assert.equal(result.rendered, true);
    assert.equal(result.stillThere, true);
    assert.equal(result.elementKept, true);
    assert.equal(result.hasOther, false);
  } finally { await browser?.close(); await server.close(); }
});
