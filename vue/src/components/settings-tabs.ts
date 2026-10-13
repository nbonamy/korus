import type { Component } from 'vue';
import { AffiliateIcon, GitBranchIcon, MicrophoneIcon, PaletteIcon, PuzzleIcon, ScreenshotIcon, SettingsIcon, TerminalIcon, UserIcon } from '../shared/icons/app-icons';
import type { AgentBackend } from '@workspace/core/contracts';

export type SettingsTab = 'antigravity' | 'appearance' | 'appshots' | 'claude-code' | 'codex' | 'connections' | 'general' | 'integrations' | 'plugins' | 'personalization' | 'git' | 'voice';
type SettingsDestination = {
  id: SettingsTab;
  labelKey: string;
  group: 'app' | 'agents' | 'workspace';
  icon?: Component;
  backend?: AgentBackend;
  aliases: string;
};

// Settings navigation and command search share labels and host availability.
const settingsDestinations: readonly SettingsDestination[] = [
  { id: 'general', labelKey: 'surface.settingsSidebar.general', group: 'app', icon: SettingsIcon, aliases: 'preferences follow-up celebrations source folder background sleep permissions accessibility' },
  { id: 'appearance', labelKey: 'surface.settingsSidebar.appearance', group: 'app', icon: PaletteIcon, aliases: 'theme color light dark font typography text size' },
  { id: 'voice', labelKey: 'surface.settingsSidebar.voice', group: 'app', icon: MicrophoneIcon, aliases: 'speech spoken announcements narration mute audio' },
  { id: 'personalization', labelKey: 'surface.instructionSettings.personalization', group: 'app', icon: UserIcon, aliases: 'instructions AGENTS.md CLAUDE.md personal preferences' },
  { id: 'appshots', labelKey: 'surface.settingsSidebar.appshots', group: 'app', icon: ScreenshotIcon, aliases: 'appshots screenshots capture' },
  { id: 'codex', labelKey: 'surface.settingsSidebar.codex', group: 'agents', backend: 'codex', aliases: 'openai engine provider login authentication' },
  { id: 'claude-code', labelKey: 'surface.settingsSidebar.claudeCode', group: 'agents', backend: 'claude', aliases: 'anthropic engine provider login authentication' },
  { id: 'antigravity', labelKey: 'antigravity.name', group: 'agents', backend: 'antigravity', aliases: 'google engine provider login authentication' },
  { id: 'plugins', labelKey: 'surface.settingsSidebar.plugins', group: 'agents', icon: PuzzleIcon, aliases: 'skills MCP tools extensions' },
  { id: 'git', labelKey: 'surface.instructionSettings.git', group: 'workspace', icon: GitBranchIcon, aliases: 'version control branches commit repository' },
  { id: 'integrations', labelKey: 'surface.settingsSidebar.integrations', group: 'workspace', icon: AffiliateIcon, aliases: 'github work providers issues' },
  { id: 'connections', labelKey: 'surface.settingsSidebar.connections', group: 'workspace', icon: TerminalIcon, aliases: 'ssh remote hosts servers' },
];
export function availableSettingsDestinations(context: { appshots: boolean; availableBackends: readonly AgentBackend[] }): SettingsDestination[] {
  return settingsDestinations.filter(destination => (destination.id !== 'appshots' || context.appshots)
    && (destination.id !== 'antigravity' || context.availableBackends.includes('antigravity')));
}
