import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';

test('split workspace dialogs cover peer headers and dividers and remain dismissible', async () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const server = await createServer({
    configFile: false, root, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
    resolve: { alias: { '@workspace/core': path.join(root, 'core/src') }, dedupe: ['vue'] },
    plugins: [vue(), {
      name: 'split-dialog-fixture',
      configureServer(server) {
        server.middlewares.use('/split-dialogs', (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end('<div id="app"></div><script type="module" src="/split-dialog-fixture.js"></script>');
        });
      },
      resolveId(id) { if (id === '/split-dialog-fixture.js') return '\0split-dialog-fixture'; },
      load(id) {
        if (id !== '\0split-dialog-fixture') return;
        return `
          import { createApp, h } from 'vue';
          import ElementPlus from 'element-plus';
          import 'element-plus/dist/index.css';
          import '/vue/src/styles/variables.css';
          import '/vue/src/styles/theme.css';
          import '/vue/src/styles/base.css';
          import { i18n } from '/vue/src/i18n/index.ts';
          import { configureAppClient } from '/vue/src/platform-api.ts';
          import Grid from '/vue/src/components/AgentSplitGrid.vue';
          import Header from '/vue/src/shared/WorkspaceHeader.vue';
          import Git from '/vue/src/components/GitWorkflowControl.vue';
          import Runs from '/vue/src/components/RunProfilesControl.vue';
          const layout = new URLSearchParams(location.search).get('layout');
          const panes = Array.from({ length: layout === '4-quadrant' ? 4 : 2 }, (_, id) => ({ id, agentId: 'agent-' + id }));
          const workflow = { repository: 'owner/repo', folder: '/repo', isLinkedWorktree: true,
            baseBranch: 'main', branch: 'feature/demo', detached: false, remote: 'origin',
            ahead: 1, behind: 0, stagedAddedLines: 0, stagedRemovedLines: 0,
            unstagedAddedLines: 1, unstagedRemovedLines: 0, untrackedAddedLines: 0, untrackedRemovedLines: 0,
            files: [{ path: 'a.ts', indexStatus: ' ', worktreeStatus: 'M' }], stagedFiles: [], unstagedFiles: ['a.ts'], githubConnected: true };
          configureAppClient({ platform: 'desktop', api: {
            onEvent: () => () => {},
            getRunProfiles: async () => ({ repository: '/repo', worktree: '/repo', profiles: [{ id: 'dev', name: 'Dev server', command: 'npm run dev', directory: '.' }], targets: { dev: { cwd: '/repo' } }, runs: [{ id: 'run', profileId: 'dev', state: 'running', command: 'npm run dev', cwd: '/repo', output: 'Ready', outputTruncated: false }] }),
            getRunProfileActions: async () => ({ actions: [], warnings: [] }),
            getAgentGitPrune: async () => ({ repository: 'repo', baseBranch: 'main', unavailableRemotes: [],
              groups: Array.from({ length: 20 }, (_, index) => ({ branch: 'feature-' + index, remotes: [], local: {
                id: 'local:' + index, name: 'feature-' + index, branch: 'feature-' + index,
                kind: 'local', sha: 'abc', revision: 'r', merged: true, usedBy: [], changedFiles: 0,
              } })) }),
          } });
          createApp({ render: () => h('main', { style: 'height:100vh;display:flex' }, [
            h(Grid, { layout, panes, focusedPaneId: 0 }, {
              header: ({ agentId }) => h(Header, {}, () => [
                h('strong', { class: 'workspace-header__title' }, agentId),
                h(Git, { agent: { id: agentId, name: agentId, folder: '/repo', backend: 'codex', status: { type: 'idle' } },
                  getWorkflow: async () => workflow, commitChanges: async () => workflow }),
                h(Runs, { agent: { id: agentId, folder: '/repo' }, hostLabel: 'Local host' }),
              ]),
              default: ({ agentId }) => h('div', { style: 'flex:1' }, agentId + ' conversation'),
            }),
          ]) }).use(ElementPlus).use(i18n).mount('#app');
        `;
      },
    }],
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    for (const layout of ['4-quadrant', '2-horizontal']) {
      await page.goto(`${server.resolvedUrls.local[0]}split-dialogs?layout=${layout}`);
      const panes = page.locator('.agent-split-grid__pane');
      for (const [pane, trigger, action, title, dismiss] of [
        [panes.first(), 'Choose Git action', 'Prune', 'Prune repository', 'Cancel'],
        [panes.last(), 'Choose Git action', 'Commit', 'Commit changes', 'Cancel'],
        [panes.first(), 'Run profiles', 'Dev server', 'Dev server', 'Close'],
        [panes.last(), 'Run profiles', 'Choose commands…', 'Choose commands', 'Done'],
      ]) {
        await pane.getByRole('button', { name: trigger, exact: true }).click();
        await page.getByRole('menuitem', { name: new RegExp('^' + action), exact: false }).click();
        const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
        await dialog.waitFor({ state: 'visible' });
        await dialog.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)); });
        const covered = await page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]');
          const box = dialog.getBoundingClientRect();
          const peers = [...document.querySelectorAll('.workspace-header, .agent-split-grid__divider')];
          return peers.map(peer => {
            const rect = peer.getBoundingClientRect();
            const x = Math.max(rect.left + 1, Math.min(rect.right - 2, box.left + box.width / 2 - 30));
            const y = rect.top + rect.height / 2;
            const hit = document.elementFromPoint(x, y);
            return { peer: peer.className, covered: !!hit?.closest('.el-overlay'), hit: hit?.className };
          });
        });
        assert.ok(covered.every(result => result.covered), JSON.stringify({ layout, title, covered }));
        if (process.env.SPLIT_DIALOG_ARTIFACTS) {
          await mkdir(process.env.SPLIT_DIALOG_ARTIFACTS, { recursive: true });
          await page.screenshot({ path: path.join(process.env.SPLIT_DIALOG_ARTIFACTS, `${layout}-${title.replaceAll(' ', '-')}.png`) });
        }
        await dialog.getByRole('button', { name: dismiss, exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        await pane.getByRole('button', { name: 'Choose Git action', exact: true }).click();
        await page.keyboard.press('Escape');
      }
    }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
