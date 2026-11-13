import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sdkSources } from './sdk-sources.mjs';
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const selected = sdkSources(projectRoot);
if (!selected.enabled) {
  console.log('[build:sdk] using installed npm SDK packages.');
} else {
  for (const folder of ['codex-sdk', 'multi-agent-sdk', 'agent-ui-sdk']) {
    const cwd = path.join(selected.root, folder);
    const npmCli = process.env.npm_execpath;
    const result = spawnSync(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, 'run', 'build'] : ['run', 'build'], { cwd, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
  }
}
