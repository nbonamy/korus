import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClaudeLaunch as nativeLaunch } from '@korus-dev/multi-agent-sdk/providers/claude';
import { resolveRuntimeExecutable, resolveRuntimeLaunch, type RuntimeDiscoveryDependencies } from '@workspace/core/runtime-discovery';
export function resolveClaudeLaunch(configuredPath?: string, overrides?: NodeJS.ProcessEnv, dependencies: RuntimeDiscoveryDependencies = {}) {
  const configured = configuredPath?.trim() || process.env.APP_CLAUDE_COMMAND?.trim();
  return nativeLaunch(configured, overrides, dependencies, (command, env, discovery) => {
    const launch = resolveRuntimeLaunch(command, env, discovery);
    if (configured || launch.command !== 'claude') return launch;
    // Korus packages the Claude binary beside its daemon, or supplies an explicit resources root.
    const executable = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const packaged = launch.env.APP_ASSETS_PATH
      ? path.join(launch.env.APP_ASSETS_PATH, 'claude', executable)
      : fileURLToPath(new URL(`../claude/${executable}`, import.meta.url));
    return existsSync(packaged) ? { ...launch, command: packaged } : launch;
  });
}
export function resolveClaudeExecutable() { return resolveRuntimeExecutable(resolveClaudeLaunch().command); }
