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

test('Cursor shows weekly usage in the account menu and billing in settings, including a Free account', async () => {
  const root = fileURLToPath(new URL('../../../..', import.meta.url));
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'cursor-billing-fixture-'));
  const source = `
    import {createApp,h,ref} from 'vue';
    import ElementPlus from 'element-plus';
    import 'element-plus/dist/index.css';
    import Menu from '/client/vue/src/components/SettingsMenu.vue';
    import CursorSettings from '/client/vue/src/components/SettingsCursorPanel.vue';
    import {configureAppClient} from '/client/vue/src/platform-api.ts';
    import {i18n} from '/client/vue/src/i18n/index.ts';
    import '/client/vue/src/styles/variables.css';
    import '/client/vue/src/styles/base.css';
    window.limits={limitId:'cursor',limitName:null,primary:{label:null,usedPercent:13,windowDurationMins:10080,resetsAt:Date.now()/1000+6*86400},secondary:null,credits:null,
      individualLimit:null,planType:'Teams Standard',rateLimitReachedType:null,
      billing:{includedBalanceUsd:'9999.99',onDemand:{enabled:true,unlimited:false,usedUsd:1,limitUsd:50,remainingUsd:49}}};
    configureAppClient({platform:'desktop',api:{
      getProviderUsage:async()=>structuredClone(window.limits),
      getProviderUpdate:async()=>({provider:'cursor',status:'current',installedVersion:'2026.11.05',canUpgrade:false,busy:false})
    }});
    createApp({setup(){
      const settingsOpen=ref(false);
      return ()=>[
        h('div',{style:'position:absolute;top:300px;left:20px'},[
          h(Menu,{enabledProviders:['cursor'],onOpenSettings:()=>{settingsOpen.value=true}})
        ]),
        settingsOpen.value?h('div',{style:'margin-left:280px;width:600px'},[
          h(CursorSettings,{installed:true,connected:true,enabled:true})
        ]):null
      ];
    }}).use(ElementPlus).use(i18n).mount('#app');
  `;
  const server = await createServer({
    configFile: false, root, logLevel: 'error', cacheDir: path.join(fixture, 'vite-cache'),
    resolve: { alias: { '@workspace/core': path.join(root, 'core/src') } },
    plugins: [sdkSourcePlugin, vue(), {
      name: 'billing-fixture',
      configureServer(server) {
        server.middlewares.use('/billing-fixture', (_request, response) => {
          response.setHeader('Content-Type', 'text/html');
          response.end('<div id="app"></div><script type="module" src="/billing-entry.js"></script>');
        });
      },
      resolveId(id) { if (id === '/billing-entry.js') return '\0billing-entry'; },
      load(id) { if (id === '\0billing-entry') return source; },
    }],
    server: { host: '127.0.0.1', port: 0 },
  });
  const browser = await chromium.launch();
  try {
    await server.listen();
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    page.setDefaultTimeout(5_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0] + 'billing-fixture');
    const trigger = page.getByRole('button', { name: 'Settings menu', exact: true });
    await trigger.click();
    const menu = page.locator('.settings-menu');
    await menu.getByText('87%', { exact: true }).waitFor();
    assert.match(await menu.textContent(), /Weekly/);
    assert.doesNotMatch(await menu.textContent(), /Teams Standard|Credits|On-demand|\$/);
    await page.getByRole('menuitem', { name: /Settings/ }).click();
    await menu.waitFor({ state: 'hidden' });
    const billing = page.locator('section[aria-labelledby="settings-cursor-billing-title"]');
    await billing.getByText('$9,999.99', { exact: true }).waitFor();
    await billing.getByText('$49.00', { exact: true }).waitFor();
    const values = await billing.locator('.form-row__copy > span').evaluateAll(elements => elements.map(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const bounds = range.getBoundingClientRect();
      return { text: element.textContent, left: bounds.left, clipped: element.scrollWidth > element.clientWidth || bounds.right > element.getBoundingClientRect().right + 1 };
    }));
    assert.equal(values.length, 2);
    assert.ok(values.every(value => Math.abs(value.left - values[0].left) <= 1), 'billing values align in the settings rows');
    assert.ok(values.every(value => !value.clipped), 'monetary balances fit in settings');
    const evidence = await mkdtemp(path.join(os.tmpdir(), 'cursor-billing-browser-'));
    await page.screenshot({ path: path.join(evidence, 'paid.png') });
    await page.evaluate(() => {
      window.limits.planType = 'Free'; window.limits.primary = null;
      window.limits.billing.includedBalanceUsd = '0.00';
      window.limits.billing.onDemand = { enabled: false, unlimited: false, usedUsd: 0, limitUsd: 0, remainingUsd: 0 };
    });
    await billing.getByRole('button', { name: 'Refresh billing', exact: true }).click();
    await billing.getByText('Off', { exact: true }).waitFor();
    await billing.getByText('$0.00', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(evidence, 'free.png') });
    await trigger.click();
    await menu.waitFor({ state: 'visible' });
    await menu.locator('.settings-menu__usage-group').waitFor({ state: 'detached' });
    assert.doesNotMatch(await menu.textContent(), /Credits|On-demand|100%|\$/);
    assert.deepEqual(errors, []);
    console.info(`Cursor billing browser evidence: ${evidence}`);
  } finally { await browser.close(); await server.close(); await rm(fixture, { recursive: true, force: true }); }
});
