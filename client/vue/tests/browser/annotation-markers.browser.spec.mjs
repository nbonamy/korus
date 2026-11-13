import assert from 'node:assert/strict';
import { test } from 'vitest';
import { withAnnotationFixture } from './annotation-fixture.mjs';

const planSource = `
  import {createApp,h,ref} from 'vue';
  import ElementPlus from 'element-plus';
  import 'element-plus/dist/index.css';
  import '/client/vue/src/styles/variables.css';
  import '/client/vue/src/styles/base.css';
  import {i18n} from '/client/vue/src/i18n/index.ts';
  import Plan from '/client/vue/src/components/PlanReviewSection.vue';
  createApp({setup(){
    const draft=ref({comments:[],choices:[]});
    const section={id:'s1',title:'Plan',heading:'',blocks:[{html:'<p>Keep the <strong>selected context</strong> visible and the <em>second passage</em> too.</p>'}]};
    return ()=>h('main',{style:'padding:40px'},[h(Plan,{section,draft:draft.value,onComment:c=>draft.value={...draft.value,comments:[...draft.value.comments.filter(x=>x.id!==c.id),...(c.body?[c]:[])]}})]);
  }}).use(ElementPlus).use(i18n).mount('#app');
`;

// Marker placement and highlight painting need real layout and CSS highlights, which jsdom lacks.
test('saved requirement comments keep their passages marked with numbers that open the comment and reveal the passage', async () => {
  const errors = await withAnnotationFixture(planSource, async page => {
    const painted = name => page.evaluate(name => [...(CSS.highlights.get(name) ?? [])].map(range => range.toString()), name);
    const select = selector => page.locator(selector).first().evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const comment = async (selector, text) => {
      await select(selector);
      const input = page.locator('textarea:visible');
      await input.click();
      await input.fill(text);
      await input.press('Escape');
    };

    // Before the first words, the comment has an icon where its number will be; it sits on the text box's first line.
    await select('strong');
    const pending = await page.evaluate(() => {
      const icon = document.querySelector('.annotation-comment--open .annotation-comment__icon').getBoundingClientRect();
      const box = document.querySelector('.annotation-comment--open textarea').getBoundingClientRect();
      return { iconBeforeBox: icon.right <= box.left, firstLine: icon.top >= box.top && icon.top + icon.height / 2 <= box.top + 28 };
    });
    assert.deepEqual(pending, { iconBeforeBox: true, firstLine: true }, 'the icon sits beside the first line of the new comment');
    await page.locator('textarea:visible').press('Escape');

    await comment('strong', 'Retain this context.');
    await comment('em', 'Say more here.');

    const markers = page.locator('[data-annotation-id]');
    assert.deepEqual(await markers.allTextContents(), ['1', '2'], 'each saved comment is numbered in order');
    assert.deepEqual(await painted('chat-annotations'), ['selected context', 'second passage'], 'saved passages stay highlighted');
    const paint = await page.locator('strong').evaluate(element => getComputedStyle(element, '::highlight(chat-annotations)').backgroundColor);
    assert.notEqual(paint, 'rgba(0, 0, 0, 0)', 'saved passages are painted');

    await markers.first().click();
    const input = page.locator('textarea:visible');
    assert.equal(await input.inputValue(), 'Retain this context.', 'the marker opens its comment');
    const layout = await page.evaluate(() => {
      const badge = document.querySelector('.annotation-comment--open .annotation-comment__locate').getBoundingClientRect();
      const box = document.querySelector('.annotation-comment--open textarea').getBoundingClientRect();
      return { badgeBeforeBox: badge.right <= box.left, badgeInsideBoxRows: badge.top >= box.top - 4 && badge.bottom <= box.bottom };
    });
    assert.deepEqual(layout, { badgeBeforeBox: true, badgeInsideBoxRows: true }, 'the text box sits beside the number');
    await input.press('Escape');

    const lines = page.locator('.annotation-comment__line');
    assert.equal((await page.locator('.annotation-comment__locate').nth(1).textContent()), '2', 'the comment row carries the same number');
    assert.equal(await page.locator('.annotation-comment__body').nth(1).textContent(), 'Say more here.', 'the row shows the comment beside its number');
    const centers = await page.evaluate(() => {
      const middle = selector => { const box = document.querySelector(selector).getBoundingClientRect(); return box.top + box.height / 2; };
      return [middle('.annotation-comment__locate'), middle('.annotation-comment__body')];
    });
    assert.ok(Math.abs(centers[0] - centers[1]) <= 2, `the number and the text share a centre line (${centers})`);
    for (const box of await lines.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height))) assert.ok(box < 48, `a saved comment fits on one line (${box}px)`);
    await page.locator('.annotation-comment__locate').nth(1).click();
    assert.deepEqual(await painted('chat-annotation-focus'), ['second passage'], 'the row reveals its passage');
    await page.waitForFunction(() => !CSS.highlights.has('chat-annotation-focus'));

    await page.getByRole('button', { name: 'Remove comment' }).first().click();
    assert.deepEqual(await markers.allTextContents(), ['1'], 'deleting a comment renumbers the rest');
    assert.deepEqual(await painted('chat-annotations'), ['second passage'], 'deleting a comment releases its passage');
  });
  assert.deepEqual(errors, []);
});

test('clicking outside an open requirement comment closes it, and the comment button shows no outline', async () => {
  const errors = await withAnnotationFixture(planSource, async page => {
    const painted = name => page.evaluate(name => [...(CSS.highlights.get(name) ?? [])].map(range => range.toString()), name);
    await page.locator('strong').evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const input = page.locator('textarea:visible');
    await input.fill('Keep this.');
    assert.deepEqual(await painted('chat-annotation-focus'), ['selected context'], 'the passage is selected while its comment is open');

    await page.mouse.click(1000, 700);
    await input.waitFor({ state: 'hidden' });
    assert.deepEqual(await painted('chat-annotation-focus'), [], 'the passage is deselected');
    assert.deepEqual(await page.locator('[data-annotation-id]').allTextContents(), ['1'], 'the saved comment keeps its marker');

    // Closing with the keyboard returns focus to the comment button, which must not draw an outline.
    await page.locator('.plan-review-section__heading button').click();
    await page.locator('textarea:visible').press('Escape');
    const focused = page.locator('.plan-review-section__heading button');
    assert.equal(await focused.evaluate(element => document.activeElement === element), true, 'focus returns to the comment button');
    assert.equal(await focused.evaluate(element => getComputedStyle(element).outlineStyle), 'none', 'the focused comment button has no outline');
  });
  assert.deepEqual(errors, []);
});

const ticketSource = `
  import {createApp,h,ref} from 'vue';
  import ElementPlus from 'element-plus';
  import 'element-plus/dist/index.css';
  import '/client/vue/src/styles/variables.css';
  import '/client/vue/src/styles/base.css';
  import {i18n} from '/client/vue/src/i18n/index.ts';
  import Ticket from '/client/vue/src/components/MissionTicketDialog.vue';
  createApp({setup(){
    const comments=ref([]);
    const filler=Array.from({length:40},(_, i)=>'Paragraph '+(i+1)+' of the ticket keeps the document taller than the dialog.').join('\\n\\n');
    const ticket={title:'Export reports',body:'The mission must **let users export reports** as CSV and keep the *existing filters* intact when exporting.\\n\\n'+filler};
    return ()=>h(Ticket,{modelValue:true,annotatable:true,ticketKey:'t1',ticketNumber:'01',ticket,comments:comments.value,totalCommentCount:comments.value.length,
      onSaveComment:c=>comments.value=[...comments.value.filter(x=>x.id!==c.id),c],onRemoveComment:id=>comments.value=comments.value.filter(x=>x.id!==id)});
  }}).use(ElementPlus).use(i18n).mount('#app');
`;

test('ticket comments use the requirement comment editor: inline, collapsible, numbered and deletable', async () => {
  const errors = await withAnnotationFixture(ticketSource, async page => {
    const painted = name => page.evaluate(name => [...(CSS.highlights.get(name) ?? [])].map(range => range.toString()), name);
    const select = selector => page.locator(selector).first().evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const comment = async (selector, text) => {
      await select(selector);
      const input = page.locator('textarea:visible');
      await input.fill(text);
      await input.press('Escape');
    };
    await comment('strong', 'Which formats?');
    await comment('em', 'Keep sort order too.');

    const markers = page.locator('[data-annotation-id]');
    assert.deepEqual(await markers.allTextContents(), ['1', '2'], 'each saved comment is numbered in order');
    assert.deepEqual(await painted('chat-annotations'), ['let users export reports', 'existing filters'], 'saved passages stay highlighted');
    assert.equal(await page.locator('textarea:visible').count(), 0, 'saved comments are collapsed');
    assert.equal(await page.getByRole('button', { name: 'Edit comment' }).count(), 2, 'each comment can be edited');

    await markers.first().click();
    assert.equal(await page.locator('textarea:visible').inputValue(), 'Which formats?', 'the marker opens its comment');
    assert.deepEqual(await painted('chat-annotation-focus'), [], 'editing a saved comment is not a new selection');
    await page.mouse.click(1000, 700);
    await page.locator('textarea:visible').waitFor({ state: 'hidden' });

    await page.locator('.annotation-comment__locate').nth(1).click();
    assert.deepEqual(await painted('chat-annotation-focus'), ['existing filters'], 'the row reveals its passage');
    await page.waitForFunction(() => !CSS.highlights.has('chat-annotation-focus'));

    // A new selection stays open until the user clicks away.
    await select('strong');
    assert.deepEqual(await painted('chat-annotation-focus'), ['let users export reports']);
    await page.mouse.click(1000, 700);
    assert.deepEqual(await painted('chat-annotation-focus'), [], 'clicking outside releases the passage');

    await page.getByRole('button', { name: 'Remove comment' }).first().click();
    assert.deepEqual(await markers.allTextContents(), ['1'], 'deleting a comment renumbers the rest');

    // The list is pinned to the bottom of the dialog while the long ticket scrolls beneath it.
    const gap = () => page.evaluate(() => {
      const body = document.querySelector('.mission-ticket-dialog .el-dialog__body').getBoundingClientRect();
      const list = document.querySelector('.mission-ticket-dialog__comments').getBoundingClientRect();
      return Math.round(body.bottom - list.bottom);
    });
    assert.equal(await gap(), 0, 'the list sits at the bottom of the dialog');
    const scrolled = await page.locator('.mission-ticket-dialog .el-dialog__body').evaluate(element => { element.scrollTop = 240; return element.scrollTop; });
    assert.ok(scrolled > 0, 'the ticket is long enough to scroll');
    assert.equal(await gap(), 0, 'the list stays at the bottom while the ticket scrolls');
    const height = await page.locator('.annotation-comment__line').first().evaluate(element => element.getBoundingClientRect().height);
    assert.ok(height < 48, `a ticket comment fits on one line (${height}px)`);
  });
  assert.deepEqual(errors, []);
});

test('Enter saves a comment and Shift+Enter adds a line, in requirements and tickets alike', async () => {
  for (const source of [planSource, ticketSource]) {
    const errors = await withAnnotationFixture(source, async page => {
      await page.locator('strong').first().evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
      const input = page.locator('textarea:visible');
      await input.fill('First line');
      await input.press('Shift+Enter');
      await input.pressSequentially('Second line');
      assert.equal(await input.inputValue(), 'First line\nSecond line', 'Shift+Enter adds a line');

      await input.press('Enter');
      await input.waitFor({ state: 'hidden' });
      assert.equal(await page.locator('.annotation-comment__body').first().textContent(), 'First line\nSecond line', 'Enter saves the comment');
      assert.deepEqual(await page.locator('[data-annotation-id]').allTextContents(), ['1'], 'the saved comment is marked');
    });
    assert.deepEqual(errors, []);
  }
});
