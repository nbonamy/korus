// Exercise the installed runner through its real coverage-report boundary.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const source = path.resolve(process.argv[2] || '.');
const requireVue = createRequire(path.join(source, 'vue/package.json'));
const vitest = requireVue.resolve('vitest/package.json');
assert.equal(JSON.parse(fs.readFileSync(vitest)).version, '5.0.5');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vue-v5-mapping-')));
try {
  fs.writeFileSync(path.join(root, 'values.js'), "export const dictionary = {good: 'present'};\n");
  fs.writeFileSync(path.join(root, 'data.json'), '{"version":"fixture-version"}');
  fs.writeFileSync(path.join(root, 'subject.js'), `import data from './data.json';
import {dictionary} from './values.js';
export const version = data.version;
export function read(key) {
  const item = dictionary[key];
  return item ?? 'missing';
}
export function never(key) {
  const missed = dictionary[key];
  return missed;
}
`);
  fs.writeFileSync(path.join(root, 'subject.test.js'), `import {test,expect} from ${JSON.stringify(path.join(path.dirname(vitest), 'dist/index.js'))};
import {version,read} from './subject.js';
test('returns imported values',()=>{expect(version).toBe('fixture-version');expect(read('good')).toBe('present');});\n`);
  fs.writeFileSync(path.join(root, 'vitest.config.mjs'), `export default {root:${JSON.stringify(root)},test:{pool:'vmThreads',maxWorkers:1,coverage:{provider:'v8',include:['subject.js'],reporter:['json'],reportsDirectory:'coverage'}}};\n`);
  const run = spawnSync(process.execPath, [path.join(path.dirname(vitest), 'vitest.mjs'), 'run', '--config',path.join(root,'vitest.config.mjs'),'--coverage'], {cwd:source, encoding:'utf8'});
  fs.writeFileSync(path.join(root,'run.log'),run.stdout+run.stderr);
  assert.equal(run.status,0,run.stdout+run.stderr);
  const data=JSON.parse(fs.readFileSync(path.join(root,'coverage/coverage-final.json')));
  const coverage=data[path.join(root,'subject.js')];
  for (const [line,covered] of [[3,true],[5,true],[9,false]]) {
    const counts=Object.entries(coverage.statementMap).filter(([,loc])=>loc.start.line===line).map(([id])=>coverage.s[id]);
    assert.ok(counts.length,`Real assignment at line ${line} disappeared from coverage; evidence: ${root}`);
    assert.equal(counts.some(n=>n>0),covered,`Wrong hit count at line ${line}`);
  }
  console.log(JSON.stringify({result:'imported assignments remain measurable, including unexecuted assignment',root}));
} catch (error) { console.error('Probe evidence:',root); throw error; }
