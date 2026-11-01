import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRuntimeExecutable, resolveRuntimeLaunch, type RuntimeDiscoveryDependencies } from '@workspace/core/runtime-discovery';

/** Keep queries, authentication and version inspection on the same runtime. */
export function resolveClaudeLaunch(
  configuredPath?: string,
  overrides?: NodeJS.ProcessEnv,
  dependencies: RuntimeDiscoveryDependencies = {},
): ReturnType<typeof resolveRuntimeLaunch> {
  const configured = configuredPath?.trim() || process.env.APP_CLAUDE_COMMAND?.trim();
  const launch = resolveRuntimeLaunch(configured || 'claude', overrides, dependencies);
  if (configured || launch.command !== 'claude') return launch;
  const executable = bundledClaudeExecutable(launch.env);
  return executable ? { ...launch, command: executable } : launch;
}

export function resolveClaudeExecutable(): string | null {
  return resolveRuntimeExecutable(resolveClaudeLaunch().command);
}

function bundledClaudeExecutable(env: NodeJS.ProcessEnv): string | null {
  const executable = process.platform === 'win32' ? 'claude.exe' : 'claude';
  // Packaged daemon.mjs lives beside the Claude resource directory. APP_ASSETS_PATH
  // also covers the desktop adapter's explicit resource location.
  const packaged = env.APP_ASSETS_PATH
    ? path.join(env.APP_ASSETS_PATH, 'claude', executable)
    : fileURLToPath(new URL(`../claude/${executable}`, import.meta.url));
  if (existsSync(packaged)) return packaged;
  try {
    const native = createRequire(import.meta.url).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/${executable}`);
    return existsSync(native) ? native : null;
  } catch { return null; } // Optional dependencies may be omitted on CLI-only hosts.
}
