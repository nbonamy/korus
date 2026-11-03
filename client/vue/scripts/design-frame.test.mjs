import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('Design pointer hover previews element bounds without changing selection or intercepting clicks', async () => {
  const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL('../src/components/design-frame.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
  const { designFrame } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
  const board = { id: 'board', title: 'Preview', width: 800, height: 600, root: { id: 'root', tag: 'main', children: [
    { id: 'heading', tag: 'h1', text: 'Heading' }, { id: 'action', tag: 'button', attributes: { class: 'target' }, text: 'Continue' },
  ] } };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<iframe sandbox="allow-scripts" style="width:800px;height:600px;transform:scale(.5);transform-origin:top left;border:0"></iframe>');
    await page.evaluate(() => { window.messages = []; addEventListener('message', event => window.messages.push(event.data)); });
    const html = play => designFrame(board, 'body{font-family:Arial}main{padding:40px}h1{margin:0 0 20px;font-weight:900}.target{padding:12px;border-radius:6px}', 'hover-test', 1, play, 'heading', { width: 'Width', height: 'Height', size: 'Size' });
    await page.locator('iframe').evaluate((frame, source) => { frame.srcdoc = source; }, html(false));
    const frame = page.frameLocator('iframe');
    const heading = frame.locator('#heading');
    const action = frame.locator('#action');
    const hover = frame.locator('[data-design-hover]');
    await action.hover();
    await hover.waitFor({ state: 'visible' });
    const actual = await hover.boundingBox(), expected = await action.boundingBox();
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(actual[key] - expected[key]) < 1, `Hover ${key} follows the element at canvas zoom`);
    assert.deepEqual(await page.evaluate(() => window.messages), [], 'Hover never selects or edits');
    const selected = frame.locator('[data-design-editor]').filter({ has: frame.getByRole('button', { name: 'Width', exact: true, includeHidden: true }) });
    assert.equal((await selected.boundingBox()).width, (await heading.boundingBox()).width, 'Selection remains on the heading');
    await page.mouse.move(700, 650);
    await hover.waitFor({ state: 'hidden' });
    await action.hover();
    await page.locator('iframe').evaluate(frame => frame.contentWindow.postMessage({ token: 'hover-test', kind: 'highlight', nodeId: 'heading', inspectNodeId: 'action', locked: true, zoom: .5, selectionColor: '#0c72ee' }, '*'));
    await hover.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.messages.some(message => message.kind === 'styles' && message.nodeId === 'action'));
    const inspected = await page.evaluate(() => window.messages.find(message => message.kind === 'styles' && message.nodeId === 'action').styles);
    assert.equal(inspected['border-top-left-radius'], '6px');
    assert.equal(inspected['padding-left'], '12px');
    assert.equal(inspected['font-family'], 'Arial');
    assert.equal(inspected['font-weight'], undefined, 'A sibling selector must not leak into selected CSS');
    assert.equal(await selected.evaluate(el => getComputedStyle(el).borderTopWidth), '4px', 'A half-scale frame retains a two-pixel selection stroke');
    assert.equal(await selected.evaluate(el => getComputedStyle(el).borderTopColor), 'rgb(12, 114, 238)');
    await heading.hover();
    await action.hover();
    assert.equal(await hover.isVisible(), false, 'Locked/pan mode suppresses hover');
    await page.locator('iframe').evaluate(frame => frame.contentWindow.postMessage({ token: 'hover-test', kind: 'highlight', nodeId: 'heading', locked: false, zoom: .5 }, '*'));
    await heading.hover();
    await action.hover();
    await hover.waitFor({ state: 'visible' });
    await action.click();
    await page.waitForFunction(() => window.messages.some(message => message.kind === 'select' && message.nodeId === 'action'));
    await hover.waitFor({ state: 'hidden' });
    await page.mouse.click(300, 260);
    await page.waitForFunction(() => window.messages.some(message => message.kind === 'select' && message.nodeId === null));
    await selected.waitFor({ state: 'hidden' });
    await page.locator('iframe').evaluate((frame, source) => { frame.srcdoc = source; }, html(true));
    await frame.locator('#action').hover();
    assert.equal(await hover.count(), 0, 'Play has no editor hover overlay');
  } finally { await browser.close(); }
});
