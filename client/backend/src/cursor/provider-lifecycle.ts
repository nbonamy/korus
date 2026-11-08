import type { ProviderLifecycle } from '../provider-lifecycle';
import { resolveProviderSetupCapabilities } from '@workspace/core/contracts/provider-setup';
import { cursorHome, resolveCursorExecutable } from './runtime';

export function createCursorLifecycle(): ProviderLifecycle {
  const validateChoice: NonNullable<ProviderLifecycle['validateChoice']> = choice => {
    if (choice.isolated) throw new Error('Cursor separate setup is not supported. Use the existing Cursor setup.');
    if (choice.shareSkills) throw new Error('Cursor skill sharing is not supported.');
  };
  return {
    capabilities: resolveProviderSetupCapabilities('cursor'),
    validateChoice,
    home: (_snapshot, choice) => {
      if (choice) validateChoice(choice);
      return { homePath: cursorHome(), isolated: false, shareSkills: false };
    },
    installed: () => Boolean(resolveCursorExecutable()),
    async prepareHome(home, configuring) {
      if (configuring) validateChoice(home);
      // Retain saved contexts at startup without creating, migrating or switching accounts.
    },
  };
}
