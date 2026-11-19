import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, test } from 'vitest';
import { startAnnotationFixture } from './annotation-fixture.mjs';

const source = `
import {createApp,h,ref} from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import '@korus-dev/agent-ui-sdk/styles.css';
import '/client/vue/src/styles/variables.css';
import '/client/vue/src/styles/base.css';
import '/client/vue/src/styles/theme.css';
import {createInitialSnapshot} from '@workspace/core/snapshot';
import {configureAppClient} from '/client/vue/src/platform-api.ts';
import {i18n} from '/client/vue/src/i18n/index.ts';
import SettingsView from '/client/vue/src/components/SettingsView.vue';
configureAppClient({platform:'desktop'});
const snapshot=createInitialSnapshot();
const activeTab=ref('general');
const theme=ref(snapshot.theme);
window.activeSettingsTab=()=>activeTab.value;
createApp({render:()=>h('div',{style:'height:100vh;display:flex'},[h(SettingsView,{
 settings:theme.value,updateSettings:async input=>{theme.value={...theme.value,...input.theme}},generalSettings:snapshot.general,activeTab:activeTab.value,
 providerConnections:['codex','claude','cursor','antigravity'].map(provider=>({provider,installed:false,connected:false})),
 onSelectTab:value=>activeTab.value=value
})])}).use(ElementPlus).use(i18n).mount('#app');
`;

const filteredSource = source
  .replace("platform:'desktop'", "platform:'web'")
  .replace("['codex','claude','cursor','antigravity']", "['codex','claude']");

let fixture;
beforeAll(async () => {
  fixture = await startAnnotationFixture({ desktop: source, filtered: filteredSource });
});
afterAll(() => fixture?.close());

// Protects clipped bottom destinations and accidental coupling of the two scroll regions.
test('settings navigation reaches bottom panels and scrolls independently at supported heights', async () => {
  const errors = await fixture.run('desktop', async page => {
    await page.locator('.settings-sidebar .el-menu-item').first().waitFor();
    const evidence = [];
    if (process.env.SETTINGS_EVIDENCE) await mkdir(process.env.SETTINGS_EVIDENCE, {recursive:true});
    for (const height of [560, 800]) {
      await page.setViewportSize({ width: 1200, height });
      const nav = page.locator('.settings-sidebar');
      const content = page.locator('.settings-view__content');
      await nav.evaluate(el => { el.scrollTop = 0; });
      const searchBox = nav.getByRole('searchbox', { name: 'Search settings' });
      const initialSearch = await searchBox.boundingBox();
      await nav.hover();
      await page.mouse.wheel(0, 3000);
      await page.waitForFunction(() => document.querySelector('.settings-sidebar').scrollTop > 0, undefined, { timeout: 2500 });
      const search = await searchBox.boundingBox();
      assert.ok(search.y >= 0 && search.y + search.height <= height, 'search stays visible while the sidebar scrolls');
      assert.equal(search.y, initialSearch.y, 'search stays at the top of the sidebar');
      const bottom = nav.getByRole('menuitem', { name: 'Connections', exact: true });
      const bounds = await bottom.boundingBox();
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= height, 'bottom destination must be visible after scrolling');
      await bottom.click();
      await page.locator('#settings-connections-title').waitFor();
      if (process.env.SETTINGS_EVIDENCE) await page.screenshot({path:process.env.SETTINGS_EVIDENCE+'/connections-'+height+'.png'});
      await nav.getByRole('menuitem', { name: 'Integrations', exact: true }).click();
      await page.locator('#settings-integrations-title').waitFor();
      await nav.evaluate(el => { el.scrollTop = 0; });
      await nav.getByRole('menuitem', { name: 'General', exact: true }).click();
      const navTop = await nav.evaluate(el => el.scrollTop);
      await content.evaluate(el => { el.scrollTop = 0; });
      await content.hover();
      await page.mouse.wheel(0, 100);
      await page.waitForFunction(() => document.querySelector('.settings-view__content').scrollTop > 0, undefined, { timeout: 2500 });
      assert.equal(await nav.evaluate(el => el.scrollTop), navTop, 'content scrolling must not move navigation');
      const { top: contentTop, max: contentMax } = await content.evaluate(el => ({
        top: el.scrollTop, max: el.scrollHeight - el.clientHeight,
      }));
      assert.ok(contentTop < contentMax, 'content must have room to scroll down during the navigation wheel check');
      await nav.hover();
      await page.mouse.wheel(0, 3000);
      await page.waitForFunction(top => document.querySelector('.settings-sidebar').scrollTop > top, navTop, { timeout: 2500 });
      assert.equal(await content.evaluate(el => el.scrollTop), contentTop, 'navigation scrolling must not move content');
      const geometry = await page.evaluate(() => ({height:innerHeight, documentHeight:document.documentElement.scrollHeight,
        nav:document.querySelector('.settings-sidebar').getBoundingClientRect().toJSON(),
        navScroll:document.querySelector('.settings-sidebar').scrollTop,contentScroll:document.querySelector('.settings-view__content').scrollTop}));
      assert.equal(geometry.documentHeight, height, 'settings must stay within the available height');
      evidence.push(geometry);
      if (process.env.SETTINGS_EVIDENCE) {
        await page.screenshot({path:process.env.SETTINGS_EVIDENCE+'/settings-'+height+'.png'});
      }
    }
    if (process.env.SETTINGS_EVIDENCE) await writeFile(process.env.SETTINGS_EVIDENCE+'/geometry.json',JSON.stringify(evidence,null,2));
  });
  assert.deepEqual(errors, []);
}, 60000);

async function withShortSettings(entry, run) {
  const errors = await fixture.run(entry, async page => {
    await page.setViewportSize({ width: 1200, height: 560 });
    await page.locator('.settings-sidebar').getByRole('menuitem').first().waitFor();
    await run(page);
  });
  assert.deepEqual(errors, []);
}

async function expectFocusedSelectionInView(page, name) {
  const nav = page.locator('.settings-sidebar');
  const item = nav.getByRole('menuitem', { name, exact: true });
  await page.waitForFunction(name => {
    const item = [...document.querySelectorAll('.settings-sidebar [role="menuitem"]')]
      .find(item => item.textContent.trim() === name);
    return item === document.activeElement && item.hasAttribute('data-selected');
  }, name, { timeout: 2500 });
  const box = await item.boundingBox();
  const region = await nav.boundingBox();
  const search = await nav.getByRole('searchbox').boundingBox();
  assert.ok(box.y >= search.y + search.height && box.y + box.height <= region.y + region.height + 1, name + ' visible below search');
}

test('Tab enters at the selected destination and arrows reveal offscreen settings', async () => {
  await withShortSettings('filtered', async page => {
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('searchbox', { name: 'Search settings' }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Tab');
    await expectFocusedSelectionInView(page, 'General');

    await page.keyboard.press('ArrowDown');
    await expectFocusedSelectionInView(page, 'Analytics');
    await page.locator('.settings-view__content').getByRole('heading', { name: 'Analytics', exact: true }).waitFor();

    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.settings-view__content').evaluate(el => el.contains(document.activeElement)), true);
    await page.keyboard.press('Shift+Tab');
    await expectFocusedSelectionInView(page, 'Analytics');

    const nav = page.locator('.settings-sidebar');
    const remaining = await nav.getByRole('menuitem').count() - 2;
    for (let index = 0; index < remaining; index++) await page.keyboard.press('ArrowDown');
    await expectFocusedSelectionInView(page, 'Connections');
    await page.locator('#settings-connections-title').waitFor();
    assert.ok(await nav.evaluate(el => el.scrollTop) > 0);
  });
}, 60000);

test('content-control arrows keep their normal behavior without changing the selected destination', async () => {
  await withShortSettings('desktop', async page => {
    await page.locator('.settings-sidebar').getByRole('menuitem', { name: 'Appearance', exact: true }).click();
    const input = page.locator('.settings-view__content input[role="spinbutton"]').first();
    await input.waitFor();
    await input.focus();
    const before = await input.inputValue();
    await input.press('ArrowUp');
    assert.notEqual(await input.inputValue(), before, 'real Element Plus numeric control handles arrows');
    assert.equal(await page.evaluate(() => window.activeSettingsTab()), 'appearance');
    assert.equal(await input.evaluate(el => el === document.activeElement), true);
  });
}, 60000);
