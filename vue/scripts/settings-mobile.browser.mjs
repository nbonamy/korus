import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';

test('desktop pairing keeps the QR and manual code compact, legible and within the settings panel', async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 },
    resolve: { dedupe: ['vue'] },
    plugins: [vue(), {
      name: 'pairing-layout-test',
      configureServer(server) {
        server.middlewares.use('/pairing-layout', (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end('<div id="app" style="padding:16px;max-width:700px"></div><script type="module" src="/pairing-fixture.js"></script>');
        });
      },
      resolveId(id) { if (id === '/pairing-fixture.js') return '\0pairing-fixture'; },
      load(id) {
        if (id !== '\0pairing-fixture') return;
        return `
          import { createApp, h } from 'vue';
          import Section from '/vue/src/components/SettingsMobileSection.vue';
          import { i18n } from '/vue/src/i18n/index.ts';
          import ElementPlus from 'element-plus';
          import 'element-plus/dist/index.css';
          import '/vue/src/styles/variables.css';
          import '/vue/src/styles/theme.css';
          import '/vue/src/styles/base.css';
          const status = { configured: true, enabled: true, connected: true, hostId: 'fixture', relayOrigin: '', devices: [], pending: [] };
          const control = async ({ action }) => ({ status, ...(action === 'invite' ? { invitation: { code: 'K7QD-M2XP', expiresAt: Date.now() + 300000 } } : {}) });
          createApp({ render: () => h(Section, { control }) }).use(ElementPlus).use(i18n).mount('#app');
        `;
      },
    }],
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 700, height: 450 } });
    await page.goto(`${server.resolvedUrls.local[0]}pairing-layout`);
    await page.getByRole('button', { name: 'Add device', exact: true }).click();
    await page.getByRole('img', { name: 'Pairing code QR' }).waitFor();
    for (const width of [700, 480, 320]) {
      await page.setViewportSize({ width, height: 500 });
      const layout = await page.locator('.settings-mobile__pairing').evaluate(panel => {
        const qr = panel.querySelector('img');
        const code = panel.querySelector('code');
        return { panel: panel.getBoundingClientRect().toJSON(), qr: qr.getBoundingClientRect().toJSON(),
          code: code.getBoundingClientRect().toJSON(), loaded: qr.complete && qr.naturalWidth > 0,
          fontSize: parseFloat(getComputedStyle(code).fontSize), value: code.textContent };
      });
      assert.equal(layout.value, 'K7QD-M2XP');
      assert.ok(layout.loaded, 'the actual pairing QR must load');
      assert.ok(layout.qr.width >= 120 && layout.qr.width <= 140, 'QR stays scannable without dominating the panel');
      assert.ok(layout.fontSize >= 18 && layout.fontSize <= 22, 'manual code stays readable and secondary');
      assert.ok(layout.code.right <= layout.panel.right && layout.qr.right <= layout.panel.right, 'pairing content must not overflow');
      if (width > 420) {
        assert.ok(layout.qr.right < layout.code.left, 'desktop QR and code sit side by side');
        assert.ok(layout.panel.height <= 180, 'desktop pairing stays compact');
      } else {
        assert.ok(layout.qr.bottom < layout.code.top, 'narrow panels stack without overlap');
      }
    }
    if (process.env.PAIRING_SCREENSHOT) {
      await page.setViewportSize({ width: 1100, height: 500 });
      await page.screenshot({ path: process.env.PAIRING_SCREENSHOT });
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});
