import { describe, expect, it } from 'vitest';
import { availableShortcuts, matchesShellShortcut, shortcutKeys, type ShortcutContext } from '../keyboard-shortcuts';
const context: ShortcutContext = { platform: 'mac', desktop: true, workspace: true, agent: true, agentCount: 2, teamCount: 2, browser: true, idleSession: true };
describe('keyboard shortcuts', () => {
  it('uses the declared shell key for both the reference and matching', () => {
    const commands = availableShortcuts(context).find(item => item.id === 'commands')!;
    expect(shortcutKeys(commands, context)).toStrictEqual(['⌘', 'Shift', 'P']);
    expect(matchesShellShortcut('commands', { key: 'p', control: true, shift: true })).toBe(true);
    expect(matchesShellShortcut('files', { key: 'p', control: true, shift: true })).toBe(false);
    expect(matchesShellShortcut('palette', { key: 'k', meta: true })).toBe(true);
    const help = availableShortcuts(context).find(item => item.id === 'help')!;
    expect(shortcutKeys(help, context)).toStrictEqual(['⌘', 'Shift', '/']);
    expect(matchesShellShortcut('help', { key: '?', code: 'Slash', meta: true, shift: true })).toBe(true);
    expect(matchesShellShortcut('help', { key: '/', control: true, shift: true })).toBe(true);
    expect(matchesShellShortcut('help', { key: '/', meta: true })).toBe(false);
    expect(matchesShellShortcut('help', { key: '/', meta: true, control: true, shift: true })).toBe(false);
  });
  it('assigns window, team and agent navigation, and puts closing an agent behind Shift', () => {
    const keys = (id: string, platform: 'mac' | 'other' = 'mac') => {
      const shortcut = availableShortcuts({ ...context, platform }).find(item => item.id === id);
      return shortcut && shortcutKeys(shortcut, { ...context, platform });
    };
    expect(keys('nextAgent')).toStrictEqual(['Ctrl', 'Tab']);
    expect(keys('previousAgent')).toStrictEqual(['Ctrl', 'Shift', 'Tab']);
    expect(keys('nextTeam')).toStrictEqual(['Ctrl', '`']);
    expect(keys('previousTeam')).toStrictEqual(['Ctrl', 'Shift', '`']);
    expect(keys('nextTeam', 'other')).toStrictEqual(['Ctrl', '`']);
    expect(keys('nextWindow')).toStrictEqual(['⌘', '`']);
    expect(keys('previousWindow')).toStrictEqual(['⌘', 'Shift', '`']);
    expect(keys('nextWindow', 'other')).toBeUndefined();
    expect(keys('closeWindow')).toStrictEqual(['⌘', 'W']);
    expect(keys('closeAgent')).toStrictEqual(['⌘', 'Shift', 'D']);
    expect(keys('closeTeam')).toBeUndefined();
    expect(matchesShellShortcut('nextTeam', { key: '`', code: 'Backquote', control: true })).toBe(true);
    expect(matchesShellShortcut('previousTeam', { key: '~', code: 'Backquote', control: true, shift: true })).toBe(true);
    expect(matchesShellShortcut('nextTeam', { key: '`', code: 'Backquote', meta: true })).toBe(false);
    expect(matchesShellShortcut('closeAgent', { key: 'w', meta: true })).toBe(false);
    expect(matchesShellShortcut('closeAgent', { key: 'D', meta: true, shift: true })).toBe(true);
    expect(matchesShellShortcut('duplicate', { key: 'd', meta: true })).toBe(true);
  });
  it('labels web Meta bindings honestly and omits bindings without a web handler', () => {
    const web = { ...context, platform: 'other' as const, desktop: false };
    const shortcuts = availableShortcuts(web);
    expect(shortcutKeys(shortcuts.find(item => item.id === 'duplicate')!, web)).toStrictEqual(['Meta', 'D']);
    expect(shortcuts.some(item => item.id === 'edit')).toBe(false);
    // Windows belong to the desktop menu; team cycling has a shell binding of its own.
    for (const id of ['nextWindow', 'previousWindow', 'closeWindow']) expect(shortcuts.some(item => item.id === id)).toBe(false);
    expect(shortcutKeys(shortcuts.find(item => item.id === 'nextTeam')!, web)).toStrictEqual(['Ctrl', '`']);
    expect(shortcutKeys(shortcuts.find(item => item.id === 'saveDraft')!, web)).toStrictEqual(['Meta', 'Shift', 'X']);
  });
});
