import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceTypecheck } from './sdk-sources.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(process.cwd(), 'package.json'));
const tools = createRequire(
  path.join(root, 'scripts/typecheck-tools/package.json'),
);
const [kind, ...originalArgs] = process.argv.slice(2);
const selected = kind === 'stock' ? { args: originalArgs, cleanup() {} } : sourceTypecheck(root, originalArgs);
const args = selected.args;
process.on('exit', selected.cleanup);
function execute(command, parameters, env = process.env) {
  const result = spawnSync(command, parameters, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
if (kind === 'stock') {
  if (!process.env.npm_execpath || args.length)
    throw new Error('Use npm run typecheck:stock');
  execute(process.execPath, [process.env.npm_execpath, 'run', 'typecheck'], {
    ...process.env,
    TYPECHECK_COMPILER: 'stock',
  });
} else {
  if (!['plain', 'vue'].includes(kind) || !args.includes('--noEmit')) {
    throw new Error(
      'Usage: typecheck.mjs plain|vue --noEmit [compiler options]',
    );
  }
  const stock = process.env.TYPECHECK_COMPILER === 'stock';
  if (kind === 'vue') {
    process.argv.splice(2, process.argv.length - 2, ...args);
    require('vue-tsc').run(
      stock
        ? require.resolve('typescript/lib/tsc')
        : tools.resolve('typescript-native-bridge/lib/tsc'),
    );
  } else if (stock) {
    execute(process.execPath, [require.resolve('typescript/bin/tsc'), ...args]);
  } else {
    const bun = path.join(
      path.dirname(tools.resolve('bun/package.json')),
      'bin/bun.exe',
    );
    execute(bun, [
      'check',
      '--no-script',
      '--all',
      '--no-pretty',
      ...args.filter((arg) => arg !== '--noEmit'),
    ]);
  }
}
