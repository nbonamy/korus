import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';

// The dropdown is teleported, so a size rule can miss its rows or affect the default selector.
test('small host selector matches dropdown text to its field without changing the default size', async () => {
  const server = await createServer({
    configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)), logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 }, resolve: { dedupe: ['vue'] },
    plugins: [vue(), {
      name: 'host-selector-fixture',
      configureServer(server) {
        server.middlewares.use('/host-selector', (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end('<div id="app"></div><script type="module" src="/host-selector-fixture.js"></script>');
        });
      },
      resolveId(id) { if (id === '/host-selector-fixture.js') return '\0host-selector-fixture'; },
      load(id) {
        if (id !== '\0host-selector-fixture') return;
        return `
          import { createApp, h, ref } from 'vue';
          import ElementPlus from 'element-plus';
          import 'element-plus/dist/index.css';
          import '/vue/src/styles/variables.css';
          import '/vue/src/styles/theme.css';
          import '/vue/src/styles/base.css';
          import { i18n } from '/vue/src/i18n/index.ts';
          import HostSelector from '/vue/src/components/HostSelector.vue';
          const hosts = [{ id: 'wall-e', name: 'wall-e', host: 'wall-e', kind: 'ssh', status: 'ready', createdAt: '', updatedAt: '' }];
          createApp({ setup() {
            const selected = ref('local');
            return () => h('main', { style: 'padding: 40px; width: 320px; display: grid; gap: 60px' }, [
              h(HostSelector, { class: 'normal-host', hosts, modelValue: selected.value, 'onUpdate:modelValue': value => selected.value = value }),
              h(HostSelector, { class: 'small-host', hosts, size: 'small', modelValue: selected.value, 'onUpdate:modelValue': value => selected.value = value }),
            ]);
          } }).use(ElementPlus).use(i18n).mount('#app');
        `;
      },
    }],
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
    await page.goto(`${server.resolvedUrls.local[0]}host-selector`);
    async function optionFontSize(selector) {
      const host = page.locator(selector);
      const fieldSize = await host.locator('.el-select__placeholder').evaluate(element => getComputedStyle(element).fontSize);
      await host.locator('.el-select__wrapper').click();
      const id = await host.locator('input').getAttribute('aria-controls');
      const option = page.locator(`[id="${id}"]`).getByRole('option', { name: 'wall-e' });
      await option.waitFor();
      const rowSize = await option.locator('.host-selector__option').evaluate(element => getComputedStyle(element).fontSize);
      if (selector === '.small-host' && process.env.HOST_SELECTOR_SCREENSHOT) await page.screenshot({ path: process.env.HOST_SELECTOR_SCREENSHOT });
      await host.locator('.el-select__wrapper').click();
      return { fieldSize, rowSize };
    }
    const normal = await optionFontSize('.normal-host');
    const small = await optionFontSize('.small-host');
    assert.equal(small.rowSize, small.fieldSize, `small dropdown ${small.rowSize} must match its field ${small.fieldSize}`);
    assert.ok(parseFloat(small.rowSize) < parseFloat(normal.rowSize), `small ${small.rowSize} must be smaller than default ${normal.rowSize}`);
    console.log(JSON.stringify({ normal, small }));
  } finally {
    await browser?.close();
    await server.close();
  }
});
