import type { AppGeneralSettings,AppSnapshot,AppThemeSettings,OpenInApplication,UpdateSettingsInput } from './contracts';
import { normalizeGeneralSettings,normalizeThemeSettings } from './settings';

export const clientGeneralSettingKeys = [
  'agentListCompact', 'collapsedRepositoryKeys', 'modelFavorites',
  'backlogRepositoryFavorites', 'repositoryIcons', 'sessionCompressionWarningEnabled', 'spokenAnnouncementsMuted',
  'savedPromptDrafts', 'followUpBehavior', 'browserBookmarks',
  'spokenAnnouncementsOnlyWhenFocused', 'spokenAnnouncementScope', 'spokenAnnouncementVoice',
] as const satisfies readonly (keyof AppGeneralSettings)[];
export type ClientPreferences = {
  activeAgentId?: string | null;
  activeTeamId?: string | null;
  activeAgentByTeam?: Record<string, string>;
  teamOrder?: string[];
  agentOrderByTeam?: Record<string, string[]>;
  externalApplications?: Record<string, OpenInApplication>;
  general?: Partial<Pick<AppGeneralSettings, typeof clientGeneralSettingKeys[number]>>;
  theme?: Partial<AppThemeSettings>;
};

export function splitSettingsInput(input: UpdateSettingsInput): { policy: UpdateSettingsInput; preferences: UpdateSettingsInput } {
  const general = Object.entries(input.general ?? {});
  const isClientKey = (key: string) => (clientGeneralSettingKeys as readonly string[]).includes(key);
  return {
    policy: {
      ...(input.sourceFolder ? { sourceFolder: input.sourceFolder } : {}),
      ...(input.workProviders ? { workProviders: input.workProviders } : {}),
      ...(general.some(([key]) => !isClientKey(key)) ? { general: Object.fromEntries(general.filter(([key]) => !isClientKey(key))) } : {}),
    },
    preferences: {
      ...(input.theme ? { theme: input.theme } : {}),
      ...(general.some(([key]) => isClientKey(key)) ? { general: Object.fromEntries(general.filter(([key]) => isClientKey(key))) } : {}),
    },
  };
}

export function projectClientSnapshot(snapshot: AppSnapshot, clientId: string): AppSnapshot {
  const preferences = snapshot.clientPreferences?.[clientId];
  if (!preferences) return snapshot;
  const projected = structuredClone(snapshot);
  const order = preferences.teamOrder ?? [];
  projected.teams.sort((left, right) => rank(order, left.id) - rank(order, right.id));
  for (const team of projected.teams) {
    const agentOrder = [...preferences.agentOrderByTeam?.[team.id] ?? []];
    // New reviewers follow their source until this client explicitly orders them.
    for (const id of [...team.agentIds].reverse()) {
      if (agentOrder.includes(id)) continue;
      const review = projected.agents.find(agent => agent.id === id)?.codeReview;
      if (review?.threadMode !== 'independent' || review.reviewerAgentId !== id) continue;
      const sourceIndex = agentOrder.indexOf(review.targetAgentId);
      if (sourceIndex >= 0 && team.agentIds.includes(review.targetAgentId)) agentOrder.splice(sourceIndex + 1, 0, id);
    }
    team.agentIds.sort((left, right) => rank(agentOrder, left) - rank(agentOrder, right));
    const selected = preferences.activeAgentByTeam?.[team.id];
    if (selected && team.agentIds.includes(selected)) team.activeAgentId = selected;
  }
  for (const agent of projected.agents) {
    const application = preferences.externalApplications?.[agent.id];
    if (application) agent.openInApplication = application;
  }
  if (preferences.activeTeamId && projected.teams.some((team) => team.id === preferences.activeTeamId)) projected.activeTeamId = preferences.activeTeamId;
  const selectedAgent = projected.agents.find((agent) => agent.id === preferences.activeAgentId);
  if (selectedAgent) {
    projected.activeAgentId = selectedAgent.id;
    projected.activeTeamId = selectedAgent.teamId ?? projected.activeTeamId;
  } else if (preferences.activeAgentId === null) projected.activeAgentId = null;
  else if (preferences.activeAgentId) {
    const team = projected.teams.find((candidate) => candidate.id === projected.activeTeamId);
    projected.activeAgentId = team?.activeAgentId ?? team?.agentIds[0] ?? null;
  }
  if (preferences.general) projected.general = normalizeGeneralSettings({ ...projected.general, ...preferences.general });
  if (preferences.theme) projected.theme = normalizeThemeSettings({ ...projected.theme, ...preferences.theme });
  return projected;
}

function rank(order: string[], id: string): number {
  const index = order.indexOf(id);
  return index < 0 ? order.length : index;
}

export function sanitizeClientPreferences(value: unknown): Record<string, ClientPreferences> {
  const record = (input: unknown): Record<string, unknown> => input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const strings = (input: unknown): string[] => Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : [];
  return Object.fromEntries(Object.entries(record(value)).map(([id, input]) => {
    const entry = record(input);
    const general = record(entry.general);
    const normalized = normalizeGeneralSettings(general);
    const preferences: ClientPreferences = {
      ...(typeof entry.activeAgentId === 'string' || entry.activeAgentId === null ? { activeAgentId: entry.activeAgentId } : {}),
      ...(typeof entry.activeTeamId === 'string' || entry.activeTeamId === null ? { activeTeamId: entry.activeTeamId } : {}),
      activeAgentByTeam: Object.fromEntries(Object.entries(record(entry.activeAgentByTeam)).filter((pair): pair is [string, string] => typeof pair[1] === 'string')),
      teamOrder: strings(entry.teamOrder),
      agentOrderByTeam: Object.fromEntries(Object.entries(record(entry.agentOrderByTeam)).map(([team, ids]) => [team, strings(ids)])),
      externalApplications: Object.fromEntries(Object.entries(record(entry.externalApplications)).filter((pair): pair is [string, OpenInApplication] => ['vscode', 'finder', 'terminal', 'iterm2', 'ghostty', 'xcode', 'android-studio', 'jetbrains'].includes(pair[1] as string))),
      general: Object.fromEntries(clientGeneralSettingKeys.filter((key) => key in general).map((key) => [key, normalized[key]])),
      ...(entry.theme ? { theme: normalizeThemeSettings(entry.theme) } : {}),
    };
    return [id, preferences];
  }));
}
