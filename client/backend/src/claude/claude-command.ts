import { resolveClaudeLaunch as nativeLaunch } from 'multi-agents-sdk/providers/claude/claude-command';
import { resolveRuntimeExecutable, resolveRuntimeLaunch, type RuntimeDiscoveryDependencies } from '@workspace/core/runtime-discovery';
export function resolveClaudeLaunch(configuredPath?: string, overrides?: NodeJS.ProcessEnv, dependencies: RuntimeDiscoveryDependencies = {}) {
  return nativeLaunch(configuredPath, overrides, dependencies, resolveRuntimeLaunch);
}
export function resolveClaudeExecutable() { return resolveRuntimeExecutable(resolveClaudeLaunch().command); }
