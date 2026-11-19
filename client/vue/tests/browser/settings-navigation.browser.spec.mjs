import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { test } from 'vitest';
import { withAnnotationFixture } from './annotation-fixture.mjs';

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

// Protects clipped bottom destinations and accidental coupling of the two scroll regions.
test('settings navigation reaches bottom panels and scrolls independently at supported heights', async () => {
  const errors = await withAnnotationFixture(source, async page => {
    await page.locator('.settings-sidebar .el-menu-item').first().waitFor();
    const evidence = [];
    if (process.env.SETTINGS_EVIDENCE) await mkdir(process.env.SETTINGS_EVIDENCE, {recursive:true});
    for (const height of [560, 800]) {
      await page.setViewportSize({ width: 1200, height });
      const nav = page.locator('.settings-sidebar');
      const content = page.locator('.settings-view__content');
      await nav.hover();
      await page.mouse.wheel(0, 3000);
      await page.waitForFunction(() => document.querySelector('.settings-sidebar').scrollTop > 0);
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
      await content.hover();
      await page.mouse.wheel(0, 3000);
      await page.waitForFunction(() => document.querySelector('.settings-view__content').scrollTop > 0);
      assert.equal(await nav.evaluate(el => el.scrollTop), navTop, 'content scrolling must not move navigation');
      const contentTop = await content.evaluate(el => el.scrollTop);
      await nav.hover();
      await page.mouse.wheel(0, 3000);
      await page.waitForFunction(() => document.querySelector('.settings-sidebar').scrollTop > 0);
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

// Real toolkit focus and layout: group boundaries, clamped endpoints and content isolation.
test('arrow selection follows visible destinations and keeps focus, panel and viewport together', async () => {
  for (const filtered of [false, true]) {
    const fixture = filtered ? source.replace("platform:'desktop'", "platform:'web'").replace("['codex','claude','cursor','antigravity']", "['codex','claude']") : source;
    const errors = await withAnnotationFixture(fixture, async page => {
      await page.setViewportSize({width:1200,height:560});
      const nav = page.locator('.settings-sidebar');
      const items = nav.getByRole('menuitem');
      await items.first().waitFor();
      const names = (await items.allTextContents()).map(value=>value.trim());
      assert.ok(names.includes('Connections'));
      if (filtered) for (const absent of ['Browser','Appshots','Cursor','Antigravity']) assert.ok(!names.includes(absent), absent+' filtered');
      if (filtered) await items.first().focus();
      else await items.first().click();
      const check = async index => {
        const item = items.nth(index);
        await page.waitForFunction(index => {
          const items = document.querySelectorAll('.settings-sidebar [role="menuitem"]');
          return items[index] === document.activeElement && items[index].hasAttribute('data-selected');
        }, index, {timeout:2500});
        const box = await item.boundingBox(), region = await nav.boundingBox();
        assert.ok(box.y >= region.y && box.y+box.height <= region.y+region.height+1, names[index]+' visible');
        if (['General','Personalization','Skills','Plugins','Workflows','Integrations','Connections'].includes(names[index])) {
          await page.locator('#settings-'+names[index].toLowerCase()+'-title').waitFor();
        }
      };
      await page.keyboard.press('ArrowUp'); await check(0);
      for (let index=1; index<names.length; index++) { await page.keyboard.press('ArrowDown'); await check(index); }
      assert.ok(await nav.evaluate(el=>el.scrollTop)>0);
      await page.keyboard.press('ArrowDown'); await check(names.length-1);
      for (let index=names.length-2; index>=0; index--) { await page.keyboard.press('ArrowUp'); await check(index); }
      await page.keyboard.press('ArrowUp'); await check(0);
      await nav.getByRole('menuitem',{name:'Appearance',exact:true}).click();
      const input = page.locator('.settings-view__content input[role="spinbutton"]').first();
      await input.waitFor(); await input.focus();
      const before = await input.inputValue();
      await input.press('ArrowUp');
      assert.notEqual(await input.inputValue(), before, 'real Element Plus numeric control handles arrows');
      assert.equal(await page.evaluate(()=>window.activeSettingsTab()), 'appearance');
      assert.equal(await input.evaluate(el=>el===document.activeElement), true);
    });
    assert.deepEqual(errors, []);
  }
}, 60000);
