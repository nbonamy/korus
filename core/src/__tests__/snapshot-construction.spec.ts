import { describe, expect, it } from 'vitest';
import type { AppSnapshot } from '../contracts';
import { createEmptySnapshot, createInitialSnapshot } from '../snapshot-construction';
import { isAppSnapshot } from '../snapshot-guards';

describe('snapshot construction', () => {
  it('creates the exact empty snapshot used by persistence defaults', () => {
    expect(createEmptySnapshot()).toStrictEqual(expectedEmptySnapshot());
  });

  it('creates the exact initial snapshot with the Dina and Jesse seeds', () => {
    expect(createInitialSnapshot()).toStrictEqual({
      ...expectedEmptySnapshot(),
      teams: [{
        id: 'team-app',
        name: 'Korus',
        avatar: 'Korus',
        color: '#1B4FB2',
        agentIds: ['agent-dina', 'agent-jesse'],
      }],
      agents: [{
        id: 'agent-dina',
        teamId: 'team-app',
        name: 'Dina',
        avatar: 'DI',
        folder: '~/src/agent-workspace',
        backend: 'codex',
        backendDefaults: { kind: 'codex' },
        status: { type: 'idle' },
        createdAt: '2026-06-05T00:00:00.000Z',
        updatedAt: '2026-06-05T00:00:00.000Z',
      }, {
        id: 'agent-jesse',
        teamId: 'team-app',
        name: 'Jesse',
        avatar: 'JE',
        folder: '~/src/agent-workspace',
        backend: 'codex',
        backendDefaults: { kind: 'codex' },
        status: { type: 'idle' },
        createdAt: '2026-06-05T00:00:00.000Z',
        updatedAt: '2026-06-05T00:00:00.000Z',
      }],
      activeAgentId: 'agent-dina',
    });
  });

  it('returns fresh mutable snapshot collections on every construction', () => {
    const first = createEmptySnapshot();
    const second = createEmptySnapshot();

    expect(first).not.toBe(second);
    expect(first.teams).not.toBe(second.teams);
    expect(first.teams[0]).not.toBe(second.teams[0]);
    expect(first.teams[0].agentIds).not.toBe(second.teams[0].agentIds);
    expect(first.agents).not.toBe(second.agents);
    expect(first.automations).not.toBe(second.automations);
    expect(first.queuedPrompts).not.toBe(second.queuedPrompts);
    expect(first.backendApprovals).not.toBe(second.backendApprovals);
    expect(first.agentGitStatuses).not.toBe(second.agentGitStatuses);
    expect(first.turnGitDiffs).not.toBe(second.turnGitDiffs);
    expect(first.subagentTrees).not.toBe(second.subagentTrees);
    expect(first.backendRuntimes).not.toBe(second.backendRuntimes);
    expect(first.backendRuntimes[0]).not.toBe(second.backendRuntimes[0]);
    expect(first.workBacklog).not.toBe(second.workBacklog);
    expect(first.workBacklog.connections).not.toBe(second.workBacklog.connections);
    expect(first.workBacklog.providerConfigurations).not.toBe(second.workBacklog.providerConfigurations);
    expect(first.workBacklog.providerSettings).not.toBe(second.workBacklog.providerSettings);
    expect(first.workBacklog.assignments).not.toBe(second.workBacklog.assignments);
    expect(first.remoteConnections).not.toBe(second.remoteConnections);
    expect(first.remoteConnections.connections).not.toBe(second.remoteConnections.connections);
    expect(first.general).not.toBe(second.general);
    expect(first.general.collapsedRepositoryKeys).not.toBe(second.general.collapsedRepositoryKeys);
    expect(first.general.repositoryIcons).not.toBe(second.general.repositoryIcons);
    expect(first.general.appshots).not.toBe(second.general.appshots);
    expect(first.general.plugins).not.toBe(second.general.plugins);
    expect(first.sourceFolder).not.toBe(second.sourceFolder);
    expect(first.sourceFolder.recentRepoNames).not.toBe(second.sourceFolder.recentRepoNames);
    expect(first.theme).not.toBe(second.theme);

    first.teams[0].agentIds.push('agent-mutated');
    first.agents.push(createInitialSnapshot().agents[0]);
    first.backendRuntimes[0].status = 'running';
    first.workBacklog.assignments.mutated = {
      provider: 'github',
      itemId: 'owner/repo#1',
      agentId: 'agent-mutated',
      assignedAt: '2026-06-05T00:00:00.000Z',
      policy: 'review',
      status: 'inProgress',
    };
    first.remoteConnections.connections.push({
      id: 'connection-mutated',
      kind: 'ssh',
      name: 'Mutated',
      host: 'example.com',
      user: 'nicolas',
      port: 22,
      status: 'saved',
      createdAt: '2026-06-05T00:00:00.000Z',
      updatedAt: '2026-06-05T00:00:00.000Z',
    });
    first.general.collapsedRepositoryKeys.push('mutated');
    first.general.repositoryIcons.mutated = 'icon';
    first.general.appshots.hotkey = 'shift';
    first.general.plugins!.computerUseEnabled = true;
    first.sourceFolder.recentRepoNames.push('mutated');
    first.general.git!.pull = 'rebase';

    expect(second).toStrictEqual(expectedEmptySnapshot());
  });

  it('produces snapshots accepted by the app-owned guards', () => {
    const empty = createEmptySnapshot();
    const initial = createInitialSnapshot();
    expect(isAppSnapshot(empty)).toBe(true);
    expect(isAppSnapshot(initial)).toBe(true);
    expect(isAppSnapshot({ ...initial, general: null })).toBe(false);
  });

  it('rejects malformed delegation preferences and inconsistent persisted worker context', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.delegationContext = { requested: 'conversation', effective: 'handoff', reason: 'unavailable' };
    expect(isAppSnapshot(snapshot)).toBe(true);
    expect(isAppSnapshot({ ...snapshot, general: { ...snapshot.general, worktreeDelegationStartingContext: 'replay' } })).toBe(false);
    expect(isAppSnapshot({ ...snapshot, agents: [{ ...snapshot.agents[0], delegationContext: { requested: 'handoff', effective: 'conversation' } }] })).toBe(false);
    expect(isAppSnapshot({ ...snapshot, agents: [{ ...snapshot.agents[0], userDelegationOverrides: { startingContext: 'replay' } }] })).toBe(false);
    expect(isAppSnapshot({ ...snapshot, agents: [{ ...snapshot.agents[0], delegationUserInstructions: { saved: 42 } }] })).toBe(false);
  });
});

function expectedEmptySnapshot(): AppSnapshot {
  return {
    teams: [{
      id: 'team-app',
      name: 'Korus',
      avatar: 'Korus',
      color: '#1B4FB2',
      agentIds: [],
    }],
    agents: [],
    automations: [],
    activeTeamId: 'team-app',
    activeAgentId: null,
    queuedPrompts: [],
    backendApprovals: {},
    agentGitStatuses: {},
    turnGitDiffs: {},
    subagentTrees: {},
    backendRuntimes: [{
      backend: 'codex',
      status: 'notConfigured',
      detail: { key: 'backend.codexNotConnected' },
    }, {
      backend: 'claude',
      status: 'notConfigured',
      detail: { key: 'backend.claudeNotStarted' },
    }],
    workBacklog: {
      connections: [{
        provider: 'github',
        status: 'disconnected',
      }],
      providerConfigurations: {},
      providerSettings: {},
      assignments: {},
    },
    remoteConnections: {
      connections: [],
    },
    general: {
      git: { pull: 'git-config', update: 'merge' },
      commitMessageInstructions: '',
      pullRequestInstructions: '',
      codeReviewInstructions: '',
      missionInstructions: '',
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
      backlogRepositoryFavorites: {},
      savedPromptDrafts: [],
      autoResumeAfterLimit: true,
      autoResumeOnStartup: true,
      sessionCompressionWarningEnabled: true,
      useInteractivePlans: true,
      worktreeInitializationMode: 'automatic',
      worktreeDelegationStartingContext: 'handoff',
      worktreeDelegationInstructions: '',
      repositoryIcons: {},
      guestDisplayName: '',
      appshots: {
        hotkey: 'command',
        destination: 'active-agent',
        playSound: true,
      },
      plugins: {
        computerUseEnabled: false,
        chromeEnabled: false,
      },
    },
    sourceFolder: {
      path: '',
      initialized: false,
      recentRepoNames: [],
    },
    theme: {
      id: 'app-light',
      mode: 'system',
      uiFontSize: 14,
      chatFontSize: 15,
      codeFontSize: 13,
    },
  };
}
