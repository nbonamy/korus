// Repeatable real-shell smoke: npm run build:web && node scripts/verify-design-workspace.mjs [output-directory]
// Deterministic by default. --live also checks generation with a real configured provider.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, copyFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import product from '../core/src/product.json' with { type: 'json' };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv.slice(2).find(value => !value.startsWith('--')) ?? path.join(os.tmpdir(), 'korus-design-evidence'));
const live = process.argv.includes('--live');
const home = await mkdtemp(path.join(os.tmpdir(), 'korus-design-smoke-'));
let host, daemon, browser, socket;
const checks = [];
const record = name => { checks.push(name); console.log(`Passed: ${name}`); };
try {
  await mkdir(output, { recursive: true });
  await rm(path.join(output, 'acceptance.json'), { force: true });
  await readFile(path.join(root, 'web/dist/server/index.js'));
  await build({ stdin: { resolveDir: root, contents: `import {createInitialSnapshot} from './core/src/snapshot';export default createInitialSnapshot();` }, bundle: true, platform: 'node', format: 'esm', outfile: path.join(home, 'seed.mjs') });
  const { default: snapshot } = await import(path.join(home, 'seed.mjs'));
  snapshot.general.providerOnboardingComplete = true;
  snapshot.general.spokenAnnouncementsEnabled = false;
  snapshot.agents.forEach(agent => { agent.folder = root; });
  snapshot.sourceFolder = { path: root, initialized: true, recentRepoNames: [] };
  await writeFile(path.join(home, 'state.json'), JSON.stringify(snapshot));
  await mkdir(path.join(home, 'codex-home'), { mode: 0o700 });
  try { await copyFile(path.join(os.homedir(), product.homeDirectory, 'codex-home/auth.json'), path.join(home, 'codex-home/auth.json')); }
  catch { throw new Error('This real-shell smoke needs existing local Codex authentication for onboarding. No model turns are submitted.'); }
  await chmod(path.join(home, 'codex-home/auth.json'), 0o600);
  const allocator = net.createServer();
  allocator.listen(0, '127.0.0.1'); await once(allocator, 'listening');
  const port = allocator.address().port;
  await new Promise(resolve => allocator.close(resolve));
  daemon = spawn(process.execPath, [path.join(root, 'backend/dist/daemon.mjs'), 'serve'], { cwd: root, stdio: 'ignore', env: { ...process.env, APP_HOME: home, APP_HOST: 'web' } });
  for (let attempt = 0; ; attempt++) {
    if (daemon.exitCode !== null) throw new Error('Isolated daemon exited during startup.');
    if (await access(path.join(home, 'daemon.sock')).then(() => true).catch(() => false)) break;
    if (attempt > 240) throw new Error('Isolated daemon did not start.');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  host = spawn(process.execPath, [path.join(root, 'web/dist/server/index.js')], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, APP_HOME: home, HOST: '127.0.0.1', PORT: String(port), APP_BACKEND_COMMAND: process.execPath, APP_BACKEND_ARGS: `${path.join(root, 'backend/dist/daemon.mjs')},connect` },
  });
  let hostOutput = '';
  host.stderr.on('data', data => { hostOutput = (hostOutput + data).slice(-2000); });
  host.stdout.on('data', data => { hostOutput = (hostOutput + data).slice(-2000); });
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; ; attempt++) {
    if (host.exitCode !== null) throw new Error(`Smoke host exited during startup: ${hostOutput}`);
    if (await fetch(`${url}/health`).then(r => r.ok).catch(() => false)) break;
    if (attempt > 240) throw new Error('Smoke host did not start.');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  socket = new WebSocket(`ws://127.0.0.1:${port}/app?clientId=design-smoke`);
  await once(socket, 'open');
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const response = JSON.parse(event.data);
    if (response.type !== 'response') return;
    const entry = pending.get(response.id); if (!entry) return;
    pending.delete(response.id); clearTimeout(entry.timeout);
    response.ok ? entry.resolve(response.result) : entry.reject(new Error(response.error));
  });
  const invoke = (operation, ...args) => new Promise((resolve, reject) => {
    const id = `smoke-${++nextId}`;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${operation}`)); }, 20_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ version: 1, type: 'request', id, operation, args }));
  });
  const agentId = snapshot.agents[0].id;
  const design = request => invoke('design', agentId, request);
  const waitSelection = async nodeId => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const workspace = (await design({ type: 'read' })).workspace;
      if (workspace.selectedNodeId === nodeId) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(`The editor did not select ${nodeId}.`);
  };
  await design({ type: 'open' });
  await design({ type: 'create', content: { title: 'Design acceptance', css: 'body{margin:0;background:#f5f1e9;color:#222;font-family:system-ui}main{padding:48px}h1{font-size:52px}button{padding:16px}p{font-size:20px}', comments: [], artboards: [{ id: 'desktop', title: 'Desktop', width: 800, height: 600, root: { id: 'root', tag: 'main', children: [
    { id: 'headline', tag: 'h1', text: 'Build together' },
    { id: 'intro', tag: 'p', text: 'An initial paragraph.' },
    { id: 'obsolete', tag: 'small', text: 'Draft' },
    { id: 'toggle', tag: 'button', text: 'Show details', toggleTargetId: 'details' },
    { id: 'details', tag: 'p', text: 'Prototype interaction works.', attributes: { hidden: '' } },
  ] } }, { id: 'mobile', title: 'Mobile', width: 375, height: 640, root: { id: 'mobile-root', tag: 'main', children: [{ id: 'mobile-heading', tag: 'h1', text: 'A second artboard' }] } }] } });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(url);
  await page.locator('.design-panel').waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('.design-canvas').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.design-canvas iframe').count(), 2);
  const assertToolbar = async () => {
    const geometry = await page.locator('.design-panel').evaluate(panel => {
      const panelBounds = panel.getBoundingClientRect();
      const title = panel.querySelector('.design-canvas__document h2');
      const stage = panel.querySelector('.design-panel__stage').getBoundingClientRect();
      const picker = panel.querySelector('button[aria-label="Artboard"]')?.getBoundingClientRect();
      const controls = [...panel.querySelectorAll('[data-design-tools]')].map(item => { const b = item.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; });
      return { panelTop: panelBounds.top, stageTop: stage.top, titleOnCanvas: !!title?.closest('.design-panel__stage'), titleTop: title?.getBoundingClientRect().top, pickerWidth: picker?.width, controls };
    });
    assert.ok(Math.abs(geometry.stageTop - geometry.panelTop) <= 2, 'There is no document toolbar above the canvas.');
    assert.ok(geometry.titleOnCanvas && geometry.titleTop > geometry.stageTop + 48, 'The design title belongs to the canvas above its artboards.');
    assert.ok(geometry.pickerWidth <= 220, 'The artboard menu must never stretch across the workspace.');
    assert.equal(geometry.controls.length, 2);
    assert.ok(geometry.controls[0].right + 8 <= geometry.controls[1].left, 'Floating controls must not overlap.');
    assert.ok(geometry.controls.every(item => item.top >= geometry.stageTop), 'Tools float inside the canvas.');
    assert.equal(await page.getByRole('textbox', { name: 'Checkpoint name', exact: true }).isVisible(), false, 'Checkpoint creation is tucked into history.');
  };
  await assertToolbar();
  assert.equal(await page.locator('.design-panel__inspector').isVisible(), false);
  assert.equal(await page.locator('.design-tools button[aria-label="Artboard actions"]').count(), 0);
  await page.getByRole('button', { name: 'Build this', exact: true }).click();
  await page.getByRole('dialog', { name: 'Send for coding', exact: true }).waitFor({ state: 'visible' });
  assert.equal((await design({ type: 'read' })).workspace.document.revision, 1, 'Reviewing a handoff does not start coding or mutate the design.');
  await page.getByRole('dialog', { name: 'Send for coding', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Comment on this proposal', exact: true }).click();
  const proposalComment = page.getByRole('textbox', { name: 'Proposal comment', exact: true });
  await proposalComment.fill('Give the next step more emphasis.');
  assert.equal(await page.locator('.design-panel__inspector').isVisible(), false, 'Review comments do not open editing controls.');
  assert.equal(await proposalComment.evaluate(el => el === document.activeElement), true);
  await page.screenshot({ path: path.join(output, 'proposal-comment.png') });
  await page.getByRole('form', { name: 'Comment on Desktop', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await design({ type: 'read' })).workspace.document.revision, 1, 'Reviewing or cancelling a handoff and comment leaves the saved design unchanged.');
  record('Proposal review, an on-canvas comment draft and the coding handoff dialog stay separate from editing controls and do not submit work until requested.');
  await page.screenshot({ path: path.join(output, 'toolbar-sidebar.png') });
  const fitAll = async () => {
    await page.getByRole('button', { name: 'Zoom', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Fit all artboards', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Fit all artboards', exact: true }).waitFor({ state: 'hidden' });
  };
  const openArtboardActions = async () => {
    const show = page.getByRole('button', { name: 'Show inspector', exact: true });
    if (await show.isVisible()) await show.click();
    await page.getByRole('tab', { name: 'Properties', exact: true }).click();
    await page.getByRole('button', { name: 'Artboard actions', exact: true }).click();
  };
  const initialBoards = await page.locator('.design-canvas__artboard').evaluateAll(items => items.map(item => {
    const frame = item.querySelector('iframe'); const bounds = frame.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }));
  assert.equal(initialBoards.length, 2);
  assert.ok(initialBoards[1].x > initialBoards[0].x + initialBoards[0].width, 'Alternatives share one horizontal canvas.');
  assert.ok(Math.abs(initialBoards[0].y - initialBoards[1].y) < 2);
  assert.ok(Math.abs(initialBoards[0].height / initialBoards[0].width - 600 / 800) < 0.01, 'The canvas shows the complete artboard.');
  assert.ok(Math.abs(initialBoards[1].height / initialBoards[1].width - 640 / 375) < 0.01);
  await page.getByRole('button', { name: 'Edit Desktop', exact: true }).click();
  assert.equal(await page.locator('.design-canvas iframe').count(), 2, 'Focusing keeps the other directions on the canvas.');
  await page.getByRole('button', { name: 'Show inspector', exact: true }).click();
  const canvasWithInspector = await page.locator('.design-panel__stage').boundingBox();
  await page.getByRole('button', { name: 'Hide inspector', exact: true }).click();
  assert.equal(await page.locator('.design-panel__inspector').isVisible(), false);
  const canvasWithoutInspector = await page.locator('.design-panel__stage').boundingBox();
  assert.ok(canvasWithoutInspector.width * canvasWithoutInspector.height > canvasWithInspector.width * canvasWithInspector.height);
  await page.getByRole('button', { name: 'Show inspector', exact: true }).click();
  const frame = page.frameLocator('.design-panel__stage [data-active="true"] iframe');
  await page.getByRole('button', { name: 'Artboard', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Mobile', exact: true }).click();
  assert.equal(await frame.locator('#mobile-heading').textContent(), 'A second artboard');
  await page.getByRole('button', { name: 'Artboard', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Desktop', exact: true }).click();
  const peerHeading = page.frameLocator('.design-canvas iframe[title="Mobile"]').locator('#mobile-heading');
  await peerHeading.scrollIntoViewIfNeeded();
  const peerBefore = await peerHeading.boundingBox();
  await peerHeading.click();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Text"]')?.value === 'A second artboard');
  const peerAfter = await peerHeading.boundingBox();
  assert.ok(Math.abs(peerBefore.width - peerAfter.width) < 2, 'Selecting another direction must preserve the shared canvas zoom.');
  await page.getByRole('button', { name: 'Edit Desktop', exact: true }).click();
  record('Full artboards share one canvas; inspector toggling preserves drafts and cross-artboard selection preserves zoom.');
  await frame.locator('#headline').click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Written by the user');
  await page.getByRole('button', { name: 'Hide inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Show inspector', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Text', exact: true }).inputValue(), 'Written by the user', 'Toggling the inspector preserves unsaved edits.');
  await page.getByRole('textbox', { name: 'Text color', exact: true }).fill('rebeccapurple');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.design-panel')?.dataset.revision === '2');
  record('User text and style changes saved through the real shell.');
  await page.getByRole('button', { name: 'Design history', exact: true }).click();
  await page.getByRole('textbox', { name: 'Checkpoint name', exact: true }).fill('User version');
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click();
  await page.getByRole('textbox', { name: 'Checkpoint name', exact: true }).waitFor({ state: 'hidden' });
  assert.equal((await design({ type: 'read' })).workspace.checkpoints[0].title, 'User version');
  await design({ type: 'edit', expectedRevision: 2, edits: [{ type: 'text', nodeId: 'intro', text: 'Changed by the agent batch.' }, { type: 'remove', nodeId: 'obsolete' }, { type: 'insert', nodeId: 'root', node: { id: 'footer', tag: 'footer', children: [{ id: 'brand-mark', tag: 'img', attributes: { alt: 'Brand mark', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO9sAAAAASUVORK5CYII=' } }, { id: 'footer-copy', tag: 'p', text: 'A new section' }] } }] });
  await assert.rejects(design({ type: 'edit', expectedRevision: 2, edits: [{ type: 'text', nodeId: 'headline', text: 'Stale overwrite' }] }), /Stale/);
  record('A stale write was rejected after an agent batch changed a different node.');
  await page.reload();
  await page.locator('.design-panel').waitFor({ state: 'visible' });
  assert.equal(await frame.locator('#headline').textContent(), 'Written by the user');
  assert.equal(await frame.locator('#headline').evaluate(node => getComputedStyle(node).color), 'rgb(102, 51, 153)');
  assert.equal(await frame.locator('#intro').textContent(), 'Changed by the agent batch.');
  assert.equal(await frame.locator('#footer-copy').textContent(), 'A new section');
  assert.equal(await frame.locator('#obsolete').count(), 0);
  assert.equal(await frame.locator('#brand-mark').evaluate(image => image.naturalWidth), 1);
  record('Reload preserved user text/style, agent structural edits and embedded assets.');
  const isolation = await frame.locator('body').evaluate(() => {
    let parentBlocked = false; try { void parent.document.body; } catch { parentBlocked = true; }
    return { parentBlocked, app: typeof window.app, require: typeof window.require };
  });
  assert.deepEqual(isolation, { parentBlocked: true, app: 'undefined', require: 'undefined' });
  record('The opaque-origin artboard cannot read the parent or access app/Node APIs.');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await frame.locator('#toggle').click();
  await frame.locator('#details').waitFor({ state: 'visible' });
  record('Play toggled a declared interaction without document mutation.');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'workspace.png') });
  await design({ type: 'undo', expectedRevision: 3 });
  assert.equal((await design({ type: 'read' })).workspace.document.content.artboards[0].root.children[1].text, 'An initial paragraph.');
  await design({ type: 'edit', expectedRevision: 4, edits: [{ type: 'text', nodeId: 'intro', text: 'A recoverable experiment.' }] });
  await page.getByRole('button', { name: 'Design history', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Restore User version', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.design-panel')?.dataset.revision === '6');
  record('Undo and named checkpoint recovery restored the saved version with monotonic revisions.');
  const result = await design({ type: 'export', artboardId: 'desktop' });
  await writeFile(path.join(output, 'design.html'), result.html);
  await writeFile(path.join(output, 'handoff.md'), result.handoff);
  await writeFile(path.join(output, 'document.json'), JSON.stringify(result.workspace, null, 2));
  const exportPage = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await exportPage.setContent(result.html);
  assert.equal(await exportPage.locator('#headline').textContent(), 'Written by the user');
  await exportPage.locator('#toggle').click();
  await exportPage.locator('#details').waitFor({ state: 'visible' });
  await exportPage.screenshot({ path: path.join(output, 'export.png') });
  record('Self-contained HTML rendered and retained the prototype interaction.');
  await openArtboardActions();
  await page.getByRole('menuitem', { name: 'Duplicate artboard', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.design-panel')?.dataset.revision === '7');
  let explored = (await design({ type: 'read' })).workspace.document;
  const copy = explored.content.artboards[1];
  const copiedHeadline = copy.root.children[0].id;
  assert.notEqual(copiedHeadline, 'headline');
  assert.equal(await frame.locator(`#${copiedHeadline}`).textContent(), 'Written by the user');
  await openArtboardActions();
  await page.getByRole('menuitem', { name: 'Artboard settings', exact: true }).click();
  await page.getByRole('textbox', { name: 'Artboard name', exact: true }).fill('Editorial');
  await page.getByRole('textbox', { name: 'Design notes', exact: true }).fill('Clear hierarchy with room for long-form content.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await fitAll();
  await page.locator('.design-canvas').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.design-canvas iframe').count(), 3);
  await page.getByRole('button', { name: 'Edit Desktop', exact: true }).click();
  await openArtboardActions();
  await page.getByRole('menuitem', { name: 'Use this direction', exact: true }).click();
  await fitAll();
  await page.waitForFunction(() => document.querySelector('.design-panel')?.dataset.revision === '9');
  explored = (await design({ type: 'read' })).workspace.document;
  await design({ type: 'edit', expectedRevision: explored.revision, edits: [
    { type: 'text', nodeId: copiedHeadline, text: 'An independent alternative' },
    { type: 'artboard-update', artboardId: copy.id, changes: { css: 'body{margin:0;background:#fff;color:#123;font-family:serif}main{padding:32px}h1{font-size:40px}' } },
    { type: 'artboard-add', artboard: { id: 'fourth', title: 'Focused', notes: 'A single clear next step.', css: 'body{margin:0;background:#18332f;color:white;font-family:system-ui}main{padding:40px}h1{font-size:44px}', width: 800, height: 600, root: { id: 'fourth-root', tag: 'main', children: [{ id: 'fourth-heading', tag: 'h1', text: 'One clear direction' }] } } },
  ] });
  await page.reload();
  await page.locator('.design-panel__stage').waitFor({ state: 'visible' });
  await fitAll();
  assert.equal(await page.locator('.design-canvas iframe').count(), 4);
  const hideInspector = page.getByRole('button', { name: 'Hide inspector', exact: true });
  if (await hideInspector.count()) await hideInspector.click();
  await page.getByRole('button', { name: 'Zoom', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '50%', exact: true }).click();
  await page.getByRole('button', { name: 'Pan canvas', exact: true }).click();
  const canvas = page.locator('.design-panel__stage');
  const beforePan = await canvas.evaluate(el => el.scrollLeft);
  const viewport = await canvas.boundingBox();
  const panStart = beforePan > 50 ? 40 : viewport.width - 40;
  const panEnd = beforePan > 50 ? viewport.width - 40 : 40;
  await page.mouse.move(viewport.x + panStart, viewport.y + 160);
  await page.mouse.down(); await page.mouse.move(viewport.x + panEnd, viewport.y + 160, { steps: 8 }); await page.mouse.up();
  assert.ok(Math.abs(await canvas.evaluate(el => el.scrollLeft) - beforePan) > 50, 'The hand tool pans across artboards, including over their content.');
  await page.getByRole('button', { name: 'Select elements', exact: true }).click();
  await fitAll();
  await page.getByRole('button', { name: 'Show inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Expand workspace', exact: true }).click();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.design-panel__stage')?.getBoundingClientRect();
    const inspector = document.querySelector('.design-panel__inspector')?.getBoundingClientRect();
    return canvas && inspector && inspector.x >= canvas.right - 2;
  });
  await assertToolbar();
  await page.screenshot({ path: path.join(output, 'alternatives.png') });
  await page.getByRole('button', { name: 'Restore workspace width', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Desktop', exact: true }).click();
  assert.equal(await frame.locator('#headline').textContent(), 'Written by the user');
  assert.equal(await frame.locator('#headline').evaluate(node => getComputedStyle(node).color), 'rgb(102, 51, 153)');
  const alternatives = await design({ type: 'export' });
  assert.equal(alternatives.workspace.document.content.chosenArtboardId, 'desktop');
  await exportPage.setContent(alternatives.html);
  assert.equal(await exportPage.locator('iframe').count(), 4);
  const originalExport = exportPage.frameLocator('iframe[title="Desktop"]');
  const alternativeExport = exportPage.frameLocator('iframe[title="Editorial"]');
  assert.equal(await originalExport.locator('#headline').textContent(), 'Written by the user');
  assert.equal(await alternativeExport.locator(`#${copiedHeadline}`).textContent(), 'An independent alternative');
  assert.notEqual(await originalExport.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), await alternativeExport.locator('body').evaluate(node => getComputedStyle(node).backgroundColor));
  await writeFile(path.join(output, 'alternatives.html'), alternatives.html);
  await writeFile(path.join(output, 'alternatives.json'), JSON.stringify(alternatives.workspace, null, 2));
  record('Comparison, duplication, notes, chosen direction, a later agent alternative and independent export survive reload without changing manual edits.');
  if (!await page.locator('.design-layers').evaluate(element => element.open)) await page.getByText('Layers', { exact: true }).click();
  await page.getByRole('treeitem', { name: 'h1 · Written by the user', exact: true }).click();
  await page.getByRole('button', { name: 'Element actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Duplicate element', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.design-panel')?.dataset.revision === '11');
  let layered = (await design({ type: 'read' })).workspace;
  const duplicateId = layered.document.content.artboards[0].root.children.find(node => node.tag === 'h1' && node.id !== 'headline').id;
  await waitSelection(duplicateId);
  assert.notEqual(duplicateId, 'headline');
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('A duplicate edited by hand');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.design-panel')?.dataset.revision === '12');
  await page.getByRole('button', { name: 'Element actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move down', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.design-panel')?.dataset.revision === '13');
  assert.equal((await design({ type: 'read' })).workspace.document.content.artboards[0].root.children[2].id, duplicateId);
  await page.getByRole('treeitem', { name: 'main · root', exact: true }).locator('.el-tree-node__content').first().click();
  await page.getByRole('button', { name: 'Element actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add container', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.design-panel')?.dataset.revision === '14');
  layered = (await design({ type: 'read' })).workspace;
  const containerId = layered.document.content.artboards[0].root.children.find(node => node.tag === 'div').id;
  await waitSelection(containerId);
  await page.getByText('Layout', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Display', exact: true }).selectOption('flex');
  await page.getByRole('combobox', { name: 'Direction', exact: true }).selectOption('column');
  await page.getByRole('textbox', { name: 'Gap', exact: true }).fill('20px');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.design-panel')?.dataset.revision === '15');
  layered = (await design({ type: 'read' })).workspace;
  assert.equal(layered.document.content.artboards[0].root.children.find(node => node.id === containerId).text, undefined, 'A layout edit must keep an empty container able to accept children.');
  await page.getByRole('treeitem', { name: 'h1 · A duplicate edited by hand', exact: true }).click();
  await page.waitForFunction(() => { const input = document.querySelector('input[aria-label="Parent layer"]'); return input && !input.disabled && !input.closest('[inert]'); });
  await page.getByRole('combobox', { name: 'Parent layer', exact: true }).press('ArrowDown');
  await page.getByRole('option', { name: `div · ${containerId}`, exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.design-panel')?.dataset.revision === '16');
  await page.reload();
  await frame.locator(`#${containerId} > #${duplicateId}`).waitFor({ state: 'visible' });
  assert.equal(await frame.locator('#headline').textContent(), 'Written by the user');
  assert.equal(await frame.locator(`#${duplicateId}`).textContent(), 'A duplicate edited by hand');
  assert.equal(await frame.locator(`#${containerId}`).evaluate(node => getComputedStyle(node).display), 'flex');
  await page.getByRole('button', { name: 'Design history', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Undo', exact: true }).click();
  await frame.locator(`#root > #${duplicateId}`).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Design history', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Redo', exact: true }).click();
  await frame.locator(`#${containerId} > #${duplicateId}`).waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(output, 'layers.png') });
  const layersExport = await design({ type: 'export', artboardId: 'desktop' });
  await writeFile(path.join(output, 'layers.html'), layersExport.html);
  await writeFile(path.join(output, 'layers.json'), JSON.stringify(layersExport.workspace, null, 2));
  record('Layer selection, duplication, reorder, reparenting and layout edits preserve the original and survive reload, undo and redo.');
  let gestureRevision = (await design({ type: 'read' })).workspace.document.revision;
  await design({ type: 'edit', expectedRevision: gestureRevision, edits: [{ type: 'artboard-add', artboard: {
    id: 'gestures', title: 'Canvas gestures', width: 800, height: 500,
    css: 'body{margin:0;font-family:system-ui;background:#f5f1e9}main{position:relative;display:flex;gap:16px;padding:24px;height:500px}.card{width:180px;height:140px;padding:24px;background:white;border:1px solid #555}#chip{position:absolute;left:40px;top:220px;width:120px;height:56px;background:#123;color:white;padding:12px}',
    root: { id: 'gesture-root', tag: 'main', children: [
      ...['a', 'b', 'c'].map(letter => ({ id: `card-${letter}`, tag: 'section', attributes: { class: 'card' }, children: [{ id: `card-text-${letter}`, tag: 'p', text: `Card ${letter.toUpperCase()}` }] })),
      { id: 'chip', tag: 'div', text: 'Move me' },
    ] },
  } }] });
  await design({ type: 'select', artboardId: 'gestures', nodeId: null });
  const drag = async (from, to, release = true) => {
    await page.waitForFunction(() => !document.querySelector('button[data-action="play"]')?.disabled);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.waitForFunction(() => document.querySelector('button[data-action="play"]')?.disabled, undefined, { timeout: 5000 });
    if (release) await page.mouse.up();
  };
  const bounds = async id => { const rect = await frame.locator(`#${id}`).boundingBox(); assert.ok(rect); return rect; };
  const gestureState = async () => (await design({ type: 'read' })).workspace.document;
  const waitRevision = async revision => page.waitForFunction(value => document.querySelector('.design-panel')?.dataset.revision === `${value}`, revision, { timeout: 15_000 });
  await frame.locator('#card-a').waitFor({ state: 'visible' });
  const firstCard = await bounds('card-a');
  const lastCard = await bounds('card-c');
  gestureRevision = (await gestureState()).revision;
  await drag({ x: firstCard.x + 6, y: firstCard.y + 6 }, { x: lastCard.x + lastCard.width - 5, y: lastCard.y + 6 });
  await waitRevision(++gestureRevision);
  assert.deepEqual((await gestureState()).content.artboards.at(-1).root.children.map(node => node.id), ['card-b', 'card-c', 'card-a', 'chip']);
  await frame.locator('#chip').click();
  await frame.getByRole('button', { name: 'Resize width and height', exact: true }).waitFor({ state: 'visible' });
  const chip = await bounds('chip');
  const scale = chip.width / 120;
  await drag({ x: chip.x + 10, y: chip.y + 10 }, { x: chip.x + 10 + 60 * scale, y: chip.y + 10 + 40 * scale });
  await waitRevision(++gestureRevision);
  const resized = await frame.getByRole('button', { name: 'Resize width and height', exact: true }).boundingBox();
  assert.ok(resized);
  await drag({ x: resized.x + resized.width / 2, y: resized.y + resized.height / 2 }, { x: resized.x + resized.width / 2 + 60 * scale, y: resized.y + resized.height / 2 + 30 * scale });
  await waitRevision(++gestureRevision);
  let chipNode = (await gestureState()).content.artboards.at(-1).root.children.find(node => node.id === 'chip');
  for (const [key, value] of Object.entries({ left: 100, top: 260, width: 180, height: 86 })) assert.ok(Math.abs(parseFloat(chipNode.styles[key]) - value) < 2, `${key}: ${chipNode.styles[key]}`);
  let movedChip = await bounds('chip');
  await drag({ x: movedChip.x + 10, y: movedChip.y + 10 }, { x: movedChip.x + 30, y: movedChip.y + 30 }, false);
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal((await gestureState()).revision, gestureRevision, 'Cancel must not create a saved edit.');
  movedChip = await bounds('chip');
  await drag({ x: movedChip.x + 10, y: movedChip.y + 10 }, { x: movedChip.x + 10 + 40 * scale, y: movedChip.y + 10 }, false);
  await design({ type: 'edit', expectedRevision: gestureRevision, edits: [{ type: 'text', nodeId: 'card-text-b', text: 'Changed during the drag' }] });
  await waitRevision(++gestureRevision);
  assert.equal(await frame.locator('#card-text-b').textContent(), 'Card B', 'The active gesture must keep its authored frame until it is committed or cancelled.');
  await page.mouse.up();
  await page.getByRole('button', { name: 'Apply my canvas edit', exact: true }).waitFor({ state: 'visible' });
  assert.equal((await gestureState()).revision, gestureRevision, 'A stale gesture must not overwrite the agent change.');
  await page.getByRole('button', { name: 'Apply my canvas edit', exact: true }).click();
  await waitRevision(++gestureRevision);
  assert.equal(await frame.locator('#card-text-b').textContent(), 'Changed during the drag');
  await frame.locator('#card-text-b').dblclick();
  await frame.locator('#card-text-b[contenteditable="true"]').fill('Direct text edit');
  await page.locator('.design-canvas__document h2').click();
  await waitRevision(++gestureRevision);
  await page.reload();
  await frame.locator('#chip').waitFor({ state: 'visible' });
  chipNode = (await gestureState()).content.artboards.at(-1).root.children.find(node => node.id === 'chip');
  assert.ok(Math.abs(parseFloat(chipNode.styles.left) - 140) < 2);
  assert.equal(await frame.locator('#card-text-b').textContent(), 'Direct text edit');
  await design({ type: 'edit', expectedRevision: gestureRevision, edits: [{ type: 'insert', nodeId: 'gesture-root', node: { id: 'removed-during-drag', tag: 'div', text: 'Temporary', styles: { position: 'absolute', left: '300px', top: '320px', width: '160px', height: '64px' } } }] });
  await waitRevision(++gestureRevision);
  const temporary = await bounds('removed-during-drag');
  await drag({ x: temporary.x + 10, y: temporary.y + 10 }, { x: temporary.x + 40, y: temporary.y + 10 }, false);
  await design({ type: 'edit', expectedRevision: gestureRevision, edits: [{ type: 'remove', nodeId: 'removed-during-drag' }] });
  await waitRevision(++gestureRevision);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Apply my canvas edit', exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Discard draft and reload', exact: true }).click();
  await frame.locator('#removed-during-drag').waitFor({ state: 'detached' });
  await frame.locator('#card-text-b').click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(output, 'gestures.png') });
  const gestureExport = await design({ type: 'export', artboardId: 'gestures' });
  await writeFile(path.join(output, 'gestures.html'), gestureExport.html);
  await writeFile(path.join(output, 'gestures.json'), JSON.stringify(gestureExport.workspace, null, 2));
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  assert.equal(await frame.getByRole('button', { name: 'Resize width and height', exact: true }).count(), 0);
  assert.equal((await gestureState()).revision, gestureRevision);
  record('Scaled canvas drag, layout reorder, resize, cancellation, stale-gesture recovery and direct text editing persist without corrupting agent changes.');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  let flowRevision = (await gestureState()).revision;
  await design({ type: 'edit', expectedRevision: flowRevision, edits: [
    { type: 'artboard-add', artboard: { id: 'checkout', title: 'Checkout', width: 800, height: 600, css: 'body{margin:0;font:18px system-ui;background:#faf8f3;color:#222}main{padding:48px}button,input{font:inherit;padding:12px;margin:12px 0}button{display:block}', root: { id: 'checkout-root', tag: 'main', children: [
      { id: 'checkout-title', tag: 'h1', text: 'Start your workspace' },
      { id: 'customer', tag: 'input', attributes: { 'aria-label': 'Workspace name', placeholder: 'Workspace name' } },
      { id: 'continue', tag: 'button', children: [{ id: 'continue-label', tag: 'span', text: 'Continue' }] },
      { id: 'show-help', tag: 'button', text: 'Show help', interaction: { type: 'show', nodeId: 'checkout-help' } },
      { id: 'hide-help', tag: 'button', text: 'Hide help', interaction: { type: 'hide', nodeId: 'checkout-help' } },
      { id: 'checkout-help', tag: 'p', text: 'Choose a name your team recognizes.', attributes: { hidden: '' } },
    ] } } },
    { type: 'artboard-add', artboard: { id: 'confirmation', title: 'Confirmation', width: 600, height: 500, css: 'body{margin:0;font:18px system-ui;background:#e3eee9;color:#173a31}main{padding:48px}button{font:inherit;padding:12px}', root: { id: 'confirmation-root', tag: 'main', children: [
      { id: 'confirmation-title', tag: 'h1', text: 'Ready to build' },
      { id: 'go-back', tag: 'button', text: 'Back to workspace', interaction: { type: 'back' } },
    ] } } },
  ] });
  await page.getByRole('button', { name: 'Artboard', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Checkout', exact: true }).click();
  await page.locator('.design-layers').getByText('button · continue', { exact: true }).click();
  await page.getByRole('combobox', { name: 'On click', exact: true }).selectOption('navigate');
  await page.getByRole('combobox', { name: 'Interaction target', exact: true }).selectOption('confirmation');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-action="apply"]')?.disabled);
  const beforePlay = (await design({ type: 'read' })).workspace;
  await page.reload();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const checkout = page.frameLocator('iframe[title="Checkout"]');
  const confirmation = page.frameLocator('iframe[title="Confirmation"]');
  await checkout.getByRole('textbox', { name: 'Workspace name', exact: true }).fill('My team');
  await checkout.getByRole('button', { name: 'Show help', exact: true }).click();
  assert.equal(await checkout.locator('#checkout-help').isVisible(), true);
  await checkout.getByRole('button', { name: 'Hide help', exact: true }).click();
  assert.equal(await checkout.locator('#checkout-help').isVisible(), false);
  await checkout.locator('#continue-label').click();
  await confirmation.getByRole('heading', { name: 'Ready to build', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('iframe[title="Checkout"]').isVisible(), false);
  await page.screenshot({ path: path.join(output, 'prototype-flow.png') });
  await confirmation.getByRole('button', { name: 'Back to workspace', exact: true }).click();
  assert.equal(await checkout.getByRole('textbox', { name: 'Workspace name', exact: true }).inputValue(), 'My team');
  assert.deepEqual((await design({ type: 'read' })).workspace, beforePlay, 'Play navigation must not mutate saved selection or authored content.');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: 'On click', exact: true }).inputValue(), 'navigate');
  const flowExport = await design({ type: 'export', artboardId: 'checkout' });
  await writeFile(path.join(output, 'prototype-flow.html'), flowExport.html);
  await writeFile(path.join(output, 'prototype-flow.json'), JSON.stringify(flowExport.workspace, null, 2));
  const flowPage = await browser.newPage();
  await flowPage.goto(`file://${path.join(output, 'prototype-flow.html')}`);
  await flowPage.getByRole('textbox', { name: 'Workspace name', exact: true }).fill('Portable team');
  await flowPage.locator('#continue-label').click();
  await flowPage.getByRole('heading', { name: 'Ready to build', exact: true }).waitFor({ state: 'visible' });
  await flowPage.getByRole('button', { name: 'Back to workspace', exact: true }).click();
  assert.equal(await flowPage.getByRole('textbox', { name: 'Workspace name', exact: true }).inputValue(), 'Portable team');
  await flowPage.close();
  record('User-authored prototype links survive reload; Play and portable HTML navigate and go back with form state preserved without changing saved editing state.');
  let tweakRevision = (await gestureState()).revision;
  const checkoutBoard = (await gestureState()).content.artboards.find(board => board.id === 'checkout');
  await design({ type: 'edit', expectedRevision: tweakRevision, edits: [
    { type: 'artboard-update', artboardId: 'checkout', changes: { css: `${checkoutBoard.css}\n#checkout-root{padding:var(--spacing)}#continue{background:var(--accent)}` } },
    { type: 'style', nodeId: 'checkout-root', styles: { '--spacing': '24px', '--accent': '#336699' } },
    { type: 'tweak-set', tweak: { id: 'spacing', label: 'Spacing', nodeId: 'checkout-root', property: '--spacing', type: 'range', min: 8, max: 64, step: 8, unit: 'px' } },
    { type: 'tweak-set', tweak: { id: 'accent', label: 'Accent', nodeId: 'checkout-root', property: '--accent', type: 'color' } },
    { type: 'tweak-set', tweak: { id: 'weight', label: 'Weight', nodeId: 'checkout-title', property: 'font-weight', type: 'select', options: [{ label: 'Regular', value: '400' }, { label: 'Bold', value: '700' }] } },
    { type: 'tweak-set', tweak: { id: 'quiet', label: 'Quiet', nodeId: 'continue', property: 'opacity', type: 'toggle', on: '0.5', off: '1' } },
  ] });
  await waitRevision(++tweakRevision);
  await page.getByRole('tab', { name: 'Tweaks', exact: true }).click();
  const spacing = page.getByRole('slider', { name: 'Spacing', exact: true });
  await spacing.press('ArrowRight');
  await waitRevision(++tweakRevision);
  assert.equal(await spacing.inputValue(), '32', 'Arrow keys adjust the focused control without changing inspector tabs.');
  await spacing.press('Home');
  await waitRevision(++tweakRevision);
  assert.equal(await spacing.inputValue(), '8');
  await spacing.evaluate(input => { input.value = '32'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await checkout.locator('#checkout-root[style*="32px"]').waitFor({ state: 'attached' });
  assert.equal(await checkout.locator('#checkout-root').evaluate(node => getComputedStyle(node).padding), '32px', 'Dragging a control previews the authored CSS without saving intermediate revisions.');
  assert.equal((await gestureState()).revision, tweakRevision);
  await design({ type: 'edit', expectedRevision: tweakRevision, edits: [{ type: 'text', nodeId: 'checkout-title', text: 'Agent refinement' }] });
  await waitRevision(++tweakRevision);
  await spacing.dispatchEvent('change');
  await page.getByRole('button', { name: 'Apply my tweak', exact: true }).waitFor({ state: 'visible' });
  assert.equal((await gestureState()).revision, tweakRevision);
  await page.getByRole('button', { name: 'Apply my tweak', exact: true }).click();
  await waitRevision(++tweakRevision);
  await spacing.evaluate(input => { input.value = '40'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await waitRevision(++tweakRevision);
  await page.getByLabel('Accent', { exact: true }).evaluate(input => { input.value = '#663399'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await waitRevision(++tweakRevision);
  await page.getByRole('combobox', { name: 'Weight', exact: true }).selectOption('700');
  await waitRevision(++tweakRevision);
  await page.getByRole('checkbox', { name: 'Quiet', exact: true }).check();
  await waitRevision(++tweakRevision);
  await page.getByRole('button', { name: 'Design history', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Undo', exact: true }).click();
  await waitRevision(++tweakRevision);
  assert.equal(await checkout.locator('#continue').evaluate(node => getComputedStyle(node).opacity), '1');
  await page.reload();
  await page.getByRole('tab', { name: 'Tweaks', exact: true }).click();
  assert.equal(await spacing.inputValue(), '40');
  assert.equal(await checkout.locator('#checkout-title').textContent(), 'Agent refinement');
  assert.equal(await checkout.locator('#continue').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(102, 51, 153)');
  await page.screenshot({ path: path.join(output, 'tweaks.png') });
  const tweaksExport = await design({ type: 'export', artboardId: 'checkout' });
  await writeFile(path.join(output, 'tweaks.html'), tweaksExport.html);
  await writeFile(path.join(output, 'tweaks.json'), JSON.stringify(tweaksExport.workspace, null, 2));
  record('Generated controls preview live, reject concurrent stale writes, preserve agent refinements, and save chosen values through reload and undo.');
  await checkout.locator('#checkout-title').click();
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  const source = page.getByRole('region', { name: 'Design code', exact: true });
  await source.getByText(/Agent refinement/).waitFor({ state: 'visible' });
  assert.match(await source.textContent(), /font-weight:700/);
  await browser.contexts()[0].grantPermissions(['clipboard-read', 'clipboard-write']);
  await source.getByRole('button', { name: 'Copy HTML', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Copied' }).waitFor({ state: 'visible' });
  const copiedHtml = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copiedHtml, /id="checkout-title"/);
  assert.match(copiedHtml, /Agent refinement/);
  await source.getByRole('button', { name: 'Copy CSS', exact: true }).click();
  await source.getByRole('status').filter({ hasText: 'Copied CSS' }).waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), tweaksExport.workspace.document.content.artboards.find(board => board.id === 'checkout').css);
  const sourceRevision = (await gestureState()).revision;
  await design({ type: 'edit', expectedRevision: sourceRevision, edits: [{ type: 'attributes', nodeId: 'checkout-title', attributes: { title: 'A saved heading' } }] });
  await source.getByText(/title="A saved heading"/).waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(output, 'code-inspector.png') });
  record('The Code inspector follows selection and saved agent changes; copied HTML and artboard CSS preserve the authored values.');
  let positionRevision = (await gestureState()).revision;
  await design({ type: 'edit', expectedRevision: positionRevision, edits: [{ type: 'artboard-update', artboardId: 'checkout', changes: { position: { x: -1200, y: 0 } } }] });
  await waitRevision(++positionRevision);
  await page.getByRole('button', { name: 'Artboard', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Checkout', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '50%', exact: true }).click();
  const caption = page.getByRole('button', { name: 'Edit Checkout', exact: true });
  await page.locator('.design-canvas:visible').evaluate(canvas => { canvas.scrollTop = 0; canvas.scrollLeft = 0; });
  let captionBounds = await caption.boundingBox();
  await drag({ x: captionBounds.x + 30, y: captionBounds.y + captionBounds.height / 2 }, { x: captionBounds.x + 130, y: captionBounds.y + captionBounds.height / 2 + 60 });
  await waitRevision(++positionRevision);
  let positioned = (await gestureState()).content.artboards.find(board => board.id === 'checkout');
  assert.deepEqual(positioned.position, { x: -1000, y: 120 });
  await caption.and(page.locator(':enabled')).waitFor({ state: 'visible' });
  await caption.press('ArrowRight');
  await waitRevision(++positionRevision);
  assert.equal((await gestureState()).content.artboards.find(board => board.id === 'checkout').position.x, -999);
  captionBounds = await caption.boundingBox();
  await drag({ x: captionBounds.x + 30, y: captionBounds.y + captionBounds.height / 2 }, { x: captionBounds.x + 70, y: captionBounds.y + captionBounds.height / 2 + 30 }, false);
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal((await gestureState()).revision, positionRevision, 'Cancelling artboard movement must not save a revision.');
  captionBounds = await caption.boundingBox();
  await drag({ x: captionBounds.x + 30, y: captionBounds.y + captionBounds.height / 2 }, { x: captionBounds.x + 90, y: captionBounds.y + captionBounds.height / 2 + 20 }, false);
  await design({ type: 'edit', expectedRevision: positionRevision, edits: [{ type: 'text', nodeId: 'checkout-title', text: 'Agent edit during board move' }] });
  await waitRevision(++positionRevision);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Apply my canvas edit', exact: true }).click();
  await waitRevision(++positionRevision);
  positioned = (await gestureState()).content.artboards.find(board => board.id === 'checkout');
  assert.deepEqual(positioned.position, { x: -879, y: 160 });
  assert.equal(positioned.root.children.find(node => node.id === 'checkout-title').text, 'Agent edit during board move');
  await page.reload();
  assert.deepEqual((await gestureState()).content.artboards.find(board => board.id === 'checkout'), positioned);
  await openArtboardActions();
  await page.getByRole('menuitem', { name: 'Arrange in row', exact: true }).click();
  await waitRevision(++positionRevision);
  assert.ok((await gestureState()).content.artboards.every(board => board.position.y === 0));
  await page.getByRole('button', { name: 'Design history', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Undo', exact: true }).click();
  await waitRevision(++positionRevision);
  assert.deepEqual((await gestureState()).content.artboards.find(board => board.id === 'checkout').position, positioned.position);
  await fitAll();
  const fittedStage = await page.locator('.design-canvas:visible').boundingBox();
  const fittedBoards = await page.locator('.design-canvas:visible iframe').evaluateAll(frames => frames.map(frame => { const rect = frame.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; }));
  assert.ok(fittedBoards.every(board => board.left >= fittedStage.x - 1 && board.right <= fittedStage.x + fittedStage.width + 1 && board.top >= fittedStage.y && board.bottom <= fittedStage.y + fittedStage.height + 1), 'Fit all must contain every artboard even when their saved positions span a large canvas.');
  await page.screenshot({ path: path.join(output, 'artboard-positions.png') });
  await writeFile(path.join(output, 'artboard-positions.json'), JSON.stringify((await design({ type: 'read' })).workspace, null, 2));
  record('Artboards move freely at the canvas scale, support keyboard nudging and cancellation, and retain positions through conflicts, reload and undoable arrangement.');
  // Recovery must remain reachable when incoming agent edits invalidate a draft.
  let recoveryRevision = (await gestureState()).revision;
  for (const removal of ['element', 'artboard']) {
    await design({ type: 'edit', expectedRevision: recoveryRevision, edits: [{ type: 'artboard-add', artboard: { id: 'recovery', title: 'Recovery', width: 800, height: 600, root: { id: 'recovery-root', tag: 'main', children: [{ id: 'recovery-text', tag: 'h1', text: 'Saved text' }] } } }] });
    await design({ type: 'select', artboardId: 'recovery', nodeId: 'recovery-text' });
    await page.reload();
    await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Unsaved text');
    recoveryRevision++;
    await design({ type: 'edit', expectedRevision: recoveryRevision, edits: [removal === 'element' ? { type: 'remove', nodeId: 'recovery-text' } : { type: 'artboard-remove', artboardId: 'recovery' }] });
    await waitRevision(++recoveryRevision);
    const discard = page.getByRole('button', { name: 'Discard draft and reload', exact: true });
    await discard.waitFor({ state: 'visible', timeout: 3000 });
    await page.screenshot({ path: path.join(output, `removed-${removal}-draft.png`) });
    await discard.click();
    await page.getByRole('button', { name: 'Play', exact: true }).and(page.locator(':enabled')).waitFor({ state: 'visible' });
    assert.equal((await gestureState()).revision, recoveryRevision, 'Discarding an orphaned draft must not save content.');
    if (removal === 'element') {
      await design({ type: 'edit', expectedRevision: recoveryRevision, edits: [{ type: 'artboard-remove', artboardId: 'recovery' }] });
      await waitRevision(++recoveryRevision);
    }
  }
  record('Removing a dirty inspector target or its artboard keeps discard/reload reachable and unlocks editing without saving the draft.');
  await design({ type: 'select', artboardId: 'checkout', nodeId: 'checkout-root' });
  await page.reload();
  await page.getByRole('tab', { name: 'Tweaks', exact: true }).click();
  const recoveryErrors = [];
  page.on('pageerror', error => recoveryErrors.push(String(error)));
  const originalSpacing = (await gestureState()).content.tweaks.find(tweak => tweak.id === 'spacing');
  for (const replacement of [{ ...originalSpacing, max: 48 }, { ...originalSpacing, type: 'color' }]) {
    await spacing.evaluate(input => { input.value = '56'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await design({ type: 'edit', expectedRevision: recoveryRevision, edits: [{ type: 'tweak-set', tweak: replacement }] });
    await waitRevision(++recoveryRevision);
    assert.deepEqual(recoveryErrors, [], 'A changed tweak definition must not throw during rendering.');
    assert.equal(await spacing.inputValue(), '56', 'Keep the draft control and value tied to the reviewed definition.');
    await spacing.dispatchEvent('change');
    await page.getByRole('button', { name: 'Apply my tweak', exact: true }).click();
    await page.getByText('This control has changed. Discard the preview and choose a new value.', { exact: true }).waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(output, `changed-tweak-${replacement.type}.png`) });
    await page.getByRole('button', { name: 'Discard draft and reload', exact: true }).click();
    assert.equal((await gestureState()).revision, recoveryRevision);
    // Restore the definition for the next independent conflict; preserve its CSS.
    await design({ type: 'edit', expectedRevision: recoveryRevision, edits: [{ type: 'tweak-set', tweak: originalSpacing }] });
    await waitRevision(++recoveryRevision);
  }
  assert.deepEqual(recoveryErrors, []);
  await writeFile(path.join(output, 'recovery.json'), JSON.stringify((await design({ type: 'read' })).workspace, null, 2));
  record('Range and type changes retain the captured tweak preview, reject reinterpretation and allow explicit discard without rendering errors.');
  for (const removal of ['control', 'element', 'artboard']) {
    await design({ type: 'edit', expectedRevision: recoveryRevision, edits: [
      { type: 'artboard-add', artboard: { id: 'preview-recovery', title: 'Preview recovery', width: 800, height: 600, root: { id: 'preview-root', tag: 'main', children: [{ id: 'preview-target', tag: 'h1', text: 'Saved target', styles: { padding: '32px' } }] } } },
      { type: 'tweak-set', tweak: { ...originalSpacing, id: 'preview-spacing', nodeId: 'preview-target', property: 'padding' } },
    ] });
    await design({ type: 'select', artboardId: 'preview-recovery', nodeId: 'preview-target' });
    await page.reload();
    await page.getByRole('tab', { name: 'Tweaks', exact: true }).click();
    const preview = page.getByRole('slider', { name: 'Spacing', exact: true });
    await preview.evaluate(input => { input.value = '56'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    recoveryRevision++;
    const edit = removal === 'control' ? { type: 'tweak-remove', tweakId: 'preview-spacing' } : removal === 'element' ? { type: 'remove', nodeId: 'preview-target' } : { type: 'artboard-remove', artboardId: 'preview-recovery' };
    await design({ type: 'edit', expectedRevision: recoveryRevision, edits: [edit] });
    await waitRevision(++recoveryRevision);
    const discard = page.getByRole('button', { name: 'Discard draft and reload', exact: true });
    await discard.waitFor({ state: 'visible', timeout: 3000 });
    await page.screenshot({ path: path.join(output, `removed-tweak-${removal}.png`) });
    await discard.click();
    await page.getByRole('button', { name: 'Play', exact: true }).and(page.locator(':enabled')).waitFor({ state: 'visible' });
    const recovered = (await design({ type: 'read' })).workspace.document;
    assert.equal(recovered.revision, recoveryRevision, 'Discarding a removed tweak preview must not save content.');
    if (removal === 'control') assert.equal(recovered.content.artboards.find(board => board.id === 'preview-recovery').root.children[0].styles.padding, '32px');
    if (removal !== 'artboard') {
      await design({ type: 'edit', expectedRevision: recoveryRevision, edits: [{ type: 'artboard-remove', artboardId: 'preview-recovery' }] });
      await waitRevision(++recoveryRevision);
    }
  }
  assert.deepEqual(recoveryErrors, []);
  record('Removing a previewed control, its element or its artboard keeps discard reachable and unlocks editing without saving the pending value.');
  // Captions share the canvas geometry, including at sidebar overview scale.
  const geometryRevision = (await gestureState()).revision;
  const geometryBoards = ['top', 'bottom', 'right'].map((name, index) => ({
    id: `geometry-${name}`, title: `Geometry ${name}`, width: 1440, height: 900,
    position: { x: index === 2 ? 3040 : 0, y: index === 1 ? 980 : 0 },
    root: { id: `geometry-root-${name}`, tag: 'main', text: 'Software proposal' },
  }));
  await design({ type: 'edit', expectedRevision: geometryRevision, edits: geometryBoards.map(artboard => ({ type: 'artboard-add', artboard })) });
  await waitRevision(geometryRevision + 1);
  await fitAll();
  const captionGeometry = await page.locator('.design-canvas:visible').evaluate(canvas => {
    const bounds = selector => { const r = canvas.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
    return { frame: bounds('[data-artboard-id="geometry-top"] iframe'), caption: bounds('[data-artboard-id="geometry-bottom"] header') };
  });
  await writeFile(path.join(output, 'caption-geometry.json'), JSON.stringify(captionGeometry, null, 2));
  await page.screenshot({ path: path.join(output, 'caption-geometry.png') });
  assert.ok(captionGeometry.caption.y >= captionGeometry.frame.bottom, 'The second-row caption must not overlap the previous screen at overview zoom.');
  assert.ok(captionGeometry.caption.height >= 32, 'Overview captions must retain readable controls instead of shrinking with the screens.');
  await page.getByRole('button', { name: 'Artboard', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Geometry bottom', exact: true }).click();
  await page.locator('[data-artboard-id="geometry-bottom"][data-active="true"]').waitFor();
  const focusedGeometry = await page.locator('[data-artboard-id="geometry-bottom"] iframe').boundingBox();
  const geometryStage = await page.locator('.design-canvas:visible').boundingBox();
  assert.ok(focusedGeometry.y >= geometryStage.y && focusedGeometry.y + focusedGeometry.height <= geometryStage.y + geometryStage.height + 1, 'Focusing a lower screen must include its caption gutter in scrolling.');
  const savedGeometry = (await gestureState()).content.artboards.filter(board => board.id.startsWith('geometry-'));
  assert.deepEqual(savedGeometry.map(board => board.position), geometryBoards.map(board => board.position), 'Viewport gutters and focusing must not alter authored positions.');
  await design({ type: 'edit', expectedRevision: geometryRevision + 1, edits: geometryBoards.map(board => ({ type: 'artboard-remove', artboardId: board.id })) });
  await waitRevision(geometryRevision + 2);
  record('Two-row software proposals keep captions clear of previous screens at overview zoom.');
  if (live) {
    const designerId = snapshot.agents[1].id;
    console.log('Checking live provider generation in the isolated profile.');
    try {
      await invoke('design', designerId, { type: 'open', prompt: 'a desktop notification center for Korus. Explore how to organize mentions, completed work and requests for approval. Keep it quiet and compact. Include at least one useful generated tweak per direction. This is a product validation: use only the Design tools to create the result; do not edit repository files, create a goal, delegate, commit or publish. Finish the design without asking questions.' });
      let generated;
      for (let attempt = 0; attempt < 240; attempt++) {
        const state = await invoke('getSnapshot');
        const designer = state.agents.find(agent => agent.id === designerId);
        if (designer.status.type === 'error' || designer.status.type === 'awaitingInput') throw new Error(`Live generation needs attention: ${JSON.stringify(designer.status)}`);
        if (designer.designWorkspace?.document && designer.status.type === 'idle') { generated = designer.designWorkspace; break; }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      assert.ok(generated, 'Live provider did not finish a design within four minutes.');
      assert.equal(generated.document.content.artboards.length, 3, 'An open-ended brief should produce three directions.');
      assert.ok(generated.document.content.artboards.every(board => board.notes?.trim()), 'Each direction needs a concrete tradeoff.');
      assert.ok(generated.document.content.tweaks?.length >= 3, 'The provider should expose generated controls for the directions.');
      await writeFile(path.join(output, 'live-generation.json'), JSON.stringify(generated, null, 2));
      await page.getByText(snapshot.agents[1].name, { exact: true }).click();
      await page.locator('.design-canvas:visible').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Expand workspace', exact: true }).click();
      const control = generated.document.content.tweaks[0];
      const flatten = node => [node, ...(node.children ?? []).flatMap(flatten)];
      const controlBoard = generated.document.content.artboards.find(board => flatten(board.root).some(node => node.id === control.nodeId));
      await page.getByRole('button', { name: 'Artboard', exact: true }).click();
      await page.getByRole('menuitemradio', { name: controlBoard.title, exact: true }).click();
      await page.getByRole('tab', { name: 'Tweaks', exact: true }).click();
      let expectedStyle;
      if (control.type === 'range') {
        const input = page.getByRole('slider', { name: control.label, exact: true });
        await input.and(page.locator(':enabled')).waitFor({ state: 'visible' });
        const goToMin = Number(await input.inputValue()) !== control.min;
        await input.press(goToMin ? 'Home' : 'ArrowRight');
        expectedStyle = `${goToMin ? control.min : control.min + control.step}${control.unit}`;
      } else if (control.type === 'color') {
        expectedStyle = '#663399';
        await page.getByLabel(control.label, { exact: true }).evaluate(input => { input.value = '#663399'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
      } else if (control.type === 'select') {
        const input = page.getByRole('combobox', { name: control.label, exact: true });
        const selectedValue = await input.inputValue();
        const option = control.options.find(option => option.value !== selectedValue) ?? control.options[0];
        expectedStyle = option.value;
        await input.selectOption(option.value);
      } else {
        const input = page.getByRole('checkbox', { name: control.label, exact: true });
        expectedStyle = await input.isChecked() ? control.off : control.on;
        await input.click();
      }
      await page.locator(`.design-panel:visible[data-revision="${generated.document.revision + 1}"]`).waitFor({ state: 'visible' });
      const refined = (await invoke('design', designerId, { type: 'read' })).workspace;
      assert.equal(flatten(refined.document.content.artboards.find(board => board.id === controlBoard.id).root).find(node => node.id === control.nodeId).styles[control.property], expectedStyle);
      await writeFile(path.join(output, 'live-refined.json'), JSON.stringify(refined, null, 2));
      await page.screenshot({ path: path.join(output, 'live-generation.png') });
      const liveExport = await invoke('design', designerId, { type: 'export' });
      await writeFile(path.join(output, 'live-generation.html'), liveExport.html);
      record('A real provider generated three named directions with tradeoffs and controls; a generated control saved a user adjustment through the real editor.');
    } finally {
      const state = await invoke('getSnapshot');
      if (state.agents.find(agent => agent.id === designerId)?.status.type !== 'idle') await invoke('interruptAgent', designerId).catch(() => undefined);
    }
  }
  await writeFile(path.join(output, 'acceptance.json'), JSON.stringify({ passed: true, fixtureGeneration: true, liveGeneration: live, checks }, null, 2));
  await rm(path.join(output, 'failure.png'), { force: true });
  console.log(`Design acceptance passed (${checks.length} checks). Artifacts: ${output}`);
} catch (error) {
  await writeFile(path.join(output, 'acceptance.json'), JSON.stringify({ passed: false, checks, error: String(error) }, null, 2));
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  throw error;
} finally {
  socket?.close();
  await browser?.close();
  if (host && host.exitCode === null) { host.kill('SIGTERM'); await Promise.race([once(host, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]); if (host.exitCode === null) host.kill('SIGKILL'); }
  if (daemon && daemon.exitCode === null) { daemon.kill('SIGTERM'); await Promise.race([once(daemon, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]); if (daemon.exitCode === null) daemon.kill('SIGKILL'); }
  await rm(home, { recursive: true, force: true });
}
