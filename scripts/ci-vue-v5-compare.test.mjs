import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('./ci-vue-v5-compare.py',import.meta.url));
test('paired runner comparison retains every baseline coverage location and test',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vue-v5-comparison-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const loc={start:{line:1,column:0},end:{line:1,column:12}};
 const original={statementMap:{0:loc},fnMap:{0:{name:'fn',decl:loc,loc,line:1}},branchMap:{0:{type:'if',loc,locations:[loc],line:1}},s:{0:1}};
 const titleMap=path.join(root,'titles.json');await fs.writeFile(titleMap,'[]');
 async function evidence(){
  const files={};
  for(const version of ['v4','v5-fixed']) {
   const coverage=structuredClone(original);
   if(version==='v5-fixed'){coverage.statementMap[1]={start:{line:2,column:0},end:{line:2,column:4}};coverage.s[1]=1;coverage.fnMap[0].name='renamed-generated-name';}
   files[version]={
    'source.json':{sha:'frozen',root:'/runner/source',source_tree:'tree',variant:version,workers:4,node:'v26.12.1',cpu_model:'cpu',pool:'vmThreads',isolate:true,clearMocks:false},
    [`metric-vue-${version}.json`]:{exit_code:0,elapsed_seconds:10,peak_tree_rss_bytes:100},
    'tests.json':{success:true,numFailedTests:0,testResults:[{name:'/runner/source/vue/a.spec.ts',assertionResults:[{fullName:'returns values',status:'passed',location:{line:3,column:1}}]}]},
    'coverage/coverage-final.json':{'/runner/source/vue/owner.ts':coverage},
   };
  }
  return files;
 }
 async function write(files){for(const[version,entries]of Object.entries(files))for(const[name,data]of Object.entries(entries)){const file=path.join(root,'pair-a',version,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(data));}}
 const run=()=>spawnSync('python3',[cli,'--input',root,'--expect','pair-a','--title-map',titleMap],{encoding:'utf8',env:{...process.env,CI_BENCH_NEEDS:'{"pairs":{"result":"success"}}'}});
 await write(await evidence());assert.equal(run().status,0,'coverage superset must pass');
 for(const[name,mutate]of[
  ['dropped statement',d=>delete d['coverage/coverage-final.json']['/runner/source/vue/owner.ts'].statementMap[0]],
  ['dropped function',d=>d['coverage/coverage-final.json']['/runner/source/vue/owner.ts'].fnMap={}],
  ['dropped branch',d=>d['coverage/coverage-final.json']['/runner/source/vue/owner.ts'].branchMap={}],
  ['dropped coverage file',d=>d['coverage/coverage-final.json']={}],
  ['changed test',d=>d['tests.json'].testResults[0].assertionResults[0].fullName='other'],
  ['dropped test',d=>d['tests.json'].testResults[0].assertionResults=[]],
  ['changed test location',d=>d['tests.json'].testResults[0].assertionResults[0].location.line=99],
  ['changed source',d=>d['source.json'].sha='different'],
  ['lost isolation',d=>d['source.json'].isolate=false],
  ['failed command',d=>d['metric-vue-v5-fixed.json'].exit_code=1],
  ['coverage below gate',d=>d['coverage/coverage-final.json']['/runner/source/vue/owner.ts'].s={0:0,1:0}],
 ])await t.test(name,async()=>{const d=await evidence();mutate(d['v5-fixed']);await write(d);assert.notEqual(run().status,0,name+' must fail');});
});
