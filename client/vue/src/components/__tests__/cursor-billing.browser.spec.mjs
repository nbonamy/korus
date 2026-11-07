import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';

test('billing displays full plan names and aligned money in the real account menu, including a Free account', async () => {
  const root = fileURLToPath(new URL('../../../../..', import.meta.url));
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'cursor-billing-fixture-'));
  const source = `
    import {createApp,h} from 'vue';
    import ElementPlus from 'element-plus';
    import 'element-plus/dist/index.css';
    import Menu from '/client/vue/src/components/SettingsMenu.vue';
    import {configureAppClient} from '/client/vue/src/platform-api.ts';
    import {i18n} from '/client/vue/src/i18n/index.ts';
    import '/client/vue/src/styles/variables.css';
    import '/client/vue/src/styles/base.css';
    window.limits={limitId:'cursor',limitName:null,primary:null,secondary:null,credits:null,
      individualLimit:null,planType:'Teams Standard',rateLimitReachedType:null,
      billing:{includedBalanceUsd:'9999.99',onDemand:{enabled:true,unlimited:false,usedUsd:1,limitUsd:50,remainingUsd:49}}};
    configureAppClient({platform:'desktop',api:{getProviderUsage:async()=>window.limits}});
    createApp({render:()=>h(Menu,{enabledBackends:['cursor']})}).use(ElementPlus).use(i18n).mount('#app');
  `;
  const server = await createServer({
    configFile: false, root, logLevel: 'error', cacheDir: path.join(fixture, 'vite-cache'),
    resolve: { alias: { '@workspace/core': path.join(root, 'core/src') } },
    plugins: [vue(), {
      name: 'billing-fixture',
      configureServer(server) {
        server.middlewares.use('/billing-fixture', (_request, response) => {
          response.setHeader('Content-Type', 'text/html');
          response.end('<div id="app" style="position:absolute;top:300px;left:20px;height:auto;width:auto"></div><script type="module" src="/billing-entry.js"></script>');
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
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0] + 'billing-fixture');
    const trigger = page.getByRole('button', { name: 'Settings menu', exact: true });
    await trigger.click();
    await page.getByText('$9,999.99', { exact: true }).waitFor();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.el-popover.el-popper')).opacity === '1');
    const values = await page.locator('.settings-menu__rate-limit-remaining').evaluateAll(elements => elements.map(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      return { text: element.textContent, right: range.getBoundingClientRect().right, clipped: element.scrollWidth > element.clientWidth };
    }));
    assert.ok(values.every(value => Math.abs(value.right - values[0].right) <= 1), 'billing values share a right edge');
    assert.ok(values.every(value => !value.clipped), 'plan names and monetary balances fit');
    const evidence = await mkdtemp(path.join(os.tmpdir(), 'cursor-billing-browser-'));
    await page.screenshot({ path: path.join(evidence, 'paid.png') });
    await trigger.click();
    await page.locator('.settings-menu').waitFor({ state: 'hidden' });
    await page.evaluate(() => {
      window.limits.planType = 'Free'; window.limits.billing.includedBalanceUsd = '0.00';
      window.limits.billing.onDemand = { enabled: false, unlimited: false, usedUsd: 0, limitUsd: 0, remainingUsd: 0 };
    });
    await trigger.click();
    await page.getByText('Off', { exact: true }).waitFor();
    assert.match(await page.locator('.settings-menu__usage-group').textContent(), /Free/);
    assert.equal(await page.getByText('100%', { exact: true }).count(), 0);
    await page.screenshot({ path: path.join(evidence, 'free.png') });
    assert.deepEqual(errors, []);
    console.info(`Cursor billing browser evidence: ${evidence}`);
  } finally { await browser.close(); await server.close(); await rm(fixture, { recursive: true, force: true }); }
});
