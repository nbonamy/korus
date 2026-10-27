import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createDevelopmentLinkTarget } from './dev-link.mjs';

// The native handler must identify one worktree/profile and preserve the URL as
// one argument, without shell interpretation or stealing the installed scheme.
test('a native development target launches its fixed app/profile with the URL intact', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-link-workflow-'));
  try {
    const root = path.join(directory, 'work tree'); const home = path.join(directory, 'guest profile');
    await mkdir(root, { recursive: true });
    const executable = path.join(directory, 'fake-electron.mjs'); const observed = path.join(directory, 'observed.json');
    await writeFile(executable, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(observed)},JSON.stringify({argv:process.argv.slice(2),home:process.env.APP_HOME,scheme:process.env.APP_DEV_PROTOCOL_SCHEME,backend:process.env.APP_BACKEND_ARGS}));`);
    const commands = []; const run = (exe, args) => commands.push([exe, args]);
    const options = { root, home, directory: path.join(directory, 'native'), executable: process.execPath, appPath: executable, run, platform: 'win32' };
    const target = await createDevelopmentLinkTarget(options);
    const same = await createDevelopmentLinkTarget(options); assert.equal(same.scheme, target.scheme);
    const other = await createDevelopmentLinkTarget({ ...options, home: path.join(directory, 'other'), directory: path.join(directory, 'other-native') }); assert.notEqual(target.scheme, other.scheme);
    assert.match(target.scheme, /^korus-dev-[a-f0-9]{12}$/);
    assert.equal(commands[0][0], 'reg.exe'); assert.equal(commands[0][1][1], `HKCU\\Software\\Classes\\${target.scheme}`);
    const link = `${target.scheme}://share?v=1&synthetic=spaces%20and%20%26%22#credential=REDACTED`;
    execFileSync(process.execPath, [target.launcher, link], { env: { ...process.env, APP_HOME: 'WRONG', APP_BACKEND_ARGS: 'WRONG', ELECTRON_RUN_AS_NODE: '1', APP_DEV_LINK_TEST_WAIT: '1' } });
    const actual = JSON.parse(await readFile(observed, 'utf8'));
    assert.deepEqual(actual, { argv: [`--user-data-dir=${path.join(home, 'electron')}`, link], home, scheme: target.scheme, backend: `${path.join(root, 'backend/dist/daemon.mjs')},--stdio` });
    await assert.rejects(() => createDevelopmentLinkTarget({ ...options, home: '' }), /profile/);
    await createDevelopmentLinkTarget({ ...options, platform: 'linux', environment: { XDG_DATA_HOME: path.join(directory, 'xdg') } });
    assert(commands.some(([exe, args]) => exe === 'xdg-mime' && args.includes(`x-scheme-handler/${target.scheme}`)));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
