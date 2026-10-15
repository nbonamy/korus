import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('a built daemon carries only public relay settings from .env into a clean runtime', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'companion-build-'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directoryLink = process.platform === 'win32' ? 'junction' : 'dir';
  try {
    await mkdir(path.join(temp, 'backend'));
    await copyFile(path.join(root, 'backend/vite.config.ts'), path.join(temp, 'backend/vite.config.ts'));
    await copyFile(path.join(root, 'vite.sdk-aliases.ts'), path.join(temp, 'vite.sdk-aliases.ts'));
    for (const name of ['core', 'node_modules']) await symlink(path.join(root, name), path.join(temp, name), directoryLink);
    const secret = 'BUILD_SECRET_CANARY_DO_NOT_SHIP_81524';
    await writeFile(path.join(temp, '.env'), `APP_COMPANION_RELAY_URL=wss://packaged.example\nAPP_COMPANION_RELAY_PEER_ID=12D3KooWKgzKeaxarcdmiyzTLSu2fmxxY6Nkj4CZKfvQGspLMG5S\nAPPLE_PASSWORD=${secret}\nAPP_COMPANION_APNS_PRIVATE_KEY=${secret}\n`);
    const manager = pathToFileURL(path.join(root, 'backend/src/companion/manager.ts')).href;
    const entry = path.join(temp, 'backend/probe.mjs');
    await writeFile(entry, `import { CompanionManager } from ${JSON.stringify(manager)};
const manager = new CompanionManager(process.argv[2], { request: async () => { throw new Error('Unexpected backend access'); } });
try { const { status } = await manager.control({ action: 'status' }); console.log(JSON.stringify({ configured: status.configured, relayOrigin: status.relayOrigin })); }
finally { await manager.stop(); }
`);
    await writeFile(path.join(temp, 'build.mjs'), `import { build } from 'vite';
await build({ configFile: ${JSON.stringify(path.join(temp, 'backend/vite.config.ts'))}, logLevel: 'silent', build: { ssr: ${JSON.stringify(entry)}, outDir: ${JSON.stringify(path.join(temp, 'dist'))}, sourcemap: false } });
`);
    const env = { ...process.env, CODEX_APP_SDK_SOURCE: '0' };
    delete env.APP_COMPANION_RELAY_URL;
    delete env.APP_COMPANION_RELAY_PEER_ID;
    const run = (args, cwd) => {
      const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    run([path.join(temp, 'build.mjs')], temp);
    const bundle = path.join(temp, 'dist/daemon.mjs');
    assert.equal((await readFile(bundle, 'utf8')).includes(secret), false, 'Private .env values must not enter the bundle');
    assert.deepEqual(JSON.parse(run([bundle, path.join(temp, 'state')], os.tmpdir())), { configured: true, relayOrigin: 'wss://packaged.example' });
  } finally { await rm(temp, { recursive: true, force: true }); }
});
