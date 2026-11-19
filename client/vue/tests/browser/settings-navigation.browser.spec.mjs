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
createApp({render:()=>h('div',{style:'height:100vh;display:flex'},[h(SettingsView,{
 settings:snapshot.theme,generalSettings:snapshot.general,activeTab:activeTab.value,
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
