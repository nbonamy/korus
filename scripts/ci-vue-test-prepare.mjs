import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const variant = process.argv[2];
if (!['workers-2', 'workers-3', 'workers-4'].includes(variant)) throw new Error('Unknown worker benchmark variant');
const sha = spawnSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'});
const clean = spawnSync('git', ['diff', '--quiet']);
if (sha.status !== 0 || clean.status !== 0) throw new Error('Benchmark requires an unchanged source checkout');
fs.mkdirSync('benchmark-results', {recursive:true});
fs.writeFileSync('benchmark-results/source.json', JSON.stringify({sha:sha.stdout.trim(), root:process.cwd(), variant,
  node:process.version, lockfile_sha256:createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex'),
  logical_cpus:os.cpus().length, available_parallelism:os.availableParallelism(), memory_bytes:os.totalmem(), cpu_model:os.cpus()[0]?.model,
}, null, 2)+'\n');
