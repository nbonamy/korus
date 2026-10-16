import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkPackagedDaemon } from './packaged-daemon-check.mjs';

for (const scenario of ['missing providers', 'wrong version', 'invalid provider status', 'early exit', 'bundled Claude available', 'bundled Claude missing']) {
  test(`packaged runtime check: ${scenario}`, async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'app-daemon-smoke-'));
    try {
      const daemon = path.join(root, 'daemon.cjs');
      writeFileSync(daemon, `
        if (${JSON.stringify(scenario)} === 'early exit') process.exit(1);
        require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
          const { id } = JSON.parse(line);
          const result = id === 1 ? { ok: true, version: ${JSON.stringify(scenario === 'wrong version' ? 'old' : '1.2.3')} }
            : ${scenario === 'invalid provider status' ? '{}' : JSON.stringify(['codex', 'claude'].map(backend => ({ backend, installed: scenario === 'bundled Claude available' && backend === 'claude' })))};
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
        });
      `);
      const check = checkPackagedDaemon(process.execPath, daemon, { ...process.env, PATH: '', HOME: root }, '1.2.3', { requireClaude: scenario.startsWith('bundled Claude') });
      if (scenario === 'missing providers' || scenario === 'bundled Claude available') await check;
      else await assert.rejects(check, scenario === 'wrong version' ? /health\/version/ : scenario === 'early exit' ? /exited/ : scenario === 'bundled Claude missing' ? /Claude runtime/ : /detection status/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
