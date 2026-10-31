import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';

test('Mission conversations preserve selection and switch beneath a covering overlay', async () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const artifacts = process.env.MISSION_CONVERSATION_ARTIFACTS ?? path.join(root, '.app-dev/mission-conversations');
  const require = createRequire(path.join(root, 'vue/package.json'));
  const server = await createServer({ configFile: false, root, cacheDir: path.join(artifacts, 'vite-cache'), server: { host: '127.0.0.1', port: 0, watch: null },
   resolve: { alias: { '@workspace/core': path.join(root, 'core/src'), '@codex-app-sdk/vue/styles.css': require.resolve('@codex-app-sdk/vue/styles.css') }, dedupe: ['vue'] },
   plugins: [vue(), { name: 'mission-tabs-check', configureServer(server) {
   server.middlewares.use('/tabs-check', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><style>html,body,#app{height:100%;margin:0}#app{display:flex;flex-direction:column}</style></head><body><div id="app"></div><script type="module" src="/tabs-fixture.js"></script></body></html>'); });
   }, resolveId(id) { if (id === '/tabs-fixture.js') return '\0tabs-fixture'; }, load(id) { if (id !== '\0tabs-fixture') return; return `
   import { createApp, h } from 'vue';
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
   snapshot.agents[0].folder = '/repos/korus'; snapshot.agents[1].folder = '/repos/website';
   const third = {...snapshot.agents[0], id: 'fixture-worker', name: 'Builder'};
   snapshot.agents.push(third); snapshot.teams[0].agentIds.push(third.id);
   const mission = createMission(snapshot, { outcome: 'Ship the workspace improvements', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0].id, orchestratorMemberId: snapshot.agents[0].id });
   applyMissionDebugFixture(snapshot, mission.id, new URLSearchParams(location.search).has('tickets') ? 'tickets' : 'implementation');
   const leadWorker = {...snapshot.agents[0], id:'fixture-korus-worker', name:'Korus worker'};
   snapshot.agents.push(leadWorker);
   for (const run of mission.execution.runs) {
    if (run.stage === 'implementation' && run.workerId === snapshot.agents[0].id) run.workerId = leadWorker.id;
    if (run.stage !== 'implementation') continue;
    const agent = snapshot.agents.find(agent => agent.id === run.workerId);
    const repositoryPath = run.repositoryPath ?? mission.artifacts.tickets[run.ticketIndex]?.repositoryPath;
    if (agent && repositoryPath) agent.workspace = {kind:'git', primaryWorktreeRoot:repositoryPath, repositoryRoot:repositoryPath};
   }
   const fixture = JSON.parse(sessionStorage.getItem('fixture'+location.search) ?? 'null') ?? {snapshot, mission};
   sessionStorage.setItem('fixture'+location.search, JSON.stringify(fixture));
   createApp({render: () => h(MissionWorkspace, {mission: fixture.mission, agents: fixture.snapshot.agents, repositoryIcons: {'/repos/korus':'📦', '/repos/website':'🌐'}}, {conversation: ({agentId}) => h('div', {class: 'conversation-pane', style: 'padding:16px'}, 'Conversation: '+agentId)})}).use(ElementPlus).use(i18n).mount('#app');
   `; } }] });
  let browser;
  try {
   await mkdir(artifacts, { recursive: true });
   await server.listen(); browser = await chromium.launch();
   const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
   const errors = []; page.on('pageerror', error => errors.push(String(error)));
   await page.goto(`${server.resolvedUrls.local[0]}tabs-check`);
   const tabs = page.locator('.mission-conversation-rail [role="tab"]');
   await tabs.first().waitFor();
   assert.equal(await tabs.count(), 4);
   assert.equal(await tabs.first().locator('svg').count(), 1);
   assert.equal(await tabs.nth(1).locator('.agent-avatar').count(), 1);
   const chat = page.locator('.mission-conversation-rail .conversation-pane');
   const overlay = page.locator('.mission-conversation-rail__switch-overlay');
   const agentOf = async index => (await tabs.nth(index).getAttribute('id')).slice(4);
   const waitForAgent = async id => page.waitForFunction(id => document.querySelector('.mission-conversation-rail .conversation-pane')?.textContent === 'Conversation: '+id, id);
   const finishSwitch = async () => {
    await overlay.evaluate(el => el.getAnimations()[0]?.finish());
    await page.waitForFunction(() => {
     const animation = document.querySelector('.mission-conversation-rail__switch-overlay')?.getAnimations()[0];
     return animation?.playbackRate === -1;
    });
    await overlay.evaluate(el => el.getAnimations()[0]?.finish());
    await page.waitForFunction(() => document.querySelector('.mission-conversation-rail__switch-overlay')?.getAnimations().length === 0);
   };
   // Read the actual DOM at the switch boundary, while the overlay must be opaque.
   await page.evaluate(() => {
    window.switchReceipts = [];
    new MutationObserver(() => window.switchReceipts.push({
     text: document.querySelector('.mission-conversation-rail .conversation-pane').textContent,
     opacity: Number(getComputedStyle(document.querySelector('.mission-conversation-rail__switch-overlay')).opacity),
    })).observe(document.querySelector('.mission-conversation-rail .conversation-pane'), {subtree:true, childList:true, characterData:true});
   });
   const originalChat = await chat.innerText();
   await tabs.nth(1).click();
   await overlay.evaluate(el => { const animation = el.getAnimations()[0]; animation.pause(); animation.currentTime = 90; });
   assert.equal(await chat.innerText(), originalChat, 'old conversation remains during fade-in');
   await finishSwitch();
   await waitForAgent(await agentOf(1));
   const receipt = await page.evaluate(() => window.switchReceipts.at(-1));
   assert.equal(receipt.opacity, 1, 'conversation switches only beneath an opaque overlay');
   // Interrupt a pending switch: a cancelled selection must never replace the last one.
   await tabs.first().click();
   await overlay.evaluate(el => el.getAnimations()[0].pause());
   await tabs.nth(2).click({force:true});
   await finishSwitch();
   await waitForAgent(await agentOf(2));
   await tabs.nth(2).press('ArrowRight');
   await finishSwitch();
   await waitForAgent(await agentOf(3));
   const selected = await chat.innerText();
   await page.reload(); await tabs.first().waitFor();
   assert.equal(await tabs.nth(3).getAttribute('aria-selected'), 'true');
   assert.equal(await chat.innerText(), selected, 'selection survives reload');
   await page.emulateMedia({ reducedMotion: 'reduce' });
   await tabs.first().click();
   await waitForAgent(await agentOf(0));
   assert.equal(await overlay.evaluate(el => el.getAnimations().length), 0, 'reduced motion switches directly');
   const ticket = page.locator('.mission-implementation__ticket:not(:disabled)').first();
   await ticket.click();
   assert.equal(await ticket.getAttribute('aria-pressed'), 'true');
   assert.equal(await page.locator('.mission-implementation__ticket[aria-pressed="true"]').count(), 1);
   await page.locator('.mission-workspace__workbench-scroll').evaluate(el => el.scrollTop = 0);
   const measurements = [];
   for (const width of [1440, 1100]) {
    await page.setViewportSize({width, height:900});
    for (const dark of [false, true]) {
     await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);

     const navigation = await page.locator('.mission-conversation-rail__navigation').boundingBox();
     const stageHeader = await page.locator('.mission-workspace__stage-header').boundingBox();
     const tabBar = await page.locator('.mission-conversation-rail__switcher').boundingBox();
     assert.ok(Math.abs(tabBar.height - stageHeader.height) <= 1, 'tab bar must fill the header height');
     assert.equal(await page.locator('.mission-conversation-rail__navigation > header').count(), 0, 'no subtitle row beneath the tabs');
     assert.ok(Math.abs(navigation.height - stageHeader.height) <= 1, 'tabs must share the neighboring header height');
     assert.ok(Math.abs(navigation.y + navigation.height - stageHeader.y - stageHeader.height) <= 1, 'conversation and workbench content must start at the same height');
     await page.screenshot({animations: 'disabled', path:`${artifacts}/${width}-${dark?'dark':'light'}.png`});
     const activeStyle = await page.locator('.mission-conversation-rail .el-tabs__item.is-active').evaluate(el => ({background:getComputedStyle(el).backgroundColor, bottom:getComputedStyle(el).borderBottomColor, border:getComputedStyle(el.closest('.mission-conversation-rail')).getPropertyValue('--color-border').trim(), shadow:getComputedStyle(el).boxShadow, normal:getComputedStyle(el.closest('.mission-conversation-rail')).backgroundColor}));
     assert.equal(activeStyle.background, activeStyle.normal, 'active tab must blend into the conversation surface');
     assert.notEqual(activeStyle.bottom, activeStyle.background, 'bottom divider continues under the active tab');
     assert.equal(activeStyle.shadow, 'none', 'active tab must not have a focus box');
     measurements.push(await page.locator('.mission-conversation-rail__switcher').evaluate(el => ({width:innerWidth, dark:document.documentElement.classList.contains('dark'), bounds:el.getBoundingClientRect().toJSON(), tabs:[...el.querySelectorAll('[role="tab"]')].map(tab => ({text:tab.textContent, bounds:tab.getBoundingClientRect().toJSON()}))})));
    }
   }
   await page.goto(`${server.resolvedUrls.local[0]}tabs-check?tickets`);
   await page.evaluate(() => document.documentElement.classList.add('dark'));
   await page.getByRole('button', {name:'Implement', exact:true}).waitFor();
   const headerHeights = await page.evaluate(() => ['.mission-workspace__stage-header', '.mission-stage-rail__heading', '.mission-conversation-rail__navigation'].map(selector => document.querySelector(selector).getBoundingClientRect().height));
   assert.ok(Math.max(...headerHeights) - Math.min(...headerHeights) <= 1, 'Implement button must not enlarge its header');
   await page.screenshot({path:path.join(artifacts, 'tickets-dark.png'), animations:'disabled'});
   assert.deepEqual(errors, []);
   await writeFile(path.join(artifacts, 'measurements.json'), JSON.stringify(measurements,null,2));
   console.log('PASS: real Mission tabs click, keyboard navigation, remembered selection, ticket-to-agent selection, reduced motion, 1440/1100 light/dark screenshots');
  } finally { await browser?.close(); await server.close(); }

});
