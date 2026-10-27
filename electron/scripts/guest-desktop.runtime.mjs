// Opt-in macOS development URL delivery and guest UI workflow, isolated from the installed desktop.
// Usage: node electron/scripts/guest-desktop.runtime.mjs /absolute/evidence-directory
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { build as bundle } from 'esbuild';
import { chromium } from 'playwright';
import { createDevelopmentLinkTarget } from '../../scripts/dev-link.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidence = process.argv[2]; if (!evidence || !path.isAbsolute(evidence)) throw new Error('An absolute evidence directory is required.');
if (process.platform !== 'darwin') throw new Error('Native runtime proof currently runs on macOS; Windows and Linux require their own runtime validation.');
await mkdir(evidence, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), 'korus-ticket4-runtime-')); const home = path.join(temporary, 'guest'); const ownerHome = path.join(temporary, 'owner');
let owner; let browser; let target; let debuggingPort; const observations = { platform: process.platform, fixtureOnly: true, scenarios: [], installedAppPresent: false, unverifiedEnvironments: ['Windows native OS URL delivery', 'Linux native OS URL delivery', 'Packaged application OS delivery'], versions: { node: process.version, app: JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version, electron: JSON.parse(await readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version, sdk: JSON.parse(await readFile(path.join(root, 'node_modules/@codex-app-sdk/core/package.json'), 'utf8')).version } };
async function wait(work, timeout = 30_000) { const end = Date.now() + timeout; let error; while (Date.now() < end) { try { const value = await work(); if (value) return value; } catch (e) { error = e; } await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Runtime condition timed out${error ? ': ' + error.message : ''}`); }
async function port() { const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value; }
const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
async function closeDesktop() {
  if (!browser) return;
  const pages = browser.contexts().flatMap(context => context.pages());
  const page = pages.find(page => page.url().endsWith('index.html')) ?? pages[0];
  try { await page.evaluate(() => window.app.quit()); } catch { /* The renderer closes before its reply. */ }
  try { await browser.close(); } catch { /* Already closed. */ } browser = undefined;
  if (debuggingPort) await wait(async () => { try { await fetch(`http://127.0.0.1:${debuggingPort}/json/version`); return false; } catch { return true; } }, 60_000);
}
try {
  console.log('Building isolated desktop workflow…');
  await build({ root: path.join(root, 'backend'), configFile: path.join(root, 'backend/vite.config.ts'), logLevel: 'error' });
  const shared = { ssr: { noExternal: true }, logLevel: 'error', define: { MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined', MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window') } };
  await build({ ...shared, configFile: path.join(root, 'electron/vite.main.config.ts'), build: { ssr: path.join(root, 'electron/src/main/index.ts'), outDir: path.join(root, 'electron/.vite/build'), emptyOutDir: true, rollupOptions: { external: ['electron', 'autolib'], output: { format: 'cjs', entryFileNames: 'main.js' } } } });
  await build({ ...shared, configFile: path.join(root, 'electron/vite.preload.config.ts'), build: { ssr: path.join(root, 'electron/src/preload/index.ts'), outDir: path.join(root, 'electron/.vite/build'), emptyOutDir: false, rollupOptions: { external: ['electron'], output: { format: 'cjs', entryFileNames: 'preload.js' } } } });
  await build({ configFile: path.join(root, 'electron/vite.renderer.config.ts'), logLevel: 'error', base: './' });
  const ownerScript = path.join(temporary, 'owner.mjs');
  await bundle({ entryPoints: [path.join(root, 'backend/src/companion/__tests__/desktop-guest-owner.ts')], outfile: ownerScript, platform: 'node', format: 'esm', bundle: true, banner: { js: "import {createRequire as makeRequire} from 'node:module';const require=makeRequire(import.meta.url);" } });
  owner = spawn(process.execPath, [ownerScript, ownerHome], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] }); let ownerErrors = ''; owner.stderr.on('data', data => { ownerErrors += data; });
  await wait(async () => { if (owner.exitCode !== null) throw new Error('Synthetic owner failed: ' + ownerErrors.slice(0, 1000)); return readFile(path.join(ownerHome, 'ready'), 'utf8').catch(() => false); });
  const relay = JSON.parse(await readFile(path.join(ownerHome, 'relay.json'), 'utf8')); const link = await readFile(path.join(ownerHome, 'link.txt'), 'utf8');
  const debugPort = await port(); debuggingPort = debugPort; await mkdir(home, { recursive: true });
  // No provider authentication, transcripts or repositories are copied into the guest profile.
  await copyFile(path.join(ownerHome, 'guest-state.json'), path.join(home, 'state.json'));
  target = await createDevelopmentLinkTarget({ home, electronArgs: [`--remote-debugging-port=${debugPort}`], environment: { APP_COMPANION_RELAY_URL: relay.origin, APP_COMPANION_RELAY_PEER_ID: relay.peerId } });
  try { await readFile('/Applications/Korus.app/Contents/Info.plist'); observations.installedAppPresent = true; } catch { /* Record actual environment. */ }
  const alias = `${target.scheme}:${link.slice(link.indexOf(':') + 1)}`;
  function deliver(url = alias) { const result = spawnSync('/usr/bin/open', [url], { encoding: 'utf8' }); if (result.status !== 0) throw new Error('Native URL delivery failed: ' + (result.stderr ?? '').replaceAll(url, '[share link redacted]')); }
  async function attach() {
    await wait(async () => { try { return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok; } catch { return false; } }, 60_000);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    return wait(() => browser.contexts().flatMap(context => context.pages()).find(page => page.url().endsWith('index.html')));
  }
  console.log('Delivering cold URL through Launch Services…'); deliver(); let page = await attach();
  await page.getByRole('heading', { name: 'Join conversation', exact: true }).waitFor();
  assert.equal(await page.locator('.guest-workspace').count(), 0);
  await page.getByRole('textbox', { name: 'Display name' }).waitFor();
  await page.screenshot({ path: path.join(evidence, 'guest-join.png') });
  observations.scheme = target.scheme;
  observations.scenarios.push('cold OS URL delivery before renderer readiness; provider-free join screen');
  const processSession = await browser.newBrowserCDPSession(); const before = await processSession.send('SystemInfo.getProcessInfo'); const firstPid = before.processInfo.find(process => process.type === 'browser').id;
  const launch = JSON.parse(await readFile(path.join(home, 'native-url/target.json'), 'utf8'));
  assert.equal(launch.home, home); assert.equal(launch.environment.APP_HOME, home);
  assert.equal(launch.environment.APP_BACKEND_SOCKET, path.join(home, 'daemon.sock'));
  assert.equal(launch.appPath, path.join(root, 'electron'));
  const guestCommand = execFileSync('/bin/ps', ['-p', String(firstPid), '-o', 'command='], { encoding: 'utf8' });
  assert(guestCommand.includes(`--user-data-dir=${home}/electron`), 'OS-delivered client must use the isolated guest profile.');
  assert.notEqual(firstPid, owner.pid);
  observations.profileIsolation = { ownerHome, guestHome: home, worktree: root, ownerPid: owner.pid, coldGuestPid: firstPid, verifiedGuestProcessProfile: true, separateStateDirectories: ownerHome !== home, ownerKind: 'scripted encrypted endpoint; not an owner desktop', guestKind: 'locally built Electron development client' };
  deliver(alias + '?unexpected=1'); await page.getByText('This invitation is invalid.').waitFor();
  deliver(); await page.getByRole('heading', { name: 'Join conversation', exact: true }).waitFor();
  console.log('Checking keyboard join and warm duplicate delivery…');
  // Both OS-delivered URLs and UUID invitations enter the same join flow.
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Join with invite…', exact: true }).click();
  await page.getByRole('textbox', { name: 'Invitation or share link' }).fill(await readFile(path.join(ownerHome, 'invitation.txt'), 'utf8'));
  await page.getByRole('button', { name: 'Join conversation', exact: true }).click();
  await page.getByRole('textbox', { name: 'Display name' }).waitFor();
  observations.scenarios.push('UUID invitation pasted through Join with invite; short link accepted on warm OS open');
  await page.getByRole('textbox', { name: 'Display name' }).fill('Synthetic Guest'); await page.keyboard.press('Enter');
  await page.getByText('Synthetic history from before sharing.', { exact: false }).waitFor();
  assert.equal(await page.locator('[contenteditable="true"]').count(), 1); assert.equal(await page.getByRole('button', { name: 'Share', exact: true }).count(), 0);
  deliver(); deliver(); await wait(async () => (await page.evaluate(() => window.app.guestConversationControl({ action: 'state' }))).view?.status === 'ready');
  assert.equal((await page.evaluate(() => window.app.guestConversationControl({ action: 'state' }))).entries.length, 1);
  const after = await processSession.send('SystemInfo.getProcessInfo'); assert.equal(after.processInfo.find(process => process.type === 'browser').id, firstPid);
  observations.profileIsolation.warmGuestPid = after.processInfo.find(process => process.type === 'browser').id;
  const identity = await page.evaluate(async () => (await window.app.guestConversationControl({ action: 'state' })).view.participant.identity);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async theme => { await window.app.updateSettings({ theme: { id: `app-${theme}`, mode: theme } }); }, theme);
    await page.reload(); deliver(); await page.getByText('Synthetic history from before sharing.', { exact: false }).waitFor();
    await wait(() => page.evaluate(expected => document.documentElement.dataset.effectiveAppearance === expected, theme));
    await page.screenshot({ path: path.join(evidence, `guest-${theme}.png`) });
  }
  observations.scenarios.push('keyboard join; normal conversation with text-only proposal composer; warm OS duplicate links focus same process and saved Quick Chat; light/dark screenshots');
  console.log('Checking private proposals and owner decisions…');
  await page.locator('[contenteditable="true"]').fill('Synthetic dismissed proposal'); await page.keyboard.press('Enter');
  await page.getByText('Waiting for owner approval', { exact: true }).waitFor();
  await writeFile(path.join(ownerHome, 'command'), 'dismiss'); await page.getByText('Dismissed', { exact: true }).waitFor();
  assert.equal(JSON.parse(await readFile(path.join(ownerHome, 'observation.json'), 'utf8')).admissions, 0);
  await page.locator('[contenteditable="true"]').fill('Synthetic approved proposal'); await page.keyboard.press('Enter');
  await page.getByText('Waiting for owner approval', { exact: true }).waitFor();
  await writeFile(path.join(ownerHome, 'command'), 'send'); await page.getByText('Sent to agent', { exact: true }).waitFor();
  await page.getByText('Synthetic agent response to approved proposal.', { exact: true }).waitFor();
  await wait(async () => (await page.evaluate(() => window.app.guestConversationControl({ action: 'state' }))).view?.proposalState?.authors.length === 1);
  observations.proposals = { dismissAdmissions: 0, sendAdmissions: 1, canonicalAuthorBound: true, fixtureOnly: true, ownerDecisionSurface: 'scripted owner authority; mounted owner controls covered separately' };
  await page.screenshot({ path: path.join(evidence, 'guest-approved.png') });
  console.log('Checking guest restart and shared Quick Chat…'); await closeDesktop();
  // Start the profile through its native launcher without resending the bearer link.
  execFileSync('/usr/bin/open', ['-a', target.nativePath], { stdio: 'ignore' }); page = await attach();
  const savedEntry = (await page.evaluate(() => window.app.guestConversationControl({ action: 'state' }))).entries[0];
  assert.equal(savedEntry.title, 'Synthetic conversation');
  await page.getByText('Synthetic history from before sharing.', { exact: false }).waitFor();
  assert.equal(await page.locator('[aria-label="Shared conversation"]').count() > 0, true);
  assert.equal(await page.getByRole('button', { name: 'Shared with me', exact: true }).count(), 0);
  await page.getByText('Synthetic history from before sharing.', { exact: false }).waitFor();
  assert.equal(await page.evaluate(async () => (await window.app.guestConversationControl({ action: 'state' })).view.participant.identity), identity);
  const restartedProcesses = await (await browser.newBrowserCDPSession()).send('SystemInfo.getProcessInfo');
  const restartedPid = restartedProcesses.processInfo.find(process => process.type === 'browser').id;
  assert.notEqual(restartedPid, firstPid);
  observations.profileIsolation.restartedGuestPid = restartedPid;
  observations.identityContinuity = { guestIdentitySha256: createHash('sha256').update(identity).digest('hex'), restoredAfterRestart: true };
  observations.scenarios.push('restart without original URL; shared Quick Chat reconnects with same protected identity');
  console.log('Checking local identity reset with the same active bearer…');
  await closeDesktop(); await rm(path.join(home, 'guest-joins/state.json')); deliver(); page = await attach();
  await page.getByRole('heading', { name: 'Join conversation', exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Display name' }).fill('Synthetic Guest'); await page.keyboard.press('Enter');
  await page.getByText('Synthetic history from before sharing.', { exact: false }).waitFor();
  assert.notEqual(await page.evaluate(async () => (await window.app.guestConversationControl({ action: 'state' })).view.participant.identity), identity);
  observations.identityContinuity.resetJoinsAsNewIdentity = true;
  observations.scenarios.push('local identity reset rejoins the same active link as a new app identity; malformed invitation is rejected');
  console.log('Checking disconnect, reconnect and learned revocation…');
  await writeFile(path.join(ownerHome, 'command'), 'offline'); await page.getByText('Owner unavailable · Reconnecting…').waitFor();
  assert.equal(await page.getByText('Synthetic history from before sharing.', { exact: false }).count(), 1);
  await page.screenshot({ path: path.join(evidence, 'guest-offline.png') });
  await writeFile(path.join(ownerHome, 'command'), 'online'); await page.getByText('Synthetic live update after reconnect.', { exact: true }).waitFor();
  await writeFile(path.join(ownerHome, 'command'), 'revoke'); await page.getByText('This conversation is no longer accessible.', { exact: true }).waitFor();
  assert.equal(await page.locator('.guest-transcript').count(), 0);
  assert.equal((await page.evaluate(() => window.app.guestConversationControl({ action: 'state' }))).entries.length, 1);
  assert.equal(await page.locator('#guest-invitation').count(), 0);
  observations.scenarios.push('offline retained content; automatic reconnect replaces provider baseline; revoke clears authorization/cache and retains an access-ended screen until Close');
  await page.screenshot({ path: path.join(evidence, 'guest-revoked.png') });
  await page.locator('.shared-conversation-pane').getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal((await page.evaluate(() => window.app.guestConversationControl({ action: 'state' }))).entries.length, 0);
  const saved = await readFile(path.join(home, 'guest-joins/state.json'), 'utf8'); assert(!saved.includes('#credential=')); assert(!saved.includes('Synthetic history'));
  console.log('Native desktop guest workflow passed.');
  await writeFile(path.join(evidence, 'observations.json'), JSON.stringify(observations, null, 2));
  for (const file of ['failure.png', 'failure.txt']) await rm(path.join(evidence, file), { force: true });
} catch (error) {
  const page = browser?.contexts().flatMap(context => context.pages()).find(page => page.url().endsWith('index.html'));
  if (page) {
    const state = await page.evaluate(() => window.app.guestConversationControl({ action: 'state' })).catch(() => null);
    observations.failure = { guestStatus: state?.view?.status ?? null, savedEntries: state?.entries?.length ?? null };
    await page.locator('#guest-invitation').fill('[invitation redacted]').catch(() => {});
    await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {}); await writeFile(path.join(evidence, 'failure.txt'), await page.locator('body').innerText().catch(() => 'No renderer')).catch(() => {}); }
  throw error;
} finally {
  await closeDesktop(); if (owner) { owner.kill('SIGTERM'); await new Promise(resolve => owner.exitCode !== null ? resolve() : owner.once('exit', resolve)); }
  if (target) { execFileSync(lsregister, ['-u', target.nativePath], { stdio: 'ignore' }); await rm(target.nativePath, { recursive: true, force: true }); }
  await rm(temporary, { recursive: true, force: true });
  await assert.rejects(access(temporary), { code: 'ENOENT' });
  if (target) await assert.rejects(access(target.nativePath), { code: 'ENOENT' });
  observations.cleanup = { complete: true, desktopClosed: !browser, ownerExited: !owner || owner.exitCode !== null || owner.signalCode !== null, temporaryProfilesRemoved: true, temporaryNativeHandlerRemoved: Boolean(target), productionHandlerChanged: false };
  await writeFile(path.join(evidence, 'observations.json'), JSON.stringify(observations, null, 2));
}
