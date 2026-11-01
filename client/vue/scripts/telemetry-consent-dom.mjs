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
import {createApp,h,ref} from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import '/src/styles/variables.css';
import '/src/styles/base.css';
import {i18n} from '/src/i18n/index.ts';
import {configureAppClient} from '/src/platform-api.ts';
import Notice from '/src/components/TelemetryConsentNotice.vue';
import Panel from '/src/components/TelemetryConsentPanel.vue';
let state={enabled:false,eligibleFrom:null,noticePending:true};
const body='{"installId":"d8b65ff5-179c-49b9-ac3a-f60a54a0f43f","day":"2026-10-15","appVersion":"0.44.0","os":"unknown","usage":[]}';
window.fixture={actions:[],copies:[],body};
Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.fixture.copies.push(text)}});
configureAppClient({platform:'desktop',api:{
  getTelemetryConsent:async()=>({...state}),
  changeTelemetryConsent:async action=>{window.fixture.actions.push(action);state={enabled:action==='enable',eligibleFrom:action==='enable'?Date.UTC(2026,9,16):null,noticePending:false};return {...state}},
  previewTelemetryDay:async()=>({kind:'hypothetical',body}),
}});
const settings=ref(false);
createApp({setup:()=>()=>h('main',{style:'padding:24px;max-width:760px;margin:auto'},[
  h(Notice,{ready:true}),h('button',{onClick:()=>settings.value=!settings.value},'Settings'),
  settings.value?h(Panel):null,
])}).use(i18n).use(ElementPlus).mount('#app');
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
  const notice = page.getByRole("dialog");
  await notice
    .getByRole("button", { name: "Share anonymous usage", exact: true })
    .waitFor();
  assert.deepEqual(await page.evaluate(() => window.fixture.actions), []);
  const policyUrl = `${product.websiteUrl}/privacy/`;
  assert.equal(
    await notice
      .getByRole("link", { name: "Privacy policy", exact: true })
      .getAttribute("href"),
    policyUrl,
  );
  await page.screenshot({
    path: path.join(output, "notice.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await notice.waitFor({ state: "hidden" });
  assert.deepEqual(await page.evaluate(() => window.fixture.actions), [
    "dismiss",
  ]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const panel = page.getByRole("region", { name: "Anonymous daily sharing" });
  assert.equal(
    await panel
      .getByRole("link", { name: "Privacy policy", exact: true })
      .getAttribute("href"),
    policyUrl,
  );
  await panel
    .getByRole("button", { name: "Show what would be sent", exact: true })
    .click();
  await panel.locator("pre").waitFor();
  const body = await page.evaluate(() => window.fixture.body);
  assert.equal(await panel.locator("pre").textContent(), body);
  await panel
    .getByRole("button", { name: "Copy payload", exact: true })
    .click();
  assert.deepEqual(await page.evaluate(() => window.fixture.copies), [body]);
  await panel
    .getByRole("button", { name: "Share anonymous usage", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Stop sharing", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await panel
    .getByRole("button", { name: "Stop sharing", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Reset installation ID", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(output, "settings-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  assert.deepEqual(await page.evaluate(() => window.fixture.actions), [
    "dismiss",
    "enable",
    "disable",
    "reset",
  ]);
  assert.ok(
    outbound.every((type) => type === "stylesheet"),
    JSON.stringify(outbound),
  );
  assert.deepEqual(errors, []);
  const evidence = {
    workflow: "real Vue and Element Plus; synthetic desktop API",
    actions: ["dismiss", "enable", "disable", "reset"],
    copy: "exact canonical body preserved",
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
