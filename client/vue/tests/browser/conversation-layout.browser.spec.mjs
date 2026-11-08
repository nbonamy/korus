import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';
import { excalidrawAssets } from '../../vite.excalidraw-assets.ts';

// Full shell, real panes and production styles; provider operations are synthetic.
test('single and split conversations keep their geometry, drafts and keyboard ownership across layout changes', async () => {
  const root = path.resolve(import.meta.dirname, '../../../..');
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'conversation-layout-'));
  const entry = `
import {createApp,h,ref,shallowReactive} from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import '@codex-app-sdk/vue/styles.css';
import '/src/styles/variables.css';
import '/src/styles/base.css';
import {i18n} from '/src/i18n/index.ts';
import Shell from '/src/components/AppShell.vue';
import {createInitialSnapshot} from '@workspace/core/snapshot';
import {claudeBackendCapabilities} from '@workspace/core/backend-capabilities';
import {createAgentComposerState} from '/src/agent-composer-state.ts';
const snapshot=createInitialSnapshot();
snapshot.general.providerOnboardingComplete=true;
snapshot.general.claudeCodeEnabled=true;
snapshot.providerConnections=[{backend:'claude',installed:true,connected:true,checking:false}];
const composer=createAgentComposerState({getSnapshot:()=>snapshot});
const views=snapshot.agents.map(agent=>{
 agent.backend='claude';agent.backendDefaults={kind:'claude',permissionMode:'default'};
 return shallowReactive({agent,codexSnapshot:null,claudeSnapshot:{agentId:agent.id,sessionId:'fixture-session',activeTurnId:null,turnIds:['fixture-turn'],turns:[],
 messages:[{id:'fixture-message',agentId:agent.id,role:'assistant',status:'complete',turnId:'fixture-turn',createdAt:'2026-11-08T00:00:00Z',parts:[{type:'text',text:'The **request** should be retried.\\n\\n'+Array.from({length:12},()=> 'More context before the selected passage.').join('\\n\\n')+'\\n\\nThe **request** should be retried.'}]}],
 answeredClientRequestIds:[],busy:false,historyLoading:false,historyState:{hasOlder:false,loadingOlder:false},contextUsage:null,plan:null,error:null},composer:composer.configurationForAgent(agent.id),
 composerState:{text:'Draft for '+agent.id,selectionStart:0,selectionEnd:0},attachments:[],capabilities:claudeBackendCapabilities,
 approvals:[],sending:false,queuedPrompts:[],history:{failed:false,hydrating:false,hasOlder:false,loadingOlder:false},answeredClientRequestIds:new Set()});
});
const active=ref(snapshot.activeAgentId), calls=[];
const actions=new Proxy({
 prepare:()=>{},
 updateComposerState:(id,state)=>views.find(v=>v.agent.id===id).composerState=state,
 setPermissionMode:(id,mode)=>{const view=views.find(v=>v.agent.id===id);view.agent={...view.agent,backendDefaults:{kind:'claude',permissionMode:mode}};calls.push([id,mode]);},
 send:(id,prompt)=>calls.push([id,prompt]),
},{get:(target,key)=>target[key]??(()=>{})});
window.fixture={calls,ids:views.map(v=>v.agent.id),visible:[]};
createApp({setup:()=>()=>h(Shell,{snapshot,activeAgent:views.find(v=>v.agent.id===active.value).agent,
 isLoading:false,isSending:false,connectionState:{status:'connected'},agentConversationFor:id=>views.find(v=>v.agent.id===id),
 agentConversationActions:actions,onSelectAgent:id=>active.value=id,onVisibleAgentsChange:ids=>window.fixture.visible=ids})}).use(i18n).use(ElementPlus).mount('#app');
`;
  const server = await createServer({
    configFile: false, root: path.join(root, 'client/vue'), cacheDir, logLevel: 'error',
    resolve: { alias: { '@workspace/core': path.join(root, 'core/src') }, dedupe: ['vue'] },
    server: { host: '127.0.0.1', port: 0 },
    optimizeDeps: { noDiscovery: true, include: ['vue', 'vue-i18n', 'element-plus', '@tabler/icons-vue', '@codex-app-sdk/vue', '@excalidraw/excalidraw', '@excalidraw/mermaid-to-excalidraw', 'react', 'react-dom/client', 'rrule-temporal', 'rrule-temporal/totext', 'beautiful-mermaid', 'qrcode', 'parse-git-diff'] },
    plugins: [vue(), excalidrawAssets(), {
      name: 'conversation-layout-fixture',
      resolveId(id) { if (id === '/conversation-fixture.js') return '\0conversation-fixture'; },
      load(id) { if (id === '\0conversation-fixture') return entry; },
      configureServer(server) {
        server.middlewares.use('/conversation-layout', (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end('<!doctype html><div id="app"></div><script type="module" src="/conversation-fixture.js"></script>');
        });
      },
    }],
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(2_500);
    // Cold Vite/SFC initialization is setup; user interactions retain the 2.5-second bound.
    page.setDefaultNavigationTimeout(15_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/conversation-layout`);
    const editor = page.locator('.chat-rich-text-editor');
    try { await editor.waitFor({ timeout: 15_000 }); } catch (error) { throw new Error(JSON.stringify({ errors, body: await page.locator('body').innerText() }) + error.message); }
    const ids = await page.evaluate(() => window.fixture.ids);
    await page.waitForFunction(id => window.fixture.visible.length === 1 && window.fixture.visible[0] === id, ids[0]);
    assert.equal(await editor.textContent(), `Draft for ${ids[0]}`);
    const setLayout = async name => {
      await page.getByRole('button', { name: 'Conversation layout', exact: true }).click();
      await page.getByRole('menuitemradio', { name, exact: true }).click();
    };
    const firstPane = page.locator('.conversation-pane').first();
    const passage = firstPane.locator('p strong').last();
    const selectPassage = async target => {
      await target.evaluate(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
    };
    await passage.scrollIntoViewIfNeeded();
    await selectPassage(passage);
    await page.getByRole('button', { name: 'Annotate', exact: true }).click();
    await page.locator('.annotation-popup__input').fill('Add a bounded retry.');
    await page.getByRole('button', { name: 'Add annotation', exact: true }).click();
    const marker = page.locator('.conversation-pane__annotation-marker');
    await marker.waitFor();
    assert.equal(await marker.textContent(), '1');
    const assertAtPassage = async (badge, target) => {
      const markerBox = await badge.boundingBox();
      const endpoint = await target.evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element);
        const rects = range.getClientRects(); const rect = rects[rects.length - 1];
        return { x: rect.right, y: rect.top };
      });
      assert.ok(Math.abs(markerBox.x - endpoint.x) < 24 && Math.abs(markerBox.y - endpoint.y) < 24,
        'marker must sit at the endpoint of the selected occurrence, not at the message header');
    };
    await assertAtPassage(marker, passage);
    const paintedRanges = await page.evaluate(() => [...CSS.highlights.values()].flatMap(highlight => [...highlight].map(range => range.toString())));
    assert.deepEqual(paintedRanges, ['request']);
    const card = page.locator('.chat-annotation-review .composer-context-cards__open');
    assert.equal(await card.innerText(), 'Add a bounded retry.');
    assert.equal(await card.locator('svg.tabler-icon-message-2').count(), 1);
    const markerColors = await marker.evaluate(element => {
      const style = getComputedStyle(element);
      const probe = document.createElement('span');
      probe.style.background = 'var(--color-primary)';
      probe.style.color = 'var(--color-on-primary)';
      element.append(probe);
      const expected = getComputedStyle(probe);
      const matches = style.backgroundColor === expected.backgroundColor && style.color === expected.color;
      probe.remove();
      return matches;
    });
    assert.ok(markerColors, 'annotation tags use the primary background and its foreground color');
    if (process.env.ANNOTATION_EVIDENCE) await page.screenshot({ path: process.env.ANNOTATION_EVIDENCE });
    await marker.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.ok((await dialog.innerText()).includes('request'));
    assert.equal(await dialog.getByText('Chat annotation comment', { exact: true }).count(), 0);
    assert.equal(await dialog.getByRole('textbox', { name: 'Chat annotation comment', exact: true }).inputValue(), 'Add a bounded retry.');
    await dialog.locator('input').fill('Discard this edit.');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.locator('.chat-annotation-review .composer-context-cards__open').click();
    await dialog.waitFor();
    assert.equal(await dialog.locator('input').inputValue(), 'Add a bounded retry.');
    const longComment = 'Use three attempts. '.repeat(20).trim();
    await dialog.locator('input').fill(longComment);
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await card.innerText(), longComment);
    const chipWidth = await card.evaluate(element => element.closest('article').getBoundingClientRect().width);
    assert.ok(chipWidth <= 180, 'the entire annotation chip, including icon and remove action, is capped at 180px');
    const longGeometry = await card.locator('.composer-context-cards__detail').evaluate(element => ({
      width: element.clientWidth, contentWidth: element.scrollWidth, height: element.getBoundingClientRect().height,
      overflow: getComputedStyle(element).textOverflow, whiteSpace: getComputedStyle(element).whiteSpace,
    }));
    assert.ok(longGeometry.contentWidth > longGeometry.width && longGeometry.width > 0);
    assert.equal(longGeometry.overflow, 'ellipsis');
    assert.equal(longGeometry.whiteSpace, 'nowrap');
    assert.ok(longGeometry.height < 24, 'comment stays on one line');
    const firstPassage = firstPane.locator('p strong').first();
    await firstPassage.scrollIntoViewIfNeeded();
    await selectPassage(firstPassage);
    await page.getByRole('button', { name: 'Annotate', exact: true }).click();
    await page.locator('.annotation-popup__input').fill('Keep this separate.');
    await page.getByRole('button', { name: 'Add annotation', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.chat-annotation-review .composer-context-cards__open').length === 2);
    assert.equal(await marker.count(), 2);
    await assertAtPassage(marker.filter({ hasText: /^2$/ }), firstPassage);
    await passage.scrollIntoViewIfNeeded();
    await assertAtPassage(marker.filter({ hasText: /^1$/ }), passage);
    await page.setViewportSize({ width: 900, height: 800 });
    await passage.scrollIntoViewIfNeeded();
    await assertAtPassage(marker.filter({ hasText: /^1$/ }), passage);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await setLayout('Vertical Split');
    await page.waitForFunction(() => document.querySelectorAll('.chat-rich-text-editor').length === 2);
    await assertAtPassage(marker.filter({ hasText: /^1$/ }), passage);
    await setLayout('Single Pane');
    await page.waitForFunction(() => document.querySelectorAll('.chat-rich-text-editor').length === 1);
    await passage.scrollIntoViewIfNeeded();
    await assertAtPassage(marker.filter({ hasText: /^1$/ }), passage);
    await page.locator('.chat-annotation-review').getByRole('button', { name: 'Remove chat annotation', exact: true }).first().click();
    await page.waitForFunction(() => document.querySelectorAll('.conversation-pane__annotation-marker').length === 1);
    assert.equal(await marker.textContent(), '1');
    await page.locator('.chat-annotation-review').getByRole('button', { name: 'Remove chat annotation', exact: true }).click();
    await marker.waitFor({ state: 'hidden' });
    await page.locator('.chat-annotation-review').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => CSS.highlights.size), 0);
    // A real selection across paragraph boundaries includes rendered line breaks.
    const multiline = await firstPane.locator('[data-chat-annotation-content]').evaluate(element => {
      const paragraphs = element.querySelectorAll('p');
      const range = document.createRange();
      range.setStart(paragraphs[0].firstChild, 0);
      range.setEnd(paragraphs[1].firstChild, paragraphs[1].firstChild.textContent.length);
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return { selected: selection.toString(), domText: range.toString() };
    });
    assert.ok(multiline.selected.includes('\n'));
    await page.getByRole('button', { name: 'Annotate', exact: true }).click();
    await page.locator('.annotation-popup__input').fill('Across paragraphs.');
    await page.getByRole('button', { name: 'Add annotation', exact: true }).click();
    await marker.waitFor();
    const multilineHighlight = await page.evaluate(() => [...CSS.highlights.values()].flatMap(highlight => [...highlight].map(range => range.toString())));
    assert.deepEqual(multilineHighlight, [multiline.domText]);
    await assertAtPassage(marker, firstPane.locator('p').nth(1));
    if (process.env.ANNOTATION_EVIDENCE) await page.screenshot({ path: process.env.ANNOTATION_EVIDENCE });
    await card.click();
    await dialog.waitFor();
    assert.equal(await dialog.locator('blockquote').innerText(), multiline.selected.trim());
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.locator('.chat-annotation-review').getByRole('button', { name: 'Remove chat annotation', exact: true }).click();
    await marker.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => CSS.highlights.size), 0);

    await setLayout('Vertical Split');
    await page.waitForFunction(() => document.querySelectorAll('.chat-rich-text-editor').length === 2);
    await page.waitForFunction(() => window.fixture.visible.length === 2);
    const panes = page.locator('.agent-split-grid__pane');
    const first = await panes.nth(0).boundingBox(), second = await panes.nth(1).boundingBox();
    assert.ok(first.width > 280 && second.width > 280);
    assert.ok(Math.abs(first.y - second.y) < 1 && second.x >= first.x + first.width - 1);
    const other = panes.nth(1);
    await other.evaluate(pane => { pane.style.display = 'none'; });
    await page.waitForFunction(id => !window.fixture.visible.includes(id), ids[1]);
    await other.evaluate(pane => { pane.style.display = ''; });
    await page.waitForFunction(id => window.fixture.visible.includes(id), ids[1]);
    await other.locator('.chat-rich-text-editor').click();
    await page.waitForFunction(id => document.querySelector('.agent-split-grid__pane--focused')?.dataset.agentId === id, ids[1]);
    await other.getByRole('button', { name: 'Composer actions', exact: true }).click();
    await other.getByRole('menuitem', { name: 'Permissions', exact: true }).hover();
    await other.getByRole('menuitemradio', { name: /Don't ask/ }).click();
    await page.waitForFunction(() => window.fixture.calls.length === 1);
    assert.deepEqual(await page.evaluate(() => window.fixture.calls), [[ids[1], 'dontAsk']]);
    await setLayout('Single Pane');
    await page.waitForFunction(() => document.querySelectorAll('.chat-rich-text-editor').length === 1);
    assert.equal(await editor.textContent(), `Draft for ${ids[1]}`);
    await editor.click();
    await page.getByRole('menu', { name: 'Conversation layout', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await editor.evaluate(element => element === document.activeElement), true,
      'closing the layout menu must preserve focus moved to the composer');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.fixture.calls.length === 2);
    assert.deepEqual(await page.evaluate(() => window.fixture.calls[1]), [ids[1], `Draft for ${ids[1]}`]);
    await page.getByRole('button', { name: 'Backlog', exact: true }).click();
    await page.waitForFunction(() => window.fixture.visible.length === 0);
    await page.locator('.team-rail__team').first().click();
    await page.waitForFunction(id => window.fixture.visible.length === 1 && window.fixture.visible[0] === id, ids[1]);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
}, 30_000); // Includes cold app startup and the complete single/split workflow.
