/// <reference types="vite/client" />
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('../../../**/*.vue', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// Menus that are not a trigger + list of choices: they embed rows in other content or in a context menu.
const compositeMenus = new Set([
  'components/AgentContextMenu.vue',
  'components/AgentEmptyState.vue',
  'components/AppShell.vue',
  'components/BackendModelSelector.vue',
  'components/BrowserPanel.vue',
  'components/MissionContextMenu.vue',
  'components/RepositoryBacklogPanel.vue',
  'components/SettingsMenu.vue',
  'components/TeamContextMenu.vue',
  'shared/menu/AppContextMenu.vue',
  'shared/menu/AppMenu.vue',
  'shared/menu/AppMenuButton.vue',
]);

// Keys are relative to this spec; make them relative to src/.
const files = Object.entries(sources).map(([path, source]) => [posix.relative('/src', posix.resolve('/src/shared/menu/__tests__', path)), source] as const);

describe('menu consistency', () => {
  it('scans the real component sources', () => {
    expect(files.some(([path]) => path === 'components/AgentSidebar.vue')).toBe(true);
    expect(files.some(([path]) => path === 'shared/OpenInControl.vue')).toBe(true);
  });

  it('attaches menus to triggers through AppMenuButton, not hand-built popovers', () => {
    const offenders = files.filter(([path, source]) => /<AppMenu(?![A-Za-z])/.test(source) && !compositeMenus.has(path)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('never uses el-dropdown, whose menu looks different from the app menu', () => {
    expect(files.filter(([, source]) => source.includes('<el-dropdown')).map(([path]) => path)).toEqual([]);
  });

  it('does not fake the selected-item check with a caller-side icon swap', () => {
    expect(files.filter(([, source]) => /icon:\s*[^,\n]*\?\s*CheckIcon/.test(source)).map(([path]) => path)).toEqual([]);
  });
});
