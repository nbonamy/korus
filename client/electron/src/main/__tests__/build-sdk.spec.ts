import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('builds independent SDK repos in dependency order without replacing installed npm artifacts', () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'sdk-build-')));
  try {
    const app = path.join(root, 'app'), sdks = path.join(root, 'sdk checkouts');
    mkdirSync(path.join(app, 'scripts'), { recursive: true });
    writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'example-app', type: 'module' }));
    for (const name of ['build-sdk.mjs', 'sdk-sources.mjs']) copyFileSync(path.resolve(__dirname, '../../../../../scripts', name), path.join(app, 'scripts', name));
    const names = ['codex-sdk', 'multi-agent-sdk', 'agent-ui-sdk'];
    for (const name of names) {
      mkdirSync(path.join(sdks, name), { recursive: true });
      writeFileSync(path.join(sdks, name, 'package.json'), JSON.stringify({ name: '@korus-dev/' + name, exports: {} }));
      const installed = path.join(app, 'node_modules/@korus-dev', name);
      mkdirSync(installed, { recursive: true }); writeFileSync(path.join(installed, 'index.js'), 'published artifact');
    }
    const trace = path.join(root, 'trace.jsonl'), npm = path.join(root, 'npm cli.cjs');
    writeFileSync(npm, `require('node:fs').appendFileSync(process.env.BUILD_TRACE, JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)})+'\\n');`);
    const result = spawnSync(process.execPath, [path.join(app, 'scripts/build-sdk.mjs')], { cwd: app, encoding: 'utf8', env: { ...process.env, SDK_LOCAL_SOURCE: '1', SDK_SOURCE_ROOT: sdks, npm_execpath: npm, BUILD_TRACE: trace } });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line))).toStrictEqual(names.map(name => ({ cwd: path.join(sdks, name), args: ['run', 'build'] })));
    for (const name of names) expect(readFileSync(path.join(app, 'node_modules/@korus-dev', name, 'index.js'), 'utf8')).toBe('published artifact');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
