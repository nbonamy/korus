import { workProviderKinds } from './work-providers';
import { isAgentBackend } from './contracts/shared';
import { spokenAnnouncementVoices, type AppGeneralSettings, type AppPluginSettings, type AppshotSettings, type AppSnapshot, type AppThemeSettings, type ModelFavorite, type SavedPromptDraft, type SourceFolderState, type SpokenAnnouncementVoice, type UpdateSettingsInput, type WorkProviderSettings } from './contracts';
import { repositoryIconKeyForRemote } from './git-remote';
import { isApprovalPreset } from './approval-presets';
import { claudeBackendCapabilities } from './backend-capabilities';
import { isCodeReviewPreferences } from './code-review';
import { normalizeGitSettings } from './git-preferences';

export const defaultPluginSettings: AppPluginSettings = {
  computerUseEnabled: false,
  chromeEnabled: false,
};

export const defaultAppshotSettings: AppshotSettings = {
  hotkey: 'command',
  destination: 'active-agent',
  playSound: true,
};

export const defaultGeneralSettings: AppGeneralSettings = {
  git: normalizeGitSettings(undefined),
  commitMessageInstructions: '',
  pullRequestInstructions: '',
  preventSleepWhenAgentsRun: true,
  preventSleepWhenRemoteAccessEnabled: true,
  celebrationsEnabled: true,
  followUpBehavior: 'queue',
  spokenAnnouncementsEnabled: false,
  spokenAnnouncementsMuted: false,
  spokenAnnouncementsOnlyForDictatedPrompts: true,
  spokenAnnouncementsOnlyWhenFocused: true,
  spokenAnnouncementScope: 'selected',
  spokenAnnouncementVoice: 'af_heart',
  codexBinaryPath: '',
  claudeCodeEnabled: false,
  agentListCompact: false,
  cockpitAgentViewMode: 'teams',
  collapsedRepositoryKeys: [],
  modelFavorites: [],
  savedPromptDrafts: [],
  worktreeInitializationMode: 'automatic',
  worktreeDelegationStartingContext: 'conversation',
  worktreeDelegationInstructions: '',
  sessionCompressionWarningEnabled: true,
  repositoryIcons: {},
  appshots: { ...defaultAppshotSettings },
  plugins: { ...defaultPluginSettings },
};

export const defaultSourceFolderState: SourceFolderState = {
  path: '',
  initialized: false,
  recentRepoNames: [],
};

export const defaultThemeSettings: AppThemeSettings = {
  id: 'app-light',
  mode: 'system',
  uiFontSize: 14,
  chatFontSize: 15,
  codeFontSize: 13,
};

export function updateSettingsInSnapshot(snapshot: AppSnapshot, input: UpdateSettingsInput): AppSnapshot {
  if (input.general) {
    const enabledChanges = input.general.providerEnabled;
    if (enabledChanges) {
      const authenticated = (snapshot.providerConnections ?? []).filter(engine => engine.installed && engine.connected);
      const disablesActiveEngine = authenticated.some(engine => engine.enabled !== false && enabledChanges[engine.backend] === false);
      const leavesAvailableEngine = authenticated.some(engine => (enabledChanges[engine.backend] ?? engine.enabled) !== false);
      if (disablesActiveEngine && !leavesAvailableEngine) {
        throw new Error('Cannot disable the last engine. Enable another one first.');
      }
    }
    snapshot.general = normalizeGeneralSettings({
      ...snapshot.general,
      ...input.general,
      ...(input.general.git ? { git: { ...normalizeGitSettings(snapshot.general.git), ...input.general.git } } : {}),
      ...(enabledChanges ? { providerEnabled: { ...snapshot.general.providerEnabled, ...enabledChanges } } : {}),
      plugins: {
        ...snapshot.general.plugins,
        ...input.general.plugins,
      },
    });
  }

  if (input.sourceFolder) {
    const nextPath = normalizeString(input.sourceFolder.path);
    const nextRecentRepoNames = input.sourceFolder.recentRepoNames
      ? normalizeRecentRepoNames(input.sourceFolder.recentRepoNames)
      : snapshot.sourceFolder.recentRepoNames;
    snapshot.sourceFolder = normalizeSourceFolderState({
      ...snapshot.sourceFolder,
      path: nextPath ?? snapshot.sourceFolder.path,
      initialized: true,
      recentRepoNames: nextPath === '' ? [] : nextRecentRepoNames,
    });
  }

  if (input.theme) {
    snapshot.theme = normalizeThemeSettings({
      ...snapshot.theme,
      ...input.theme,
    });
  }

  for (const provider of workProviderKinds) {
    if (!input.workProviders?.[provider]) continue;
    const settings = normalizeWorkProviderSettings({
      ...snapshot.workBacklog.providerSettings[provider],
      ...input.workProviders[provider],
    });
    if (settings.oauthClientId) {
      snapshot.workBacklog.providerSettings[provider] = settings;
    } else {
      delete snapshot.workBacklog.providerSettings[provider];
    }
  }

  return snapshot;
}

export function normalizeGeneralSettings(value: unknown): AppGeneralSettings {
  if (!isRecord(value)) {
    return { ...defaultGeneralSettings, git: normalizeGitSettings(defaultGeneralSettings.git) };
  }

  return {
    preventSleepWhenAgentsRun: value.preventSleepWhenAgentsRun !== false,
    git: normalizeGitSettings(value.git),
    commitMessageInstructions: normalizeString(value.commitMessageInstructions) ?? '',
    pullRequestInstructions: normalizeString(value.pullRequestInstructions) ?? '',
    preventSleepWhenRemoteAccessEnabled: value.preventSleepWhenRemoteAccessEnabled !== false,
    celebrationsEnabled: value.celebrationsEnabled !== false,
    followUpBehavior: value.followUpBehavior === 'steer' ? 'steer' : 'queue',
    spokenAnnouncementsEnabled: value.spokenAnnouncementsEnabled === true,
    spokenAnnouncementsMuted: value.spokenAnnouncementsMuted === true,
    spokenAnnouncementsOnlyForDictatedPrompts: value.spokenAnnouncementsOnlyForDictatedPrompts !== false,
    spokenAnnouncementsOnlyWhenFocused: value.spokenAnnouncementsOnlyWhenFocused !== false,
    spokenAnnouncementScope: value.spokenAnnouncementScope === 'all' ? 'all' : 'selected',
    spokenAnnouncementVoice: normalizeSpokenAnnouncementVoice(value.spokenAnnouncementVoice),
    codexBinaryPath: normalizeString(value.codexBinaryPath) ?? defaultGeneralSettings.codexBinaryPath,
    claudeCodeEnabled: value.claudeCodeEnabled === true,
    ...(typeof value.codexEnabled === 'boolean' ? { codexEnabled: value.codexEnabled } : {}),
    ...(value.providerOnboardingComplete === true || typeof value.codexEnabled === 'boolean' ? { providerOnboardingComplete: true } : {}),
    ...(isRecord(value.providerHomes) ? { providerHomes: normalizeProviderHomes(value.providerHomes) } : {}),
    ...(isRecord(value.providerEnabled) ? { providerEnabled: Object.fromEntries(Object.entries(value.providerEnabled).filter(([backend, enabled]) => (isAgentBackend(backend)) && typeof enabled === 'boolean')) } : {}),
    ...(isRecord(value.providerModelDefaults) ? { providerModelDefaults: normalizeProviderModelDefaults(value.providerModelDefaults) } : {}),
    ...(isCodeReviewPreferences(value.codeReviewDefaults) ? { codeReviewDefaults: structuredClone(value.codeReviewDefaults) } : {}),
    ...(isRecord(value.providerApprovalDefaults) ? { providerApprovalDefaults: normalizeProviderApprovalDefaults(value.providerApprovalDefaults) } : {}),
    agentListCompact: value.agentListCompact === true,
    cockpitAgentViewMode: value.cockpitAgentViewMode === 'recent' ? 'recent' : 'teams',
    collapsedRepositoryKeys: normalizeStringList(value.collapsedRepositoryKeys, 200),
    modelFavorites: normalizeModelFavorites(value.modelFavorites),
    savedPromptDrafts: normalizeSavedPromptDrafts(value.savedPromptDrafts),
    worktreeInitializationMode: normalizeWorktreeInitializationMode(value.worktreeInitializationMode),
    worktreeDelegationStartingContext: value.worktreeDelegationStartingContext === 'handoff' ? 'handoff' : 'conversation',
    worktreeDelegationInstructions: normalizeString(value.worktreeDelegationInstructions) ?? '',
    sessionCompressionWarningEnabled: value.sessionCompressionWarningEnabled !== false,
    repositoryIcons: normalizeRepositoryIcons(value.repositoryIcons),
    appshots: normalizeAppshotSettings(value.appshots),
    plugins: normalizePluginSettings(value.plugins),
  };
}

function normalizeProviderHomes(value: Record<string, unknown>): NonNullable<AppGeneralSettings['providerHomes']> {
  const homes: NonNullable<AppGeneralSettings['providerHomes']> = {};
  for (const backend of ['codex', 'claude', 'antigravity'] as const) {
    const entry = value[backend];
    if (isRecord(entry) && typeof entry.homePath === 'string' && entry.homePath.trim()
      && typeof entry.isolated === 'boolean' && typeof entry.shareSkills === 'boolean') {
      homes[backend] = { homePath: entry.homePath, isolated: entry.isolated, shareSkills: entry.shareSkills };
    }
  }
  return homes;
}

function normalizeProviderModelDefaults(value: Record<string, unknown>): NonNullable<AppGeneralSettings['providerModelDefaults']> {
  const defaults: NonNullable<AppGeneralSettings['providerModelDefaults']> = {};
  for (const backend of ['codex', 'claude', 'antigravity'] as const) {
    const entry = value[backend];
    const model = isRecord(entry) ? normalizeString(entry.model) : undefined;
    if (!isRecord(entry) || !model) continue;
    defaults[backend] = {
      model,
      reasoningEffort: backend === 'antigravity' ? null : normalizeString(entry.reasoningEffort) || null,
      serviceTier: backend === 'antigravity' ? null : normalizeString(entry.serviceTier) || null,
    } as NonNullable<typeof defaults[typeof backend]>;
  }
  return defaults;
}

function normalizeProviderApprovalDefaults(value: Record<string, unknown>): NonNullable<AppGeneralSettings['providerApprovalDefaults']> {
  const { codex, claude, antigravity } = value;
  return {
    ...(isApprovalPreset(codex) ? { codex } : {}),
    ...(typeof claude === 'string' && claudeBackendCapabilities.permissionModes?.some(option => option.id === claude) ? { claude } : {}),
    ...(typeof antigravity === 'string' && ['default', 'auto_edit'].includes(antigravity) ? { antigravity } : {}),
  };
}

function normalizeSpokenAnnouncementVoice(value: unknown): SpokenAnnouncementVoice {
  return typeof value === 'string' && spokenAnnouncementVoices.includes(value as SpokenAnnouncementVoice)
    ? value as SpokenAnnouncementVoice
    : defaultGeneralSettings.spokenAnnouncementVoice;
}

function normalizeWorktreeInitializationMode(value: unknown): AppGeneralSettings['worktreeInitializationMode'] {
  return value === 'repository' || value === 'off' ? value : 'automatic';
}

function normalizeRepositoryIcons(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const icons: Record<string, string> = {};
  for (const [repositoryRoot, iconValue] of Object.entries(value)) {
    const rawKey = repositoryRoot.trim();
    const root = repositoryIconKeyForRemote(rawKey) ?? rawKey;
    const icon = typeof iconValue === 'string' ? iconValue.trim() : '';
    if (!root || root.length > 4_096 || !icon || icon.length > 64) continue;
    icons[root] = icon;
    if (Object.keys(icons).length >= 200) break;
  }
  return icons;
}

function normalizeStringList(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((candidate): candidate is string => typeof candidate === 'string')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0 && candidate.length <= 4_096))]
    .slice(0, maximum);
}

function normalizeModelFavorites(value: unknown): ModelFavorite[] {
  if (!Array.isArray(value)) return [];
  const favorites: ModelFavorite[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const backend = candidate.backend === 'codex' || candidate.backend === 'claude' || candidate.backend === 'antigravity'
      ? candidate.backend
      : null;
    const modelId = normalizeFavoriteValue(candidate.modelId);
    const reasoningEffort = candidate.reasoningEffort === null
      ? null
      : normalizeFavoriteValue(candidate.reasoningEffort);
    const normalizedServiceTier = candidate.serviceTier === null
      ? null
      : normalizeFavoriteValue(candidate.serviceTier);
    const serviceTier = normalizedServiceTier === 'default' ? null : normalizedServiceTier;
    if (!backend || !modelId || reasoningEffort === undefined || serviceTier === undefined) continue;
    const favorite: ModelFavorite = { backend, modelId, reasoningEffort, serviceTier };
    const key = JSON.stringify(favorite);
    if (seen.has(key)) continue;
    seen.add(key);
    favorites.push(favorite);
    if (favorites.length >= 20) break;
  }
  return favorites;
}

function normalizeSavedPromptDrafts(value: unknown): SavedPromptDraft[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const drafts: SavedPromptDraft[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const { id, agentId, text, createdAt } = candidate;
    if (typeof id !== 'string' || !id || id.length > 128 || seen.has(id)
      || typeof agentId !== 'string' || !agentId || agentId.length > 128
      || typeof text !== 'string' || !text.trim() || text.length > 131_072
      || typeof createdAt !== 'number' || !Number.isFinite(createdAt) || createdAt < 0) continue;
    seen.add(id);
    drafts.push({ id, agentId, text, createdAt });
  }
  return drafts.slice(-100);
}

function normalizeFavoriteValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 256 ? normalized : undefined;
}

export function normalizeAppshotSettings(value: unknown): AppshotSettings {
  if (!isRecord(value)) {
    return { ...defaultAppshotSettings };
  }
  const hotkey = value.hotkey;
  return {
    hotkey: hotkey === 'command' || hotkey === 'option' || hotkey === 'shift' || hotkey === 'none'
      ? hotkey
      : defaultAppshotSettings.hotkey,
    destination: 'active-agent',
    playSound: value.playSound !== false,
  };
}

export function normalizePluginSettings(value: unknown): AppPluginSettings {
  if (!isRecord(value)) {
    return { ...defaultPluginSettings };
  }

  return {
    computerUseEnabled: value.computerUseEnabled === true,
    chromeEnabled: value.chromeEnabled === true,
  };
}

export function normalizeSourceFolderState(value: unknown): SourceFolderState {
  if (!isRecord(value)) {
    return { ...defaultSourceFolderState };
  }

  return {
    path: normalizeString(value.path) ?? defaultSourceFolderState.path,
    initialized: value.initialized === true,
    recentRepoNames: normalizeRecentRepoNames(value.recentRepoNames),
  };
}

export function normalizeThemeSettings(value: unknown): AppThemeSettings {
  if (!isRecord(value)) {
    return { ...defaultThemeSettings };
  }

  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : defaultThemeSettings.id,
    mode: isAppearanceMode(value.mode) ? value.mode : defaultThemeSettings.mode,
    uiFontSize: normalizeFontSize(value.uiFontSize, defaultThemeSettings.uiFontSize),
    chatFontSize: normalizeFontSize(value.chatFontSize, defaultThemeSettings.chatFontSize),
    codeFontSize: normalizeFontSize(value.codeFontSize, defaultThemeSettings.codeFontSize),
  };
}

function normalizeFontSize(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.round(value), 11), 22);
}

function isAppearanceMode(value: unknown): value is AppThemeSettings['mode'] {
  return value === 'dark' || value === 'light' || value === 'system';
}

function normalizeWorkProviderSettings(value: unknown): WorkProviderSettings {
  if (!isRecord(value)) {
    return {};
  }

  const oauthClientId = normalizeOptionalString(value.oauthClientId);
  return oauthClientId ? { oauthClientId } : {};
}

function normalizeRecentRepoNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const names: string[] = [];
  for (const item of value) {
    const name = normalizeString(item);
    if (!name || names.includes(name)) {
      continue;
    }
    names.push(name);
    if (names.length >= 5) {
      break;
    }
  }
  return names;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
