import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The experiment opts in explicitly. Builds/declaration emit continue using TS6.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(process.cwd(), 'package.json'));
const tools = createRequire(path.join(root, 'scripts/ci-tools/package.json'));
const [kind, ...args] = process.argv.slice(2);
const fast = process.env.CI_BENCH_FAST === '1';
if (!['plain', 'vue'].includes(kind) || !args.includes('--noEmit')) {
  throw new Error('Usage: ci-typecheck.mjs plain|vue --noEmit [compiler options]');
}
if (kind === 'vue') {
  process.argv.splice(2, 1);
  require('vue-tsc').run(fast
    ? tools.resolve('typescript-native-bridge/lib/tsc')
    : require.resolve('typescript/lib/tsc'));
} else {
  const executable = fast ? path.join(root, 'scripts/ci-tools/node_modules/.bin/bun') : process.execPath;
  const command = fast
    ? ['check', '--no-script', '--all', '--no-pretty', ...args.filter(arg => arg !== '--noEmit')]
    : [require.resolve('typescript/bin/tsc'), ...args];
  const result = spawnSync(executable, command, { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
