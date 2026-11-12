import type { HarnessProvider } from '@workspace/core/contracts';
import type { SshConnectionService } from './ssh-connections';

/** Harnesses an SSH host's own daemon installs once it runs; the others are installed over SSH first. */
export const installedByRemoteDaemon = (provider: HarnessProvider): boolean => provider === 'antigravity';

/** Installs a harness on an SSH host over SSH, before its daemon runs it. */
export async function installOverSsh(ssh: SshConnectionService, host: string, provider: HarnessProvider): Promise<void> {
  if (provider === 'codex') await ssh.ensureRemoteCodexInstalled(host);
  else await ssh.ensureRemoteClaudeInstalled(host);
}
