import { sdkSourcePlugin } from '../../../../vite.sdk-aliases.ts';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';

// Native selection painting and focus behavior need Chromium; jsdom has neither.
test('the passage being annotated stays highlighted while its comment is written and is released afterwards', async () => {
  const root = fileURLToPath(new URL('../../../..', import.meta.url));
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'annotation-selection-fixture-'));
  const source = `
    import {createApp,h,ref} from 'vue';
    import ElementPlus from 'element-plus';
    import 'element-plus/dist/index.css';
    import '/client/vue/src/styles/variables.css';
    import '/client/vue/src/styles/base.css';
    import {i18n} from '/client/vue/src/i18n/index.ts';
    import Ticket from '/client/vue/src/components/MissionTicketDialog.vue';
    import Plan from '/client/vue/src/components/PlanReviewSection.vue';
    import Chat from '/client/vue/src/components/ChatTextSelectionAnnotation.vue';
    createApp({setup(){
      const mode=ref('ticket'), selection=ref(null), draft=ref({comments:[],choices:[]});
      window.fixture={show(value){mode.value=value;selection.value=null;draft.value={comments:[],choices:[]}}};
      const capture=()=>{
        const r=getSelection().getRangeAt(0).getBoundingClientRect();
        selection.value={text:getSelection().toString(),messageIndex:0,role:'assistant',anchor:{x:r.x,y:r.y,width:r.width,height:r.height}};
      };
      return ()=>h('main',{style:'padding:40px'},
        mode.value==='ticket'
          ? [h(Ticket,{modelValue:true,annotatable:true,ticketKey:'ticket',ticketNumber:'01',ticket:{title:'Ticket',body:'Keep the **selected context** visible.'},onSaveComment:()=>{}})]
        : mode.value==='plan'
          ? [h(Plan,{section:{id:'s1',title:'Plan',heading:'',blocks:[{html:'<p>Keep the <strong>selected context</strong> visible.</p>'}]},draft:draft.value,onComment:c=>draft.value={...draft.value,comments:[c]}})]
        : mode.value==='none'
          ? []
          : [h('p',{onMouseup:capture},['Keep the ',h('strong','selected context'),' visible.']),
             h(Chat,{selection:selection.value,conversationKey:'c1',onDismiss:()=>selection.value=null,onSave:()=>{}})]);
    }}).use(ElementPlus).use(i18n).mount('#app');
  `;
  const server = await createServer({
    configFile: false, root, logLevel: 'error', cacheDir: path.join(fixture, 'vite-cache'),
    resolve: { alias: { '@workspace/core': path.join(root, 'core/src') } },
    plugins: [sdkSourcePlugin, vue(), {
      name: 'annotation-selection-fixture',
      configureServer(server) {
        server.middlewares.use('/annotation-fixture', (_request, response) => {
          response.setHeader('Content-Type', 'text/html');
          response.end('<div id="app"></div><script type="module" src="/annotation-entry.js"></script>');
        });
      },
      resolveId(id) { if (id === '/annotation-entry.js') return '\0annotation-entry'; },
      load(id) { if (id === '\0annotation-entry') return source; },
    }],
    server: { host: '127.0.0.1', port: 0 },
  });
  const browser = await chromium.launch();
  try {
    await server.listen();
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(30_000); // Cold Vite transforms.
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0] + 'annotation-fixture');
    const passages = () => page.evaluate(() => [...(CSS.highlights.get('chat-annotation-focus') ?? [])].map(range => range.toString()));
    const released = () => page.waitForFunction(() => !CSS.highlights.has('chat-annotation-focus'));

    for (const mode of ['ticket', 'chat', 'plan']) {
      await page.evaluate(mode => window.fixture.show(mode), mode);
      const passage = page.locator('strong').first();
      await passage.evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
      if (mode === 'chat') await page.locator('.chat-text-selection-annotation__add').click();
      const input = page.locator(mode === 'plan' ? 'textarea:visible' : '.annotation-popup__input');
      await input.click();
      await input.fill('Retain this context.');
      assert.equal(await input.evaluate(element => document.activeElement === element), true, `${mode} editor has focus`);
      assert.deepEqual(await passages(), ['selected context'], `${mode} keeps the passage highlighted`);
      const paint = await passage.evaluate(element => getComputedStyle(element, '::highlight(chat-annotation-focus)').backgroundColor);
      assert.equal(paint, 'rgb(255, 235, 59)', `${mode} paints the annotation focus color`);

      // Dismissing the editor releases the passage; the plan editor is closed with Escape.
      if (mode === 'ticket') await page.locator('.annotation-popup__submit').click();
      else await input.press('Escape');
      await released();
    }

    // Removing the owning component releases a highlight that is still held.
    await page.evaluate(() => window.fixture.show('plan'));
    await page.locator('strong').first().evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    assert.deepEqual(await passages(), ['selected context']);
    await page.evaluate(() => window.fixture.show('none'));
    await released();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); await server.close(); await rm(fixture, { recursive: true, force: true });
  }
});
