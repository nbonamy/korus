import { product } from '@workspace/core/product';
import path from 'node:path';
import type { Agent, AppSnapshot, BackendConversationRef, RendererMessage, SourceWorktree, SystemPermissionsStatus, ThreadGoal, WorkItem } from '@workspace/core/contracts';
import { backendMethods } from '@workspace/core/backend-protocol/methods';

export function createTestSnapshot(): AppSnapshot {
  return {
    teams: [{
      id: 'team-test',
      name: 'Test Team',
      agentIds: [],
    }],
    agents: [],
    automations: [],
    activeTeamId: 'team-test',
    activeAgentId: null,
    backendApprovals: {},
    agentGitStatuses: {},
    turnGitDiffs: {},
    subagentTrees: {},
    backendRuntimes: [],
    providerConnections: [
      { backend: 'codex', installed: true, connected: true, checking: false },
      { backend: 'claude', installed: true, connected: true, checking: false },
    ],
    workBacklog: {
      connections: [],
      providerConfigurations: {},
      providerSettings: {},
      assignments: {},
    },
    remoteConnections: {
      connections: [],
    },
    general: {
      commitMessageInstructions: '',
      pullRequestInstructions: '',
      codeReviewInstructions: '',
      preventSleepWhenAgentsRun: true,
      preventSleepWhenRemoteAccessEnabled: true,
      celebrationsEnabled: true,
      followUpBehavior: 'queue',
      spokenAnnouncementsEnabled: false,
      spokenAnnouncementsMuted: false,
      spokenAnnouncementsOnlyForDictatedPrompts: false,
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
      sessionCompressionWarningEnabled: true,
      worktreeInitializationMode: 'automatic',
      worktreeDelegationStartingContext: 'conversation',
      worktreeDelegationInstructions: '',
      repositoryIcons: {},
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

export function readyRemoteConnection(): AppSnapshot['remoteConnections']['connections'][number] {
  return {
    id: 'connection-devbox',
    kind: 'ssh',
    name: 'devbox',
    host: 'devbox',
    status: 'ready',
    transport: {
      type: 'ssh-stdio',
      command: 'ssh',
      args: ['devbox', `node ~/${product.homeDirectory}/daemon.mjs --stdio`],
    },
    createdAt: '2026-06-14T10:00:00.000Z',
    updatedAt: '2026-06-14T10:00:00.000Z',
  };
}

export function createRemoteAgent(): AppSnapshot['agents'][number] {
  return {
    id: 'agent-remote',
    teamId: 'team-remote',
    name: 'Dina',
    folder: '/home/mnmt/src/agent-workspace',
    backend: 'codex',
    status: { type: 'idle' },
    createdAt: '2026-06-14T10:00:00.000Z',
    updatedAt: '2026-06-14T10:00:00.000Z',
  };
}

export function gitWorkspace(primaryWorktreeRoot: string, repositoryName: string, branch: string): Extract<NonNullable<Agent['workspace']>, { kind: 'git' }> {
  return {
    kind: 'git',
    folder: primaryWorktreeRoot,
    repositoryName,
    repositoryRoot: primaryWorktreeRoot,
    branch,
    isLinkedWorktree: false,
    primaryWorktreeRoot,
    updatedAt: '2026-06-05T00:00:00.000Z',
  };
}

export function createRemoteTeamSnapshot(agents: AppSnapshot['agents'] = []): AppSnapshot {
  const snapshot = createTestSnapshot();
  snapshot.teams = [{
    id: 'team-remote',
    name: 'Remote Core',
    color: '#46A857',
    agentIds: agents.map((agent) => agent.id),
    activeAgentId: agents[0]?.id,
  }];
  snapshot.agents = agents;
  snapshot.activeTeamId = 'team-remote';
  snapshot.activeAgentId = agents[0]?.id ?? null;
  return snapshot;
}

export function createWorkItem(): WorkItem {
  return {
    provider: 'github',
    id: 'github:nbonamy/agent-workspace#12',
    sourceId: 'nbonamy/agent-workspace',
    sourceName: 'nbonamy/agent-workspace',
    number: 12,
    title: 'Fix bug',
    url: 'https://github.com/nbonamy/agent-workspace/issues/12',
    state: 'open',
    labels: [],
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
  };
}

export function createTextMessage(
  id: string,
  agentId: string,
  text: string,
  turnId?: string,
  role: RendererMessage['role'] = 'user',
): RendererMessage {
  return {
    id,
    agentId,
    role,
    ...(turnId ? { turnId } : {}),
    status: 'complete',
    createdAt: '2026-06-13T00:00:00.000Z',
    parts: [{ type: 'text', text }],
  };
}

export function createThreadGoal(threadId: string, objective: string): ThreadGoal {
  return {
    threadId,
    objective,
    status: 'active',
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

export async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
