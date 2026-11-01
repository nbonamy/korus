import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const reporter = fileURLToPath(new URL('./vitest-ai-reporter.ts', import.meta.url));
for (const args of [
  ['run', 'test', '--workspaces', '--', '--silent', `--reporter=${reporter}`],
  ['run', 'test:scripts'],
]) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
