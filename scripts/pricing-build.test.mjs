import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('standalone and desktop resource bundles load the checked-in pricing catalog offline', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const temp = await mkdtemp(path.join(os.tmpdir(), 'pricing-build-'));
  try {
    await mkdir(path.join(temp, 'backend'), { recursive: true });
    await mkdir(path.join(temp, 'scripts'));
    for (const name of ['core', 'node_modules']) {
      await symlink(path.join(root, name), path.join(temp, name), process.platform === 'win32' ? 'junction' : 'dir');
    }
    await copyFile(path.join(root, 'scripts/package-backend.mjs'), path.join(temp, 'scripts/package-backend.mjs'));
    await writeFile(path.join(temp, 'offline.mjs'), `
import http from 'node:http'; import https from 'node:https'; import net from 'node:net';
const fail = () => { throw new Error('Network is disabled'); };
globalThis.fetch = fail; http.request = fail; https.request = fail; net.connect = fail; net.createConnection = fail;
`);
    const config = path.join(root, 'backend/vite.config.ts');
    await writeFile(path.join(temp, 'build.mjs'), `import { build } from 'vite';
await build({ configFile: ${JSON.stringify(config)}, logLevel: 'silent', build: { outDir: ${JSON.stringify(path.join(temp, 'backend/dist'))}, sourcemap: false } });
`);
    const run = (args, options = {}) => {
      const result = spawnSync(process.execPath, ['--import', path.join(temp, 'offline.mjs'), ...args], {
        cwd: temp, env: { ...process.env, CODEX_APP_SDK_SOURCE: '0' }, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024, ...options,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    run([path.join(temp, 'build.mjs')]);
    run([path.join(temp, 'scripts/package-backend.mjs')]);
    const results = [];
    const expected = JSON.parse(await readFile(path.join(root, 'backend/src/pricing/history.json'), 'utf8'));
    for (const bundle of ['backend/dist/daemon.mjs', 'electron/resources/daemon/daemon.mjs']) {
      const url = pathToFileURL(path.join(temp, bundle)).href;
      const output = run(['--input-type=module', '-e', `
const { loadPricingHistory } = await import(${JSON.stringify(url)});
const history = loadPricingHistory();
console.log(JSON.stringify(history));
`]);
      const history = JSON.parse(output);
      assert.equal(history[0].date, '2026-10-01T00:00:00.000Z');
      assert.deepEqual(history, expected);
      results.push(history);
      const home = path.join(temp, 'state', String(results.length));
      await mkdir(home, { recursive: true });
      const db = new DatabaseSync(path.join(home, 'usage.sqlite'));
      const at = Date.now();
      const observation = {
        provider: 'codex', sessionId: 's', turnId: 't', agentId: 'a', requestId: 'r', revision: 0, status: 'final', at,
        apiProvider: 'openai', model: 'gpt-6-sol', modality: 'text', cacheMode: 'implicit',
        requestedServiceTier: 'priority', reportedServiceTier: 'standard', reportedMode: null, pricingContext: { context: 1000, region: null },
        tokens: { input: 1000, output: 100, cacheRead: 0, cacheWrite: {}, reasoning: 0, inputIncludesCacheRead: true, inputIncludesCacheWrite: true, outputIncludesReasoning: true },
      };
      try {
        db.exec('CREATE TABLE executions(provider TEXT,session_id TEXT,turn_id TEXT,agent_id TEXT,model TEXT,reasoning_effort TEXT,service_tier TEXT,team_id TEXT,repository TEXT,phase TEXT,started_at INTEGER,updated_at INTEGER,duration_ms INTEGER,tokens TEXT,timing TEXT,request_coverage TEXT,PRIMARY KEY(provider,session_id,turn_id)); CREATE TABLE requests(provider TEXT,session_id TEXT,turn_id TEXT,request_id TEXT,at INTEGER,revision INTEGER,status TEXT,observation TEXT,PRIMARY KEY(provider,session_id,turn_id,request_id));');
        db.prepare('INSERT INTO executions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('codex', 's', 't', 'a', 'gpt-6-sol', null, null, null, null, 'completed', at, at, null, null, null, 'complete');
        db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?)').run('codex', 's', 't', 'r', at, 0, 'final', JSON.stringify(observation));
      } finally { db.close(); }
      const response = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', path.join(temp, 'offline.mjs'), '--input-type=module', '-e', `const { main } = await import(${JSON.stringify(url)}); await main(['--stdio']);`], {
          cwd: temp, env: { ...process.env, APP_HOME: home, CODEX_APP_SDK_SOURCE: '0' }, stdio: ['pipe', 'pipe', 'pipe'],
        });
        let buffer = '', stderr = '', result;
        const deadline = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Offline usage RPC timed out: ' + stderr)); }, 30_000);
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.stdout.on('data', chunk => {
          buffer += chunk;
          while (buffer.includes('\n')) {
            const index = buffer.indexOf('\n'), line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
            const message = JSON.parse(line);
            if (message.id === 1) { result = message; child.stdin.end(); }
          }
        });
        child.once('error', error => { clearTimeout(deadline); reject(error); });
        child.once('exit', code => {
          clearTimeout(deadline);
          if (code !== 0 || !result) reject(new Error('Offline usage RPC failed: ' + stderr));
          else resolve(result);
        });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'usage/get', params: {} }) + '\n');
      });
      assert.deepEqual(response.result.cost, { usd: .003, coverage: 'complete', requests: 1, pricedRequests: 1, unpricedRequests: 0, unknownRequestExecutions: 0, reasons: [] });

    }
    assert.deepEqual(results[0], results[1]);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
