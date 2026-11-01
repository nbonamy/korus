import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./ci-vue-test-benchmark.py', import.meta.url));

test('Vue comparison rejects incomplete or changed test and coverage evidence', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vue-comparison-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  async function evidence(label) {
    const directory = path.join(root,label); await fs.mkdir(path.join(directory,'coverage'),{recursive:true});
    const files = {
      'source.json': {sha:'frozen-sha', root:'/runner/source', variant:label},
      [`metric-${label}.json`]: {label,exit_code:0,elapsed_seconds:10,peak_tree_rss_bytes:100,logical_cpus:4},
      'tests.json': {success:true,numTotalTests:2,numPassedTests:2,numFailedTests:0,testResults:[{name:'/runner/source/vue/a.spec.ts',assertionResults:[{fullName:'keeps event ordering',status:'passed'},{fullName:'recovers after failure',status:'passed'}]}]},
      'coverage/coverage-final.json': {'/runner/source/vue/owner.ts':{statementMap:{0:{start:{line:1,column:0},end:{line:1,column:1}}},fnMap:{},branchMap:{},s:{0:1}}},
    };
    for (const [file,value] of Object.entries(files)) await fs.writeFile(path.join(directory,file),JSON.stringify(value));
    return {directory,files};
  }
  const labels=['vue-baseline-2-1','vue-fixture-4-1'];
  const run=()=>spawnSync('python3',[script,'--input',root,...labels.flatMap(x=>['--expect',x])],{encoding:'utf8',env:{...process.env,CI_BENCH_NEEDS:'{"runs":{"result":"success"}}'}});
  await evidence(labels[0]);
  let candidate=await evidence(labels[1]);
  assert.equal(run().status,0,'complete identical evidence must pass');
  for (const [name,mutate] of [
    ['missing result',async e=>fs.rm(path.join(e.directory,`metric-${labels[1]}.json`))],
    ['failed command',async e=>{e.files[`metric-${labels[1]}.json`].exit_code=1;}],
    ['different source',async e=>{e.files['source.json'].sha='other-sha';}],
    ['dropped test',async e=>{e.files['tests.json'].testResults[0].assertionResults.pop();}],
    ['failed test',async e=>{e.files['tests.json'].success=false;}],
    ['dropped coverage file',async e=>{e.files['coverage/coverage-final.json']={};}],
    ['different instrumentation',async e=>{e.files['coverage/coverage-final.json']['/runner/source/vue/owner.ts'].statementMap[0].end.column=2;}],
    ['coverage below gate',async e=>{e.files['coverage/coverage-final.json']['/runner/source/vue/owner.ts'].s[0]=0;}],
  ]) await t.test(name,async()=>{
    candidate=await evidence(labels[1]); await mutate(candidate);
    if(name!=='missing result')for(const[file,value]of Object.entries(candidate.files))await fs.writeFile(path.join(candidate.directory,file),JSON.stringify(value));
    assert.notEqual(run().status,0,name+' must fail closed');
  });
});
