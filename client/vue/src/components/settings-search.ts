import { supportedBrowserExtensions } from '@workspace/core/browser-extensions';
import { workProviders } from '@workspace/core/work-providers';
import { i18n } from '../i18n';
import type { SettingsTab } from './settings-tabs';

const engineAccount = ['engineConnection', 'providerUpdate', 'auth.installProvider', 'auth.notDetected'];
const engineLocation = ['engineSetup.title', 'auth.separateChats', 'auth.existingSetup', 'auth.customize'];
const instructions = 'surface.instructionSettings';
const messagesByTab: Record<SettingsTab, readonly string[]> = {
  general: ['surface.settingsGeneralPanel', 'telemetry.share'],
  usage: ['analytics'],
  appearance: ['surface.settingsAppearancePanel'],
  browser: ['surface.browserExtensions'],
  dictation: ['dictation'],
  voice: ['surface.settingsVoicePanel'],
  personalization: [
    ...['personalizationIntroTitle', 'personalizationIntroDescription', 'developerInstructions', 'personalizationHint', 'engine', 'saveAll', 'noEngines', 'overwrite', 'overwriteBoth']
      .map(key => `${instructions}.${key}`),
  ],
  appshots: ['surface.settingsAppshotsPanel'],
  projects: ['surface.settingsProjectsPanel'],
  codex: ['surface.settingsCodexPanel', 'bankedResets', ...engineAccount, ...engineLocation],
  'claude-code': ['surface.settingsClaudeCodePanel', ...engineAccount, ...engineLocation],
  cursor: ['cursor', 'engineSetup.title', 'surface.settingsMenu.credits', 'surface.settingsMenu.onDemand', 'surface.settingsMenu.noLimit', ...engineAccount],
  antigravity: ['antigravity', ...engineAccount, ...engineLocation],
  skills: ['surface.skills'],
  plugins: ['surface.settingsPluginsPanel'],
  git: [
    'gitWorkflow',
    ...['gitIntroTitle', 'gitIntroDescription', 'commitMessageInstructions', 'commitMessageInstructionsDescription', 'commitMessageInstructionsPlaceholder',
      'pullRequestInstructions', 'pullRequestInstructionsDescription', 'pullRequestInstructionsPlaceholder', 'worktrees', 'worktreeInitialization',
      'worktreeInitializationGuide', 'prepareNewWorktreesBeforeAgentsStart', 'worktreeInitializationAutomatic', 'worktreeInitializationRepository',
      'worktreeInitializationDisabled'].map(key => `${instructions}.${key}`),
  ],
  workflows: [
    'surface.settingsWorkflowsPanel', 'guest.settingsTitle', 'guest.displayName', 'guest.displayNamePurpose',
    'planModeSettings', 'delegation', 'reviewSettings', 'missionSettings',
    ...['settingsTitle', 'style', 'styleDescription', 'automatic', 'automaticDescription'].map(key => `surface.diffViz.${key}`),
  ],
  integrations: ['surface.settingsIntegrationsPanel', 'workAuthorization', ...Object.values(workProviders).map(provider => provider.description.key)],
  connections: ['surface.settingsConnectionsPanel', 'surface.settingsMobileSection', 'surface.remoteCodexAuth', 'surface.remoteClaudeAuth', 'surface.remoteTerminalAuth', ...engineAccount],
};

const labelsByTab: Partial<Record<SettingsTab, string[]>> = {
  browser: supportedBrowserExtensions.map(extension => extension.name),
  integrations: Object.values(workProviders).map(provider => provider.label),
};

function messageText(message: unknown): string {
  if (typeof message === 'string') return message.replace(/\{[^}]*\}/g, '');
  return message && typeof message === 'object' ? Object.values(message).map(messageText).join(' ') : '';
}

export function normalizeSettingsSearch(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Search product copy without opening inactive panels or loading their data. */
export function settingsSearchText(tab: SettingsTab, labelKey: string): string {
  return normalizeSettingsSearch([
    ...[labelKey, ...messagesByTab[tab]].map(key => messageText(i18n.global.tm(key))),
    ...(labelsByTab[tab] ?? []),
  ].join(' '));
}
