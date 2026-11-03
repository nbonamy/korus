import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('a built daemon carries only public connection settings and preserves telemetry runtime overrides', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'companion-build-'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directoryLink = process.platform === 'win32' ? 'junction' : 'dir';
  try {
    await mkdir(path.join(temp, 'client/backend'), { recursive: true });
    await mkdir(path.join(temp, 'client/electron/assets/viz'), {recursive:true});
    await copyFile(path.join(root, 'client/electron/assets/viz/reference.png'), path.join(temp, 'client/electron/assets/viz/reference.png'));
    await copyFile(path.join(root, 'client/backend/vite.config.ts'), path.join(temp, 'client/backend/vite.config.ts'));
    await copyFile(path.join(root, 'vite.sdk-aliases.ts'), path.join(temp, 'vite.sdk-aliases.ts'));
    for (const name of ['core', 'node_modules']) await symlink(path.join(root, name), path.join(temp, name), directoryLink);
    const secret = 'BUILD_SECRET_CANARY_DO_NOT_SHIP_81524';
    await writeFile(path.join(temp, '.env'), `APP_COMPANION_RELAY_URL=wss://packaged.example\nAPP_COMPANION_RELAY_PEER_ID=12D3KooWKgzKeaxarcdmiyzTLSu2fmxxY6Nkj4CZKfvQGspLMG5S\nAPPLE_PASSWORD=${secret}\nAPP_COMPANION_APNS_PRIVATE_KEY=${secret}\nAPP_TELEMETRY_ENDPOINT=https://packaged.example/v1/telemetry/daily\n`);
    const manager = pathToFileURL(path.join(root, 'client/backend/src/companion/manager.ts')).href;
    const runtimeConfig = pathToFileURL(path.join(root, 'client/backend/src/runtime-config.ts')).href;
    const entry = path.join(temp, 'client/backend/probe.mjs');
    await writeFile(entry, `import { CompanionManager } from ${JSON.stringify(manager)};
import { configuredTelemetryEndpoint } from ${JSON.stringify(runtimeConfig)};
const manager = new CompanionManager(process.argv[2], { request: async () => { throw new Error('Unexpected backend access'); } });
try { const { status } = await manager.control({ action: 'status' }); console.log(JSON.stringify({ configured: status.configured, relayOrigin: status.relayOrigin, telemetryEndpoint: configuredTelemetryEndpoint(process.env.APP_TELEMETRY_ENDPOINT) ?? null })); }
finally { await manager.stop(); }
`);
    await writeFile(path.join(temp, 'build.mjs'), `import { build } from 'vite';
await build({ configFile: ${JSON.stringify(path.join(temp, 'client/backend/vite.config.ts'))}, logLevel: 'silent', build: { ssr: ${JSON.stringify(entry)}, outDir: ${JSON.stringify(path.join(temp, 'dist'))}, sourcemap: false } });
`);
    const env = { ...process.env, CODEX_APP_SDK_SOURCE: '0' };
    delete env.APP_COMPANION_RELAY_URL;
    delete env.APP_COMPANION_RELAY_PEER_ID;
    delete env.APP_TELEMETRY_ENDPOINT;
    const run = (args, cwd, overrides = {}) => {
      const result = spawnSync(process.execPath, args, { cwd, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    run([path.join(temp, 'build.mjs')], temp);
    const bundle = path.join(temp, 'dist/daemon.mjs');
    assert.equal((await readFile(bundle, 'utf8')).includes(secret), false, 'Private .env values must not enter the bundle');
    assert.deepEqual(JSON.parse(run([bundle, path.join(temp, 'state')], os.tmpdir())), { configured: true, relayOrigin: 'wss://packaged.example', telemetryEndpoint: 'https://packaged.example/v1/telemetry/daily' });
    for (const override of [' https://runtime.example/v1/telemetry/daily ', '']) {
      assert.equal(JSON.parse(run([bundle, path.join(temp, 'state')], os.tmpdir(), { APP_TELEMETRY_ENDPOINT: override })).telemetryEndpoint, override.trim());
    }
    run([path.join(temp, 'build.mjs')], temp, { APP_TELEMETRY_ENDPOINT: 'https://release.example/v1/telemetry/daily' });
    assert.equal(JSON.parse(run([bundle, path.join(temp, 'state')], os.tmpdir())).telemetryEndpoint, 'https://release.example/v1/telemetry/daily');
    await writeFile(path.join(temp, '.env'), '');
    run([path.join(temp, 'build.mjs')], temp);
    assert.equal(JSON.parse(run([bundle, path.join(temp, 'state')], os.tmpdir())).telemetryEndpoint, null);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
