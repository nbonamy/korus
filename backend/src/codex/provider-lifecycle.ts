import { product } from '@workspace/core/product';
import { mkdir } from 'node:fs/promises';
import { resolveCodexExecutable } from './codex-command';
import { getCodexResourceSharingStatus, initializeCodexResourceSharing, setCodexResourceSharing } from '../codex-resource-sharing';
import { providerHomePaths, type ProviderLifecycle } from '../provider-lifecycle';

export function createCodexLifecycle(): ProviderLifecycle {
  const paths = providerHomePaths('codex', process.env.CODEX_HOME);
  const resources = (homePath: string) => ({ appCodexHome: homePath, userCodexHome: paths.existing });
  return {
    home: (_snapshot, choice = { isolated: true, shareSkills: true }) => ({
      ...choice, homePath: choice.isolated ? paths.isolated : paths.existing,
    }),
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
