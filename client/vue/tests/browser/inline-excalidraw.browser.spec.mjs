import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';
import { excalidrawAssets } from '../../vite.excalidraw-assets.ts';
import { sdkSourceAliases, sdkSourceRoot } from '../../../../vite.sdk-aliases.ts';

test('inline renderer streams and renders diagrams, integrating with capable SDKs and preserving older code fallback', async () => {
  const root = fileURLToPath(new URL('../../../..', import.meta.url));
  const useSource = process.env.CODEX_APP_SDK_SOURCE === '1';
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'inline-diagram-vite-'));
  const server = await createServer({
    configFile: false, root, logLevel: 'error', cacheDir,
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, ...(useSource ? [sdkSourceRoot] : [])] } },
    resolve: { alias: { '@workspace/core': path.join(root, 'core/src'), ...(useSource ? sdkSourceAliases : {}) }, dedupe: ['vue'] },
    optimizeDeps: {
      // Lazy editor imports must not trigger an optimizer reload mid-interaction.
      entries: [path.join(root, 'client/vue/src/components/InlineExcalidrawBlock.vue'), path.join(root, 'client/vue/src/components/excalidraw-editor.ts')],
      include: ['@excalidraw/excalidraw', '@excalidraw/mermaid-to-excalidraw', 'react', 'react-dom/client'],
      ...(useSource ? { exclude: Object.keys(sdkSourceAliases) } : {}),
    },
    plugins: [vue(), excalidrawAssets(), {
      name: 'inline-diagram-fixture',
      configureServer(server) {
        server.middlewares.use('/inline-diagram', (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end('<!doctype html><div id="app" style="width:600px"></div><script type="module" src="/diagram-fixture.js"></script>');
        });
      },
      resolveId(id) { if (id === '/diagram-fixture.js') return '\0diagram-fixture'; },
      load(id) {
        if (id !== '\0diagram-fixture') return;
        return `import {createApp,h,ref} from 'vue';
          import * as SDK from '@codex-app-sdk/vue';
          import Diagram from '/client/vue/src/components/InlineExcalidrawBlock.vue';
          import '@codex-app-sdk/vue/styles.css';
          import '/client/vue/src/styles/variables.css';
          import '/client/vue/src/styles/base.css';
          import {i18n} from '/client/vue/src/i18n/index.ts';
          const content=ref(''),sourceText=ref(''),streaming=ref(false);
          window.hasCustomBlocks=typeof Reflect.get(SDK,'codexCustomBlocksKey')==='symbol';
          window.setDiagram=(source,complete=true)=>{sourceText.value=source;streaming.value=!complete;content.value='Before\\n\\n\`\`\`excalidraw\\n'+source+(complete?'\\n\`\`\`\\n\\nAfter':'')};
          createApp({render:()=>h('div',[
            h('section',{id:'host'},h(Diagram,{source:sourceText.value,complete:!streaming.value})),
            h('section',{id:'chat'},h(SDK.CodexMessage,{message:{id:'diagram',role:'assistant',content:content.value,streaming:streaming.value}}))
          ])}).provide(Symbol.for('codex.custom-blocks'),{excalidraw:Diagram}).use(i18n).mount('#app');`;
      },
    }],
  });
  const browser = await chromium.launch();
  try {
    await server.listen();
    const page = await browser.newPage();
    page.setDefaultTimeout(2_500);
    // Cold module loading belongs to browser startup, not individual interactions.
    page.setDefaultNavigationTimeout(15_000);
    const errors = [];
    let navigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0] + 'inline-diagram');
    await page.waitForFunction(() => typeof window.setDiagram === 'function', undefined, { timeout: 15_000 });
    const initialNavigations = navigations;
    await page.evaluate(() => window.setDiagram('{"elements":[', false));
    const host = page.locator('#host');
    await host.getByText('Diagram is rendering…', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await host.locator('.inline-diagram__spinner').evaluate(el => el.getAnimations().length), 1);
    assert.ok(!(await host.textContent()).includes('"elements"'));
    assert.equal(await host.locator('pre, details').count(), 0);
    const customBlocks = await page.evaluate(() => window.hasCustomBlocks);
    if (customBlocks) {
      assert.ok(!(await page.locator('#chat').textContent()).includes('"elements"'));
      await page.locator('#chat').getByText('Diagram is rendering…', {exact:true}).waitFor();
    } else {
      assert.ok((await page.locator('#chat').textContent()).includes('"elements"'));
    }
    await page.evaluate(() => window.setDiagram(JSON.stringify({ elements: [
      { id: 'box', type: 'rectangle', x: 0, y: 0, width: 220, height: 80, roughness: 0 },
      { id: 'label', type: 'text', x: 20, y: 20, width: 180, height: 30, text: 'Small diagram', fontSize: 20, fontFamily: 2 },
    ] })));
    const image = host.getByRole('img', { name: 'Diagram', exact: true });
    try { await image.waitFor({ state: 'visible' }); }
    catch (error) { throw new Error(`${error.message}\nBrowser errors: ${JSON.stringify(errors)}\nRendered host: ${await host.textContent()}`); }
    await page.waitForFunction(() => document.querySelector('#host .inline-diagram img')?.naturalWidth > 0);
    assert.ok((await image.boundingBox()).height <= 320);
    assert.ok(decodeURIComponent(await image.getAttribute('src')).includes('Small diagram'));
    assert.ok((await page.locator('#chat').textContent()).includes('After'));
    if(customBlocks) await page.locator('#chat').getByRole('img', {name:'Diagram',exact:true}).waitFor();
    else assert.equal(await page.locator('#chat img').count(), 0);
    assert.equal(await host.locator('summary').evaluate(el => getComputedStyle(el).fontSize), '11px');
    await page.screenshot({ path: '/tmp/korus-inline-diagram-preview.png' });
    await page.evaluate(() => window.setDiagram('{broken'));
    await host.getByRole('status').waitFor({ state: 'visible' });
    assert.equal(await image.count(), 0);
    assert.equal(await host.locator('details').getAttribute('open'), '');
    assert.ok((await host.locator('pre').textContent()).includes('{broken'));
    assert.deepEqual(errors, []);
    assert.equal(navigations, initialNavigations, 'Lazy rendering must preserve the page and its scene');
    await page.screenshot({ path: '/tmp/korus-inline-diagram-fallback.png' });
  } finally { await browser.close(); await server.close(); await rm(cacheDir, { recursive: true, force: true }); }
});
