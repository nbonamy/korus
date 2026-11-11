import { product } from './product';
import { normalizeGitSettings } from './git-preferences';
import type { Agent, AppSnapshot } from './contracts';
import { defaultGeneralSettings, defaultPluginSettings, defaultSourceFolderState, defaultThemeSettings } from './settings';
import { seedTeamId } from './seed-ids';
import { defaultTeamColor } from './team-colors';

const seedCreatedAt = '2026-06-05T00:00:00.000Z';

export function replaceAppSnapshot(snapshot: AppSnapshot, replacement: AppSnapshot): void {
  const target = snapshot as unknown as Record<string, unknown>;
  for (const key of Object.keys(target)) {
    if (!(key in replacement)) delete target[key];
  }
  Object.assign(snapshot, replacement);
}

export function createEmptySnapshot(): AppSnapshot {
  return {
    teams: [
      createDefaultTeam(),
    ],
    agents: [],
    automations: [],
    activeTeamId: seedTeamId,
    activeAgentId: null,
    queuedPrompts: [],
    providerApprovals: {},
    agentGitStatuses: {},
    turnGitDiffs: {},
    subagentTrees: {},
    providerRuntimes: [{
      provider: 'codex',
      status: 'notConfigured',
      detail: { key: 'backend.codexNotConnected' },
    }, {
      provider: 'claude',
      status: 'notConfigured',
      detail: { key: 'backend.claudeNotStarted' },
    }],
    workBacklog: createDefaultWorkBacklogState(),
    remoteConnections: createDefaultRemoteConnectionsState(),
    general: {
      ...defaultGeneralSettings,
      git: normalizeGitSettings(defaultGeneralSettings.git),
      collapsedRepositoryKeys: [...defaultGeneralSettings.collapsedRepositoryKeys],
      repositoryIcons: { ...defaultGeneralSettings.repositoryIcons },
      appshots: { ...defaultGeneralSettings.appshots },
      plugins: { ...defaultPluginSettings },
    },
    sourceFolder: {
      ...defaultSourceFolderState,
      recentRepoNames: [...defaultSourceFolderState.recentRepoNames],
    },
    theme: { ...defaultThemeSettings },
  };
}

export function createInitialSnapshot(): AppSnapshot {
  const agents = createSeedAgents();

  return {
    teams: [
      {
        ...createDefaultTeam(),
        agentIds: agents.map((agent) => agent.id),
      },
    ],
    agents,
    automations: [],
    activeTeamId: seedTeamId,
    activeAgentId: agents[0]?.id ?? null,
    queuedPrompts: [],
    providerApprovals: {},
    agentGitStatuses: {},
    turnGitDiffs: {},
    subagentTrees: {},
    providerRuntimes: [{
      provider: 'codex',
      status: 'notConfigured',
      detail: { key: 'backend.codexNotConnected' },
    }, {
      provider: 'claude',
      status: 'notConfigured',
      detail: { key: 'backend.claudeNotStarted' },
    }],
    workBacklog: createDefaultWorkBacklogState(),
    remoteConnections: createDefaultRemoteConnectionsState(),
    general: {
      ...defaultGeneralSettings,
      git: normalizeGitSettings(defaultGeneralSettings.git),
      collapsedRepositoryKeys: [...defaultGeneralSettings.collapsedRepositoryKeys],
      repositoryIcons: { ...defaultGeneralSettings.repositoryIcons },
      appshots: { ...defaultGeneralSettings.appshots },
      plugins: { ...defaultPluginSettings },
    },
    sourceFolder: {
      ...defaultSourceFolderState,
      recentRepoNames: [...defaultSourceFolderState.recentRepoNames],
    },
    theme: { ...defaultThemeSettings },
  };
}

function createDefaultWorkBacklogState(): AppSnapshot['workBacklog'] {
  return {
    connections: [{
      provider: 'github',
      status: 'disconnected',
    }],
    providerConfigurations: {},
    providerSettings: {},
    assignments: {},
  };
}

export function createDefaultRemoteConnectionsState(): AppSnapshot['remoteConnections'] {
  return {
    connections: [],
  };
}

function createDefaultTeam(): AppSnapshot['teams'][number] {
  return {
    id: seedTeamId,
    name: product.defaultTeamName,
    avatar: product.defaultTeamName,
    color: defaultTeamColor,
    agentIds: [],
  };
}

function createSeedAgents(): Agent[] {
  return [
    {
      id: 'agent-dina',
      teamId: seedTeamId,
      name: 'Dina',
      avatar: 'DI',
      folder: '~/src/agent-workspace',
      provider: 'codex',
      providerDefaults: { kind: 'codex' },
      status: { type: 'idle' },
      createdAt: seedCreatedAt,
      updatedAt: seedCreatedAt,
    },
    {
      id: 'agent-jesse',
      teamId: seedTeamId,
      name: 'Jesse',
      avatar: 'JE',
      folder: '~/src/agent-workspace',
      provider: 'codex',
      providerDefaults: { kind: 'codex' },
      status: { type: 'idle' },
      createdAt: seedCreatedAt,
      updatedAt: seedCreatedAt,
    },
  ];
}
