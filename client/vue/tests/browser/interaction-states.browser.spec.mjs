import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import { startAnnotationFixture } from './annotation-fixture.mjs';
import { interactionControlsSource } from './fixtures/interaction-controls.mjs';

let fixture;
beforeAll(async () => {
  fixture = await startAnnotationFixture({ controls: interactionControlsSource });
});
afterAll(() => fixture?.close());

test('activity disclosure and mark-unread affordances respond to hover and keyboard focus', async () => {
  const errors = await fixture.run('controls', async page => {
    await page.evaluate(() => window.showActivity());
    await page.addStyleTag({ content: '.agent-sidebar__activity-time{transition:none!important}' });
    const unreadRow = page.locator('.agent-sidebar__agent[data-reorder-id="quick"]');
    await unreadRow.hover();
    const driver = await unreadRow.locator('.agent-sidebar__engine').boundingBox();
    const dot = await unreadRow.locator('.agent-sidebar__activity-unread').boundingBox();
    assert.ok(dot.x - driver.x - driver.width >= 8, 'driver and unread dot have a clear gap');
    const markUnread = page.getByRole('button', { name: 'Mark unread', exact: true }).first();
    const idleRow = markUnread.locator('..');
    assert.equal(await markUnread.evaluate(el => getComputedStyle(el).opacity), '0');
    await idleRow.hover();
    assert.equal(await markUnread.evaluate(el => getComputedStyle(el).opacity), '1');
    assert.equal(await idleRow.locator('.agent-sidebar__activity-time').evaluate(el => getComputedStyle(el).opacity), '0');
    await markUnread.hover();
    await page.getByRole('tooltip', { name: 'Mark unread', exact: true }).waitFor();
    await page.mouse.move(1190, 850);
    await markUnread.focus();
    assert.equal(await markUnread.evaluate(el => getComputedStyle(el).opacity), '1');
    await markUnread.press('Enter');
    assert.equal((await page.evaluate(() => window.markedUnread)).unread, true);
    assert.equal(await page.evaluate(() => window.selectedAgent), null, 'marking unread does not open the chat');
    await page.waitForFunction(() => document.getAnimations().every(animation =>
      animation.effect?.getTiming().iterations === Infinity || animation.playState !== 'running'));
    const group = page.locator('[data-activity-group="working"]');
    const toggle = group.getByRole('button', { name: 'Working', exact: true });
    const opacity = selector => group.locator(selector).evaluate(el => getComputedStyle(el).opacity);
    await page.mouse.move(1190, 850);
    assert.equal(await opacity('.agent-sidebar__activity-chevron'), '0');
    const before = await toggle.boundingBox();
    await toggle.hover();
    assert.equal(await opacity('.agent-sidebar__activity-chevron'), '1');
    assert.equal(await opacity('.agent-sidebar__activity-icon'), '0');
    assert.deepEqual(await toggle.boundingBox(), before, 'swapping the icon does not move the header');
    await toggle.click();
    await page.mouse.move(1190, 850);
    assert.equal(await group.locator('.agent-sidebar__agent').count(), 0);
    assert.equal(await opacity('.agent-sidebar__activity-chevron'), '1', 'folded groups remain discoverable');
  });
  assert.deepEqual(errors, []);
});

test('toolbar controls share resting, hover, open and keyboard-focus policy across palettes', async () => {
  const errors = await fixture.run('controls', async page => {
    await page.locator('.git-diff-control__open').waitFor();
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
    const selectors = ['.agent-more-menu__trigger', '.run-profiles-control__trigger', '.git-diff-control__open',
      '.git-diff-control__menu-trigger', '.git-workflow-control__trigger', '.agent-header__open-in .open-in-control__launch'];
    const paint = selector => page.locator(selector).evaluate(element => {
      const context = document.createElement('canvas').getContext('2d');
      const ancestors = []; for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
      for (const node of ancestors) { context.fillStyle = getComputedStyle(node).backgroundColor; context.fillRect(0, 0, 1, 1); }
      const style = getComputedStyle(element);
      return { pixels: [...context.getImageData(0, 0, 1, 1).data], color: style.color, outline: style.outlineStyle };
    });
    for (const theme of await page.evaluate(() => window.themes.filter(({ id }) => ['app-light', 'app-dark-blue'].includes(id)))) {
      await page.evaluate(theme => window.applyTheme(theme), theme);
      await page.mouse.move(1190, 850);
      const resting = await paint(selectors[0]);
      for (const selector of selectors) assert.deepEqual((await paint(selector)).pixels, resting.pixels, `${theme.id}: uniform toolbar rest for ${selector}`);
      await page.locator(selectors[0]).hover(); const hovered = await paint(selectors[0]);
      assert.notDeepEqual(hovered.pixels, resting.pixels, `${theme.id}: hover remains visible`);
      for (const selector of selectors.slice(1)) {
        await page.locator(selector).hover();
        const current = await paint(selector);
        assert.equal(await page.locator('html').getAttribute('data-app-theme'),theme.id,'palette remains active during the hover workflow');
        assert.deepEqual([current.pixels, current.color], [hovered.pixels, hovered.color], `${theme.id}: shared hover for ${selector}`);
      }
    }
    await page.mouse.move(1190, 850);
    await page.keyboard.press('Tab'); await page.locator(selectors[0]).focus();
    assert.notEqual((await paint(selectors[0])).outline, 'none', 'keyboard focus is visible');
    await page.locator('.right-workspace-panel__add button').click();
    const open = await paint('.right-workspace-panel__add button');
    assert.notDeepEqual(open.pixels, (await paint('.right-workspace-panel__tabs')).pixels, 'an open menu trigger stays highlighted');
    await page.keyboard.press('Escape');
  });
  assert.deepEqual(errors, []);
});

test('native, toolkit and generated controls retain one state policy and readable palette accents', async () => {
  const errors = await fixture.run('controls', async page => {
    await page.locator('[data-test="native-primary"]').waitFor();
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
    const appearance = locator => locator.evaluate(el => {
      const style = getComputedStyle(el), context = document.createElement('canvas').getContext('2d');
      const luminance = color => {
        context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
        const [r,g,b] = [...context.getImageData(0,0,1,1).data].map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
        return r*.2126+g*.7152+b*.0722;
      };
      const a=luminance(style.color),b=luminance(style.backgroundColor);
      return {color:style.color,background:style.backgroundColor,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),cursor:style.cursor,opacity:style.opacity,outline:style.outlineStyle};
    });
    const control = (family, variant) => page.locator(`[data-test="${family}-${variant}"]`);
    for (const theme of await page.evaluate(() => window.themes.filter(({ id }) => ['app-light', 'app-dark-blue'].includes(id)))) {
      await page.evaluate(theme => window.applyTheme(theme), theme); await page.mouse.move(1190,850);
      const native=await appearance(control('native','primary')), toolkit=await appearance(control('toolkit','primary'));
      assert.deepEqual([toolkit.color,toolkit.background],[native.color,native.background],`${theme.id}: toolkit shares solid colors`);
      if(theme.appearance==='dark') assert.equal(native.color,'rgb(255, 255, 255)',`${theme.id}: dark primary actions use white text`);
      else assert.ok(native.contrast>=4.5,`${theme.id}: primary text contrast ${native.contrast}`);
      await control('native','primary').evaluate(el=>el.setAttribute('data-highlighted',''));
      const highlighted=await appearance(control('native','primary'));
      await control('native','primary').evaluate(el=>el.removeAttribute('data-highlighted'));
      assert.ok(highlighted.contrast>=native.contrast-.02,`${theme.id}: hover preserves primary text contrast`);
    }
    await page.evaluate(()=>window.showLock());
    const lock=page.locator('.team-rail__lock--active');
    for (const theme of ['app-light','app-dark-blue']) {
      await page.evaluate(id=>window.applyTheme(window.themes.find(theme=>theme.id===id)),theme);
      const warning=await page.evaluate(()=>{const probe=document.createElement('span');probe.style.color='var(--color-warning)';document.body.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color});
      await page.mouse.move(1190,850);
      assert.equal((await appearance(lock)).color,warning,theme+': disabled screen locking retains its warning color');
      await lock.hover();
      assert.equal((await appearance(lock)).color,warning,theme+': screen-lock warning survives hover');
      for (const variant of ['neutral','primary','destructive']) {
        await page.mouse.move(1190,850); const rest=await appearance(control('native',variant));
        await control('native',variant).hover(); const hover=await appearance(control('native',variant));
        await control('toolkit',variant).hover(); const toolkit=await appearance(control('toolkit',variant));
        assert.deepEqual([toolkit.background,toolkit.color],[hover.background,hover.color],`${theme}/${variant}: shared hover`);
        assert.notEqual(hover.background,rest.background,`${theme}/${variant}: visible hover`);
        await page.mouse.down();const pressed=await appearance(control('toolkit',variant));await page.mouse.up();
        assert.notEqual(pressed.background,hover.background,`${theme}/${variant}: visible pressed state`);
      }
      const disabled=page.locator('[data-test="disabled"]');await disabled.hover();
      const disabledPaint=await appearance(disabled);
      assert.equal(disabledPaint.cursor,'default');assert.equal(disabledPaint.opacity,'0.5');
      assert.equal(disabledPaint.background,(await appearance(control('native','neutral'))).background);
      await disabled.evaluate(el=>{el.disabled=false});await page.keyboard.press('Tab');await disabled.focus();
      assert.equal((await appearance(disabled)).outline,'solid','toolkit focus ring remains visible');
      await disabled.evaluate(el=>{el.disabled=true});
      const selected=page.locator('.settings-sidebar .el-menu-item.is-active');
      assert.notEqual((await appearance(selected)).background,(await appearance(page.locator('.settings-sidebar .el-menu-item').first())).background,'settings selection remains visible');
    }
    const tabs=page.locator('.el-tabs [role="tab"]');
    assert.notEqual((await appearance(tabs.first())).background,(await appearance(tabs.last())).background,'generated tabs share selected paint');
    await tabs.last().hover(); const tabHover=await appearance(tabs.last());
    await control('native','neutral').hover();
    assert.equal(tabHover.background,(await appearance(control('native','neutral'))).background,'generated tabs share hover paint');
    const install=page.locator('.provider-install-actions a'),refresh=page.locator('.provider-install-actions button');
    await install.hover();const installHover=await appearance(install);await refresh.hover();
    assert.deepEqual(await appearance(refresh),installHover,'installation links and refresh controls share their text appearance');
    for (const id of ['app-light','app-dark-blue']) {
      await page.evaluate(id=>window.applyTheme(window.themes.find(theme=>theme.id===id)),id);
      await page.mouse.move(1190,850);
      const headings=page.locator('.agent-sidebar__workspace-label[aria-expanded="true"]');
      assert.ok(await headings.count()>=2,'repository and Chats headings are expanded');
      for (const heading of await headings.all()) assert.equal((await appearance(heading)).background,'rgba(0, 0, 0, 0)',id+': expanded headings have no selection fill');
      assert.notEqual((await appearance(page.locator('.agent-sidebar__agent[aria-pressed="true"]'))).background,'rgba(0, 0, 0, 0)','active chat stays selected');
      const surface=token=>page.evaluate(token=>{const el=document.createElement('div');el.style.backgroundColor='var('+token+')';document.body.append(el);const color=getComputedStyle(el).backgroundColor;el.remove();return color},token);
      assert.equal((await appearance(page.locator('.git-diff-preview-panel__file-header-row'))).background,await surface('--color-surface-lowest'),id+': filename row keeps its material');
      assert.equal((await appearance(page.locator('.git-diff-preview-panel__group-header'))).background,await surface('--color-surface-low'),id+': group heading keeps its material');
      assert.equal((await appearance(page.locator('.git-diff-preview-panel__file-header'))).background,'rgba(0, 0, 0, 0)','the row owns filename paint');
      assert.equal((await appearance(page.locator('.right-workspace-panel__tab[data-selected]'))).background,id==='app-light'?'rgb(244, 244, 245)':await surface('--agent-ui-state-hover'),id+': tab selection keeps its subtle palette role');
      assert.equal((await appearance(page.locator('.git-review-panel__toolbar .el-segmented__item-selected'))).background,await surface('--color-surface-lowest'),id+': segmented selection keeps its raised surface');
      const chat=page.locator('.agent-sidebar__agent[aria-pressed="true"]');
      const sidebarTint=percent=>page.locator('.agent-sidebar').evaluate((el,percent)=>{const probe=document.createElement('div');probe.style.backgroundColor='color-mix(in srgb,var(--color-text) '+percent+'%,transparent)';el.append(probe);const color=getComputedStyle(probe).backgroundColor;probe.remove();return color},percent);
      assert.equal((await appearance(chat)).background,await sidebarTint(3),id+': chat selection keeps its subtle tint');
      const otherChat=page.locator('.agent-sidebar__agent:not([aria-pressed="true"])').first();
      await otherChat.hover();
      assert.equal((await appearance(otherChat)).background,await sidebarTint(1),id+': chat hover is quieter than selection');
      await page.mouse.down();
      try { assert.equal((await appearance(otherChat)).background,await sidebarTint(5),id+': pressing a chat keeps a subtle tint'); }
      finally { await page.mouse.up(); }
      assert.equal(await page.locator('.el-segmented__item-selected').first().evaluate(el=>getComputedStyle(el).boxShadow),'none','segmented selection has no shadow');
    }
    for (const method of ['confirm','alert','prompt']) {
      await page.evaluate(method=>{void window.openDialog(method,method==='confirm')},method);
      const confirm=page.locator('.el-message-box .fixture-confirm'); await confirm.waitFor(); await page.mouse.move(1190,850);
      assert.equal(await confirm.evaluate(el=>el.classList.contains('agent-ui-interactive')),true);
      if(method==='prompt')await page.locator('.el-message-box input').fill('Edited value');
      const expected=await appearance(control('native',method==='confirm'?'destructive':'primary'));
      const actual=await appearance(confirm);
      assert.deepEqual([actual.color,actual.background],[expected.color,expected.background],'generated buttons use the same solid variant');
      await confirm.click();
      await page.waitForFunction(()=>window.dialogResult!==null);
      assert.deepEqual(await page.evaluate(()=>window.dialogResult),method==='prompt'?{value:'Edited value',action:'confirm'}:'confirm');
      await page.locator('.el-message-box').waitFor({state:'hidden'});
    }
    await control('native','neutral').hover();const neutralHover=await appearance(control('native','neutral'));
    await page.evaluate(()=>{void window.openDialog('confirm',false)});
    const close=page.locator('.el-message-box__headerbtn');await close.hover();
    assert.equal((await appearance(close)).background,neutralHover.background,'generated close control uses shared hover');
    await close.click();await page.waitForFunction(()=>window.dialogResult==='cancel');
    await page.locator('.el-message-box').waitFor({state:'hidden'});
    const blue=page.getByRole('button',{name:'Blue workspace',exact:true}),green=page.getByRole('button',{name:'Green workspace',exact:true});
    const identity=locator=>locator.evaluate(el=>{const s=getComputedStyle(el);return {background:s.backgroundColor,ring:s.outlineColor,style:s.outlineStyle,width:s.outlineWidth,gap:s.outlineOffset}});
    await page.mouse.move(1190,850);
    assert.match((await identity(blue)).ring,/rgb\(27, 79, 178\)/,'selected identity ring keeps its own color');
    assert.equal((await identity(green)).background,'rgb(70, 168, 87)');
    await green.click();await page.mouse.move(1190,850);
    assert.equal((await identity(blue)).style,'none');
    assert.match((await identity(green)).ring,/rgb\(70, 168, 87\)/,'selection moves through the shared engine');
    assert.deepEqual(await identity(green),{background:'rgb(70, 168, 87)',ring:'rgb(70, 168, 87)',style:'solid',width:'1px',gap:'2px'},'selection keeps identity material and a real gap around its ring');
    await green.hover();
    assert.equal((await identity(green)).background,'rgb(70, 168, 87)','hover preserves the workspace identity color');
  });
  assert.deepEqual(errors, []);
});
