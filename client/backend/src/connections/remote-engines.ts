import type { HarnessProvider } from '@workspace/core/contracts';
import { resolveProviderSetupCapabilities } from '@workspace/core/contracts/provider-setup';
import type { SshConnectionService } from './ssh-connections';

export type RemoteShellEngine = Extract<HarnessProvider, 'cursor' | 'antigravity'>;

/** Run only the built-in vendor installer and verify the CLI itself can run. */
export function remoteShellEngineInstallCommand(provider: RemoteShellEngine): string {
  const { command } = resolveProviderSetupCapabilities(provider).installation;
  if (!command) throw new Error('No official installer is registered for this engine.');
  const version = provider === 'cursor' ? '(agent --version || cursor-agent --version)' : 'agy --version';
  return `set -eu
if ${version} >/dev/null 2>&1; then exit 0; fi
bash -o pipefail <<'INSTALL_ENGINE'
${command}
INSTALL_ENGINE
${version}`;
}

/** Installs a harness on an SSH host over SSH, before its daemon runs it. */
export async function installOverSsh(ssh: SshConnectionService, host: string, provider: HarnessProvider): Promise<void> {
  if (provider === 'codex') await ssh.ensureRemoteCodexInstalled(host);
  else if (provider === 'claude') await ssh.ensureRemoteClaudeInstalled(host);
  else await ssh.ensureRemoteShellEngineInstalled(host, provider);
}
