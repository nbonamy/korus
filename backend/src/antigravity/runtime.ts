import path from 'node:path';
import { resolveRuntimeExecutable, withDiscoveredRuntimePath } from '@workspace/core/runtime-discovery';
import { backendHomeDir } from '../state';
import { acpReleaseVersion, resolveAcpReleaseAsset } from './release';

export const acpVersion = acpReleaseVersion;

export function managedRuntimeDirectory(): string | null {
  const asset = resolveAcpReleaseAsset();
  return asset ? path.join(backendHomeDir(), 'antigravity', `${acpVersion}-${process.platform}-${process.arch}-${asset.sha256}`) : null;
}

function runtimeDirectory(): string { return path.join(backendHomeDir(), 'antigravity', acpVersion); }
export function antigravityHome(): string { return process.env.GEMINI_HOME || path.join(backendHomeDir(), 'antigravity-home'); }

export function resolveAcpRuntime(): { command: string; harness: string; args: string[] } | null {
  const executable = process.platform === 'win32' ? 'agy_acp_server.exe' : 'agy_acp_server.par';
  const companion = process.platform === 'win32' ? 'localharness_external.exe' : 'localharness_external';
  const command = process.env.APP_ANTIGRAVITY_COMMAND
    ? resolveRuntimeExecutable(process.env.APP_ANTIGRAVITY_COMMAND)
    : resolveRuntimeExecutable(path.join(managedRuntimeDirectory() ?? runtimeDirectory(), executable))
      ?? resolveRuntimeExecutable(executable) ?? resolveRuntimeExecutable(path.join(runtimeDirectory(), executable));
  if (!command) return null;
  const harness = resolveRuntimeExecutable(process.env.ANTIGRAVITY_HARNESS_PATH || path.join(path.dirname(command), companion));
  return harness ? { command, harness, args: process.platform === 'linux' ? ['--uid='] : [] } : null;
}

export function acpEnvironment(home: string, harness: string, temp: string): NodeJS.ProcessEnv {
  const env = { ...withDiscoveredRuntimePath(undefined) };
  for (const key of Object.keys(env)) {
    if (/^(GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_CLOUD_|GOOGLE_GENAI_|AGY_ACP_)/.test(key)) delete env[key];
  }
  return { ...env, GEMINI_HOME: home, ANTIGRAVITY_HARNESS_PATH: harness,
    AGY_ACP_FORCE_FILE_STORAGE: '1', PYTHONUNBUFFERED: '1', TMPDIR: temp };
}
