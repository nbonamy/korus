import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { mkdir, mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, build } from 'vite';
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
  const httpServer = createHttpServer();
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const port = httpServer.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const server = await createServer({
    configFile: false, root, logLevel: 'error', cacheDir: path.join(output, 'vite-cache'),
    optimizeDeps: { entries: [path.join(root, 'client/vue/src/components/GitReviewPanel.vue'), path.join(root, 'client/vue/src/components/excalidraw-editor.ts')] },
    server: { middlewareMode: true, host: '127.0.0.1', port, hmr: { server: httpServer } },
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
          import {createApp,h,ref,reactive} from 'vue';
          import ElementPlus from 'element-plus';
          import 'element-plus/dist/index.css';
          import '/client/vue/src/styles/variables.css';
          import '/client/vue/src/styles/theme.css';
          import '/client/vue/src/styles/base.css';
          import {i18n} from '/client/vue/src/i18n/index.ts';
          import Review from '/client/vue/src/components/GitReviewPanel.vue';
          import DiffControl from '/client/vue/src/components/GitDiffControl.vue';
          import SettingsWorkflowsPanel from '/client/vue/src/components/SettingsWorkflowsPanel.vue';
          import {diffVizSettingsKey} from '/client/vue/src/components/diff-viz-settings.ts';
          import {configureAppClient} from '/client/vue/src/platform-api.ts';
          import {createEmptySnapshot} from '/core/src/snapshot.ts';
          const sections=${JSON.stringify(sections)};
          const panel=ref({kind:'gitDiff',title:'Changes',target:{type:'uncommitted'},summary:${JSON.stringify(summary)},state:'idle',diff:sections.map(s=>s.diff).join('\\n'),sections});
          window.fixture={replace:value=>panel.value={...panel.value,...value},opens:[],generations:[],settings:[]};
          const snapshot=reactive(createEmptySnapshot());
          const settingsVisible=ref(false);
          window.fixture.openSettings=value=>settingsVisible.value=value;
          const save=async input=>{window.fixture.settings.push(input);Object.assign(snapshot.general,input.general);return snapshot;};
          const nodes=[
            {id:'requests',icon:'repository',label:'GitHub PRs and reviews',status:'unchanged',paths:[],x:20,y:20,width:180,height:70},
            {id:'sync',icon:'sync',review:{title:'Persist profile activity',changed:'Profile activity is saved during synchronization.',impact:'Responses can read the synchronized activity.',question:'Does incremental sync retain existing records?'},locations:[{path:'src/rewrite.ts',line:2,endLine:3,side:'new'}],label:'Profile Sync Service',status:'changed',paths:['src/rewrite.ts','src/module-100.ts'],x:240,y:160,width:200,height:90},
            {id:'store',icon:'database',label:'Activity storage',status:'added',paths:['src/module-101.ts'],x:240,y:340,width:200,height:90},
            {id:'legacy',icon:'service',label:'Legacy sync path',status:'deleted',paths:['src/module-102.ts'],x:20,y:170,width:160,height:60},
            {id:'response',icon:'api',label:'Profile API',status:'unchanged',paths:[],x:240,y:540,width:180,height:70},
            {id:'tests',icon:'tests',label:'Profile tests',status:'added',paths:['tests/module-140.spec.ts'],x:240,y:20,width:200,height:60}
          ];
          const brandAsset={mimeType:'image/svg+xml',base64:btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24"><path fill="#ee00cc" d="M0 0h48v24H0z"/></svg>'),source:'svgl',sourceUrl:'https://svgl.app/library/fixture.svg',whiteFill:false};
          nodes.find(node=>node.id==='store').iconImage=brandAsset;
          nodes.find(node=>node.id==='legacy').iconImage={...brandAsset,base64:btoa('<svg>')};
          const diagram={format:'excalidraw',title:'Profile sync persists review activity',layout:'PR events feed synchronization and storage, with tests supporting the changed components.',groups:['activity'],nodes:nodes.map(({id,label,status,paths,icon,iconImage,review,locations})=>({id,label,status,paths,icon,iconImage,review,locations})),elements:[
            {id:'activity',type:'rectangle',x:210,y:100,width:280,height:380},
            {id:'activity_title',type:'text',x:230,y:115,width:240,height:24,text:'Profile Activity',fontFamily:2,fontSize:18},
            ...[['pr_events',200,55,140,105,[[0,0],[140,0],[140,105]],'requests','sync'],['save',340,258,0,74,[[0,0],[0,74]],'sync','store'],['read',340,438,0,94,[[0,0],[0,94]],'store','response'],['replace',188,200,44,5,[[0,0],[44,0]],'legacy','sync'],['checks',340,88,0,64,[[0,0],[0,64]],'tests','sync']].map(([id,x,y,width,height,points,from,to])=>({id,type:'arrow',x,y,width,height,points,...(id==='read'?{strokeStyle:'dashed'}:{}),endArrowhead:'arrow',startBinding:{elementId:from,focus:0,gap:8},endBinding:{elementId:to,focus:0,gap:8}})),
            ...nodes.flatMap(node=>[
              {id:node.id,type:'rectangle',x:node.x,y:node.y,width:node.width,height:node.height,boundElements:[{id:node.id+'_label',type:'text'}]},
              {id:node.id+'_label',type:'text',x:node.x+10,y:node.y+16,width:node.width-20,height:node.height-32,text:node.label,originalText:node.label,fontFamily:2,fontSize:18,lineHeight:1.25,textAlign:'center',verticalAlign:'middle',containerId:node.id}
            ]),
            {id:'save_label',type:'text',x:350,y:280,width:70,height:22,text:'persists',fontFamily:2,fontSize:16},
            {id:'read_label',type:'text',x:350,y:470,width:70,height:22,text:'reads',fontFamily:2,fontSize:16,containerId:'read'}
          ]};
          window.fixture.iconAsset=brandAsset;
          window.fixture.nativeScene=async()=>{const {diffVizScene}=await import('/client/vue/src/components/diff-viz-scene.ts');return diffVizScene(diagram);};
          const fastDiagram={format:'mermaid',nodes:diagram.nodes,source:'flowchart TB\\nrequests["GitHub PRs and reviews"]\\nsubgraph activity["Profile Activity"]\\nsync["Profile Sync Service"]\\nstore[("Activity storage")]\\nlegacy["Legacy sync path"]\\nend\\nresponse["Profile API"]\\ntests["Profile tests"]\\nrequests -->|PR events| sync\\nsync -->|persists| store\\nstore -->|reads| response\\nlegacy -.->|replaced by| sync\\ntests -.->|checks| sync'};
          configureAppClient({platform:'desktop',api:{
            getSnapshot:async()=>snapshot,
            updateSettings:save,
            generateAgentGitMessage:async(id,input)=>{const request=structuredClone(input);window.fixture.generations.push({id,input:request});return {kind:'viz',diagram:request.mode==='fast'?fastDiagram:diagram};}
          }});
          const byKind=Object.fromEntries(['code','test','docs','other'].map(kind=>[kind,{changedFiles:1,addedLines:1,removedLines:1}]));
          createApp({setup:()=>()=>[
            h('aside',{style:'position:absolute;right:16px;top:16px'},[h(DiffControl,{agentId:'fixture',gitStatus:{...panel.value.summary,diffCatalog:{uncommitted:{...panel.value.summary,byKind},commits:[]}}})]),
            h('main',{class:'fixture',style:settingsVisible.value?'display:none':undefined},[h(Review,{agent:{id:'fixture',folder:'/repos/korus'},panel:panel.value,onOpenFile:path=>window.fixture.opens.push(path)})]),
            settingsVisible.value?h('div',{class:'settings-fixture',style:'width:650px;height:820px;overflow:auto'},[h(SettingsWorkflowsPanel,{settings:snapshot.general,updateSettings:async input=>{await save(input);}})]):null
          ]}).provide(diffVizSettingsKey,()=>snapshot.general).use(i18n).use(ElementPlus).mount('#app');
        `;
      },
    }],
  });
  httpServer.on('request', server.middlewares);
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(10_000);
    // Remote font stylesheets must not hold this local rendering workflow open.
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/diff-map`);
    const toggleMap = async () => {
      await page.locator('.git-review-panel__toolbar .el-segmented__item').filter({ hasText: /^Map$/ }).click();
    };
    assert.equal(await page.locator('.git-review-panel__toolbar').getByRole('radio', { name: 'Files', exact: true }).isChecked(), true);
    const filesRadio = page.getByRole('radio', { name: 'Files', exact: true });
    const mapRadio = page.getByRole('radio', { name: 'Map', exact: true });
    await filesRadio.focus();
    const vizRadio = page.getByRole('radio', { name: 'Viz', exact: true });
    await page.keyboard.press('ArrowRight');
    await page.locator('.git-diff-view-toggle .el-segmented__item.is-selected').filter({hasText:/^Viz$/}).waitFor();
    assert.equal(await vizRadio.isChecked(), true);
    await page.getByText('See the impact of your changes', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.fixture.generations.length), 0, 'opening Viz must not send code without confirmation');
    await page.getByRole('checkbox', { name: 'Do not ask again', exact: true }).waitFor({ state: 'attached' });
    assert.equal(await page.locator('.diff-viz__legend').count(), 0, 'the legend belongs only to a generated diagram');
    await page.keyboard.press('ArrowRight');
    await page.locator('.git-diff-view-toggle .el-segmented__item.is-selected').filter({hasText:/^Map$/}).waitFor();
    assert.equal(await mapRadio.isChecked(), true);
    await page.keyboard.press('ArrowLeft');
    await page.locator('.git-diff-view-toggle .el-segmented__item.is-selected').filter({hasText:/^Viz$/}).waitFor();
    assert.equal(await vizRadio.isChecked(), true);
    await page.keyboard.press('ArrowLeft');
    await page.locator('.git-diff-view-toggle .el-segmented__item.is-selected').filter({hasText:/^Files$/}).waitFor();
    assert.equal(await filesRadio.isChecked(), true);
    await page.getByRole('button', { name: 'Choose repository diff', exact: true }).click();
    const menuColors = await page.locator('.app-menu__color-dot').evaluateAll(dots => dots.map(dot => getComputedStyle(dot).backgroundColor));
    assert.equal(menuColors.length, 4);
    await page.keyboard.press('Escape');
    await toggleMap();
    const filterColors = await page.locator('.diff-treemap__filters button i').evaluateAll(dots => dots.slice(1).map(dot => getComputedStyle(dot).backgroundColor));
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
      const filters = await page.locator('.diff-treemap__filters button').evaluateAll(buttons => buttons.map(button => ({
        top: button.getBoundingClientRect().top,
        labelVisible: button.querySelector('.diff-treemap__filter-label').getBoundingClientRect().width > 0,
        countVisible: button.querySelector('.diff-treemap__filter-count').getBoundingClientRect().width > 0,
      })));
      assert.ok(filters.every(filter => Math.abs(filter.top - filters[0].top) < 1), 'type filters must stay on one row');
      if (width >= 460) assert.ok(filters.every(filter => filter.labelVisible && filter.countVisible), 'panes with sufficient space retain labels and counts');
      if (width === 280) assert.ok(filters.every(filter => !filter.labelVisible && !filter.countVisible), 'narrow panes retain compact category controls');
      assert.ok(await page.locator('.diff-treemap__name').evaluateAll(names => names.every(name => getComputedStyle(name).whiteSpace === 'nowrap')), 'filenames must stay on one line');
      const header = await page.locator('.git-review-panel__toolbar').evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
      assert.ok(header.scrollWidth <= header.width + 1, 'header controls must fit the sidebar width');
      const selectorBounds = await page.locator('.git-diff-view-toggle').boundingBox();
      const headerBounds = await page.locator('.git-review-panel__toolbar').boundingBox();
      assert.ok(Math.abs(selectorBounds.x + selectorBounds.width / 2 - headerBounds.x - headerBounds.width / 2) < 1, 'the labeled view selector must stay centered in the pane');
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
    await page.locator('.diff-treemap__filter-target').nth(1).hover();
    await page.getByRole('tooltip').filter({ hasText: /^Code · 141$/ }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: /^Code ·/ }).click();
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
    await toggleMap();
    assert.equal(await tiles.count(), 140, 'returning to the map must preserve the file-type filter');
    await page.getByRole('button', { name: /^All / }).click();
    await page.getByText('Files without line changes', { exact: false }).click();
    await page.getByRole('button', { name: 'assets/logo.png', exact: true }).click();
    assert.match(await page.locator('.git-diff-preview-panel__files').innerText(), /No textual hunks/);
    await toggleMap();
    await page.getByRole('button', { name: 'Review options', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Staged changes', exact: true }).click();
    assert.equal(await tiles.count(), 101, 'scope filters must update the map, not only the line diff');
    // Generate from the currently visible scopes, then drill through a semantic box spanning files.
    await page.locator('.fixture').evaluate(element => { element.style.width = '460px'; });
    await page.locator('.git-diff-view-toggle .el-segmented__item').filter({hasText:/^Viz$/}).click();
    assert.equal(await page.evaluate(() => window.fixture.settings.length), 0);
    await page.locator('.fixture').screenshot({ path: path.join(output, 'viz-empty-460.png') });
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const concept = page.getByRole('button', { name: 'Open changes for Profile Sync Service', exact: true });
    await page.waitForFunction(() => document.querySelector('.diff-viz-canvas__target') || document.querySelector('.diff-viz-canvas__status button'), { timeout: 30_000 });
    assert.equal(await page.locator('.diff-viz-canvas__status button').count(), 0, (await page.locator('.diff-viz-canvas__status').allTextContents()).join(' '));
    await concept.waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByRole('heading',{name:'Profile sync persists review activity',exact:true}).waitFor();
    const explanation=await concept.getAttribute('title');
    assert.ok(explanation.includes('Profile activity is saved during synchronization.'));
    assert.ok(explanation.includes('Responses can read the synchronized activity.'));
    assert.ok(explanation.includes('Does incremental sync retain existing records?'));
    assert.ok(explanation.includes('src/rewrite.ts:2–3'));
    await page.locator('.diff-viz__legend').waitFor();
    assert.equal(await page.locator('.diff-viz__consent').count(), 0);
    await page.waitForFunction(() => {
      const target = document.querySelector('.diff-viz-canvas__target');
      return target && target.getBoundingClientRect().width > 30;
    });
    assert.equal(await page.locator('.diff-viz-canvas__target').count(), 4, 'unchanged context must not be clickable');
    assert.equal(await page.locator('.diff-viz-canvas .App-menu_top').isVisible(),false,'the read-only viewer must hide the editor menu');
    assert.equal(await page.locator('.diff-viz-canvas .layer-ui__wrapper__footer').isVisible(),false,'the viewer provides its own controls');
    const assets=await page.evaluate(async()=>{
      const scene=await window.fixture.nativeScene();
      const images=scene.elements.filter(element=>element.type==='image');
      const dimensions=await Promise.all(images.map(async element=>{const image=new Image();image.src=scene.files[element.fileId].dataURL;await image.decode();return [image.naturalWidth,image.naturalHeight];}));
      const tile=scene.elements.find(element=>element.id==='sync');
      const caption=scene.elements.find(element=>element.id==='sync_label');
      const group=scene.elements.find(element=>element.id==='activity');
      return {count:images.length,dimensions,tile,caption,group,heading:scene.elements.find(element=>element.id==='activity_title'),labels:['save_label','read_label'].map(id=>scene.elements.find(element=>element.id===id)),secondary:scene.elements.find(element=>element.id==='read'),fonts:[...document.fonts].filter(face=>['Geist','JetBrains Mono'].includes(face.family.replaceAll(String.fromCharCode(34),''))).map(face=>({family:face.family.replaceAll(String.fromCharCode(34),''),status:face.status})),connection:scene.elements.find(element=>element.id==='save'),icon:images.find(element=>element.id==='viz_icon_sync'),brand:images.find(element=>element.id==='viz_icon_store'),brandFile:scene.files[images.find(element=>element.id==='viz_icon_store').fileId]};
    });
    assert.equal(assets.caption.fontFamily,4,'node names use Geist');
    assert.equal(assets.heading.fontFamily,4,'group headings use Geist');
    assert.deepEqual(assets.labels.map(label=>label.fontFamily),[10,10],'relationships use JetBrains Mono');
    assert.equal(assets.labels[0].strokeColor,assets.connection.strokeColor,'legacy standalone labels inherit their arrow color');
    assert.equal(assets.labels[1].strokeColor,assets.secondary.strokeColor,'bound labels follow their dashed connection color');
    assert.notEqual(assets.connection.strokeColor,assets.secondary.strokeColor,'the fixture checks distinct relationship colors');
    assert.deepEqual(assets.fonts.map(font=>font.family).sort(),['Geist','JetBrains Mono']);
    assert.ok(assets.fonts.every(font=>font.status==='loaded'),'both real font files must be loaded before laying out the scene');
    assert.equal(assets.tile.width,assets.tile.height,'semantic components render as square icon tiles');
    assert.ok(assets.caption.y >= assets.tile.y+assets.tile.height+8,'captions sit beneath tiles, outside arrow attachment geometry');
    assert.equal(assets.caption.containerId,null,'native text binding must not pull captions back inside the tile');
    assert.ok(assets.connection.y+assets.connection.points[0][1] >= assets.caption.y+assets.caption.height+8,'vertical connections start beyond the caption');
    assert.ok(assets.icon.width >= assets.tile.width*0.45,'role icons carry the visual weight');
    assert.equal(assets.group.strokeStyle,'solid','subsystems use quiet solid boundaries');
    assert.notEqual(assets.group.backgroundColor,'transparent','subsystems have a theme-aware surface');
    assert.equal(assets.brand.width/assets.brand.height,2,'registered marks preserve their aspect ratio');
    assert.equal(assets.brandFile.mimeType,'image/png','SVG marks materialize into persisted raster files');
    assert.equal(assets.count,6,'role icons must be native canvas images, including unchanged context');
    assert.ok(assets.dimensions.every(([width,height])=>width>0&&height>0),'every role icon must decode from its app-owned asset');
    assert.equal(await page.evaluate(() => window.fixture.generations.length), 1);
    const generated = await page.evaluate(() => window.fixture.generations[0]);
    assert.equal(generated.id, 'fixture');
    assert.deepEqual(generated.input.target, {type:'uncommitted'});
    assert.deepEqual(generated.input.scopes, ['unstaged'], 'Viz must honor excluded staged changes');
    assert.equal('diff' in generated.input, false, 'send the scope, not the patch');
    assert.deepEqual(await page.evaluate(() => window.fixture.settings), []);
    // A real Excalidraw canvas must paint shapes and labels, not merely the click overlays.
    await page.waitForFunction(() => [...document.querySelectorAll('.diff-viz-canvas canvas')].some(canvas => {
      if (!canvas.width || !canvas.height) return false;
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 0 && pixels[i] < 160 && pixels[i + 1] < 160 && pixels[i + 2] < 160) painted++;
      return painted > 100;
    }));
    const waitForBrand = () => page.waitForFunction(() => [...document.querySelectorAll('.diff-viz-canvas canvas')].some(canvas => {
      if (!canvas.width || !canvas.height) return false;
      const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let brand=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>210&&pixels[i+1]<40&&pixels[i+2]>170&&pixels[i+3]>200)brand++;
      return brand>20;
    }));
    await waitForBrand();
    await page.locator('.fixture').screenshot({ path: path.join(output, 'viz-460.png') });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForFunction(() => document.querySelector('.diff-viz-canvas__host .excalidraw') && document.documentElement.classList.contains('dark'));
    // Recolored native assets decode asynchronously; wait for an actual line icon, not its placeholder.
    await page.waitForFunction(() => {
      const target=document.querySelector('.diff-viz-canvas__target');
      const canvas=document.querySelector('.diff-viz-canvas canvas');
      if(!target||!canvas)return false;
      const box=target.getBoundingClientRect(), bounds=canvas.getBoundingClientRect();
      const scale=canvas.width/bounds.width;
      const pixels=canvas.getContext('2d').getImageData((box.x+box.width*0.24-bounds.x)*scale,(box.y+box.height*0.24-bounds.y)*scale,box.width*0.52*scale,box.height*0.52*scale).data;
      let ink=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>180&&pixels[i+1]>180&&pixels[i+2]>180)ink++;
      const coverage=ink/(pixels.length/4);
      return coverage>0.01&&coverage<0.45;
    });
    await waitForBrand();
    await page.locator('.fixture').screenshot({ path: path.join(output, 'viz-dark-460.png') });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await concept.click();
    await page.locator('.git-diff-view-toggle .el-segmented__item.is-selected').filter({hasText:/^Files$/}).waitFor();
    assert.equal(await filesRadio.isChecked(), true);
    assert.deepEqual(await page.locator('[data-code-path]').evaluateAll(elements=>elements.map(element=>element.dataset.codePath)), ['src/module-100.ts', 'src/rewrite.ts'], 'one semantic box must open all of its changed files within the selected scope');
    assert.deepEqual(await page.locator('[data-code-path="src/rewrite.ts"] [data-viz-focus="true"]').evaluateAll(rows=>rows.map(row=>Number(row.dataset.codeLine))),[2,3],'clicking a component must focus its relevant diff lines');
    await page.locator('.git-diff-view-toggle .el-segmented__item').filter({hasText:/^Viz$/}).click();
    assert.equal(await page.evaluate(() => window.fixture.generations.length), 1, 'switching views must reuse the generated drawing');
    // Workflow settings and the consent checkbox share the automatic-generation preference.
    await page.evaluate(()=>window.fixture.openSettings(true));
    const style = page.locator('.settings-diff-viz .el-select');
    await style.click();
    await page.getByRole('option',{name:'Fast',exact:true}).click();
    await page.waitForFunction(()=>window.fixture.settings.at(-1)?.general.diffVisualizationMode==='fast');
    await page.locator('.settings-fixture').screenshot({path:path.join(output,'viz-workflow-settings.png')});
    await page.evaluate(()=>window.fixture.openSettings(false));
    await page.getByRole('button',{name:'Generate',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.fixture.generations.length),1,'changing style must not generate with automatic off');
    await page.locator('.diff-viz__consent').click();
    assert.equal(await page.evaluate(()=>window.fixture.generations.length),1,'checking Do not ask again must still wait for Generate');
    await page.getByRole('button',{name:'Generate',exact:true}).click();
    await page.locator('.diff-viz-mermaid g.node[role="button"]').first().waitFor();
    assert.equal(await page.locator('.diff-viz-mermaid g.node[role="button"]').count(),4);
    assert.equal(await page.evaluate(()=>window.fixture.generations.at(-1).input.mode),'fast');
    await page.locator('.fixture').screenshot({path:path.join(output,'viz-fast-460.png')});
    await page.getByRole('button',{name:'Open changes for Profile Sync Service',exact:true}).click();
    assert.deepEqual(await page.locator('[data-code-path]').evaluateAll(elements=>elements.map(element=>element.dataset.codePath)),['src/module-100.ts','src/rewrite.ts']);
    await page.evaluate(()=>window.fixture.openSettings(true));
    assert.equal(await page.locator('.settings-diff-viz').getByRole('switch').isChecked(),true,'Do not ask again must enable the Workflow setting');
    await page.waitForFunction(()=>window.fixture.settings.at(-1)?.general.autoGenerateDiffViz===true);
    await style.click();
    await page.getByRole('option',{name:'Polished',exact:true}).click();
    await page.waitForFunction(()=>window.fixture.settings.at(-1)?.general.diffVisualizationMode==='polished');
    await page.evaluate(()=>window.fixture.openSettings(false));
    await page.locator('.git-diff-view-toggle .el-segmented__item').filter({hasText:/^Viz$/}).click();
    await page.locator('.diff-viz-canvas__target').first().waitFor();
    assert.equal(await page.evaluate(()=>window.fixture.generations.length),3,'automatic mode generates on opening Viz');
    await page.evaluate(()=>window.fixture.openSettings(true));
    await page.locator('.settings-diff-viz .el-switch').click();
    await page.waitForFunction(()=>window.fixture.settings.at(-1)?.general.autoGenerateDiffViz===false);
    await page.evaluate(()=>window.fixture.openSettings(false));
    await page.locator('.fixture').evaluate(element=>{element.style.width='280px';});
    await toggleMap();
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
    httpServer.closeAllConnections();
    await new Promise(resolve => httpServer.close(resolve));
    await server.close();
  }
});


test('bundles exact diagram fonts and their licenses for production rendering', async t => {
  const root=fileURLToPath(new URL('../../..',import.meta.url));
  const fixture=await mkdtemp(path.join(root,'node_modules/.cache/diagram-font-build-'));
  try {
    await writeFile(path.join(fixture,'index.html'),'<script type="module">import {loadCanvasFonts} from "/client/vue/src/components/diagram-fonts.ts";window.loadDiagramFonts=loadCanvasFonts;</script>');
    const {diagramFontAssets}=await import('../vite.diagram-fonts.ts');
    await build({configFile:false,root,logLevel:'error',plugins:[diagramFontAssets()],build:{outDir:path.join(fixture,'dist'),rollupOptions:{input:path.join(fixture,'index.html'),external:['@excalidraw/excalidraw']}}});
    const assets=path.join(fixture,'dist/assets');
    const names=await readdir(assets);
    for(const name of ['Geist','JetBrainsMono']){
      const emitted=names.find(file=>file.startsWith(name+'-')&&file.endsWith('.woff2'));
      assert.ok(emitted, name+' must be emitted as a local font resource');
      assert.deepEqual(await readFile(path.join(assets,emitted)),await readFile(path.join(root,'client/vue/src/assets/diagram-fonts',name+'.woff2')));
      assert.deepEqual(await readFile(path.join(fixture,'dist/diagram-fonts/OFL-'+name+'.txt')),await readFile(path.join(root,'client/vue/src/assets/diagram-fonts/OFL-'+name+'.txt')));
    }
    t.diagnostic('Production font bytes and OFL notices match the bundled sources.');
  }finally{await rm(fixture,{recursive:true,force:true});}
});
