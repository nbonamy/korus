import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';

test('Mission workspace pairs horizontal workflow steps with persistent conversation tabs', async () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const artifacts = process.env.MISSION_CONVERSATION_ARTIFACTS ?? path.join(root, '.app-dev/mission-conversations');
  const require = createRequire(path.join(root, 'vue/package.json'));
  const server = await createServer({ configFile: false, root, cacheDir: path.join(artifacts, 'vite-cache'), server: { host: '127.0.0.1', port: 0, watch: null },
   resolve: { alias: { '@workspace/core': path.join(root, 'core/src'), '@codex-app-sdk/vue/styles.css': require.resolve('@codex-app-sdk/vue/styles.css') }, dedupe: ['vue'] },
   plugins: [vue(), { name: 'mission-tabs-check', configureServer(server) {
   server.middlewares.use('/tabs-check', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><style>html,body,#app{height:100%;margin:0}#app{display:flex;flex-direction:column}</style></head><body><div id="app"></div><script type="module" src="/tabs-fixture.js"></script></body></html>'); });
   }, resolveId(id) { if (id === '/tabs-fixture.js') return '\0tabs-fixture'; }, load(id) { if (id !== '\0tabs-fixture') return; return `
   import { createApp, h, reactive, ref } from 'vue';
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
   const fixture = reactive(JSON.parse(sessionStorage.getItem('fixture'+location.search) ?? 'null') ?? {snapshot, mission});
   sessionStorage.setItem('fixture'+location.search, JSON.stringify(fixture));
   const conversationOnly = ref(false);
   const unreadAgentIds = ref([]);
   window.setMissionAttention = (states, unread) => {
    for (const agent of fixture.snapshot.agents) agent.status = {type: states[agent.id] ?? 'idle'};
    unreadAgentIds.value = unread;
   };
   createApp({render: () => h(MissionWorkspace, {mission: fixture.mission, agents: fixture.snapshot.agents, unreadAgentIds: unreadAgentIds.value, repositoryIcons: {'/repos/korus':'📦', '/repos/website':'🌐'}, workspaceToggleAvailable: true, conversationOnly: conversationOnly.value, onToggleWorkspace: () => { conversationOnly.value = !conversationOnly.value; }}, {conversation: ({agentId}) => h('div', {class: 'conversation-pane', style: 'padding:16px'}, 'Conversation: '+agentId)})}).use(ElementPlus).use(i18n).mount('#app');
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
   const workflow = page.getByLabel('Workflow progress', {exact:true});
   const workbench = page.locator('.mission-workspace__workbench');
   const initialWorkflow = await workflow.boundingBox();
   const initialWorkbench = await workbench.boundingBox();
   assert.ok(Math.abs(initialWorkflow.x - initialWorkbench.x) <= 1
    && Math.abs(initialWorkflow.width - initialWorkbench.width) <= 1,
   'workflow steps must fill the workspace header instead of a separate column');
   assert.equal(await tabs.count(), 4);
   assert.equal(await tabs.first().locator('svg').count(), 1);
   assert.equal(await tabs.nth(1).locator('.agent-avatar').count(), 1);
   const tabAgentIds = await tabs.evaluateAll(tabs => tabs.map(tab => tab.id.slice(4)));
   await page.evaluate(ids => window.setMissionAttention({[ids[1]]:'awaitingInput', [ids[2]]:'working'}, ids), tabAgentIds);
   const dotStates = () => tabs.evaluateAll(tabs => tabs.map(tab => tab.querySelector('[data-attention]')?.dataset.attention ?? null));
   await page.waitForFunction(() => document.querySelectorAll('.mission-conversation-rail [data-attention="working"]').length === 1);
   assert.deepEqual(await dotStates(), ['unread', 'needsInput', 'working', null]);
   for (const dark of [false, true]) {
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
    const colors = await tabs.evaluateAll(tabs => tabs.slice(0,3).map((tab,index) => {
     const dot = tab.querySelector('[data-attention]');
     const token = document.createElement('i');
     token.style.background = 'var('+['--color-error','--color-primary','--color-warning'][index]+')';
     document.body.append(token);
     const expected = getComputedStyle(token).backgroundColor;
     token.remove();
     return {actual:getComputedStyle(dot).backgroundColor, expected};
    }));
    assert.ok(colors.every(color => color.actual === color.expected), 'lead unread/input/working dots must use red/blue/orange theme tokens');
    await page.screenshot({path:path.join(artifacts, 'agent-dots-'+(dark?'dark':'light')+'.png'), animations:'disabled'});
   }
   await page.evaluate(() => document.documentElement.classList.remove('dark'));
   await page.evaluate(ids => window.setMissionAttention({[ids[0]]:'awaitingInput', [ids[1]]:'working'}, ids), tabAgentIds);
   assert.deepEqual(await dotStates(), ['needsInput', 'working', null, null]);
   await page.evaluate(ids => window.setMissionAttention({[ids[0]]:'working'}, ids), tabAgentIds);
   assert.deepEqual(await dotStates(), ['working', null, null, null]);
   await page.evaluate(() => window.setMissionAttention({}, []));
   assert.deepEqual(await dotStates(), [null, null, null, null]);

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
   const stages = workflow.getByRole('button');
   assert.equal(await stages.count(), 5);
   assert.equal(await stages.nth(3).isDisabled(), true, 'future stages remain unavailable');
   assert.equal(await stages.nth(4).isDisabled(), true);
   const activeConversation = await chat.innerText();
   await stages.first().focus();
   await stages.first().press('Enter');
   await page.getByLabel('Accepted artifact', {exact:true}).waitFor();
   assert.match(await stages.nth(2).getAttribute('aria-current'), /step/, 'viewing an artifact must not advance the workflow');
   assert.equal(await stages.first().getAttribute('aria-pressed'), 'true');
   assert.equal(await chat.innerText(), activeConversation, 'stage browsing keeps the selected conversation');
   await stages.nth(2).click();
   await page.waitForFunction(() => [...document.querySelectorAll('.mission-implementation__lane ol > li')]
    .every(card => Number(getComputedStyle(card).opacity) === 1));
   const measurements = [];
   for (const width of [1440, 1100]) {
    await page.setViewportSize({width, height:900});
    for (const dark of [false, true]) {
     await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);

     const navigation = await page.locator('.mission-conversation-rail__navigation').boundingBox();
     const stageHeader = await workflow.boundingBox();
     const tabBar = await page.locator('.mission-conversation-rail__switcher').boundingBox();
     const body = await page.locator('.mission-workspace__body').boundingBox();
     const workspace = await workbench.boundingBox();
     const chats = await page.locator('.mission-conversation-rail').boundingBox();
     assert.ok(Math.abs(workspace.x - body.x) <= 1 && Math.abs(workspace.x + workspace.width - chats.x) <= 1
      && Math.abs(chats.x + chats.width - body.x - body.width) <= 1, 'workspace and chats must occupy the two columns');
     const stepBounds = await stages.evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().toJSON()));
     assert.ok(stepBounds.every(bounds => Math.abs(bounds.y - stepBounds[0].y) <= 1), 'all workflow steps must stay on one row');
     assert.ok(stepBounds.every(bounds => bounds.x >= workspace.x && bounds.x + bounds.width <= workspace.x + workspace.width), 'all five steps must fit in the desktop workspace header');
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
   await page.setViewportSize({width:1440, height:900});
   const resizer = page.getByRole('separator', {name:'Resize mission chat'});
   const chatWidth = async () => (await page.locator('.mission-conversation-rail').boundingBox()).width;
   const originalWidth = await chatWidth();
   const handle = await resizer.boundingBox();
   await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
   await page.mouse.down();
   await page.mouse.move(handle.x + handle.width / 2 - 100, handle.y + handle.height / 2, {steps:5});
   await page.mouse.up();
   assert.ok(Math.abs(await chatWidth() - originalWidth - 100) <= 1, 'dragging the divider must resize the chat');
   await resizer.press('ArrowRight');
   const savedWidth = await chatWidth();
   assert.ok(Math.abs(savedWidth - originalWidth - 84) <= 1, 'keyboard resizing must adjust the chat width');
   await page.reload(); await tabs.first().waitFor();
   assert.ok(Math.abs(await chatWidth() - savedWidth) <= 1, 'the resized width must survive reload');
   await resizer.press('Home');
   assert.ok(Math.abs(await chatWidth() - 300) <= 1, 'the chat must retain its minimum usable width');
   await resizer.dblclick();
   assert.ok(Math.abs(await chatWidth() - originalWidth) <= 1, 'double-clicking resets the split');
   await page.goto(`${server.resolvedUrls.local[0]}tabs-check?tickets`);
   await page.evaluate(() => document.documentElement.classList.add('dark'));
   await page.getByRole('button', {name:'Implement', exact:true}).waitFor();
   const headerHeights = await page.evaluate(() => ['.mission-stage-rail', '.mission-conversation-rail__navigation'].map(selector => document.querySelector(selector).getBoundingClientRect().height));
   assert.ok(Math.max(...headerHeights) - Math.min(...headerHeights) <= 1, 'workflow and chat headers stay aligned while ticket approval is available');
   await page.screenshot({path:path.join(artifacts, 'tickets-dark.png'), animations:'disabled'});
   await page.setViewportSize({width:900, height:900});
   assert.equal(await page.locator('.mission-conversation-rail').isVisible(), true, 'the two-pane layout keeps chats available at intermediate widths');
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'horizontal workflow scrolling must not widen the page');
   await page.setViewportSize({width:640, height:900});
   assert.equal(await page.locator('.mission-conversation-rail').isVisible(), false);
   await page.getByRole('button', {name:'Toggle right workspace', exact:true}).click();
   assert.equal(await workbench.isVisible(), false);
   assert.equal(await page.locator('.mission-conversation-rail').isVisible(), true, 'compact conversation-only mode remains reachable');
   await page.screenshot({path:path.join(artifacts, 'compact-conversation.png'), animations:'disabled'});
   await page.getByRole('button', {name:'Toggle right workspace', exact:true}).click();
   assert.equal(await workbench.isVisible(), true);
   assert.equal(await page.locator('.mission-conversation-rail').isVisible(), false);
   assert.deepEqual(errors, []);
   await writeFile(path.join(artifacts, 'measurements.json'), JSON.stringify(measurements,null,2));
   console.log('PASS: real Mission tabs click, keyboard navigation, remembered selection, ticket-to-agent selection, reduced motion, 1440/1100 light/dark screenshots');
  } finally { await browser?.close(); await server.close(); }

});
