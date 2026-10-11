import type { AppCommand } from './contracts';

export type ShortcutPlatform = 'mac' | 'other';
export type ShortcutInput = { key?: string; code?: string; meta?: boolean; control?: boolean; alt?: boolean; shift?: boolean };
type Binding = { key: string; modifier: 'primary' | 'meta' | 'control'; shift?: boolean; code?: string };
export type KeyboardShortcut = {
  id: string;
  group: 'navigation' | 'agents' | 'application';
  accelerator?: string;
  command?: AppCommand;
  shell?: Binding;
  native?: boolean;
  workspace?: boolean;
  agent?: boolean;
  browser?: boolean;
  idleSession?: boolean;
  multipleAgents?: boolean;
  multipleTeams?: boolean;
  macOnly?: boolean;
};
const primary = (key: string, shift = false): Binding => ({ key, modifier: 'primary', shift });
const meta = (key: string, shift = false): Binding => ({ key, modifier: 'meta', shift });

// Menu accelerators and shell matching share the same declarations as the reference.
export const keyboardShortcuts: readonly KeyboardShortcut[] = [
  { id: 'help', group: 'application', accelerator: 'CommandOrControl+Shift+/', command: { type: 'open-keyboard-shortcuts' }, shell: { ...primary('/', true), code: 'Slash' } },
  { id: 'palette', group: 'navigation', accelerator: 'CommandOrControl+K', command: { type: 'open-agent-palette' }, shell: primary('k'), native: true },
  { id: 'files', group: 'navigation', shell: primary('p'), workspace: true, agent: true },
  { id: 'review', group: 'navigation', accelerator: 'CommandOrControl+G', command: { type: 'open-review' }, shell: meta('g'), native: true, workspace: true, agent: true },
  { id: 'browser', group: 'navigation', accelerator: 'CommandOrControl+B', command: { type: 'open-browser' }, shell: meta('b'), native: true, workspace: true, agent: true, browser: true },
  { id: 'nextAgent', group: 'navigation', accelerator: 'Control+Tab', command: { type: 'cycle-agents', direction: 1 }, shell: { key: 'Tab', modifier: 'control' }, native: true, workspace: true, multipleAgents: true },
  { id: 'previousAgent', group: 'navigation', accelerator: 'Control+Shift+Tab', command: { type: 'cycle-agents', direction: -1 }, shell: { key: 'Tab', modifier: 'control', shift: true }, native: true, workspace: true, multipleAgents: true },
  { id: 'nextTeam', group: 'navigation', accelerator: 'Command+`', command: { type: 'cycle-teams' }, shell: { ...meta('`'), code: 'Backquote' }, native: true, workspace: true, multipleTeams: true, macOnly: true },
  ...Array.from({ length: 9 }, (_, index): KeyboardShortcut => ({ id: `agent${index + 1}`, group: 'agents', shell: meta(String(index + 1)), workspace: true, agent: true })),
  { id: 'duplicate', group: 'agents', accelerator: 'CommandOrControl+D', command: { type: 'duplicate-active-agent' }, shell: meta('d'), native: true, workspace: true, agent: true },
  { id: 'restart', group: 'agents', command: { type: 'restart-active-agent' }, shell: meta('r'), workspace: true, agent: true },
  { id: 'closeAgent', group: 'agents', accelerator: 'CommandOrControl+W', command: { type: 'close-active-agent' }, shell: meta('w'), native: true, workspace: true, agent: true },
  { id: 'edit', group: 'agents', accelerator: 'CommandOrControl+E', command: { type: 'edit-active-agent' }, native: true, workspace: true, agent: true },
  { id: 'compact', group: 'agents', accelerator: 'CommandOrControl+Shift+K', command: { type: 'compact-active-session' }, native: true, workspace: true, agent: true, idleSession: true },
  { id: 'saveDraft', group: 'agents', accelerator: 'CommandOrControl+Shift+X', command: { type: 'save-active-prompt-draft' }, native: true, agent: true },
  { id: 'drafts', group: 'agents', accelerator: 'CommandOrControl+Shift+V', command: { type: 'open-saved-prompt-drafts' }, native: true, agent: true },
  { id: 'newTeam', group: 'application', accelerator: 'CommandOrControl+N', command: { type: 'new-team' }, native: true },
  { id: 'closeTeam', group: 'application', accelerator: 'CommandOrControl+Shift+W', command: { type: 'close-active-team' }, native: true, workspace: true, multipleTeams: true },
  { id: 'settings', group: 'application', accelerator: 'CommandOrControl+,', command: { type: 'open-settings' }, native: true, macOnly: true },
  { id: 'quit', group: 'application', accelerator: 'CommandOrControl+Q', command: { type: 'quit' }, native: true },
  { id: 'mute', group: 'application', command: { type: 'toggle-spoken-announcements-muted' }, shell: meta('m', true), native: true },
];

export function shortcutAccelerator(id: string): string {
  const shortcut = keyboardShortcuts.find(item => item.id === id);
  if (!shortcut?.accelerator) throw new Error(`No menu accelerator for ${id}`);
  return shortcut.accelerator;
}
function acceleratorBinding(accelerator: string): Binding {
  const parts = accelerator.split('+');
  return { key: parts.at(-1)!, modifier: parts.includes('Control') ? 'control' : parts.includes('Command') ? 'meta' : 'primary', shift: parts.includes('Shift'), ...(parts.at(-1) === '`' ? { code: 'Backquote' } : {}) };
}
function matches(binding: Binding, input: ShortcutInput): boolean {
  const modifier = binding.modifier === 'primary' ? (input.meta || input.control) && !(input.meta && input.control)
    : binding.modifier === 'meta' ? input.meta && !input.control : input.control && !input.meta;
  return Boolean(modifier && !input.alt && Boolean(input.shift) === Boolean(binding.shift)
    && (input.key?.toLowerCase() === binding.key.toLowerCase() || (binding.code && input.code === binding.code)));
}
export function matchesShellShortcut(id: string, input: ShortcutInput): boolean {
  const binding = keyboardShortcuts.find(item => item.id === id)?.shell;
  return Boolean(binding && matches(binding, input));
}
export function nativeShortcutCommand(input: ShortcutInput): AppCommand | null {
  // Existing native input handling uses Command; Control menu accelerators are owned by Electron.
  const shortcut = keyboardShortcuts.find(item => item.native && item.command && (
    item.accelerator ? matches(acceleratorBinding(item.accelerator), input) && (input.meta || item.accelerator.startsWith('Control+'))
      : item.shell && matches(item.shell, input)
  ));
  return shortcut?.command ?? null;
}
export type ShortcutContext = {
  platform: ShortcutPlatform;
  onboarding?: boolean;
  desktop: boolean;
  workspace: boolean;
  agent: boolean;
  agentCount: number;
  teamCount: number;
  browser: boolean;
  idleSession: boolean;
};
export function availableShortcuts(context: ShortcutContext): KeyboardShortcut[] {
  return keyboardShortcuts.filter(item => {
    if (context.onboarding && item.id !== 'help' && item.id !== 'mute') return false;
    if (item.macOnly && context.platform !== 'mac') return false;
    if (!item.shell && !context.desktop) return false;
    if (item.workspace && !context.workspace || item.agent && !context.agent || item.browser && !context.browser || item.idleSession && !context.idleSession) return false;
    if (item.multipleAgents && context.agentCount < 2 || item.multipleTeams && context.teamCount < 2) return false;
    if (/^agent\d$/.test(item.id) && Number(item.id.slice(5)) > context.agentCount) return false;
    return true;
  });
}
export function shortcutKeys(shortcut: KeyboardShortcut, context: Pick<ShortcutContext, 'platform' | 'desktop'>): string[] {
  const binding = context.desktop && shortcut.accelerator ? acceleratorBinding(shortcut.accelerator) : shortcut.shell!;
  const modifier = binding.modifier === 'control' ? 'Ctrl' : binding.modifier === 'meta' ? context.platform === 'mac' ? '⌘' : 'Meta' : context.platform === 'mac' ? '⌘' : 'Ctrl';
  return [modifier, ...(binding.shift ? ['Shift'] : []), binding.key.length === 1 ? binding.key.toUpperCase() : binding.key];
}
