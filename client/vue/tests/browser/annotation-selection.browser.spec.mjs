import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';

// Native focus/selection painting needs Chromium, rather than jsdom's selection model.
test('annotation editors retain the selected passage while typing and release it on dismissal', async () => {
  const root = path.resolve(import.meta.dirname, '../../../..');
  const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'annotation-highlights-evidence-'));
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'annotation-selection-'));
  const entry = `
import {createApp,h,ref} from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import '/src/styles/variables.css';
import '/src/styles/base.css';
import {i18n} from '/src/i18n';
import Ticket from '/src/components/MissionTicketDialog.vue';
import Plan from '/src/components/PlanReviewSection.vue';
import Chat from '/src/components/ChatTextSelectionAnnotation.vue';
import Code from '/src/components/CodeSelectionAnnotation.vue';
createApp({setup(){
 const mode=ref('ticket'), visible=ref(true), selection=ref(null), draft=ref({comments:[],choices:[]});
 window.fixture={show(value){mode.value=value;visible.value=true;selection.value=null;draft.value={comments:[],choices:[]}}};
 const capture=()=>{const r=getSelection().getRangeAt(0).getBoundingClientRect();selection.value={text:getSelection().toString(),path:'file.ts',startLine:1,endLine:1,messageId:'m1',messageIndex:0,role:'assistant',anchor:{x:r.x,y:r.y,width:r.width,height:r.height}}};
 return ()=>h('main', {style:'padding:40px'}, mode.value==='ticket' ? [h(Ticket,{modelValue:visible.value,annotatable:true,ticketKey:'ticket',ticket:{title:'Ticket',body:'Keep the **selected context** visible.'},onClose:()=>visible.value=false,onSaveComment:()=>{}})]
 : mode.value==='plan' ? [h(Plan,{section:{id:'s1',title:'Plan',heading:'',blocks:[{html:'<p>Keep the <strong>selected context</strong> visible.</p>'}]},draft:draft.value,onComment:c=>draft.value={...draft.value,comments:[c]}})]
 : [h('p',{onMouseup:capture},['Keep the ',h('strong','selected context'),' visible.']),h(mode.value==='chat'?Chat:Code,{selection:selection.value,conversationKey:'c1',onDismiss:()=>selection.value=null,onSave:()=>{}})]);
}}).use(ElementPlus).use(i18n).mount('#app');
`;
  const server = await createServer({
    configFile: false, root: path.join(root, 'client/vue'), cacheDir, logLevel: 'error',
    resolve: { alias: { '@workspace/core': path.join(root, 'core/src') }, dedupe: ['vue'] },
    optimizeDeps: { noDiscovery: true, include: ['vue', 'vue-i18n', 'element-plus', '@tabler/icons-vue', '@codex-app-sdk/vue', '@excalidraw/excalidraw', '@excalidraw/mermaid-to-excalidraw', 'react', 'react-dom/client', 'beautiful-mermaid'] },
    plugins: [vue(), {
      name: 'annotation-selection-fixture',
      resolveId(id) { if (id === '/annotation-entry.js') return '\0annotation-entry'; },
      load(id) { if (id === '\0annotation-entry') return entry; },
      configureServer(server) { server.middlewares.use('/annotation-fixture', (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end('<div id="app"></div><script type="module" src="/annotation-entry.js"></script>');
      }); },
    }], server: { host: '127.0.0.1', port: 0 },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.setDefaultTimeout(2_500);
    page.setDefaultNavigationTimeout(15_000); // Cold Vite/SFC compilation.
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0] + 'annotation-fixture');
    await page.locator('strong').waitFor({ timeout: 15_000 });
    for (const mode of ['ticket', 'chat', 'code', 'plan']) {
      await page.evaluate(mode => window.fixture.show(mode), mode);
      const passage = page.locator('strong').first();
      await passage.waitFor();
      await passage.evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
      if (mode === 'chat' || mode === 'code') await page.locator(`.${mode === 'chat' ? 'chat-text' : 'code'}-selection-annotation__add`).click();
      const input = page.locator(mode === 'plan' ? 'textarea:visible' : '.annotation-popup__input');
      await input.fill('Retain this context.');
      await input.click();
      assert.equal(await input.evaluate(el => document.activeElement === el), true, mode);
      assert.deepEqual(await page.evaluate(() => [...(CSS.highlights.get('annotation-selection') ?? [])].map(r => r.toString())), ['selected context'], mode);
      const paint = await passage.evaluate(el => getComputedStyle(el, '::highlight(annotation-selection)').backgroundColor);
      assert.ok(paint !== 'rgba(0, 0, 0, 0)' && paint !== 'transparent', `${mode} has visible highlight paint`);
      await page.screenshot({ path: path.join(evidenceDir, `${mode}.png`) });
      if (mode === 'ticket' || mode === 'code') await page.locator('.annotation-popup__submit').click();
      else if (mode === 'plan') await page.evaluate(() => window.fixture.show('chat'));
      else await input.press('Escape');
      await page.waitForFunction(() => !CSS.highlights.has('annotation-selection'));
    }
    assert.deepEqual(errors, []);
    console.info(`Annotation highlight screenshots: ${evidenceDir}`);
  } finally {
    await browser?.close(); await server.close(); await rm(cacheDir, { recursive: true, force: true });
  }
});
