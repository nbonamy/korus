import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';

test('Backlog actions stay inside their rows when the inbox is narrower than the window', async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../..', import.meta.url)),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
    resolve: { dedupe: ['vue'] },
    plugins: [vue(), {
      name: 'backlog-layout-fixture',
      configureServer(server) {
        server.middlewares.use('/backlog-layout', (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end('<div id="app" style="display:flex;height:600px;width:1400px"></div><script type="module" src="/backlog-layout-fixture.js"></script>');
        });
      },
      resolveId(id) { if (id === '/backlog-layout-fixture.js') return '\0backlog-layout-fixture'; },
      load(id) {
        if (id !== '\0backlog-layout-fixture') return;
        return `
          import { createApp, h } from 'vue';
          import ElementPlus from 'element-plus';
          import 'element-plus/dist/index.css';
          import '/vue/src/styles/variables.css';
          import '/vue/src/styles/theme.css';
          import '/vue/src/styles/base.css';
          import { i18n } from '/vue/src/i18n/index.ts';
          import Inbox from '/vue/src/components/CockpitWorkInbox.vue';
          const item = { id: 'github:owner/repository#68', provider: 'github', sourceId: 'repo', sourceName: 'owner/repository',
            number: 68, kind: 'issue', title: 'Leaving a shared conversation can replace another conversation',
            body: 'Keep all actions reachable.', url: 'https://example.com/issues/68', state: 'open', nativeState: 'Ready',
            labels: [{ name: 'bug' }], assignees: [], branchName: 'fix/shared-conversation',
            createdAt: '2026-10-29T00:00:00Z', updatedAt: '2026-10-29T00:00:00Z' };
          createApp({ render: () => h(Inbox, { agents: [], teams: [], assignments: {}, items: [item],
            repositories: [{ id: 'repo', provider: 'github', name: 'repository', fullName: 'owner/repository', path: '/repo' }],
            connection: { provider: 'github', status: 'connected' }, status: 'loaded', error: null,
            activeView: 'backlog', selectedRepositoryId: 'repo', startWorkAction: async () => {} })
          }).use(ElementPlus).use(i18n).mount('#app');
        `;
      },
    }],
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1600, height: 750 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`${server.resolvedUrls.local[0]}backlog-layout`);
    await page.locator('.cockpit-inbox__row').waitFor();
    const measurements = [];
    for (const width of [1400, 1100, 950, 780, 640, 480]) {
      await page.locator('#app').evaluate((app, width) => { app.style.width = `${width}px`; }, width);
      const layout = await page.locator('.cockpit-inbox__row').evaluate(row => {
        const bounds = row.getBoundingClientRect();
        const actions = row.querySelector('.cockpit-inbox__row-actions').getBoundingClientRect();
        const title = row.querySelector('.cockpit-inbox__title').getBoundingClientRect();
        const buttons = [...row.querySelectorAll('.cockpit-inbox__row-actions button')];
        return { width: bounds.width, rowRight: bounds.right, actionsRight: actions.right, titleWidth: title.width,
          reachable: buttons.every(button => { const r = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }) };
      });
      measurements.push({ inboxWidth: width, ...layout });
      assert.ok(layout.actionsRight <= layout.rowRight + 1, `actions overflow at inbox width ${width}: ${JSON.stringify(layout)}`);
      assert.ok(layout.titleWidth >= 100, `title remains usable at inbox width ${width}`);
      assert.ok(layout.reachable, `every row action is reachable at inbox width ${width}`);
    }
    if (process.env.BACKLOG_LAYOUT_SCREENSHOT) {
      await page.locator('#app').screenshot({ path: process.env.BACKLOG_LAYOUT_SCREENSHOT });
    }
    await page.getByRole('button', { name: 'Start work on #68', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify(measurements));
  } finally {
    await browser?.close();
    await server.close();
  }
});
