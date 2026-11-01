"""Run immutable Vue sources under both toolchains on one runner, sequentially."""
import argparse,hashlib,json,os,pathlib,subprocess,sys
H=pathlib.Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('--order',choices=['v4-first','v5-first'],required=True);p.add_argument('--rep',choices=['1','2'],required=True);p.add_argument('--workers',type=int,choices=[2,4],default=4);a=p.parse_args()
root=pathlib.Path.cwd().resolve();delta=json.loads((H/'ci-vue-v5-lock-delta.json').read_text())
def output(cmd):return subprocess.check_output(cmd,text=True).strip()
def run(cmd):subprocess.run(cmd,check=True)
if output(['git','rev-parse','HEAD'])!=delta['base_sha']or output(['git','status','--porcelain','--untracked-files=no']):raise ValueError('Expected clean frozen source checkout')
files={name:(root/name).read_bytes()for name in ['vue/package.json','package-lock.json','vue/vitest.config.ts']}
if hashlib.sha256(files['package-lock.json']).hexdigest()!=delta['base_lock_sha256']:raise ValueError('Baseline lock differs')
pair=root/'benchmark-results'/f'pair-{a.order}-{a.rep}';pair.mkdir(parents=True,exist_ok=True)
state='v4'
def sample(label,folder,cmd):run([sys.executable,str(H/'ci-benchmark.py'),'run','--label',label,'--output',str(folder),'--',*cmd])
def metadata(variant):
    changed=set(output(['git','diff','--name-only']).splitlines())
    allowed=set(files)if variant=='v5-fixed'else set()
    if changed-allowed:raise ValueError('Unexpected tracked source changes: '+str(changed-allowed))
    info=json.loads(output(['node','--input-type=module','-e',"import os from 'node:os';import{createRequire}from'node:module';const r=createRequire(process.cwd()+'/vue/package.json');console.log(JSON.stringify({node:process.version,cpu_model:os.cpus()[0].model,logical_cpus:os.cpus().length,memory_bytes:os.totalmem(),vitest:r('vitest/package.json').version,coverage:r('@vitest/coverage-v8/package.json').version,vite:r('vite/package.json').version}))"]))
    expected='4.1.8'if variant=='v4'else'5.0.5'
    if info['vitest']!=expected or info['coverage']!=expected or info['vite']!='8.0.16':raise ValueError('Unexpected toolchain versions: '+str(info))
    return {**info,'sha':delta['base_sha'],'source_tree':output(['git','rev-parse','HEAD^{tree}']),'root':str(root),'variant':variant,'workers':a.workers,'pool':'vmThreads','isolate':True,'clearMocks':False,'lockfile_sha256':hashlib.sha256((root/'package-lock.json').read_bytes()).hexdigest()}
try:
    for variant in (['v4','v5-fixed']if a.order=='v4-first'else['v5-fixed','v4']):
        folder=pair/variant;folder.mkdir(exist_ok=True)
        if variant=='v5-fixed':
            lock=json.loads(files['package-lock.json']);lock['packages'].update(delta['packages'])
            for key in delta['removed']:del lock['packages'][key]
            (root/'package-lock.json').write_text(json.dumps(lock,indent=2)+'\n')
            (root/'vue/package.json').write_text(json.dumps(delta['manifest'],indent=2)+'\n')
            config=files['vue/vitest.config.ts'].decode();needle="    pool: 'vmThreads',"
            if config.count(needle)!=1:raise ValueError('Unexpected pool config')
            (root/'vue/vitest.config.ts').write_text(config.replace(needle,'    clearMocks: false,\n'+needle))
            sample('vue-v5-install',folder,['npm','ci','--no-audit','--no-fund'])
            patch=output(['node',str(H/'ci-vue-v5-coverage-fix.mjs'),str(root)]);(folder/'patch.json').write_text(patch+'\n')
            run(['node',str(H/'ci-vue-v5-mapping-probe.mjs'),str(root)])
            state='v5-fixed'
        elif state!='v4':
            for name,data in files.items():(root/name).write_bytes(data)
            sample('vue-v4-install',folder,['npm','ci','--no-audit','--no-fund']);state='v4'
        (folder/'source.json').write_text(json.dumps(metadata(variant),indent=2)+'\n')
        sample('vue-'+variant,folder,['npm','run','test:coverage','--workspace','vue','--','--maxWorkers='+str(a.workers),'--includeTaskLocation','--silent=passed-only','--reporter=default','--reporter=json','--outputFile.json='+str(folder/'tests.json'),'--coverage.reportsDirectory='+str(folder/'coverage')])
        # Compiler compatibility is an independent gate, excluded from timings.
        with(folder/'typecheck.log').open('w')as log:subprocess.run(['npm','run','typecheck','--workspace','vue'],stdout=log,stderr=subprocess.STDOUT,check=True)
finally:
    for name,data in files.items():(root/name).write_bytes(data)
    if output(['git','status','--porcelain','--untracked-files=no']):raise ValueError('Tracked checkout was not restored')
