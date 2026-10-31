import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium, webkit } from 'playwright';

const browserEngine = process.env.TRANSCRIPT_BROWSER === 'webkit' ? webkit : chromium;

test('mobile diff types show matching totals and toggle one file filter without extra reads', async () => {
  const server = await createServer({ configFile: fileURLToPath(new URL('../web/vite.config.ts', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
  let browser;
  const evidence = [];
  const patch = (path, added, removed) => [
    `diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`,
    `@@ -1,${removed} +1,${added} @@`,
    ...Array.from({ length: removed }, (_, i) => `-old ${i}`),
    ...Array.from({ length: added }, (_, i) => `+new ${i}`),
  ].join('\n');
  const diff = [patch('src/app.ts', 2, 1), patch('src/app.spec.ts', 1, 1), patch('docs/readme.md', 3, 2), patch('package.json', 1, 1)].join('\n');
  try {
    await server.listen(); browser = await browserEngine.launch();
    const page = await browser.newPage({ viewport: { width: 393, height: 740 } });
    await page.addInitScript(() => {
      window.changesMessages = [];
      window.webkit = { messageHandlers: { changes: { postMessage(message) { window.changesMessages.push(message); } } } };
    });
    await page.goto(`${server.resolvedUrls.local[0]}changes.html`);
    await page.waitForFunction(() => window.companionChanges);
    const setDiff = value => page.evaluate(diff => window.companionChanges.setDiff(JSON.stringify({ diff })), value);
    await setDiff(diff); // Raw patches from older daemons carry no byKind metadata.
    const types = page.getByRole('group', { name: 'Files', exact: true });
    await types.waitFor({ timeout: 2000 });
    const files = page.locator('.git-diff-preview-panel__file-header');
    assert.equal(await types.getByRole('button').count(), 4);
    for (const [label, plus, minus, name] of [['Code', 2, 1, 'app.ts'], ['Tests', 1, 1, 'app.spec.ts'], ['Documentation', 3, 2, 'readme.md'], ['Other', 1, 1, 'package.json']]) {
      const chip = types.getByRole('button', { name: new RegExp(`^${label}: 1 file, \\+${plus}, -${minus}$`) });
      assert.ok(await chip.isVisible());
      await chip.click();
      assert.equal(await chip.getAttribute('aria-pressed'), 'true');
      assert.equal(await types.locator('[aria-pressed="true"]').count(), 1);
      assert.equal(await files.count(), 1);
      assert.match(await files.first().textContent(), new RegExp(name.replaceAll('.', '\\.')));
    }
    await types.getByRole('button', { name: /^Other:/ }).click();
    assert.equal(await types.locator('[aria-pressed="true"]').count(), 0);
    assert.equal(await files.count(), 4);
    for (const width of [320, 393]) {
      await page.setViewportSize({ width, height: 740 });
      for (const theme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: theme });
        const geometry = await types.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth,
          chipHeights: Array.from(el.querySelectorAll('button'), b => b.getBoundingClientRect().height),
          pageWidth: document.documentElement.scrollWidth, viewport: innerWidth }));
        assert.ok(geometry.chipHeights.every(height => height >= 44));
        assert.ok(geometry.pageWidth <= width, 'chips scroll inside the row, not the page');
        evidence.push({ width, theme, ...geometry });
      }
    }
    await setDiff(patch('docs/only.md', 1, 1));
    assert.equal(await types.getByRole('button').count(), 1);
    await types.getByRole('button', { name: /^Documentation:/ }).click();
    await setDiff(patch('src/fresh.ts', 1, 1));
    assert.equal(await types.locator('[aria-pressed="true"]').count(), 0, 'new patches cannot retain a stale filter');
    assert.match(await files.first().textContent(), /fresh\.ts/);
    await setDiff('diff --git a/assets/icon.png b/assets/icon.png\nBinary files a/assets/icon.png and b/assets/icon.png differ\n');
    assert.ok(await types.getByRole('button', { name: 'Other: 1 file, +0, -0', exact: true }).isVisible(), 'binary files still count as changes');
    assert.equal(await files.count(), 1);
    await setDiff('');
    assert.equal(await page.getByRole('group', { name: 'Files', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.changesMessages.length), 1, 'filtering uses the loaded patch, with no native/backend reads');
    const directory = fileURLToPath(new URL('../../.app-dev/mobile-diff-kind-evidence/', import.meta.url));
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/${process.env.TRANSCRIPT_BROWSER === 'webkit' ? 'webkit' : 'chromium'}.json`, JSON.stringify({ passed: true, evidence }, null, 2));
  } finally { await browser?.close(); await server.close(); }
});

// Protects mobile folding controls and the bounded, touch-scrollable file area.
test('changes can collapse and expand every file without losing the phone layout', async () => {
  const server = await createServer({ configFile: fileURLToPath(new URL('../web/vite.config.ts', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await server.listen(); browser = await browserEngine.launch();
    const page = await browser.newPage({ viewport: { width: 393, height: 680 } });
    await page.addInitScript(() => { window.webkit = { messageHandlers: { changes: { postMessage() {} } } }; });
    await page.goto(`${server.resolvedUrls.local[0]}changes.html`);
    await page.waitForFunction(() => window.companionChanges);
    await page.evaluate(() => window.companionChanges.setDiff(JSON.stringify({ diff: ['a.ts', 'b.ts'].map(name => [
      `diff --git a/src/${name} b/src/${name}`, `--- a/src/${name}`, `+++ b/src/${name}`,
      '@@ -1,61 +1,61 @@', '-const oldValue = 1;', '+const newValue = "a_very_long_identifier_that_should_wrap_inside_the_phone_without_horizontal_scrolling";',
      ...Array.from({ length: 60 }, (_, i) => ` const context${i} = ${i};`),
    ].join('\n')).join('\n') })));
    const files = page.getByRole('button', { expanded: true });
    await files.first().waitFor();
    assert.equal(await files.count(), 2);
    await page.getByRole('button', { name: 'Collapse all', exact: true }).click({ timeout: 2000 });
    assert.equal(await page.getByRole('button', { expanded: false }).count(), 2);
    assert.equal(await page.locator('.git-diff-preview-panel__line').count(), 0);
    await page.getByRole('button', { name: 'Expand all', exact: true }).click();
    assert.equal(await files.count(), 2);
    await files.first().click();
    await page.getByRole('button', { name: 'Expand all', exact: true }).click();
    assert.equal(await files.count(), 2);
    const geometry = await page.locator('.git-diff-preview-panel').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert.equal(geometry.scroll, geometry.width, 'wrapped diffs must fit the file card');
    await page.locator('.git-diff-preview-panel').hover();
    await page.mouse.wheel(0, 10000);
    await page.waitForFunction(() => document.querySelector('.git-diff-preview-panel').scrollTop > 0, null, { timeout: 2000 });
    const lastFile = await files.last().boundingBox();
    assert.ok(lastFile && lastFile.y >= 0 && lastFile.y + lastFile.height <= 680, 'the last file must be reachable');
    assert.ok(await page.getByRole('button', { name: 'Collapse all', exact: true }).isVisible(), 'file controls stay above the scroll area');
    await page.screenshot({ path: '/tmp/korus-mobile-changes-form.png', fullPage: true });
  } finally { await browser?.close(); await server.close(); }
});

test('empty repository chats show the repository and branch without overlapping wrapped headings', async () => {
  const server = await createServer({ configFile: fileURLToPath(new URL('../web/vite.config.ts', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await server.listen(); browser = await browserEngine.launch();
    const page = await browser.newPage({ viewport: { width: 320, height: 740 } });
    await page.addInitScript(() => { window.webkit = { messageHandlers: { transcript: { postMessage() {} } } }; });
    await page.goto(`${server.resolvedUrls.local[0]}transcript.html`);
    await page.waitForFunction(() => window.companionTranscript);
    for (const repositoryName of ['korus', 'a-very-long-repository-name-that-needs-to-wrap']) {
      await page.evaluate(async (repositoryName) => {
        const agent = { id: 'empty-repository', teamId: 'team', name: 'feat/mobile-companion', backend: 'codex',
          status: { type: 'idle' }, workspace: { kind: 'git', repositoryName, branch: 'feat/mobile-companion' } };
        await window.companionTranscript.setConversation(JSON.stringify({ agentId: agent.id, agent, frame: null, ready: true,
          engines: { current: 'codex', choices: ['codex', 'claude', 'antigravity'] } }));
      }, repositoryName);
      assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), `Chat in ${repositoryName}`);
      assert.ok(await page.getByText('feat/mobile-companion', { exact: true }).isVisible());
      const geometry = await page.getByRole('heading', { level: 1 }).evaluate(element => {
        const style = getComputedStyle(element);
        const heading = element.getBoundingClientRect();
        const subtitle = element.nextElementSibling.getBoundingClientRect();
        return { font: parseFloat(style.fontSize), line: parseFloat(style.lineHeight), bottom: heading.bottom, subtitleTop: subtitle.top,
          left: heading.left, right: heading.right, viewport: innerWidth };
      });
      assert.ok(geometry.line >= geometry.font, 'wrapped title lines must not overlap');
      assert.ok(geometry.subtitleTop >= geometry.bottom, 'branch must sit below the title');
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewport, 'long repository names must fit the phone');
    }
  } finally { await browser?.close(); await server.close(); }
});

test('the transcript automatically retrieves bounded deferred Claude content through native replies', async () => {
  const server = await createServer({ configFile: fileURLToPath(new URL('../web/vite.config.ts', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await server.listen(); browser = await browserEngine.launch();
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
    browser = await browserEngine.launch();
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
      const conversation = { agentId: agent.id, generation: 1, ready: true, agent, peers: [], frame: { payload: { snapshot: {
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
      const cleared = window.companionTranscript.setConversation(JSON.stringify({ ...conversation, ready: false, frame: null }));
      const superseded = await stale;
      const empty = await cleared;
      // A genuinely empty, loaded thread is ready too; a null frame is not.
      const newThread = await window.companionTranscript.setConversation(JSON.stringify({ ...conversation,
        ready: true, frame: null, agent: { ...agent, name: null, sessionKind: 'quickChat' },
        engines: { current: 'codex', choices: ['codex', 'claude'] },
      }));
      return { before, ready, after, superseded, empty, newThread };
    });
    assert.deepEqual(presentation, { before: false, ready: { agentId: 'presentation-agent', revision: 3, generation: 1 }, after: true, superseded: null, empty: null, newThread: { agentId: 'presentation-agent', revision: 3, generation: 1 } });
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
    const bubblePadding = await page.locator('.chat-user-text').last().evaluate(element => {
      const style = getComputedStyle(element);
      return [parseFloat(style.paddingTop), parseFloat(style.paddingBottom)];
    });
    assert.ok(bubblePadding.every(value => value >= 8 && value <= 12), 'mobile user bubbles need modest vertical breathing room');
    if (process.env.BUBBLE_SCREENSHOT) await page.screenshot({ path: process.env.BUBBLE_SCREENSHOT });
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
    browser = await browserEngine.launch();
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

test('transcript links ask iOS to open external destinations without navigating or opening a web popup', async () => {
  const server = await createServer({ configFile: fileURLToPath(new URL('../web/vite.config.ts', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await server.listen(); browser = await browserEngine.launch();
    const page = await browser.newPage({ viewport: { width: 402, height: 740 } });
    await page.addInitScript(() => {
      window.nativeEvents = [];
      window.webkit = { messageHandlers: { transcript: { postMessage(json) { window.nativeEvents.push(JSON.parse(json)); } } } };
    });
    await page.goto(`${server.resolvedUrls.local[0]}transcript.html`);
    await page.waitForFunction(() => window.companionTranscript);
    await page.evaluate(async () => {
      const agent = { id: 'links', name: 'Links', folder: null, backend: 'claude', status: { type: 'idle' }, createdAt: '', updatedAt: '' };
      const message = { id: 'links-message', role: 'assistant', status: 'complete', createdAt: '', parts: [{ type: 'text', text: '[Website](https://example.com/docs?q=hello#section) [Email](mailto:hello@example.com) [File](/workspace/readme.md)' }] };
      await window.companionTranscript.setConversation(JSON.stringify({ agentId: agent.id, agent, ready: true, peers: [], history: { hasOlder: false, loadingOlder: false, failed: false }, engines: null,
        frame: { agentId: agent.id, backend: 'claude', payload: { snapshot: { messages: [message], turns: [], activeTurnId: null, busy: false } } } }));
    });
    const original = page.url();
    await page.getByRole('link', { name: 'Website', exact: true }).click();
    await page.getByRole('link', { name: 'Email', exact: true }).click();
    await page.getByRole('link', { name: 'File', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.nativeEvents.filter(event => event.type === 'openExternal')), [
      { type: 'openExternal', url: 'https://example.com/docs?q=hello#section' },
      { type: 'openExternal', url: 'mailto:hello@example.com' },
    ]);
    assert.equal(page.url(), original);
    assert.equal(page.context().pages().length, 1);
    const preview = page.getByRole('complementary', { name: 'File preview' });
    assert.ok(await preview.isVisible(), 'local file links open the file pane rather than the external browser');
    await preview.getByRole('button', { name: 'Close file preview' }).click();
    assert.ok(await page.getByRole('link', { name: 'Website', exact: true }).isVisible());
  } finally { await browser?.close(); await server.close(); }
});

test('a normal laptop image link resolves through native and opens the image viewer, with failures visible', async () => {
  const server = await createServer({ configFile: fileURLToPath(new URL('../web/vite.config.ts', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await server.listen(); browser = await browserEngine.launch();
    const page = await browser.newPage({ viewport: { width: 402, height: 740 } });
    await page.addInitScript(() => {
      window.nativeEvents = [];
      window.webkit = { messageHandlers: { transcript: { postMessage(json) {
        const event = JSON.parse(json); window.nativeEvents.push(event);
        if (event.type === 'readConversationImage' && event.path === 'slow.png') { window.slowImageRequest = event; return; }
        if (event.type === 'readConversationImage') queueMicrotask(() => window.companionTranscript.setImage(JSON.stringify({ requestId: event.requestId, agentId: event.agentId,
          ...(event.path.endsWith('missing.png') ? { error: 'Unavailable' } : { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1xkAAAAASUVORK5CYII=' }) })));
      } } } };
    });
    await page.goto(`${server.resolvedUrls.local[0]}transcript.html`);
    await page.waitForFunction(() => window.companionTranscript);
    await page.evaluate(async () => {
      const agent = { id: 'image-links', name: 'Images', backend: 'claude', folder: '/repo', status: { type: 'idle' } };
      const message = { id: 'screenshots', role: 'assistant', parts: [{ type: 'text', text: '[Screenshot](/tmp/phone.png) [Missing](missing.png) [Slow](slow.png) [Fast](fast.png)' }, { type: 'media', media: { url: 'conversation-image:thread:' + 'a'.repeat(64), mimeType: 'image/png' } }] };
      await window.companionTranscript.setConversation(JSON.stringify({ agentId: agent.id, agent, ready: true,
        frame: { agentId: agent.id, backend: 'claude', payload: { snapshot: { messages: [message], turns: [], busy: false } } } }));
    });
    await page.waitForFunction(() => window.nativeEvents.some(event => event.type === 'readConversationImage' && event.path.startsWith('conversation-image:')));
    await page.waitForFunction(() => document.querySelector('img.chat-media-block__image')?.naturalWidth === 1);
    assert.match(await page.locator('img.chat-media-block__image').first().getAttribute('src'), /^blob:/);
    for (const [label, path, src] of [['Screenshot', '/tmp/phone.png', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1xkAAAAASUVORK5CYII='], ['Missing', 'missing.png', '']]) {
      const title = path.split('/').at(-1);
      await page.getByRole('link', { name: label, exact: true }).click();
      await page.waitForFunction(title => window.nativeEvents.some(event => event.type === 'openImage' && event.title === title), title);
      const events = await page.evaluate(() => window.nativeEvents);
      assert.ok(events.some(event => event.type === 'readConversationImage' && event.agentId === 'image-links' && event.path === path));
      assert.deepEqual(events.filter(event => event.type === 'openImage').at(-1), { type: 'openImage', agentId: 'image-links', title, src });
    }
    assert.ok(await page.getByRole('link', { name: 'Screenshot', exact: true }).isVisible());
    await page.getByRole('link', { name: 'Slow', exact: true }).click();
    await page.getByRole('link', { name: 'Fast', exact: true }).click();
    await page.waitForFunction(() => window.nativeEvents.some(event => event.type === 'openImage' && event.title === 'fast.png'));
    await page.evaluate(async () => {
      const event = window.slowImageRequest;
      window.companionTranscript.setImage(JSON.stringify({ requestId: event.requestId, agentId: event.agentId, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1xkAAAAASUVORK5CYII=' }));
      await Promise.resolve();
    });
    assert.equal((await page.evaluate(() => window.nativeEvents.filter(event => event.type === 'openImage'))).at(-1).title, 'fast.png');
  } finally { await browser?.close(); await server.close(); }
});

test('conversation images open the native viewer through the SDK action without leaking laptop paths or moving the transcript', async () => {
  const server = await createServer({ configFile: fileURLToPath(new URL('../web/vite.config.ts', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await server.listen(); browser = await browserEngine.launch();
    const page = await browser.newPage({ viewport: { width: 402, height: 740 } });
    await page.addInitScript(() => {
      window.nativeEvents = [];
      window.webkit = { messageHandlers: { transcript: { postMessage(json) {
        const event = JSON.parse(json); window.nativeEvents.push(event);
        if (event.type === 'readConversationImage') queueMicrotask(() => window.companionTranscript.setImage(JSON.stringify({ requestId: event.requestId, agentId: event.agentId,
          dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1xkAAAAASUVORK5CYII=' })));
      } } } };
    });
    await page.goto(`${server.resolvedUrls.local[0]}transcript.html`);
    await page.waitForFunction(() => window.companionTranscript);
    const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1xkAAAAASUVORK5CYII=';
    await page.evaluate(async src => {
      const agent = { id: 'image-agent', name: 'Images', folder: null, backend: 'claude', status: { type: 'idle' }, createdAt: '', updatedAt: '' };
      const messages = [
        { id: 'photo', role: 'user', parts: [{ type: 'attachment', attachment: { kind: 'image', name: 'Photo.jpg', path: '/private/laptop/Photo.jpg' } }] },
        { id: 'result', role: 'assistant', parts: [{ type: 'media', media: { title: 'Result', alt: 'Result', url: src } }] },
      ];
      window.imageConversation = { agentId: agent.id, agent, ready: true,
        frame: { agentId: agent.id, backend: 'claude', payload: { snapshot: { messages, turns: [], activeTurnId: null, busy: false } } } };
      await window.companionTranscript.setConversation(JSON.stringify(window.imageConversation));
    }, src);
    await page.waitForFunction(() => document.querySelector('[aria-label="Open Photo.jpg"] img')?.naturalWidth > 0);
    await page.evaluate(async () => {
      const image = document.querySelector('[aria-label="Open Photo.jpg"] img');
      for (let update = 0; update < 3; update++) {
        const snapshot = window.imageConversation.frame.payload.snapshot;
        snapshot.messages[1].parts.push({ type: 'text', text: `Streaming update ${update}` });
        await window.companionTranscript.setConversation(JSON.stringify(window.imageConversation));
        if (document.querySelector('[aria-label="Open Photo.jpg"] img') !== image) throw new Error('An unchanged attachment preview was replaced');
      }
    });
    assert.equal((await page.evaluate(() => window.nativeEvents.filter(event => event.type === 'readConversationImage'))).length, 1, 'streaming must not read the same image again');
    const original = page.url();
    for (const title of ['Photo.jpg', 'Result']) {
      const button = page.getByRole('button', { name: `Open ${title}`, exact: true });
      await button.scrollIntoViewIfNeeded();
      const before = await button.boundingBox();
      await button.click();
      await page.waitForFunction(title => window.nativeEvents.some(event => event.type === 'openImage' && event.title === title), title);
      assert.deepEqual((await page.evaluate(() => window.nativeEvents.filter(event => event.type === 'openImage'))).at(-1),
        { type: 'openImage', agentId: 'image-agent', title, src });
      assert.equal(await page.locator('.chat-image-lightbox').count(), 0, 'native viewer owns fullscreen');
      assert.equal(page.url(), original);
      assert.deepEqual(await button.boundingBox(), before, 'opening an image keeps the transcript in place');
    }
  } finally { await browser?.close(); await server.close(); }
});

test('image previews follow the viewport with stable geometry, bounded caching and conversation cleanup', async () => {
  const server = await createServer({ configFile: fileURLToPath(new URL('../web/vite.config.ts', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await server.listen(); browser = await browserEngine.launch();
    const page = await browser.newPage({ viewport: { width: 402, height: 740 } });
    await page.addInitScript(() => {
      window.imageReads = []; window.openedImages = []; window.activeReads = 0; window.peakReads = 0;
      window.imageUrls = new Set(); window.imageBytes = new Map(); window.revokedImages = 0;
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = create(blob); window.imageUrls.add(url); window.imageBytes.set(url,blob.size); return url; };
      URL.revokeObjectURL = url => { if (window.imageUrls.delete(url)) window.revokedImages++; window.imageBytes.delete(url); revoke(url); };
      window.webkit = { messageHandlers: { transcript: { postMessage(json) {
        const event = JSON.parse(json); if (event.type === 'openImage') window.openedImages.push(event); if (event.type !== 'readConversationImage') return;
        window.imageReads.push(event); window.peakReads = Math.max(window.peakReads, ++window.activeReads);
        setTimeout(() => {
          window.activeReads--;
          const canvas = document.createElement('canvas'); const index = Number(/shot-(\d+)/.exec(event.path)?.[1] ?? 2);
          canvas.width = event.path.endsWith('large.png') ? 3072 : index % 3 === 0 ? 2048 : index % 3 === 1 ? 512 : 1024;
          canvas.height = event.path.endsWith('large.png') ? 3072 : 1024 * 1024 / canvas.width;
          window.companionTranscript.setImage(JSON.stringify({requestId:event.requestId,agentId:event.agentId,dataUrl:canvas.toDataURL('image/png')}));
        }, 30);
      } } } };
    });
    await page.goto(`${server.resolvedUrls.local[0]}transcript.html`); await page.waitForFunction(() => window.companionTranscript);
    await page.evaluate(async () => {
      const agent = {id:'images-budget',name:'Images',backend:'codex',status:{type:'idle'}};
      window.imageBudgetConversation = {agentId:agent.id,agent,ready:true,frame:{agentId:agent.id,backend:'codex',payload:{snapshot:{messages:Array.from({length:12},(_,i)=>({id:`shot-${i}`,role:'assistant',parts:[{type:'text',text:'Context for screenshot '+i+'\n\n'+('Context line\n\n'.repeat(12))}, i % 2 ? {type:'attachment',attachment:{kind:'image',path:`/tmp/shot-${i}.png`,name:`Shot ${i}`,width:i%3===0?2048:i%3===1?512:1024,height:i%3===0?512:i%3===1?2048:1024}} : {type:'media',media:{url:`/tmp/shot-${i}.png`,title:`Shot ${i}`,width:i%3===0?2048:i%3===1?512:1024,height:i%3===0?512:i%3===1?2048:1024}}]})),turns:[],busy:false}}}};
      await window.companionTranscript.setConversation(JSON.stringify(window.imageBudgetConversation));
    });
    await page.waitForFunction(() => window.imageReads.length > 0 && window.activeReads === 0);
    await page.waitForTimeout(250);
    const initialReads = await page.evaluate(() => window.imageReads.length);
    assert.ok(initialReads < 6, `offscreen images should not fetch (read ${initialReads})`);
    const shot = i => page.getByRole('button', {name: `Open Shot ${i}`, exact:true});
    for (let i = 0; i < 12; i++) {
      await shot(i).evaluate(el => el.scrollIntoView({block:'center'}));
      const before = await shot(i).boundingBox();
      const expectedRatio = i % 3 === 0 ? 4 : i % 3 === 1 ? 0.25 : 1;
      assert.ok(Math.abs(before.width / before.height - expectedRatio) < 0.01, 'image placeholder must have its intrinsic ratio');
      await page.waitForFunction(i => document.querySelector(`[aria-label="Open Shot ${i}"] img`)?.naturalWidth > 0, i);
      assert.deepEqual(await shot(i).boundingBox(), before, 'loading cannot change the preview frame');
    }
    await page.waitForFunction(() => window.activeReads === 0);
    assert.ok(await page.evaluate(() => window.peakReads <= 2), 'preview reads must be bounded');
    await page.waitForFunction(() => !document.body.textContent.includes('Loading image…'));
    assert.ok(await page.evaluate(() => [...window.imageBytes.values()].reduce((a,b)=>a+b,0)+[...document.querySelectorAll('img')].reduce((a,x)=>a+x.naturalWidth*x.naturalHeight*4,0)<=64*1024*1024), 'compressed originals and decoded thumbnails share the 64 MiB bound');
    const readsBeforeReturn = await page.evaluate(() => window.imageReads.filter(e => e.path === '/tmp/shot-0.png').length);
    await shot(0).evaluate(el => el.scrollIntoView({block:'center'}));
    await page.waitForFunction(() => document.querySelector('[aria-label="Open Shot 0"] img')?.naturalWidth > 0);
    assert.ok(await page.evaluate(count => window.imageReads.filter(e => e.path === '/tmp/shot-0.png').length === count, readsBeforeReturn), 'returning previews reuse downloaded bytes without a host read');
    const settledReads = await page.evaluate(() => window.imageReads.length);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.imageReads.length), settledReads, 'memory pressure must not cause a fetch loop');
    const evidence = await page.evaluate(() => ({peakReads:window.peakReads,retainedImages:window.imageUrls.size,evictions:window.revokedImages}));
    await page.evaluate(async () => { const c = window.imageBudgetConversation; c.frame.payload.snapshot.messages=[]; await window.companionTranscript.setConversation(JSON.stringify(c)); });
    await page.waitForFunction(() => window.imageUrls.size === 0);
    await page.evaluate(async () => { const c = window.imageBudgetConversation; c.frame.payload.snapshot.messages=[{id:'large',role:'assistant',parts:[{type:'media',media:{url:'/tmp/large.png',title:'Large image'}}]}]; await window.companionTranscript.setConversation(JSON.stringify(c)); });
    await page.waitForFunction(() => window.imageReads.some(e => e.path === '/tmp/large.png') && window.activeReads === 0 && !document.body.textContent.includes('Loading image…'));
    await page.waitForFunction(() => document.querySelector('[aria-label="Open Large image"] img')?.naturalWidth > 0);
    assert.ok(await page.getByRole('button',{name:'Open Large image',exact:true}).locator('img').evaluate(el=>el.naturalWidth<3072), 'large originals use bounded inline thumbnails');
    await page.getByRole('button',{name:'Open Large image',exact:true}).click();
    await page.waitForFunction(() => window.openedImages.some(image => image.title === 'Large image'));
    await mkdir('out', {recursive:true});
    await writeFile(`out/image-memory-${process.env.TRANSCRIPT_BROWSER || 'chromium'}.json`, JSON.stringify({...evidence,initialReads,viewportReload:true,stableGeometry:true,releasedOnClose:true},null,2));
  } finally { await browser?.close(); await server.close(); }
});


test('summary turns load only the selected Working details through the native bridge and cache reopens', async () => {
  const server = await createServer({ configFile: fileURLToPath(new URL('../web/vite.config.ts', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await server.listen(); browser = await browserEngine.launch();
    const page = await browser.newPage({ viewport: { width: 393, height: 740 } });
    await page.addInitScript(() => {
      window.turnRequests = [];
      window.webkit = { messageHandlers: { transcript: { postMessage(json) {
        const request = JSON.parse(json);
        if (request.type !== 'loadTurnHistory') return;
        window.turnRequests.push(request);
        window.completeTurnHistory = async () => {
          const scene = structuredClone(window.summaryScene);
          const turn = scene.frame.payload.snapshot.turns.find(turn => turn.id === request.turnId);
          turn.itemsView = 'full';
          scene.frame.payload.snapshot.messages.splice(1, 0, { id: 'work', turnId: request.turnId, role: 'assistant', status: 'complete', createdAt: '',
            parts: [{ type: 'text', text: 'Inspected the selected turn only.', phase: 'commentary' }] });
          window.summaryScene = scene;
          await window.companionTranscript.setConversation(JSON.stringify(scene));
          window.companionTranscript.setContent(JSON.stringify({ type: 'turnHistory', requestId: request.requestId, agentId: request.agentId }));
        };
      } } } };
    });
    await page.goto(`${server.resolvedUrls.local[0]}transcript.html`);
    await page.waitForFunction(() => window.companionTranscript);
    await page.evaluate(async () => {
      const agent = { id: 'summary-agent', name: 'Summary', backend: 'codex', backendSession: { kind: 'codex', threadId: 'summary-thread' }, status: { type: 'idle' } };
      const turn = { id: 'summary-turn', itemsView: 'summary', status: 'completed', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:49Z', durationMs: 109000 };
      const messages = [{ id: 'request', turnId: turn.id, role: 'user', status: 'complete', createdAt: '', parts: [{ type: 'text', text: 'Check this turn.' }] },
        { id: 'answer', turnId: turn.id, role: 'assistant', status: 'complete', createdAt: '', parts: [{ type: 'text', text: 'Here is the final answer.', phase: 'final_answer' }] }];
      window.summaryScene = { generation: 1, agentId: agent.id, agent, ready: true, peers: [], history: { hasOlder: false, loadingOlder: false, failed: false },
        frame: { agentId: agent.id, backend: 'codex', payload: { snapshot: { messages, turns: [turn], activeTurnId: null, busy: false } } } };
      await window.companionTranscript.setConversation(JSON.stringify(window.summaryScene));
    });
    assert.equal(await page.getByText('Here is the final answer.', { exact: true }).isVisible(), true);
    assert.equal(await page.evaluate(() => window.turnRequests.length), 0);
    const details = page.getByRole('button', { name: /Done.*1m 49s/i });
    const answer = page.getByText('Here is the final answer.', { exact: true });
    const before = await answer.boundingBox();
    await details.click();
    const spinner = details.getByRole('status', { name: /Loading details/ });
    await spinner.waitFor();
    assert.equal(await details.getAttribute('aria-expanded'), 'false');
    assert.equal(await details.isDisabled(), true);
    assert.equal(await details.locator('svg').count(), 1, 'the spinner must replace the chevron');
    assert.notEqual(await spinner.evaluate(element => getComputedStyle(element).animationName), 'none');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.chat-fold--open').count(), 0);
    const pending = await answer.boundingBox();
    assert(Math.abs(pending.y - before.y) < 1, 'loading must not move the final answer');
    await mkdir('out', { recursive: true });
    await page.screenshot({ path: `out/working-loading-${process.env.TRANSCRIPT_BROWSER || 'chromium'}.png` });
    await page.evaluate(() => window.completeTurnHistory());
    await page.getByText('Inspected the selected turn only.', { exact: true }).waitFor();
    assert.equal(await details.getAttribute('aria-expanded'), 'true');
    assert.equal(await details.getByRole('status').count(), 0);
    const requests = await page.evaluate(() => window.turnRequests);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].turnId, 'summary-turn');
    assert.equal(requests[0].agentId, 'summary-agent');
    await page.getByRole('button', { name: /Done.*1m 49s/i }).click();
    await page.getByRole('button', { name: /Done.*1m 49s/i }).click();
    assert.equal(await page.evaluate(() => window.turnRequests.length), 1);
    await writeFile(`out/working-loading-${process.env.TRANSCRIPT_BROWSER || 'chromium'}.json`, JSON.stringify({ reads: requests.length, pendingAnswerShiftPx: pending.y - before.y, collapsedWhileLoading: true, spinnerReplacesChevron: true, cachedReopen: true }, null, 2));
    await page.screenshot({ path: `/tmp/korus-summary-${browserEngine === webkit ? 'webkit' : 'chromium'}.png`, fullPage: true });
  } finally { await browser?.close(); await server.close(); }
});


// The fixture is emitted by the real Claude host/RPC workflow in sdk-boundary.spec.ts.
// This checks the production native replica and pane, rather than replacing a scene on click.
test('Claude backend frames reveal selected Working content and retain it across collapse', async t => {
  if (!process.env.APP_CLAUDE_HISTORY_EVIDENCE) { t.skip('Run the Claude RPC evidence workflow first.'); return; }
  const fixture = JSON.parse(await readFile(process.env.APP_CLAUDE_HISTORY_EVIDENCE, 'utf8'));
  const server = await createServer({ configFile: fileURLToPath(new URL('../web/vite.config.ts', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
  let browser;
  const warnings = [];
  try {
    await server.listen(); browser = await browserEngine.launch();
    const page = await browser.newPage({ viewport: { width: 393, height: 740 } });
    page.on('console', message => { if (/duplicate key|unhandled|error/i.test(message.text())) warnings.push(message.text()); });
    page.on('pageerror', error => warnings.push(error.message));
    await page.addInitScript(fixture => {
      window.claudeFixture = fixture; window.turnRequests = []; window.bridgeErrors = []; window.failedDetailDelivered = false;
      window.webkit = { messageHandlers: { transcript: { postMessage(json) {
        const request = JSON.parse(json);
        if (request.type !== 'loadTurnHistory') return;
        window.turnRequests.push(request);
        queueMicrotask(async () => {
          try {
            const failure = window.claudeFixture.failedExpansion;
            const shouldFail = failure && failure.turnId === request.turnId && !window.failedDetailDelivered;
            if (shouldFail) window.failedDetailDelivered = true;
            const expansion = shouldFail ? failure : window.claudeFixture.expansions.find(item => item.turnId === request.turnId);
            if (!expansion) throw new Error('Unknown requested turn');
            const context = window.claudeContext;
            const frames = expansion.frames;
            const result = await window.companionTranscript.setTransfer(JSON.stringify({ ...context, frames,
              checkpoint: { epoch: 'claude-history', revision: frames.at(-1).payload.revision } }));
            if (result?.needsReset) throw new Error('Native replica rejected expansion');
            window.companionTranscript.setContent(JSON.stringify({ type: 'turnHistory', requestId: request.requestId, agentId: request.agentId, ...(expansion.error ? { error: expansion.error } : {}) }));
          } catch (error) { window.bridgeErrors.push(String(error)); }
        });
      } } } };
    }, fixture);
    await page.goto(`${server.resolvedUrls.local[0]}transcript.html`);
    await page.waitForFunction(() => window.companionTranscript);
    const initial = await page.evaluate(async () => {
      const fixture = window.claudeFixture;
      window.claudeContext = { agent: fixture.agent, agentId: fixture.agent.id, generation: 1, ready: true, peers: [], engines: null,
        identity: 'claude-summary-evidence', history: { hasOlder: !fixture.olderPages, loadingOlder: false, failed: false } };
      return window.companionTranscript.setTransfer(JSON.stringify({ ...window.claudeContext, frames: fixture.initialFrames,
        checkpoint: { epoch: 'claude-history', revision: fixture.initialFrames.at(-1).payload.revision } }));
    });
    assert.equal(initial?.needsReset, undefined);
    assert.equal(await page.evaluate(() => window.turnRequests.length), 0);
    assert.equal((await page.locator('body').innerText()).includes('PRIVATE'), false);
    const answerOnly = page.locator('.codex-message-turn').filter({ has: page.getByText('Request 68', { exact: true }) });
    assert.equal(await answerOnly.locator('.chat-work-group__header').count(), 1);
    assert.equal(await answerOnly.locator('.chat-work-group__header').getAttribute('aria-expanded'), null);
    assert.equal(await answerOnly.getByRole('button', { name: /View details|Hide details/i }).count(), 0);
    for (const index of [65, 66, 67, 69]) {
      const turn = page.locator('.codex-message-turn').filter({ has: page.getByText(`Request ${index}`, { exact: true }) });
      const expand = turn.getByRole('button', { name: /View details/i });
      assert.equal(await expand.count(), 1, 'one details action per native turn across compaction');
      await expand.click();
      if (index === 65) {
        await turn.getByRole('alert').waitFor();
        await turn.getByRole('alert').getByRole('button', { name: /Retry/i }).click();
      }
      await turn.getByText(`PRIVATE COMMENTARY ${index}`, { exact: true }).waitFor();
      await turn.getByRole('button', { name: /Hide details/i }).waitFor();
      assert.equal(await page.evaluate(() => window.turnRequests.at(-1).turnId), `claude-turn-${index}`);
      await turn.getByRole('button', { name: /Hide details/i }).click();
      await turn.getByRole('button', { name: /View details/i }).click();
      await turn.getByText(`PRIVATE COMMENTARY ${index}`, { exact: true }).waitFor();
    }
    assert.equal(await page.evaluate(() => window.turnRequests.length), 5, 'cached expansions do not issue another native request');
    assert.deepEqual(await page.evaluate(() => window.bridgeErrors), []);
    assert.equal((await page.locator('body').innerText()).includes('PRIVATE COMMENTARY 64'), false);
    assert.equal((await page.locator('body').innerText()).includes('Empty response'), false);
    if (fixture.olderPages) {
      const anchor = page.getByText('Request 69', { exact: true });
      await anchor.scrollIntoViewIfNeeded();
      const before = await anchor.boundingBox();
      for (const older of fixture.olderPages) {
        const received = await page.evaluate(async older => {
          const result = await window.companionTranscript.setTransfer(JSON.stringify({ ...window.claudeContext, frames: older.frames,
            checkpoint: { epoch: 'claude-history', revision: older.frames.at(-1).payload.revision } }));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return result;
        }, older);
        assert.equal(received?.needsReset, undefined, 'archive pages use the existing native frame contract');
      }
      const after = await anchor.boundingBox();
      assert.ok(Math.abs(after.y - before.y) < 3, `archive join moved the visible anchor: ${before.y} -> ${after.y}`);
      const oldest = page.locator('.codex-message-turn').filter({ has: page.getByText('Request 0', { exact: true }) });
      await page.mouse.move(200, 350);
      // Scroll through the SDK's local render window as well as the host's archive pages.
      for (let attempt = 0; attempt < 8; attempt++) {
        await page.mouse.wheel(0, -100000);
        try { await oldest.waitFor({ timeout: 1000 }); break; } catch { /* Reveal the next local window. */ }
      }
      await oldest.waitFor({ timeout: 2000 });
      assert.equal(await oldest.count(), 1);
      await oldest.getByRole('button', { name: /View details/i }).click();
      await oldest.getByText('PRIVATE COMMENTARY 0', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.turnRequests.at(-1).turnId), 'claude-turn-0');
      assert.deepEqual(await page.evaluate(() => window.bridgeErrors), []);
    }
    assert.deepEqual(warnings, []);
    await page.screenshot({ path: `/tmp/korus-claude-real-frames-${process.env.TRANSCRIPT_BROWSER || 'chromium'}.png`, fullPage: true });
  } finally { await browser?.close(); await server.close(); }
});
