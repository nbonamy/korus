import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';
import { excalidrawAssets } from '../../../vite.excalidraw-assets.ts';

// Full shell, real panes and production styles; provider operations are synthetic.
test('single and split conversations keep their geometry, drafts and keyboard ownership across layout changes', async () => {
  const root = path.resolve(import.meta.dirname, '../../../../..');
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
 return shallowReactive({agent,codexSnapshot:null,claudeSnapshot:null,composer:composer.configurationForAgent(agent.id),
 composerState:{text:'Draft for '+agent.id,selectionStart:0,selectionEnd:0},attachments:[],capabilities:claudeBackendCapabilities,
 approvals:[],sending:false,queuedPrompts:[],history:{failed:false,hydrating:false,hasOlder:false,loadingOlder:false},answeredClientRequestIds:new Set()});
});
const active=ref(snapshot.activeAgentId), calls=[];
const actions=new Proxy({
 updateComposerState:(id,state)=>views.find(v=>v.agent.id===id).composerState=state,
 setPermissionMode:(id,mode)=>{const view=views.find(v=>v.agent.id===id);view.agent={...view.agent,backendDefaults:{kind:'claude',permissionMode:mode}};calls.push([id,mode]);},
 send:(id,prompt)=>calls.push([id,prompt]),
},{get:(target,key)=>target[key]??(()=>{})});
window.fixture={calls,ids:views.map(v=>v.agent.id)};
createApp({setup:()=>()=>h(Shell,{snapshot,activeAgent:views.find(v=>v.agent.id===active.value).agent,
 isLoading:false,isSending:false,connectionState:{status:'connected'},agentConversationFor:id=>views.find(v=>v.agent.id===id),
 agentConversationActions:actions,onSelectAgent:id=>active.value=id})}).use(i18n).use(ElementPlus).mount('#app');
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
    assert.equal(await editor.textContent(), `Draft for ${ids[0]}`);
    const setLayout = async name => {
      await page.getByRole('button', { name: 'Conversation layout', exact: true }).click();
      await page.getByRole('menuitemradio', { name, exact: true }).click();
    };
    await setLayout('Vertical Split');
    await page.waitForFunction(() => document.querySelectorAll('.chat-rich-text-editor').length === 2);
    const panes = page.locator('.agent-split-grid__pane');
    const first = await panes.nth(0).boundingBox(), second = await panes.nth(1).boundingBox();
    assert.ok(first.width > 280 && second.width > 280);
    assert.ok(Math.abs(first.y - second.y) < 1 && second.x >= first.x + first.width - 1);
    const other = panes.nth(1);
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
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
}, 30_000); // Includes cold app startup and the complete single/split workflow.
