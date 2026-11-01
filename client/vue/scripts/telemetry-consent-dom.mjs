// Real Vue/Element Plus DOM evidence with a synthetic desktop API. Backend
// persistence/delivery delegation is exercised by server-usage.spec.ts.
import { createServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { chromium } from "playwright";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import product from "../../../core/src/product.json" with { type: "json" };

const root = path.resolve(import.meta.dirname, "../../..");
const output =
  process.env.TELEMETRY_DOM_OUTPUT ||
  (await mkdtemp(path.join(os.tmpdir(), "telemetry-consent-dom-")));
await mkdir(output, { recursive: true });
const entry = `
import {createApp,h,provide,ref} from 'vue';
import {createCodexConversationPaneController} from '@codex-app-sdk/vue';
import '@codex-app-sdk/vue/styles.css';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import '/src/styles/variables.css';
import '/src/styles/base.css';
import {i18n} from '/src/i18n/index.ts';
import {configureAppClient} from '/src/platform-api.ts';
import Conversation from '/src/components/ConversationPane.vue';
import General from '/src/components/SettingsGeneralPanel.vue';
import Header from '/src/shared/WorkspaceHeader.vue';
import {defaultGeneralSettings} from '@workspace/core/settings';
import {telemetryNoticeReadyKey} from '/src/components/use-telemetry-consent.ts';
let state=JSON.parse(sessionStorage.getItem('consent') || 'null') || {};
const ready=ref(false), active=ref(true);
let visible=true, focused=true;
Object.defineProperty(document,'visibilityState',{get:()=>visible?'visible':'hidden'});
document.hasFocus=()=>focused;
window.fixture={actions:[],failNext:false,ready:value=>ready.value=value,active:value=>active.value=value,
  foreground:(isVisible,isFocused)=>{visible=isVisible;focused=isFocused;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event(isFocused?'focus':'blur'))}};
configureAppClient({platform:'desktop',api:{
  getTelemetryConsent:async()=>({...state}),
  onEvent:()=>()=>{},
  changeTelemetryConsent:async action=>{window.fixture.actions.push(action);if(window.fixture.failNext){window.fixture.failNext=false;throw Error('Save failed')}state={enabled:action==='enable'};sessionStorage.setItem('consent',JSON.stringify(state));return {...state}},
}});
const settings=ref(false);
const controller=createCodexConversationPaneController({state:()=>({identity:{conversationKey:'consent-fixture',messages:[]}})});
createApp({setup:()=>{
  provide(telemetryNoticeReadyKey,ready);
  return ()=>h('main',{style:'padding:24px;max-width:1200px;margin:auto'},[
    h('div',{style:'height:600px;display:flex;flex-direction:column'},[h(Header,()=>h('span','Conversation')),h('div',{class:'workspace-body',style:'display:flex'},[h(Conversation,{controller,agent:null,keyboardActive:active.value})])]),
    h('button',{onClick:()=>settings.value=!settings.value},'Settings'),
    settings.value?h(General,{settings:defaultGeneralSettings,getSystemPermissions:async()=>({platform:'linux',accessibility:{required:false,trusted:true},screenRecording:{required:false,trusted:true}})}):null,
  ]);
}}).use(i18n).use(ElementPlus).mount('#app');
`;
const server = await createServer({
  configFile: false,
  root: path.join(root, "client/vue"),
  plugins: [
    vue(),
    {
      name: "telemetry-consent-dom-fixture",
      resolveId(id) {
        if (id === "virtual:consent-fixture") return "\0consent-fixture";
      },
      load(id) {
        if (id === "\0consent-fixture") return entry;
      },
      configureServer(server) {
        server.middlewares.use("/consent-dom", async (_req, res) => {
          res.setHeader("Content-Type", "text/html");
          res.end(
            await server.transformIndexHtml(
              "/consent-dom",
              '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="/@id/virtual:consent-fixture"></script></body></html>',
            ),
          );
        });
      },
    },
  ],
  resolve: { alias: { "@workspace/core": path.join(root, "core/src") } },
  server: { host: "127.0.0.1", port: 0 },
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1000, height: 900 },
  });
  const page = await context.newPage();
  await page.clock.install({time:new Date('2026-11-01T12:00:00Z')});
  await page.clock.pauseAt(new Date('2026-11-01T12:00:01Z'));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const outbound = [];
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname !== "127.0.0.1") {
      outbound.push(route.request().resourceType());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${address.port}/consent-dom`);
  await page.waitForFunction(() => Boolean(window.fixture));
  await page.clock.runFor(90_000);
  assert.deepEqual(await page.evaluate(() => window.fixture.actions), []);
  const notice = page.locator('.telemetry-notice');
  assert.equal(await notice.count(),0);
  await page.evaluate(() => window.fixture.ready(true));
  await notice.getByRole('button', {name:'Close',exact:true}).waitFor();
  const buttonColors = await notice.evaluate(element => {
    const buttons = element.querySelectorAll('button');
    const probe = document.createElement('span');
    element.append(probe);
    const resolve = token => { probe.style.color = `var(${token})`; return getComputedStyle(probe).color; };
    const colors = {
      tertiary: getComputedStyle(buttons[0]).color,
      primary: getComputedStyle(buttons[1]).backgroundColor,
      border: getComputedStyle(buttons[1]).borderColor,
      expectedTertiary: resolve('--color-text-muted'),
      expectedPrimary: resolve('--color-primary'),
      expectedBorder: resolve('--color-primary'),
    };
    probe.remove();
    return colors;
  });
  assert.equal(buttonColors.tertiary, buttonColors.expectedTertiary);
  assert.equal(buttonColors.primary, buttonColors.expectedPrimary);
  assert.equal(buttonColors.border, buttonColors.expectedBorder);
  assert.deepEqual(await page.evaluate(() => window.fixture.actions), []);
  assert.equal(await page.getByRole('dialog').count(), 0);
  const policyUrl = `${product.websiteUrl}/privacy/`;
  const geometry = [];
  for (const width of [1600, 1000, 390]) {
    await page.setViewportSize({width,height:900});
    const bounds = await notice.boundingBox();
    const composer = await page.locator('.chat-composer').boundingBox();
    assert.ok(bounds && composer);
    assert.ok(Math.abs(bounds.x - composer.x) <= 1, JSON.stringify({bounds,composer}));
    assert.ok(Math.abs(bounds.width - composer.width) <= 1, JSON.stringify({bounds,composer}));
    const pane = await page.locator('.conversation-pane').boundingBox();
    const header = await page.locator('.workspace-header').boundingBox();
    assert.ok(pane && header);
    assert.ok(Math.abs(bounds.y - (header.y + header.height)) <= 1, JSON.stringify({bounds,header}));
    assert.ok(bounds.x >= pane.x + 16 && bounds.x + bounds.width <= pane.x + pane.width - 16, JSON.stringify({bounds,pane}));
    assert.ok(bounds.y + bounds.height < composer.y, JSON.stringify({bounds,composer}));
    const panelStyle = await notice.evaluate(element => {
      const style = getComputedStyle(element);
      return {topBorder:parseFloat(style.borderTopWidth),bottomBorder:parseFloat(style.borderBottomWidth),topRadius:parseFloat(style.borderTopLeftRadius),bottomRadius:parseFloat(style.borderBottomLeftRadius)};
    });
    assert.ok(panelStyle.topBorder > 0 && panelStyle.bottomBorder > 0 && panelStyle.bottomRadius > 0);
    assert.equal(panelStyle.topRadius,0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (const button of await notice.getByRole('button').all()) {
      const bounds = await button.boundingBox();
      assert.ok(bounds && bounds.height <= 24, JSON.stringify(bounds));
    }
    geometry.push({width,notice:bounds,composer});
    await page.screenshot({path:path.join(output,`notice-${width}.png`),fullPage:true,animations:'disabled'});
  }
  const unchangedCopy = `Help improve ${product.name} with anonymous usage and performance data. No conversation content is shared.`;
  assert.equal(await notice.locator('p').textContent(), unchangedCopy);
  await page.clock.runFor(30_000);
  await page.evaluate(() => window.fixture.active(false));
  await notice.waitFor({state:'hidden'});
  await page.clock.runFor(90_000);
  assert.deepEqual(await page.evaluate(() => window.fixture.actions), []);
  await page.evaluate(() => window.fixture.active(true));
  await notice.waitFor();
  await page.evaluate(() => window.fixture.foreground(false,false));
  await page.clock.runFor(90_000);
  await page.evaluate(() => window.fixture.foreground(true,false));
  await page.clock.runFor(90_000);
  assert.deepEqual(await page.evaluate(() => window.fixture.actions), []);
  await page.evaluate(() => window.fixture.foreground(true,true));
  await page.clock.runFor(29_999);
  assert.deepEqual(await page.evaluate(() => window.fixture.actions), []);
  await page.clock.runFor(1);
  await page.waitForFunction(() => window.fixture.actions.length === 1);
  assert.deepEqual(await page.evaluate(() => window.fixture.actions), ['enable']);
  assert.equal(await notice.isVisible(),true);
  assert.equal(await notice.locator('p').textContent(), unchangedCopy);
  await page.clock.runFor(120_000);
  assert.deepEqual(await page.evaluate(() => window.fixture.actions), ['enable']);
  await notice.screenshot({path:path.join(output,'notice-after-timeout.png')});
  await page.reload();
  await page.waitForFunction(() => Boolean(window.fixture));
  await page.evaluate(() => window.fixture.ready(true));
  await page.clock.runFor(90_000);
  assert.equal(await notice.count(),0);
  assert.deepEqual(await page.evaluate(() => window.fixture.actions), []);
  await page.evaluate(() => sessionStorage.removeItem('consent'));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.fixture));
  await page.evaluate(() => window.fixture.ready(true));
  await notice.waitFor();
  await page.evaluate(() => {window.fixture.failNext=true});
  await page.clock.runFor(60_000);
  await notice.getByRole('alert').waitFor();
  await page.clock.runFor(90_000);
  assert.deepEqual(await page.evaluate(() => window.fixture.actions), ['enable']);
  await notice.getByRole('button', {name:'Close',exact:true}).click();
  await notice.waitFor({state:'hidden'});
  assert.deepEqual(await page.evaluate(() => window.fixture.actions), ['enable','enable']);
  await page.reload();
  await page.locator('.chat-composer').waitFor();
  await page.evaluate(() => window.fixture.ready(true));
  assert.equal(await notice.count(),0);
  assert.deepEqual(await page.evaluate(() => window.fixture.actions), []);
  // A fresh pending profile takes the independent opt-out path.
  await page.evaluate(() => sessionStorage.removeItem('consent'));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.fixture));
  await page.evaluate(() => window.fixture.ready(true));
  await page.clock.runFor(59_999);
  await notice.getByRole('button', {name:'Cancel',exact:true}).click();
  await notice.waitFor({state:'hidden'});
  await page.clock.runFor(90_000);
  assert.deepEqual(await page.evaluate(() => window.fixture.actions), ['disable']);
  await page.getByRole('button', {name:'Settings',exact:true}).click();
  const advanced = page.locator('section[aria-labelledby="settings-general-advanced-title"]');
  const sharing = advanced.getByRole('switch', {name:'Share anonymous telemetry data',exact:true});
  const sharingControl = sharing.locator('..');
  await sharingControl.waitFor();
  assert.equal(await sharing.isChecked(), false);
  await sharingControl.click();
  await page.waitForFunction(() => window.fixture.actions.at(-1) === 'enable');
  assert.equal(await sharing.isChecked(), true);
  await page.getByRole('button', {name:'Settings',exact:true}).click();
  await page.getByRole('button', {name:'Settings',exact:true}).click();
  assert.equal(await sharing.isChecked(), true);
  await page.setViewportSize({width:1000,height:1100});
  await advanced.screenshot({path:path.join(output,'general-advanced.png')});
  await sharingControl.click();
  await page.waitForFunction(() => window.fixture.actions.at(-1) === 'disable');
  assert.equal(await sharing.isChecked(), false);
  assert.ok(
    outbound.every((type) => type === "stylesheet"),
    JSON.stringify(outbound),
  );
  assert.deepEqual(errors, []);
  const evidence = {
    workflow: "real Vue and Element Plus; synthetic desktop API",
    actions: ["enable", "enable", "disable", "enable", "disable"],
    generalAdvancedToggle: true,
    foregroundTimeoutMs: 60_000,
    timeoutKeepsNoticeAndCopy: true,
    hiddenAndUnfocusedTimeExcluded: true,
    paneSwitchKeepsElapsedTime: true,
    timeoutPersistsAcrossReload: true,
    geometry,
    closeEnablesAndPersists: true,
    failedTimeoutRetryWithClose: true,
    horizontalOverflow: false,
    telemetryOutboundRequests: 0,
    blockedExternalStylesheets: outbound.length,
    pageErrors: 0,
    policyUrl,
  };
  await writeFile(
    path.join(output, "evidence.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify({ output, ...evidence }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
