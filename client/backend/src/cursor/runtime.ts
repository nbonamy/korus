import { homedir } from 'node:os';
import path from 'node:path';
import type { ProviderHomeSettings } from '@workspace/core/contracts/provider-setup';
import { resolveRuntimeExecutable, withDiscoveredRuntimePath } from '@workspace/core/runtime-discovery';

export const cursorMinimumVersion = '2026.10.08';
export function cursorHome(): string { return path.join(homedir(), '.cursor'); }
export function resolveCursorExecutable(): string | null {
  return resolveRuntimeExecutable('agent') ?? resolveRuntimeExecutable('cursor-agent');
}
export function cursorVersion(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})\.(\d{2})\.(\d{2})(?:-[a-zA-Z0-9]+)?$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(`${year}-${month}-${day}`)
    ? Number(year) * 10000 + Number(month) * 100 + Number(day) : null;
}
/** Captured per host: setup changes cannot redirect an in-flight account operation. */
export type CursorRuntime = Readonly<{ homePath: string; isolated: boolean; environment: NodeJS.ProcessEnv }>;
export function cursorRuntime(home?: ProviderHomeSettings): CursorRuntime {
  const isolated = home?.isolated === true;
  const homePath = home?.homePath ?? cursorHome();
  const env = withDiscoveredRuntimePath(undefined);
  for (const key of Object.keys(env)) if (key.startsWith('CURSOR_') || key === 'AGENT_CLI_CREDENTIAL_STORE') env[key] = undefined;
  env.CURSOR_CONFIG_DIR = homePath;
  env.HOME = homedir();
  if (isolated) {
    const userHome = homedir();
    const privateHome = path.dirname(homePath);
    env.HOME = privateHome;
    env.USERPROFILE = privateHome;
    env.XDG_CONFIG_HOME = path.join(privateHome, '.config');
    env.XDG_CACHE_HOME = path.join(privateHome, '.cache');
    env.XDG_DATA_HOME = path.join(privateHome, '.local', 'share');
    env.XDG_STATE_HOME = path.join(privateHome, '.local', 'state');
    env.APPDATA = path.join(privateHome, 'AppData', 'Roaming');
    env.LOCALAPPDATA = path.join(privateHome, 'AppData', 'Local');
    env.AGENT_CLI_CREDENTIAL_STORE = 'file';
    // Keep tool discovery and the user's explicit Git identity; do not copy keys or credentials.
    env.GIT_CONFIG_GLOBAL ??= path.join(userHome, '.gitconfig');
  }
  return Object.freeze({ homePath, isolated, environment: Object.freeze(env) });
}
export function cursorEnvironment(interactive = false, runtime: CursorRuntime = cursorRuntime()): NodeJS.ProcessEnv {
  return { ...runtime.environment, NO_OPEN_BROWSER: interactive ? undefined : '1' };
}
