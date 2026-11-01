// Benchmark-only compatibility patch: preserve Vitest 4's coverage surface.
// Vitest #11023's added import-binding rule also drops user assignments to
// imported member values. Remove that rule until upstream distinguishes them.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
export function patchCoverage(source) {
  const requireVue=createRequire(path.resolve(source,'vue/package.json'));
  const manifest=requireVue.resolve('@vitest/coverage-v8/package.json');
  if(JSON.parse(fs.readFileSync(manifest)).version!=='5.0.5')throw Error('Expected coverage-v8 5.0.5');
  const file=path.join(path.dirname(manifest),'dist/provider.js');
  const original=fs.readFileSync(file,'utf8');
  const hash=text=>createHash('sha256').update(text).digest('hex');
  const before=hash(original);
  if(before!=='3ead93e011c731396ec415fb542cd37859113e577a50c2845f18e5037e3939ce')throw Error('Unexpected coverage provider bytes; refusing patch');
  const start=original.indexOf('\t\t\t\t// SSR transformed import binding\n');
  const end=original.indexOf('\t\t\t\t// SSR transformed exports',start);
  if(start<0||end<start)throw Error('Expected import-binding rule not found');
  const modified=original.slice(0,start)+original.slice(end);
  fs.writeFileSync(file,modified);
  return {version:'5.0.5',file,before_sha256:before,after_sha256:hash(modified),reason:'Restore v4 import filtering; retain real imported-value assignments'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(patchCoverage(process.argv[2]||'.')));
