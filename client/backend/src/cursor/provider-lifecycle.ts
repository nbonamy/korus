import type { ProviderLifecycle } from '../provider-lifecycle';
import { cursorHome, resolveCursorExecutable } from './runtime';

export function createCursorLifecycle(): ProviderLifecycle {
  return {
    home: (_snapshot, choice) => {
      if (choice?.isolated) throw new Error('Cursor isolated homes are not supported.');
      return { homePath: cursorHome(), isolated: false, shareSkills: false };
    },
    installed: () => Boolean(resolveCursorExecutable()),
    async prepareHome(home) {
      if (home.isolated || home.homePath !== cursorHome() || home.shareSkills) {
        throw new Error('Cursor uses its existing home; isolated homes and skill sharing are not supported.');
      }
    },
  };
}
