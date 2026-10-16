import { resolveRuntimeExecutable, resolveRuntimeLaunch } from '@workspace/core/runtime-discovery';

export function resolveCodexExecutable(configuredPath: string | undefined): string | null {
  const configured = configuredPath?.trim();
  if (configured) return resolveRuntimeExecutable(configured);
  return resolveRuntimeExecutable('codex')
    ?? (process.platform === 'darwin'
      ? resolveRuntimeExecutable('/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex')
      : null);
}

export function resolveCodexLaunch(
  configuredPath: string | undefined,
): ReturnType<typeof resolveRuntimeLaunch> {
  // Pass the selected command explicitly so SDK discovery cannot change precedence.
  return resolveRuntimeLaunch(resolveCodexExecutable(configuredPath) ?? (configuredPath?.trim() || 'codex'));
}
