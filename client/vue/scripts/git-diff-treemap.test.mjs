import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';

// Owning rendered workflow: a dense map must preserve churn, scope and file identity
// while resizing/filtering, and every small or non-textual file must stay reachable.
test('diff treemap scales to hundreds of files and drills into the existing diff', { timeout: 90_000 }, async t => {
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const output = process.env.DIFF_TREEMAP_EVIDENCE || await mkdtemp(path.join(os.tmpdir(), 'diff-treemap-'));
  await mkdir(output, { recursive: true });
  const patch = (name, added, removed) => [
    `diff --git a/${name} b/${name}`, `--- a/${name}`, `+++ b/${name}`,
    `@@ -1,${removed} +1,${added} @@`,
    ...Array.from({ length: removed }, (_, i) => `-old ${i}`),
    ...Array.from({ length: added }, (_, i) => `+new ${i}`),
  ].join('\n');
  const files = Array.from({ length: 200 }, (_, i) => ({
    name: i === 0 ? 'src/rewrite.ts' : i === 1 ? 'src/growth.ts' : i < 140 ? `src/module-${i}.ts` : i < 180 ? `tests/module-${i}.spec.ts` : i < 195 ? `docs/page-${i}.md` : `config/file-${i}.json`,
    added: i === 0 ? 200 : i === 1 ? 300 : Math.max(1, Math.floor(200 / ((((i - 2) * 137) % 198 + 3) ** 0.6))),
    removed: i === 0 ? 200 : i === 1 ? 1 : i % 7,
  }));
  const binary = 'diff --git a/assets/logo.png b/assets/logo.png\nindex 1234567..7654321 100644\nBinary files a/assets/logo.png and b/assets/logo.png differ';
  const rename = 'diff --git a/src/old.ts b/src/renamed.ts\nsimilarity index 100%\nrename from src/old.ts\nrename to src/renamed.ts';
  const sections = [
    { scope: 'staged', diff: [...files.slice(0, 100).map(f => patch(f.name, f.added, f.removed)), binary].join('\n') },
    { scope: 'unstaged', diff: [...files.slice(100).map(f => patch(f.name, f.added, f.removed)), patch(files[0].name, 3, 2), rename].join('\n') },
  ];
  const summary = { addedLines: files.reduce((n, file) => n + file.added, 3), removedLines: files.reduce((n, file) => n + file.removed, 2), changedFiles: 202 };
  const server = await createServer({
    configFile: false, root, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, ws: false },
    resolve: { alias: { '@workspace/core': path.join(root, 'core/src') }, dedupe: ['vue'] },
    plugins: [vue(), {
      name: 'diff-treemap-fixture',
      configureServer(server) {
        server.middlewares.use('/diff-map', (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end('<!doctype html><html><head><style>html,body{margin:0;height:100%}#app{height:100%;display:flex}.fixture{display:flex;width:960px;height:740px;margin:12px;min-width:0}</style></head><body><div id="app"></div><script type="module" src="/diff-map-fixture.js"></script></body></html>');
        });
      },
      resolveId(id) { if (id === '/diff-map-fixture.js') return '\0diff-map-fixture'; },
      load(id) {
        if (id !== '\0diff-map-fixture') return;
        return `
          import {createApp,h,ref} from 'vue';
          import ElementPlus from 'element-plus';
          import 'element-plus/dist/index.css';
          import '/client/vue/src/styles/variables.css';
          import '/client/vue/src/styles/theme.css';
          import '/client/vue/src/styles/base.css';
          import {i18n} from '/client/vue/src/i18n/index.ts';
          import Review from '/client/vue/src/components/GitReviewPanel.vue';
          import DiffControl from '/client/vue/src/components/GitDiffControl.vue';
          const sections=${JSON.stringify(sections)};
          const panel=ref({kind:'gitDiff',title:'Changes',summary:${JSON.stringify(summary)},state:'idle',diff:sections.map(s=>s.diff).join('\\n'),sections});
          window.fixture={replace:value=>panel.value={...panel.value,...value},opens:[]};
          const byKind=Object.fromEntries(['code','test','docs','other'].map(kind=>[kind,{changedFiles:1,addedLines:1,removedLines:1}]));
          createApp({setup:()=>()=>[
            h('aside',{style:'position:absolute;right:16px;top:16px'},[h(DiffControl,{agentId:'fixture',gitStatus:{...panel.value.summary,diffCatalog:{uncommitted:{...panel.value.summary,byKind},commits:[]}}})]),
            h('main',{class:'fixture'},[h(Review,{agent:{id:'fixture',folder:'/repos/korus'},panel:panel.value,onOpenFile:path=>window.fixture.opens.push(path)})])
          ]}).use(i18n).use(ElementPlus).mount('#app');
        `;
      },
    }],
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}diff-map`);
    const toggleMap = async () => {
      await page.locator('.git-review-panel__toolbar .el-segmented__item').filter({ hasText: /^Map$/ }).click();
    };
    assert.equal(await page.locator('.git-review-panel__toolbar').getByRole('radio', { name: 'Files', exact: true }).isChecked(), true);
    await page.getByRole('button', { name: 'Choose repository diff', exact: true }).click();
    const menuColors = await page.locator('.app-menu__color-dot').evaluateAll(dots => dots.map(dot => getComputedStyle(dot).backgroundColor));
    assert.equal(menuColors.length, 4);
    await page.keyboard.press('Escape');
    await toggleMap();
    const filterColors = await page.locator('.diff-treemap__filters button:not(:first-child) i').evaluateAll(dots => dots.map(dot => getComputedStyle(dot).backgroundColor));
    assert.deepEqual(filterColors, menuColors, 'the map filters and header menu must use identical file-type colors');
    const tiles = page.locator('[data-diff-map-path]');
    await tiles.first().waitFor();
    assert.equal(await tiles.count(), 200, 'duplicate staged/unstaged paths must share one tile');
    assert.match(await tiles.first().getAttribute('aria-label'), /src\/rewrite.ts/);
    assert.match(await tiles.first().innerText(), /\+203/);
    assert.match(await tiles.first().innerText(), /-202/);
    // Canvas fills must agree with the accessible file controls above them.
    const readPixel = () => tiles.first().evaluate(tile => {
      const canvas = tile.parentElement.querySelector('canvas');
      const bounds = canvas.getBoundingClientRect(), rect = tile.getBoundingClientRect();
      const x = (rect.x - bounds.x + rect.width / 2) * canvas.width / bounds.width;
      const y = (rect.y - bounds.y + rect.height / 2) * canvas.height / bounds.height;
      return [...canvas.getContext('2d').getImageData(Math.floor(x), Math.floor(y), 1, 1).data];
    });
    const initialPixel = await readPixel();
    assert.equal(initialPixel[3], 255, 'the chart must paint the file tile, not leave a blank canvas');
    const colorSamples = await tiles.evaluateAll((tiles, colors) => {
      const canvas = tiles[0].parentElement.querySelector('canvas'), bounds = canvas.getBoundingClientRect();
      const surface = getComputedStyle(document.documentElement).getPropertyValue('--color-surface-lowest').trim();
      const expected = document.createElement('canvas').getContext('2d');
      return ['src/', 'tests/', 'docs/', 'config/'].map((prefix, i) => {
        const rect = tiles.find(tile => tile.dataset.diffMapPath.startsWith(prefix)).getBoundingClientRect();
        const x = Math.floor((rect.x - bounds.x + rect.width * 0.6) * canvas.width / bounds.width);
        const y = Math.floor((rect.y - bounds.y + rect.height * 0.6) * canvas.height / bounds.height);
        expected.fillStyle = `color-mix(in srgb, ${colors[i]} 16%, ${surface})`;
        expected.fillRect(0, 0, 1, 1);
        return { actual: [...canvas.getContext('2d').getImageData(x, y, 1, 1).data], expected: [...expected.getImageData(0, 0, 1, 1).data] };
      });
    }, menuColors);
    for (const sample of colorSamples) assert.ok(sample.actual.every((value, i) => Math.abs(value - sample.expected[i]) <= 3), 'canvas tile tints must use the menu category color');
    const measurements = [];
    for (const width of [960, 460, 280]) {
      await page.locator('.fixture').evaluate((element, width) => { element.style.width = width + 'px'; }, width);
      await page.waitForFunction(() => {
        const canvas = document.querySelector('.diff-treemap__canvas');
        return canvas && [...canvas.querySelectorAll('button')].every(button => button.getBoundingClientRect().right <= canvas.getBoundingClientRect().right + 1);
      });
      // Wait for ResizeObserver and its reactive layout, rather than assuming the window resized.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const geometry = await page.locator('.diff-treemap').evaluate(root => {
        const canvas = root.querySelector('.diff-treemap__canvas').getBoundingClientRect();
        return { width: root.clientWidth, scrollWidth: root.scrollWidth, canvas: canvas.toJSON(),
          tiles: [...root.querySelectorAll('[data-diff-map-path]')].map(tile => ({ path: tile.dataset.diffMapPath, rect: tile.getBoundingClientRect().toJSON(), labelled: Boolean(tile.querySelector('.diff-treemap__name')) })) };
      });
      measurements.push(geometry);
      assert.ok(geometry.scrollWidth <= geometry.width + 1, 'the pane must not scroll horizontally');
      const header = await page.locator('.git-review-panel__toolbar').evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
      assert.ok(header.scrollWidth <= header.width + 1, 'header controls must fit the sidebar width');
      assert.equal(await page.locator('.git-review-panel__toolbar').getByRole('radio', { name: 'Map', exact: true }).isChecked(), true);
      assert.equal(geometry.tiles.length, 200);
      for (const { rect } of geometry.tiles) {
        assert.ok(rect.width > 0 && rect.height > 0);
        assert.ok(rect.left >= geometry.canvas.left - 0.1 && rect.top >= geometry.canvas.top - 0.1);
        assert.ok(rect.right <= geometry.canvas.right + 0.1 && rect.bottom <= geometry.canvas.bottom + 0.1);
      }
      for (let i = 0; i < geometry.tiles.length; i++) for (let j = i + 1; j < geometry.tiles.length; j++) {
        const a = geometry.tiles[i].rect, b = geometry.tiles[j].rect;
        assert.ok(Math.min(a.right, b.right) - Math.max(a.left, b.left) < 0.1 || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) < 0.1, 'tiles must not overlap');
      }
      const [rewrite, growth] = geometry.tiles;
      assert.ok(Math.abs((rewrite.rect.width * rewrite.rect.height) / (growth.rect.width * growth.rect.height) - 405 / 301) < 0.005,
        'area must use additions plus deletions, including duplicate scopes, not net growth');
      assert.ok(geometry.tiles.some(tile => !tile.labelled), 'small tiles must not force clipped labels');
      await page.locator('.fixture').screenshot({ path: path.join(output, `all-${width}.png`) });
      if (width === 460) {
        const lightPixel = await readPixel();
        await page.evaluate(() => document.documentElement.classList.add('dark'));
        await page.waitForFunction(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const darkPixel = await readPixel();
        assert.notDeepEqual(darkPixel, lightPixel, 'canvas colors must follow theme changes without remounting');
        await page.locator('.fixture').screenshot({ path: path.join(output, 'dark-460.png') });
        await page.evaluate(() => document.documentElement.classList.remove('dark'));
      }
    }
    const small = tiles.last();
    const smallPath = await small.getAttribute('data-diff-map-path');
    await small.hover();
    const tooltip = page.getByRole('tooltip').filter({ has: page.locator('.diff-treemap__tooltip') });
    await tooltip.waitFor({ state: 'visible' });
    assert.match(await tooltip.innerText(), new RegExp(smallPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(await tooltip.innerText(), /\+\d+.*-\d+/s);
    await page.screenshot({ path: path.join(output, 'tooltip.png') });
    await small.focus();
    await page.keyboard.press('Home');
    assert.equal(await tiles.first().evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('End');
    assert.equal(await tiles.last().evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Escape');
    await tooltip.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Code', exact: false }).filter({ hasText: 'Code' }).click();
    assert.equal(await tiles.count(), 140);
    assert.ok((await tiles.evaluateAll(elements => elements.map(element => element.dataset.diffMapPath))).every(name => name.startsWith('src/')));
    await page.screenshot({ path: path.join(output, 'code-280.png') });
    const picked = await tiles.first().getAttribute('data-diff-map-path');
    await tiles.first().click();
    await page.locator('.git-diff-preview-panel__files').waitFor();
    const matching = page.locator(`[data-code-path="${picked}"]`);
    assert.equal(await matching.count(), 2, 'both patches for the selected path must remain reviewable');
    assert.equal(await page.locator('[data-code-path]').count(), 2, 'the changes pane must focus the clicked file itself, not all files');
    assert.equal(await matching.first().locator('.git-diff-preview-panel__file-header').getAttribute('aria-expanded'), 'true');
    assert.ok(await matching.first().locator('.git-diff-preview-panel__chunks').isVisible());
    assert.ok((await matching.first().boundingBox()).y < 740, 'clicking a tile must reveal its diff in the pane');
    await page.getByRole('button', { name: 'Back to change map', exact: true }).click();
    assert.equal(await tiles.count(), 140, 'returning to the map must preserve the file-type filter');
    await page.getByRole('button', { name: /^All / }).click();
    await page.getByText('Files without line changes', { exact: false }).click();
    await page.getByRole('button', { name: 'assets/logo.png', exact: true }).click();
    assert.match(await page.locator('.git-diff-preview-panel__files').innerText(), /No textual hunks/);
    await toggleMap();
    await page.getByRole('button', { name: 'Review options', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Staged changes', exact: true }).click();
    assert.equal(await tiles.count(), 101, 'scope filters must update the map, not only the line diff');
    const skewed = patch('config/huge.json', 25000, 25000) + '\n' + patch('src/tiny.ts', 1, 0);
    await page.evaluate(diff => window.fixture.replace({ diff, sections: [] }), skewed);
    await page.waitForFunction(() => document.querySelectorAll('[data-diff-map-path]').length === 2);
    const tinyBounds = await tiles.last().boundingBox();
    const canvasBounds = await page.locator('.diff-treemap__canvas').boundingBox();
    assert.ok(tinyBounds.x + tinyBounds.width <= canvasBounds.x + canvasBounds.width + 0.1, 'a dominant file must not push tiny tiles past the canvas');
    assert.ok(tinyBounds.width * tinyBounds.height < 4, 'tiny tiles must preserve their true area rather than a minimum button size');
    await tiles.last().focus();
    await page.getByRole('tooltip').filter({ has: page.locator('.diff-treemap__tooltip') }).waitFor({ state: 'visible' });
    assert.match(await page.getByRole('tooltip').filter({ has: page.locator('.diff-treemap__tooltip') }).innerText(), /src\/tiny.ts/);
    await page.evaluate(() => window.fixture.replace({ state: 'error', error: 'Read failed' }));
    await page.getByText('Read failed', { exact: true }).waitFor();
    assert.equal(await tiles.count(), 0);
    await page.evaluate(() => window.fixture.replace({ state: 'idle', diff: '', sections: [] }));
    await page.getByText('No diff content.', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await writeFile(path.join(output, 'evidence.json'), JSON.stringify({ measurements, pageErrors: errors, fileCount: 200, codeFileCount: 140, duplicateScopes: true, tooltip: true, keyboard: true, zeroLineFiles: true }, null, 2));
    t.diagnostic(`Diff treemap evidence: ${output}`);
  } finally {
    await browser?.close();
    await server.close();
  }
});
