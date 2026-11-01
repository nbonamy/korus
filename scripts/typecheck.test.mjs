import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./typecheck.mjs', import.meta.url));
const repo = path.resolve(path.dirname(script), '..');
test('normal and reference checkers reject real TS and Vue template errors', async (t) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'typecheck-contract-')),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
  fs.symlinkSync(
    path.join(repo, 'node_modules'),
    path.join(root, 'node_modules'),
    'junction',
  );
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        types: [],
        skipLibCheck: true,
        noEmit: true,
      },
      include: ['*.ts', '*.vue'],
    }),
  );
  for (const kind of ['plain', 'vue'])
    await t.test(kind, () => {
      const file = path.join(root, kind === 'plain' ? 'probe.ts' : 'Probe.vue');
      const valid =
        kind === 'plain'
          ? 'export const value: number = 1;'
          : '<script setup lang="ts">const value = 1;</script><template>{{ value.toFixed(1) }}</template>';
      const invalid =
        kind === 'plain'
          ? "export const value: number = 'bad';"
          : '<script setup lang="ts">const value = 1;</script><template>{{ value.missing() }}</template>';
      for (const compiler of ['native', 'stock']) {
        const env = { ...process.env, TYPECHECK_COMPILER: compiler };
        delete env.NODE_TEST_CONTEXT;
        const run = () =>
          spawnSync(
            process.execPath,
            [script, kind, '--noEmit', '--pretty', 'false'],
            { cwd: root, env, encoding: 'utf8' },
          );
        fs.writeFileSync(file, valid);
        let result = run();
        assert.equal(result.status, 0, result.stdout + result.stderr);
        fs.writeFileSync(file, invalid);
        result = run();
        assert.notEqual(result.status, 0, 'type errors must block ' + compiler);
        assert.match(
          result.stdout + result.stderr,
          kind === 'plain' ? /2322/ : /2339/,
        );
      }
      fs.rmSync(file);
    });
  const emit = spawnSync(process.execPath, [script, 'plain', '--declaration'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.notEqual(
    emit.status,
    0,
    'emitting builds must stay on the reference compiler',
  );
});
