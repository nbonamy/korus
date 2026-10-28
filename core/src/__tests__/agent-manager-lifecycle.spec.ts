import { describe, expect, it } from 'vitest';
import {
  createAgentFromInput,
  createAgentInSnapshot,
  createQuickChatInSnapshot,
  restartAgentConversation,
  resumeAgentConversationInSnapshot,
  selectAgent,
  updateAgentFromInput,
  updateAgentFolder,
  updateAgentOpenInApplication,
  updateAgentWorkspace,
} from '../agent-manager';
import { createInitialSnapshot } from '../snapshot';

describe('agent-manager lifecycle', () => {
  it('updates the agent folder and clears the old thread mapping', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.agents[0].backendSession = { kind: 'codex', threadId: 'thread-old' };
    snapshot.agents[0].contextUsage = {
      totalTokens: 397_740,
      inputTokens: 320_000,
      cachedInputTokens: 80_000,
      outputTokens: 72_000,
      reasoningOutputTokens: 24_000,
      lastTotalTokens: 64_600,
      modelContextWindow: 258_400,
      usedPercent: 25,
    };
    snapshot.agents[0].plan = {
      threadId: 'thread-old',
      turnId: 'turn-plan',
      kind: 'execution',
      status: 'inProgress',
      explanation: 'Old plan',
      steps: [{ step: 'Do old work', status: 'pending' }],
      markdown: 'Old plan\n- [ ] Do old work',
      updatedAt: '2026-06-05T00:00:00.000Z',
    };
    snapshot.agents[0].goal = {
      threadId: 'thread-old',
      objective: 'Old goal',
      status: 'active',
      tokenBudget: null,
      tokensUsed: 100,
      timeUsedSeconds: 5,
      createdAt: 1,
      updatedAt: 2,
    };
    snapshot.agents[0].isRegistered = true;
    snapshot.agents[0].mcpSessionId = 'mcp-session';
    snapshot.agents[0].statusText = 'Registered';

    expect(updateAgentFolder(snapshot, 'agent-dina', '/Users/nbonamy/src/id8', '2026-06-05T00:00:01.000Z')).toStrictEqual({
      id: 'agent-dina',
      teamId: 'team-app',
      name: 'Dina',
      avatar: 'DI',
      folder: '/Users/nbonamy/src/id8',
      backend: 'codex',
      backendDefaults: { kind: 'codex' },
      status: { type: 'idle' },
      createdAt: '2026-06-05T00:00:00.000Z',
      updatedAt: '2026-06-05T00:00:01.000Z',
    });
  });

  it('stores workspace identity and clears it when the folder changes', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const workspace = {
      kind: 'git' as const,
      folder: '/Users/nbonamy/src/agent-workspace',
      repositoryName: 'agent-workspace',
      repositoryRoot: '/Users/nbonamy/src/agent-workspace',
      branch: 'main',
      isLinkedWorktree: false,
      primaryWorktreeRoot: '/Users/nbonamy/src/agent-workspace',
      updatedAt: '2026-08-27T12:00:00.000Z',
    };

    expect(updateAgentWorkspace(snapshot, 'agent-dina', workspace)).toMatchObject({ workspace });
    snapshot.agents[0].pullRequest = {
      provider: 'github', repository: 'owner/repo', branch: 'feature', number: 7, title: 'Feature',
      url: 'https://github.com/owner/repo/pull/7', draft: false, headSha: 'abc123', state: 'open',
      createdAt: '2026-09-03T11:00:00.000Z', updatedAt: '2026-09-03T11:00:00.000Z',
    };
    updateAgentFolder(snapshot, 'agent-dina', '/Users/nbonamy/src/id8');
    expect(snapshot.agents[0].workspace).toBeUndefined();
    expect(snapshot.agents[0].pullRequest).toBeUndefined();
  });

  it('preserves the conversation title on folder changes but clears it on restart and resume', () => {
    const folderSnapshot = createInitialSnapshot();
    folderSnapshot.agents[0].conversationTitle = 'Keep this title';

    updateAgentFolder(folderSnapshot, 'agent-dina', '/Users/nbonamy/src/id8');

    expect(folderSnapshot.agents[0].conversationTitle).toBe('Keep this title');

    const restartSnapshot = createInitialSnapshot();
    restartSnapshot.agents[0].conversationTitle = 'Clear on restart';
    restartAgentConversation(restartSnapshot, 'agent-dina');
    expect(restartSnapshot.agents[0].conversationTitle).toBeUndefined();

    const resumeSnapshot = createInitialSnapshot();
    resumeSnapshot.agents[0].conversationTitle = 'Clear on resume';
    resumeAgentConversationInSnapshot(
      resumeSnapshot,
      'agent-dina',
      { kind: 'codex', threadId: 'thread-resumed' },
    );
    expect(resumeSnapshot.agents[0].conversationTitle).toBeUndefined();
  });

  it('normalizes agent creation input and clones matching backend defaults', () => {
    const thinking = { type: 'enabled' as const, budgetTokens: 12_000 };
    const input = {
      name: ' Claude agent ',
      avatar: ' CA ',
      folder: ' /Users/nbonamy/src/claude-agent ',
      backend: 'claude' as const,
      backendDefaults: { kind: 'claude' as const, thinking },
      delegatedByAgentId: ' agent-dina ',
    };

    const agent = createAgentFromInput(
      input,
      '2026-06-05T10:11:12.000Z',
      'team-claude',
      'agent-claude',
    );

    expect(agent).toStrictEqual({
      id: 'agent-claude',
      teamId: 'team-claude',
      delegatedByAgentId: 'agent-dina',
      name: 'Claude agent',
      avatar: 'CA',
      folder: '/Users/nbonamy/src/claude-agent',
      backend: 'claude',
      backendDefaults: { kind: 'claude', thinking: { type: 'enabled', budgetTokens: 12_000 } },
      status: { type: 'idle' },
      createdAt: '2026-06-05T10:11:12.000Z',
      updatedAt: '2026-06-05T10:11:12.000Z',
    });
    expect(agent.backendDefaults).not.toBe(input.backendDefaults);
    expect(agent.backendDefaults?.kind === 'claude' ? agent.backendDefaults.thinking : undefined).not.toBe(thinking);
  });

  it('creates agents in the active team and selects the new agent', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));

    createAgentInSnapshot(snapshot, {
      name: ' Jules ',
      avatar: '🤖',
      folder: '/Users/nbonamy/src/id8',
      delegatedByAgentId: ' agent-dina ',
    }, '2026-06-05T10:11:12.000Z', 'agent-new-jules');

    expect(snapshot.activeAgentId).toBe('agent-new-jules');
    expect(snapshot.teams[0].agentIds).toContain('agent-new-jules');
    expect(snapshot.teams[0].activeAgentId).toBe('agent-new-jules');
    expect(snapshot.agents.at(-1)).toStrictEqual({
      id: 'agent-new-jules',
      teamId: 'team-app',
      delegatedByAgentId: 'agent-dina',
      name: 'Jules',
      avatar: '🤖',
      folder: '/Users/nbonamy/src/id8',
      backend: 'codex',
      backendDefaults: { kind: 'codex' },
      status: { type: 'idle' },
      createdAt: '2026-06-05T10:11:12.000Z',
      updatedAt: '2026-06-05T10:11:12.000Z',
    });
  });

  it('creates agents in a requested team from overview add actions', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.teams.push({
      id: 'team-skwad',
      name: 'Skwad',
      color: '#46A857',
      agentIds: [],
    });

    createAgentInSnapshot(snapshot, {
      name: 'Abby',
      folder: '/Users/nbonamy/src/skwad',
      teamId: 'team-skwad',
    }, '2026-06-05T10:11:12.000Z', 'agent-new-abby');

    expect(snapshot.activeTeamId).toBe('team-skwad');
    expect(snapshot.activeAgentId).toBe('agent-new-abby');
    expect(snapshot.teams[0].agentIds).not.toContain('agent-new-abby');
    expect(snapshot.teams[1].agentIds).toStrictEqual(['agent-new-abby']);
    expect(snapshot.teams[1].activeAgentId).toBe('agent-new-abby');
    expect(snapshot.agents.at(-1)).toMatchObject({
      id: 'agent-new-abby',
      teamId: 'team-skwad',
      name: 'Abby',
      folder: '/Users/nbonamy/src/skwad',
    });
  });

  it('uses the stable default instead of shared active navigation for legacy creation', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.teams.push({
      id: 'team-skwad',
      name: 'Skwad',
      color: '#46A857',
      agentIds: ['agent-jesse'],
      activeAgentId: 'agent-jesse',
    });
    snapshot.teams[0].agentIds = ['agent-dina'];
    snapshot.agents[1].teamId = 'team-skwad';
    snapshot.activeTeamId = 'team-missing';
    snapshot.activeAgentId = 'agent-jesse';

    const result = createAgentInSnapshot(snapshot, {
      name: 'Abby',
      folder: '/Users/nbonamy/src/skwad',
    }, '2026-06-05T10:11:12.000Z', 'agent-new-abby');

    expect(result).toBe(snapshot);
    expect(snapshot.agents.at(-1)?.teamId).toBe('team-app');
    expect(snapshot.teams[1].agentIds).toStrictEqual(['agent-jesse']);
    expect(snapshot.activeTeamId).toBe('team-app');
    expect(snapshot.activeAgentId).toBe('agent-new-abby');
  });

  it('appends an unselected agent without changing active selection', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));

    const result = createAgentInSnapshot(snapshot, {
      name: 'Background agent',
      folder: '/Users/nbonamy/src/background',
    }, '2026-06-05T10:11:12.000Z', 'agent-background', { select: false });

    expect(result).toBe(snapshot);
    expect(snapshot.agents.map((agent) => agent.id)).toStrictEqual([
      'agent-dina',
      'agent-jesse',
      'agent-background',
    ]);
    expect(snapshot.teams[0].agentIds).toStrictEqual([
      'agent-dina',
      'agent-jesse',
      'agent-background',
    ]);
    expect(snapshot.teams[0].activeAgentId).toBe('agent-background');
    expect(snapshot.activeTeamId).toBe('team-app');
    expect(snapshot.activeAgentId).toBe('agent-dina');
  });

  it('creates selected quick chats without a folder in the requested team', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.teams.push({
      id: 'team-skwad',
      name: 'Skwad',
      color: '#46A857',
      agentIds: [],
    });

    const result = createQuickChatInSnapshot(snapshot, {
      teamId: 'team-skwad',
    }, '2026-06-05T10:11:12.000Z', 'agent-quick-chat');

    expect(result).toBe(snapshot);
    expect(snapshot.agents.at(-1)).toStrictEqual({
      id: 'agent-quick-chat',
      teamId: 'team-skwad',
      name: null,
      avatar: undefined,
      folder: null,
      backend: 'codex',
      backendDefaults: { kind: 'codex' },
      sessionKind: 'quickChat',
      status: { type: 'idle' },
      createdAt: '2026-06-05T10:11:12.000Z',
      updatedAt: '2026-06-05T10:11:12.000Z',
    });
    expect(snapshot.teams[1].agentIds).toStrictEqual(['agent-quick-chat']);
    expect(snapshot.activeTeamId).toBe('team-skwad');
    expect(snapshot.activeAgentId).toBe('agent-quick-chat');
  });

  it('creates agents without storing execution connection on the agent', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));

    createAgentInSnapshot(snapshot, {
      name: 'Remote Dina',
      folder: '/home/nicolas/src/agent-workspace',
    }, '2026-06-05T10:11:12.000Z', 'agent-remote-dina');

    expect(snapshot.agents.at(-1)).toMatchObject({
      id: 'agent-remote-dina',
      name: 'Remote Dina',
      folder: '/home/nicolas/src/agent-workspace',
    });
    expect(snapshot.agents.at(-1)).not.toHaveProperty('remoteConnectionId');
  });

  it('stores a blank created agent name as null', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));

    createAgentInSnapshot(snapshot, {
      name: ' ',
      folder: '/tmp/agent-workspace',
    }, '2026-06-05T10:11:12.000Z', 'agent-new-agent-workspace');

    expect(snapshot.agents.at(-1)?.name).toBeNull();
    expect(snapshot.agents.at(-1)?.id).toBe('agent-new-agent-workspace');
  });

  it('renames working agents without clearing runtime state', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const agent = snapshot.agents[0];
    agent.status = { type: 'working', detail: 'Running tests' };
    agent.backendSession = { kind: 'codex', threadId: 'thread-old' };
    agent.contextUsage = {
      totalTokens: 397_740,
      inputTokens: 320_000,
      cachedInputTokens: 80_000,
      outputTokens: 72_000,
      reasoningOutputTokens: 24_000,
      lastTotalTokens: 64_600,
      modelContextWindow: 258_400,
      usedPercent: 25,
    };
    agent.plan = {
      threadId: 'thread-old',
      turnId: 'turn-plan',
      kind: 'execution',
      status: 'inProgress',
      explanation: 'Old plan',
      steps: [{ step: 'Do old work', status: 'pending' }],
      markdown: 'Old plan\n- [ ] Do old work',
      updatedAt: '2026-06-05T00:00:00.000Z',
    };
    agent.goal = {
      threadId: 'thread-old',
      objective: 'Old goal',
      status: 'active',
      tokenBudget: null,
      tokensUsed: 100,
      timeUsedSeconds: 5,
      createdAt: 1,
      updatedAt: 2,
    };
    agent.isRegistered = true;
    agent.mcpSessionId = 'mcp-session';
    agent.statusText = 'Registered and idle';

    expect(updateAgentFromInput(snapshot, {
      id: 'agent-dina',
      name: 'Dina Prime',
    }, '2026-06-05T10:11:12.000Z')).toMatchObject({
      id: 'agent-dina',
      name: 'Dina Prime',
      avatar: 'DI',
      folder: '~/src/agent-workspace',
      status: { type: 'working', detail: 'Running tests' },
      backendSession: { kind: 'codex', threadId: 'thread-old' },
      plan: { turnId: 'turn-plan' },
      goal: { objective: 'Old goal' },
      updatedAt: '2026-06-05T10:11:12.000Z',
    });
    expect(snapshot.agents[0].contextUsage?.totalTokens).toBe(397_740);
    expect(snapshot.agents[0].isRegistered).toBe(true);
    expect(snapshot.agents[0].mcpSessionId).toBe('mcp-session');
  });

  it('clears an edited name without changing the existing agent workspace', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.agents[0].backendSession = { kind: 'codex', threadId: 'thread-existing' };

    updateAgentFromInput(snapshot, {
      id: 'agent-dina',
      name: null,
    }, '2026-06-05T10:11:12.000Z');

    expect(snapshot.agents[0].name).toBeNull();
    expect(snapshot.agents[0].avatar).toBe('DI');
    expect(snapshot.agents[0].folder).toBe('~/src/agent-workspace');
    expect(snapshot.agents[0].backendSession).toStrictEqual({ kind: 'codex', threadId: 'thread-existing' });
  });

  it('updates the Git diff target without changing the agent name', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const previousUpdatedAt = snapshot.agents[0].updatedAt;

    updateAgentFromInput(snapshot, {
      id: 'agent-dina',
      gitDiffTarget: { type: 'staged' },
    }, '2026-06-05T10:11:12.000Z');

    expect(snapshot.agents[0]).toMatchObject({
      name: 'Dina',
      gitDiffTarget: { type: 'staged' },
      updatedAt: previousUpdatedAt,
    });
  });

  it('returns null when updating a missing agent', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));

    expect(updateAgentFromInput(snapshot, {
      id: 'agent-missing',
      name: 'Missing',
    })).toBeNull();
  });

  it('updates the preferred application and returns null for a missing agent', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));

    expect(updateAgentOpenInApplication(
      snapshot,
      'agent-dina',
      'vscode',
      '2026-06-05T10:11:12.000Z',
    )).toMatchObject({
      id: 'agent-dina',
      openInApplication: 'vscode',
      updatedAt: '2026-06-05T10:11:12.000Z',
    });
    expect(updateAgentOpenInApplication(snapshot, 'agent-missing', 'finder')).toBeNull();
  });

  it('selects the active agent on its team when switching agents', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));

    selectAgent(snapshot, 'agent-jesse');

    expect(snapshot.activeAgentId).toBe('agent-jesse');
    expect(snapshot.activeTeamId).toBe('team-app');
    expect(snapshot.teams[0].activeAgentId).toBe('agent-jesse');
  });
});
