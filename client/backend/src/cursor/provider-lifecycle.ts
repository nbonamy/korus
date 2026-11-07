import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { backendHomeDir } from '../state';
import type { ProviderLifecycle } from '../provider-lifecycle';
import { cursorHome, resolveCursorExecutable } from './runtime';

export function createCursorLifecycle(): ProviderLifecycle {
  return {
    home: (_snapshot, choice) => ({
      homePath: choice?.isolated ? path.join(backendHomeDir(), 'cursor-home', '.cursor') : cursorHome(),
      isolated: choice?.isolated ?? false, shareSkills: false,
    }),
    installed: () => Boolean(resolveCursorExecutable()),
    async prepareHome(home) {
      if (home.shareSkills) throw new Error('Cursor skill sharing is not supported.');
      if (home.isolated) {
        if (path.basename(home.homePath) !== '.cursor') throw new Error('Invalid Cursor separate home.');
        await mkdir(path.dirname(home.homePath), { recursive: true, mode: 0o700 });
        await mkdir(home.homePath, { recursive: true, mode: 0o700 });
      }
    },
  };
}
