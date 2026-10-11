import { availableShortcuts, keyboardShortcuts, shortcutKeys, type ShortcutContext } from '@workspace/core/keyboard-shortcuts';
import type { Agent, AppCommand, BackendCapabilities, Team } from '@workspace/core/contracts';
import { defaultBackendCommands } from '@workspace/core/backend-commands';
import { translate } from '../i18n';

export type CommandPaletteAction = {
  id: string;
  label: string;
  aliases?: string;
  keys?: string[];
  disabledReason?: string;
  scope?: string;
  run: () => void | Promise<void>;
};

type Context = {
  shortcuts: ShortcutContext;
  agent: Agent | null;
  team: Team | null;
  connected: boolean;
  hostConnected: boolean;
  engineConnected: boolean;
  canCreateAgent: boolean;
  capabilities: BackendCapabilities;
  gitAvailable: boolean;
  gitActions: CommandPaletteAction[];
};
type Actions = {
  command: (command: AppCommand) => void;
  newAgent: () => void;
  files: () => void;
  filesPane: () => void;
  codeReview: () => void | Promise<void>;
  visualize: () => void | Promise<void>;
  plan: () => void;
};
const shortcutAliases: Record<string, string> = { settings: 'preferences configuration', palette: 'search agent teammate', files: 'search file', review: 'git diff changes', browser: 'web preview', help: 'keyboard reference shortcuts', mute: 'speech voice announcements' };

// Each result carries its availability, binding and the existing handler together.
// Git actions come directly from the control that owns their workflow and prompts.
export function commandPaletteActions(context: Context, actions: Actions): CommandPaletteAction[] {
  const result: CommandPaletteAction[] = [];
  const hints = new Map(availableShortcuts(context.shortcuts).map(shortcut => [shortcut.id, shortcutKeys(shortcut, context.shortcuts)]));
  const disconnected = !context.connected || !context.hostConnected ? translate('commands.disconnected') : undefined;
  const engineUnavailable = disconnected ?? (!context.engineConnected ? translate('commands.engineUnavailable') : undefined);
  const busy = context.agent && ['working', 'awaitingInput'].includes(context.agent.status.type) ? translate('commands.busy') : undefined;
  const idleUnavailable = context.agent?.status.type !== 'idle' ? busy ?? translate('commands.notIdle') : undefined;
  const agentScope = context.agent?.id;
  const addShortcut = (id: string, disabledReason?: string, scope?: string, run?: CommandPaletteAction['run']) => {
    const shortcut = keyboardShortcuts.find(item => item.id === id)!;
    result.push({ id, label: translate(`shortcuts.actions.${id}`), aliases: shortcutAliases[id], keys: hints.get(id), disabledReason, scope, run: run ?? (() => { if (shortcut.command) actions.command(shortcut.command); }) });
  };
  addShortcut('settings');
  addShortcut('help');
  addShortcut('mute');
  if (context.shortcuts.desktop) addShortcut('quit');
  if (context.shortcuts.onboarding) return result;
  addShortcut('palette');
  addShortcut('newTeam', !context.connected ? translate('commands.disconnected') : undefined);
  if (context.team) result.push({ id: 'newAgent', label: translate('commands.newAgent'), aliases: 'create teammate', scope: context.team.id, disabledReason: disconnected ?? (!context.canCreateAgent ? translate('commands.engineUnavailable') : undefined), run: actions.newAgent });
  if (context.shortcuts.workspace && context.team && (context.shortcuts.teamCount > 1 || context.team.remoteConnectionId)) addShortcut('closeTeam', disconnected, context.team.id);
  if (!context.shortcuts.workspace || !context.agent) return result;
  for (const id of ['edit', 'duplicate', 'closeAgent']) addShortcut(id, disconnected, agentScope);
  addShortcut('restart', engineUnavailable ?? busy, agentScope);
  if (context.agent.backendSession && context.capabilities.conversationFork) result.push({ id: 'fork', label: translate('commands.fork'), aliases: 'branch conversation', scope: agentScope, disabledReason: engineUnavailable ?? idleUnavailable, run: () => actions.command({ type: 'fork-active-agent' }) });
  if (context.capabilities.conversationResume) result.push({ id: 'resume', label: translate('commands.resume'), aliases: 'history conversation', scope: agentScope, disabledReason: engineUnavailable ?? busy, run: () => actions.command({ type: 'resume-active-session' }) });
  if (context.agent.backendSession && defaultBackendCommands(context.agent.backend).some(command => command.slashName === 'compact')) addShortcut('compact', engineUnavailable ?? idleUnavailable, agentScope);
  addShortcut('saveDraft', undefined, agentScope);
  addShortcut('drafts', undefined, agentScope);
  if (context.shortcuts.browser) addShortcut('browser', disconnected, agentScope);
  result.push({ id: 'visualize', label: translate('commands.visualize'), aliases: 'diagram canvas artifact', scope: agentScope, disabledReason: disconnected, run: actions.visualize });
  result.push({ id: 'plan', label: translate('commands.plan'), aliases: 'artifact execution', scope: agentScope, run: actions.plan });
  if (!context.agent.folder) return result;
  addShortcut('files', disconnected, agentScope, actions.files);
  result.push({ id: 'filesPane', label: translate('commands.filesPane'), aliases: 'repository tree artifact', scope: agentScope, disabledReason: disconnected, run: actions.filesPane });
  if (context.capabilities.codeReview) result.push({ id: 'codeReview', label: translate('commands.codeReview'), aliases: 'review findings', scope: agentScope, disabledReason: engineUnavailable ?? busy, run: actions.codeReview });
  if (context.gitAvailable) {
    addShortcut('review', disconnected, agentScope);
    result.push(...context.gitActions.map(action => ({ ...action, scope: agentScope, disabledReason: disconnected ?? action.disabledReason })));
  }
  return result;
}
