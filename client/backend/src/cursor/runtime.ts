import { homedir } from 'node:os';
import path from 'node:path';
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
export function cursorEnvironment(interactive = false): NodeJS.ProcessEnv {
  const env = withDiscoveredRuntimePath(undefined);
  for (const key of Object.keys(env)) if (key.startsWith('CURSOR_') || key === 'AGENT_CLI_CREDENTIAL_STORE') env[key] = undefined;
  env.CURSOR_CONFIG_DIR = cursorHome();
  if (interactive) env.NO_OPEN_BROWSER = undefined;
  else env.NO_OPEN_BROWSER = '1';
  return env;
}
