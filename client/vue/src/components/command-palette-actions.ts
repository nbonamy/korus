import type { Component } from 'vue';
import BackendIcon from './BackendIcon.vue';
import { actionIcon } from '../shared/icons/action-icons';
import { availableShortcuts, keyboardShortcuts, shortcutKeys, type ShortcutContext } from '@workspace/core/keyboard-shortcuts';
import type { Agent, AppCommand, BackendCapabilities, Team } from '@workspace/core/contracts';
import { defaultBackendCommands } from '@workspace/core/backend-commands';
import { availableSettingsDestinations, type SettingsTab } from './settings-tabs';
import { translate } from '../i18n';

export type CommandPaletteAction = {
  id: string;
  label: string;
  aliases?: string;
  group?: string;
  icon?: Component;
  iconProps?: Record<string, unknown>;
  keys?: string[];
  disabledReason?: string;
  scope?: string;
  run: () => void | Promise<void>;
};

type Context = {
  shortcuts: ShortcutContext;
  settings: Parameters<typeof availableSettingsDestinations>[0];
  agent: Agent | null;
  team: Team | null;
  connected: boolean;
  hostConnected: boolean;
  engineConnected: boolean;
  canCreateAgent: boolean;
  capabilities: BackendCapabilities;
  gitAvailable: boolean;
  planAvailable: boolean;
  simulatorAvailable: boolean;
  gitActions: CommandPaletteAction[];
};
type Actions = {
  command: (command: AppCommand) => void;
  newAgent: () => void;
  settings: (tab: SettingsTab) => void;
  cockpit: () => void;
  backlog: () => void | Promise<void>;
  automations: () => void;
  quickChat: () => void | Promise<void>;
  files: () => void;
  filesPane: () => void;
  codeReview: () => void | Promise<void>;
  simulator: () => void;
  design: () => void | Promise<void>;
  visualize: () => void | Promise<void>;
  plan: () => void;
};
const sections = ['workspace', 'agent', 'conversation', 'git', 'team', 'navigation', 'settings', 'application'] as const;
type PaletteSection = typeof sections[number];
type PaletteEntry = CommandPaletteAction & { section: PaletteSection };

const shortcutAliases: Record<string, string> = { settings: 'preferences configuration', palette: 'search agent teammate', files: 'search file', review: 'git diff changes', browser: 'web preview', help: 'keyboard reference shortcuts', mute: 'speech voice announcements' };

// Each result carries its availability, binding and the existing handler together.
// Git actions come directly from the control that owns their workflow and prompts.
export function commandPaletteActions(context: Context, actions: Actions): CommandPaletteAction[] {
  const result: PaletteEntry[] = [];
  const hints = new Map(availableShortcuts(context.shortcuts).map(shortcut => [shortcut.id, shortcutKeys(shortcut, context.shortcuts)]));
  const disconnected = !context.connected || !context.hostConnected ? translate('commands.disconnected') : undefined;
  const engineUnavailable = disconnected ?? (!context.engineConnected ? translate('commands.engineUnavailable') : undefined);
  const busy = context.agent && ['working', 'awaitingInput'].includes(context.agent.status.type) ? translate('commands.busy') : undefined;
  const idleUnavailable = context.agent?.status.type !== 'idle' ? busy ?? translate('commands.notIdle') : undefined;
  const agentScope = context.agent?.id;
  const addShortcut = (id: string, section: PaletteSection, disabledReason?: string, scope?: string, run?: CommandPaletteAction['run']) => {
    const shortcut = keyboardShortcuts.find(item => item.id === id)!;
    result.push({ id, section, label: translate(`shortcuts.actions.${id}`), aliases: shortcutAliases[id], keys: hints.get(id), disabledReason, scope, run: run ?? (() => { if (shortcut.command) actions.command(shortcut.command); }) });
  };
  addShortcut('settings', 'settings');
  result.push(...availableSettingsDestinations(context.settings).map(destination => ({
    id: `settings:${destination.id}`, section: 'settings' as const, icon: destination.backend ? BackendIcon : destination.icon,
    iconProps: destination.backend ? { backend: destination.backend, monochrome: true } : undefined, label: translate(destination.labelKey), aliases: destination.aliases,
    run: () => actions.settings(destination.id),
  })));
  addShortcut('help', 'application');
  addShortcut('mute', 'application');
  if (context.shortcuts.desktop) addShortcut('quit', 'application');
  if (context.shortcuts.onboarding) return groupedActions(result);
  addShortcut('palette', 'navigation');
  if (context.shortcuts.workspace && context.agent?.folder) addShortcut('files', 'navigation', disconnected, agentScope, actions.files);
  result.push(
    { id: 'cockpit', section: 'navigation', label: translate('commands.cockpit'), aliases: 'dashboard agents status overview', run: actions.cockpit },
    { id: 'backlog', section: 'navigation', label: translate('commands.backlog'), aliases: 'work inbox issues tasks', run: actions.backlog },
    { id: 'automations', section: 'navigation', label: translate('commands.automations'), aliases: 'scheduled tasks recurring jobs', run: actions.automations },
    { id: 'quickChat', section: 'conversation', label: translate('commands.quickChat'), aliases: 'new chat conversation', scope: context.team?.id, disabledReason: disconnected ?? (!context.canCreateAgent ? translate('commands.engineUnavailable') : undefined), run: actions.quickChat },
  );
  addShortcut('newTeam', 'team', !context.connected ? translate('commands.disconnected') : undefined);
  if (context.team) result.push({ id: 'newAgent', section: 'agent', label: translate('commands.newAgent'), aliases: 'create teammate', scope: context.team.id, disabledReason: disconnected ?? (!context.canCreateAgent ? translate('commands.engineUnavailable') : undefined), run: actions.newAgent });
  if (context.shortcuts.workspace && context.team && context.shortcuts.teamCount > 1) addShortcut('closeTeam', 'team', disconnected, context.team.id);
  if (!context.shortcuts.workspace || !context.agent) return groupedActions(result);
  // Keep the existing agent-menu sequence.
  for (const id of ['edit', 'duplicate']) addShortcut(id, 'agent', disconnected, agentScope);
  if (context.agent.backendSession && context.capabilities.conversationFork) result.push({ id: 'fork', section: 'agent', label: translate('commands.fork'), aliases: 'branch conversation', scope: agentScope, disabledReason: engineUnavailable ?? idleUnavailable, run: () => actions.command({ type: 'fork-active-agent' }) });
  if (context.agent.backendSession && defaultBackendCommands(context.agent.backend).some(command => command.slashName === 'compact')) addShortcut('compact', 'agent', engineUnavailable ?? idleUnavailable, agentScope);
  if (context.capabilities.conversationResume) result.push({ id: 'resume', section: 'agent', label: translate('commands.resume'), aliases: 'history conversation', scope: agentScope, disabledReason: engineUnavailable ?? busy, run: () => actions.command({ type: 'resume-active-session' }) });
  addShortcut('restart', 'agent', engineUnavailable ?? busy, agentScope);
  addShortcut('closeAgent', 'agent', disconnected, agentScope);
  addShortcut('saveDraft', 'conversation', undefined, agentScope);
  addShortcut('drafts', 'conversation', undefined, agentScope);

  // Artifact panes follow the workspace menu; file search belongs to navigation.
  result.push({ id: 'codeReview', section: 'workspace', label: translate('commands.codeReview'), aliases: 'review reviews findings inspection', scope: agentScope, disabledReason: disconnected, run: actions.codeReview });
  result.push({ id: 'design', section: 'workspace', label: translate('commands.design'), aliases: 'design mockup prototype exploration', scope: agentScope, disabledReason: disconnected, run: actions.design });
  result.push({ id: 'visualize', section: 'workspace', label: translate('commands.visualize'), aliases: 'diagram canvas artifact', scope: agentScope, disabledReason: disconnected, run: actions.visualize });
  if (context.agent.folder && context.gitAvailable) addShortcut('review', 'workspace', disconnected, agentScope);
  if (context.simulatorAvailable) result.push({ id: 'simulator', section: 'workspace', label: translate('commands.simulator'), aliases: 'mobile device ios android emulator', scope: agentScope, disabledReason: disconnected, run: actions.simulator });
  if (context.shortcuts.browser) addShortcut('browser', 'workspace', disconnected, agentScope);
  if (context.agent.folder) result.push({ id: 'filesPane', section: 'workspace', label: translate('commands.filesPane'), aliases: 'repository tree artifact', scope: agentScope, disabledReason: disconnected, run: actions.filesPane });
  if (context.planAvailable) result.push({ id: 'plan', section: 'workspace', label: translate('commands.plan'), aliases: 'artifact execution', scope: agentScope, run: actions.plan });
  if (context.agent.folder && context.gitAvailable) {
    result.push(...context.gitActions.map(action => ({ ...action, section: 'git' as const, scope: agentScope, disabledReason: disconnected ?? action.disabledReason })));
  }
  return groupedActions(result);
}

function groupedActions(actions: PaletteEntry[]): CommandPaletteAction[] {
  return sections.flatMap(section => actions.filter(action => action.section === section)
    .map(({ section: _section, ...action }) => ({ ...action, icon: action.icon ?? actionIcon(action.id), group: translate(`commands.groups.${section}`) })));
}
