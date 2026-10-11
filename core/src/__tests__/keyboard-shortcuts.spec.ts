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
  it('labels web Meta bindings honestly and omits bindings without a web handler', () => {
    const web = { ...context, platform: 'other' as const, desktop: false };
    const shortcuts = availableShortcuts(web);
    expect(shortcutKeys(shortcuts.find(item => item.id === 'duplicate')!, web)).toStrictEqual(['Meta', 'D']);
    expect(shortcuts.some(item => item.id === 'edit')).toBe(false);
    expect(shortcuts.some(item => item.id === 'nextTeam')).toBe(false);
    expect(shortcutKeys(shortcuts.find(item => item.id === 'saveDraft')!, web)).toStrictEqual(['Meta', 'Shift', 'X']);
  });
});
