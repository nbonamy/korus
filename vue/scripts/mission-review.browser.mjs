import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';

test('Mission review keeps actions visible and applies the implementation model choice', async () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const require = createRequire(new URL('../package.json', import.meta.url));
  const server = await createServer({
    configFile: false,
    root,
    server: { host: '127.0.0.1', port: 0 },
    resolve: { alias: {
      '@workspace/core': path.join(root, 'core/src'),
      '@codex-app-sdk/vue/styles.css': require.resolve('@codex-app-sdk/vue/styles.css'),
    }, dedupe: ['vue'] },
    plugins: [vue(), {
      name: 'mission-review-layout',
      configureServer(server) {
        server.middlewares.use('/mission-review-layout', (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end('<!doctype html><html><head><style>html,body,#app{height:100%;margin:0}#app{display:flex;flex-direction:column}</style></head><body><div id="app"></div><script type="module" src="/mission-review-fixture.js"></script></body></html>');
        });
      },
      resolveId(id) { if (id === '/mission-review-fixture.js') return '\0mission-review-fixture'; },
      load(id) {
        if (id !== '\0mission-review-fixture') return;
        return `
          import { createApp, h, computed } from 'vue';
          import { backendChoicesKey } from '/vue/src/components/backend-selection.ts';
          import { backendModelCatalogKey } from '/vue/src/components/backend-model-catalog.ts';
          import ElementPlus from 'element-plus';
          import 'element-plus/dist/index.css';
          import '@codex-app-sdk/vue/styles.css';
          import '/vue/src/styles/variables.css';
          import '/vue/src/styles/theme.css';
          import '/vue/src/styles/base.css';
          import { i18n } from '/vue/src/i18n/index.ts';
          import { createInitialSnapshot } from '/core/src/snapshot-construction.ts';
          import { createMission } from '/core/src/missions.ts';
          import { applyMissionDebugFixture } from '/backend/src/mission-debug-fixtures.ts';
          import MissionWorkspace from '/vue/src/components/MissionWorkspace.vue';
          const snapshot = createInitialSnapshot();
          const mission = createMission(snapshot, { outcome: 'Review a long Mission brief', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0].id, orchestratorMemberId: snapshot.agents[0].id });
          applyMissionDebugFixture(snapshot, mission.id, 'requirements');
          if (new URLSearchParams(location.search).has('tickets')) {
            mission.stage = 'tickets';
            const run = mission.execution.runs.at(-1);
            run.stage = 'tickets';
            run.proposal.tickets = [{ title: 'Implement checkout', repositoryPath: '/repo', done: false }];
            snapshot.agents.find(agent => agent.id === run.workerId).backendDefaults = { kind: 'codex', model: 'planner', reasoningEffort: 'high' };
          }
          const app = createApp({ render: () => h(MissionWorkspace, { mission, agents: snapshot.agents, executeMission: async input => { window.lastApproval = input; } }, { conversation: () => h('p', 'Fixture conversation') }) });
          app.provide(backendChoicesKey, computed(() => ['codex', 'claude']));
          app.provide(backendModelCatalogKey, { listModels: async () => [
            { id: 'planner', model: 'planner', displayName: 'Planner', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }] },
            { id: 'luna', model: 'luna', displayName: 'Luna', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }] },
          ] });
          app.use(ElementPlus).use(i18n).mount('#app');
        `;
      },
    }],
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 800 } });
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => console.error(error));
    await page.goto(`${server.resolvedUrls.local[0]}mission-review-layout`);
    await page.getByRole('button', { name: 'Approve', exact: true }).waitFor({ state: 'attached' });
    const scroll = page.locator('.mission-workspace__workbench-scroll');
    const measurements = [];
    for (const height of [800, 560]) {
      await page.setViewportSize({ width: 1440, height });
      for (const fraction of [0, 0.5, 1]) {
        await scroll.evaluate((element, fraction) => element.scrollTo(0, fraction * (element.scrollHeight - element.clientHeight)), fraction);
        const layout = await scroll.evaluate(element => {
          const footer = element.querySelector('.plan-review-footer');
          return {
            scroll: element.getBoundingClientRect().toJSON(),
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
            footer: footer.getBoundingClientRect().toJSON(),
            buttons: [...footer.querySelectorAll('button')].map(button => ({ text: button.textContent.trim(), bounds: button.getBoundingClientRect().toJSON() })),
            documentBottom: element.querySelector('.plan-review-section:last-child').getBoundingClientRect().bottom,
          };
        });
        measurements.push({ height, fraction, ...layout });
        assert.ok(layout.scrollHeight > layout.clientHeight * 2, 'the debug brief must span multiple viewport heights');
        assert.ok(Math.abs(layout.footer.bottom - layout.scroll.bottom) <= 1, 'the action bar must sit flush against the bottom of the review viewport');
        for (const button of layout.buttons) {
          assert.ok(button.bounds.top >= layout.scroll.top && button.bounds.bottom <= layout.scroll.bottom + 1,
            `${button.text} must stay visible at ${fraction * 100}% scroll in a ${height}px viewport`);
        }
        if (fraction === 1) assert.ok(layout.documentBottom <= layout.footer.top + 1, 'the footer must not cover the end of the brief');
        if (process.env.MISSION_REVIEW_ARTIFACTS) {
          await mkdir(process.env.MISSION_REVIEW_ARTIFACTS, { recursive: true });
          await page.screenshot({ path: path.join(process.env.MISSION_REVIEW_ARTIFACTS, `${height}-${fraction}.png`) });
        }
      }
    }
    const companion = page.getByRole('checkbox', { name: 'Companion progress overview', exact: true });
    assert.equal(await companion.isEnabled(), true, 'debug requirements must allow answering questions');
    await companion.check();
    await page.getByRole('button', { name: 'Comment on diagram 1: Workflow at a glance', exact: true }).click();
    await page.locator('textarea:visible').fill('Keep the approval boundary explicit.');
    assert.equal(await page.locator('textarea:visible').inputValue(), 'Keep the approval boundary explicit.', 'debug requirements must allow annotations');
    const commentFocus = await page.locator('textarea:visible').evaluate(field => {
      const style = getComputedStyle(field);
      const bounds = field.getBoundingClientRect();
      const clip = field.closest('.plan-review-document').getBoundingClientRect();
      const width = parseFloat(style.outlineWidth);
      const outside = Math.max(0, width + parseFloat(style.outlineOffset));
      return { visible: field.matches(':focus-visible') && style.outlineStyle !== 'none' && width > 0,
        left: bounds.left - outside, right: bounds.right + outside, clipLeft: clip.left, clipRight: clip.right };
    });
    assert.ok(commentFocus.visible, 'the comment field must retain a visible keyboard focus indicator');
    assert.ok(commentFocus.left >= commentFocus.clipLeft && commentFocus.right <= commentFocus.clipRight,
      'the complete comment focus ring must fit inside the document clipping bounds');
    if (process.env.MISSION_REVIEW_ARTIFACTS) {
      await page.screenshot({ path: path.join(process.env.MISSION_REVIEW_ARTIFACTS, 'comment-focus.png') });
      await writeFile(path.join(process.env.MISSION_REVIEW_ARTIFACTS, 'comment-focus.json'), JSON.stringify(commentFocus, null, 2));
    }
    await page.goto(`${server.resolvedUrls.local[0]}mission-review-layout?tickets`);
    await page.getByRole('button', { name: 'Implement', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Start implementation', exact: true });
    await dialog.waitFor();
    const parallel = dialog.getByRole('switch', { name: 'Allow parallel agents in the same repository', exact: true });
    assert.equal(await parallel.getAttribute('aria-checked'), 'false');
    assert.match(await dialog.innerText(), /Agents share files and Git state/);
    await dialog.locator('.el-switch').click();
    assert.equal(await parallel.getAttribute('aria-checked'), 'true');
    const modelPicker = page.getByRole('button', { name: 'Coding agent and model', exact: true });
    await modelPicker.waitFor();
    await modelPicker.click();
    await page.getByRole('menuitem', { name: 'Luna', exact: true }).hover();
    await page.getByRole('menuitemradio', { name: 'low', exact: true }).click();
    assert.match(await modelPicker.innerText(), /Luna/);
    assert.match(await modelPicker.innerText(), /low/);
    await page.getByRole('menuitemradio', { name: 'low', exact: true }).waitFor({ state: 'hidden' });
    if (process.env.MISSION_REVIEW_ARTIFACTS) await page.screenshot({ path: path.join(process.env.MISSION_REVIEW_ARTIFACTS, 'parallel-implementation-dialog.png') });
    await dialog.getByRole('button', { name: 'Start', exact: true }).click();
    const approval = await page.evaluate(() => window.lastApproval);
    assert.deepEqual(approval.implementationModel, { backend: 'codex', model: 'luna', reasoningEffort: 'low', serviceTier: null });
    assert.equal(approval.parallelImplementation, true);
    if (process.env.MISSION_REVIEW_ARTIFACTS) {
      await page.screenshot({ path: path.join(process.env.MISSION_REVIEW_ARTIFACTS, 'implementation-model.png') });
      await writeFile(path.join(process.env.MISSION_REVIEW_ARTIFACTS, 'implementation-model.json'), JSON.stringify(approval, null, 2));
    }
    if (process.env.MISSION_REVIEW_ARTIFACTS) await writeFile(path.join(process.env.MISSION_REVIEW_ARTIFACTS, 'measurements.json'), JSON.stringify(measurements, null, 2));
  } finally {
    await browser?.close();
    await server.close();
  }
});
