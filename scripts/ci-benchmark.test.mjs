import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const runner = path.join(import.meta.dirname, 'ci-benchmark.py');
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci-benchmark-'));
  return { dir, close: () => rmSync(dir, { recursive: true, force: true }) };
}
test('benchmark records process-tree memory and preserves a failing command outcome', () => {
  const f = fixture();
  try {
    const result = spawnSync('python3', [runner, 'run', '--label', 'probe', '--output', f.dir, '--', process.execPath, '-e', "const child=require('child_process').spawn(process.execPath,['-e','const b=Buffer.alloc(32*1024*1024,1);setTimeout(()=>console.log(b[0]),500)'],{stdio:'inherit'});child.on('exit',()=>process.exit(7))"], { encoding: 'utf8' });
    assert.equal(result.status, 7, result.stderr);
    const metric = JSON.parse(readFileSync(path.join(f.dir, 'metric-probe.json'), 'utf8'));
    assert.equal(metric.exit_code, 7);
    assert.ok(metric.peak_processes >= 2);
    assert.ok(metric.peak_tree_rss_bytes > 32 * 1024 * 1024);
    assert.match(readFileSync(path.join(f.dir, 'probe.log'), 'utf8'), /1/);
  } finally { f.close(); }
});
test('benchmark retains timeout evidence and stops the command', () => {
  const f = fixture();
  try {
    const result = spawnSync('python3', [runner, 'run', '--label', 'timeout', '--output', f.dir, '--timeout', '0.3', '--', process.execPath, '-e', 'setInterval(()=>{},1000)'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(readFileSync(path.join(f.dir, 'metric-timeout.json'), 'utf8')).timed_out, true);
  } finally { f.close(); }
});
test('benchmark retains native node:test suite counts alongside Vitest inventories', () => {
  const f = fixture();
  try {
    const file = path.join(f.dir, 'runtime.test.mjs');
    writeFileSync(file, "import { test } from 'node:test'; test('real runtime probe', () => {});\n");
    const script = "console.log('> @fixture/workspace@1.0.0 test');const r=require('child_process').spawnSync(process.execPath,['--test',process.argv[1]],{stdio:'inherit'});process.exit(r.status)";
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync('python3', [runner, 'run', '--label', 'inventory', '--output', f.dir, '--', process.execPath, '-e', script, file], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    const metric = JSON.parse(readFileSync(path.join(f.dir, 'metric-inventory.json'), 'utf8'));
    assert.deepEqual(metric.tests['@fixture/workspace'], { total: 1, passed: 1, failed: 0, skipped: 0, todo: 0 });
  } finally { f.close(); }
});
test('aggregate requires every expected successful metric and rejects skipped jobs', () => {
  const f = fixture();
  const run = () => spawnSync('python3', [runner, 'aggregate', '--input', f.dir, '--expect', 'core', '--expect', 'vue'], { encoding: 'utf8', env: { ...process.env, CI_BENCH_NEEDS: JSON.stringify({ tests: { result: 'success' } }) } });
  try {
    writeFileSync(path.join(f.dir, 'metric-core.json'), JSON.stringify({ label: 'core', exit_code: 0 }));
    assert.notEqual(run().status, 0);
    writeFileSync(path.join(f.dir, 'metric-vue.json'), JSON.stringify({ label: 'vue', exit_code: 1 }));
    assert.notEqual(run().status, 0);
    writeFileSync(path.join(f.dir, 'metric-vue.json'), JSON.stringify({ label: 'vue', exit_code: 0 }));
    assert.equal(run().status, 0);
    const skipped = spawnSync('python3', [runner, 'aggregate', '--input', f.dir, '--expect', 'core'], { encoding: 'utf8', env: { ...process.env, CI_BENCH_NEEDS: '{"tests":{"result":"skipped"}}' } });
    assert.notEqual(skipped.status, 0);
  } finally { f.close(); }
});
test('benchmark retains coverage entries outside the checkout without dropping the measured surface', () => {
  const f = fixture();
  try {
    const root = realpathSync(f.dir);
    mkdirSync(path.join(root, 'core/coverage'), { recursive: true });
    const external = path.join(path.dirname(root), 'borrowed.ts');
    writeFileSync(path.join(root, 'core/coverage/coverage-final.json'), JSON.stringify({ [external]: { s: { 0: 1, 1: 0 } } }));
    const result = spawnSync('python3', [runner, 'run', '--label', 'coverage', '--output', root, '--', process.execPath, '-e', 'process.exit(0)'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const metric = JSON.parse(readFileSync(path.join(root, 'metric-coverage.json'), 'utf8'));
    assert.deepEqual(metric.coverage_surface.core, ['../borrowed.ts']);
    assert.deepEqual(metric.statement_counts.core, { covered: 1, total: 2 });
  } finally { f.close(); }
});
test('script-test totals do not overwrite the final workspace inventory', () => {
  const f = fixture();
  try {
    const file = path.join(f.dir, 'script.test.mjs');
    writeFileSync(file, "import { test } from 'node:test'; test('script probe', () => {});\n");
    const script = "console.log('> @fixture/mobile@1.0.0 test:coverage\\nTests 7 passed (7)\\n> fixture-root@1.0.0 test:scripts');const r=require('child_process').spawnSync(process.execPath,['--test',process.argv[1]],{stdio:'inherit'});process.exit(r.status)";
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync('python3', [runner, 'run', '--label', 'separate', '--output', f.dir, '--', process.execPath, '-e', script, file], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    const metric = JSON.parse(readFileSync(path.join(f.dir, 'metric-separate.json'), 'utf8'));
    assert.deepEqual(metric.tests['@fixture/mobile'], { passed: 7 });
    assert.equal(metric.tests['fixture-root:test:scripts'].total, 1);
  } finally { f.close(); }
});
test('comparison rejects dropped product tests and smaller coverage surfaces', () => {
  const f = fixture();
  try {
    const metric = { exit_code: 0, tests: { '@fixture/core': { passed: 7 } }, coverage_surface: { core: ['src/a.ts'] } };
    const write = (label, value) => writeFileSync(path.join(f.dir, `metric-${label}.json`), JSON.stringify({ label, ...value }));
    const run = () => spawnSync('python3', [runner, 'compare', '--input', f.dir], { encoding: 'utf8' });
    write('baseline-quality', metric); write('optimized-coverage-core', metric);
    assert.equal(run().status, 0);
    write('optimized-coverage-core', { ...metric, tests: { '@fixture/core': { passed: 6 } } });
    assert.notEqual(run().status, 0);
    write('optimized-coverage-core', { ...metric, coverage_surface: { core: [] } });
    assert.notEqual(run().status, 0);
  } finally { f.close(); }
});
