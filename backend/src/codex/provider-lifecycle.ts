import { product } from '@workspace/core/product';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolveCodexExecutable } from './codex-command';
import { getCodexResourceSharingStatus, initializeCodexResourceSharing, setCodexResourceSharing } from '../codex-resource-sharing';
import { providerHomePaths, type ProviderLifecycle } from '../provider-lifecycle';

export function createCodexLifecycle(): ProviderLifecycle {
  const paths = providerHomePaths('codex', process.env.CODEX_HOME);
  const resources = (homePath: string) => ({ appCodexHome: homePath, userCodexHome: paths.existing });
  return {
    skillDirectories: home => [path.join(home.homePath, 'skills')],
    skillDiscoveryDirectories: () => [path.join(homedir(), '.agents', 'skills')],
    home(snapshot, choice) {
      // Older installations without a saved choice already own isolated threads.
      const selected = choice ?? { isolated: snapshot.agents.some(agent => agent.backend === 'codex') || snapshot.general.providerOnboardingComplete === true, shareSkills: true };
      return { ...selected, homePath: selected.isolated ? paths.isolated : paths.existing };
    },
    installed: snapshot => Boolean(resolveCodexExecutable(snapshot.general.codexBinaryPath)),
    async prepareHome(home, configuring) {
      await mkdir(home.homePath, { recursive: true, mode: 0o700 });
      if (!home.isolated) return;
      await initializeCodexResourceSharing(home.shareSkills, resources(home.homePath));
      if (configuring && (await getCodexResourceSharingStatus(home.shareSkills, resources(home.homePath))).migrationRequired) {
        throw new Error(`This ${product.name} home already has private skills or plugins. They were kept; disable sharing to continue.`);
      }
    },
    sharing: {
      status: home => home.isolated ? getCodexResourceSharingStatus(home.shareSkills, resources(home.homePath))
        : Promise.resolve({ enabled: true, migrationRequired: false }),
      set: (home, input) => setCodexResourceSharing(input, resources(home.homePath)),
    },
  };
}
