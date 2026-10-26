import { describe, expect, it } from 'vitest';
import type { Agent, AppSnapshot } from '../contracts';
import { createEmptySnapshot, createInitialSnapshot } from '../snapshot-construction';
import {
  decodeAppSnapshot,
  isAppSnapshot,
  isClientState,
} from '../snapshot-guards';

describe('snapshot guards', () => {
  it('decodes valid empty, seeded, JSON, and fully populated snapshots', () => {
    const empty = createEmptySnapshot();
    const seeded = createInitialSnapshot();
    const full = completeSnapshot();
    const json = JSON.parse(JSON.stringify(full)) as unknown;

    expect(decodeAppSnapshot(empty)).toStrictEqual({ value: empty });
    expect(decodeAppSnapshot(seeded)).toStrictEqual({ value: seeded });
    expect(decodeAppSnapshot(json)).toStrictEqual({ value: json });
    expect(isAppSnapshot(full)).toBe(true);
  });

  it('validates public MCP eligibility without requiring it on legacy connections', () => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections.push({ provider: 'gitlab', status: 'connected', hostedMcp: { status: 'restricted' } });
    expect(decodeAppSnapshot(snapshot)).toStrictEqual({ value: snapshot });
    snapshot.workBacklog.connections.at(-1)!.hostedMcp = { status: 'invalid' as never };
    expect(isAppSnapshot(snapshot)).toBe(false);
  });

  it('returns the original snapshot object identity', () => {
    const full = completeSnapshot();
    expect(decodeAppSnapshot(full)?.value).toBe(full);
  });

  it('rejects malformed nested fields across every snapshot domain', () => {
    const invalidCases: Array<{
      name: string;
      mutate: (snapshot: AppSnapshot) => void;
    }> = [
      { name: 'teams collection', mutate: (snapshot) => { snapshot.teams = {} as never; } },
      { name: 'team agent ids', mutate: (snapshot) => { snapshot.teams[0]!.agentIds = [42 as never]; } },
      { name: 'agents collection', mutate: (snapshot) => { snapshot.agents = {} as never; } },
      { name: 'agent status', mutate: (snapshot) => { snapshot.agents[0]!.status = { type: 'waiting' } as never; } },
      { name: 'agent status app text', mutate: (snapshot) => { snapshot.agents[0]!.status = { type: 'working', detail: { key: 'working', params: { invalid: {} as never } } }; } },
      { name: 'agent pull request', mutate: (snapshot) => { snapshot.agents[0]!.pullRequest!.headSha = 42 as never; } },
      { name: 'agent workspace', mutate: (snapshot) => {
        const workspace = snapshot.agents[0]!.workspace;
        if (workspace?.kind === 'git') workspace.isLinkedWorktree = 'yes' as never;
      } },
      { name: 'agent backend session', mutate: (snapshot) => { snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 42 as never }; } },
      { name: 'agent backend defaults', mutate: (snapshot) => { snapshot.agents[0]!.backendDefaults = { kind: 'codex', approvalPreset: 'later' as never }; } },
      { name: 'agent application', mutate: (snapshot) => { snapshot.agents[0]!.openInApplication = 'emacs' as never; } },
      { name: 'agent context', mutate: (snapshot) => { snapshot.agents[0]!.contextUsage!.inputTokens = 'many' as never; } },
      { name: 'agent plan', mutate: (snapshot) => { snapshot.agents[0]!.plan!.steps[0]!.status = 'working' as never; } },
      { name: 'agent goal', mutate: (snapshot) => { snapshot.agents[0]!.goal!.tokenBudget = 'unlimited' as never; } },
      { name: 'agent registration', mutate: (snapshot) => { snapshot.agents[0]!.isRegistered = 'yes' as never; } },
      { name: 'automation target', mutate: (snapshot) => { snapshot.automations[0]!.target = { kind: 'unknown' } as never; } },
      { name: 'automation schedule', mutate: (snapshot) => { snapshot.automations[0]!.schedule = { intervalMinutes: 'hourly' as never }; } },
      { name: 'automation log', mutate: (snapshot) => { snapshot.automations[0]!.executionLog[0]!.status = 'pending' as never; } },
      { name: 'automation created agent', mutate: (snapshot) => { snapshot.automations[0]!.executionLog[0]!.conversationRef = { backend: 'codex', threadId: 42 as never }; } },
      { name: 'backend runtime', mutate: (snapshot) => { snapshot.backendRuntimes[0]!.status = 'stopped' as never; } },
      { name: 'backend capabilities', mutate: (snapshot) => { snapshot.backendRuntimes[0]!.capabilities!.planMode = 'automatic' as never; } },
      { name: 'approval presets', mutate: (snapshot) => { snapshot.backendRuntimes[0]!.capabilities!.approvalPresets = ['later' as never]; } },
      { name: 'permission descriptors', mutate: (snapshot) => { snapshot.backendRuntimes[0]!.capabilities!.permissionModes![0]!.label = { key: 42 as never }; } },
      { name: 'backend approvals collection', mutate: (snapshot) => { snapshot.backendApprovals.agent = {} as never; } },
      { name: 'backend requested permissions', mutate: (snapshot) => { snapshot.backendApprovals.agent![0]!.requestedPermissions![0] = { kind: 'filesystem', access: 'execute' as never, path: '/repo' }; } },
      { name: 'subagent tree', mutate: (snapshot) => { snapshot.subagentTrees.root!.rootConversationId = 42 as never; } },
      { name: 'subagent node', mutate: (snapshot) => { snapshot.subagentTrees.root!.nodes.child!.status = 'waiting' as never; } },
      { name: 'subagent identity', mutate: (snapshot) => { snapshot.subagentTrees.root!.nodes.child!.agentNickname = 42 as never; } },
      { name: 'subagent operation', mutate: (snapshot) => { snapshot.subagentTrees.root!.operations.operation!.lifecycle = 'pending' as never; } },
      { name: 'subagent activity', mutate: (snapshot) => { snapshot.subagentTrees.root!.activities.activity!.kind = 'waiting' as never; } },
      { name: 'work backlog connection', mutate: (snapshot) => { snapshot.workBacklog.connections[0]!.status = 'ready' as never; } },
      { name: 'work backlog provider configuration', mutate: (snapshot) => { snapshot.workBacklog.providerConfigurations.github!.sourceId = 42 as never; } },
      { name: 'work backlog provider settings', mutate: (snapshot) => { snapshot.workBacklog.providerSettings.github!.oauthClientId = 42 as never; } },
      { name: 'work backlog assignment', mutate: (snapshot) => { snapshot.workBacklog.assignments.item!.status = 'working' as never; } },
      { name: 'remote connection', mutate: (snapshot) => { snapshot.remoteConnections.connections[0]!.status = 'connected' as never; } },
      { name: 'remote daemon version', mutate: (snapshot) => { snapshot.remoteConnections.connections[0]!.daemonVersion = 42 as never; } },
      { name: 'remote Codex version', mutate: (snapshot) => { snapshot.remoteConnections.connections[0]!.codexVersion = 42 as never; } },
      { name: 'remote transport', mutate: (snapshot) => { snapshot.remoteConnections.connections[0]!.transport!.args = [42 as never]; } },
      { name: 'general settings', mutate: (snapshot) => { snapshot.general.celebrationsEnabled = 'yes' as never; } },
      { name: 'follow-up behavior', mutate: (snapshot) => { snapshot.general.followUpBehavior = 'invalid' as never; } },
      { name: 'saved prompt draft', mutate: (snapshot) => { snapshot.general.savedPromptDrafts = [{ id: 'draft', agentId: 'agent', text: 'Prompt', createdAt: 'now' as never }]; } },
      { name: 'plugin settings', mutate: (snapshot) => { snapshot.general.plugins!.chromeEnabled = 'yes' as never; } },
      { name: 'appshot settings', mutate: (snapshot) => { snapshot.general.appshots.hotkey = 'control' as never; } },
      { name: 'repository icons', mutate: (snapshot) => { snapshot.general.repositoryIcons.repo = 42 as never; } },
      { name: 'source folder', mutate: (snapshot) => { snapshot.sourceFolder.recentRepoNames = [42 as never]; } },
      { name: 'theme', mutate: (snapshot) => { snapshot.theme.mode = 'auto' as never; } },
      { name: 'queued prompt', mutate: (snapshot) => { snapshot.queuedPrompts![0]!.attempts = 'once' as never; } },
      { name: 'prompt attachment', mutate: (snapshot) => { snapshot.queuedPrompts![0]!.options!.attachments![0]!.type = 'audio' as never; } },
      { name: 'prompt backend options', mutate: (snapshot) => { snapshot.queuedPrompts![0]!.options!.backendOptions = { kind: 'codex', serviceTier: 42 as never }; } },
      { name: 'delegation override context', mutate: (snapshot) => { snapshot.queuedPrompts![0]!.options!.delegation = { startingContext: 'replay' as never }; } },
      { name: 'delegation override instructions', mutate: (snapshot) => { snapshot.queuedPrompts![0]!.options!.delegation = { startingContext: 'handoff', instructions: 42 as never }; } },
      { name: 'agent git status', mutate: (snapshot) => { snapshot.agentGitStatuses.agent!.branch = null as never; } },
      { name: 'turn git diff', mutate: (snapshot) => { snapshot.turnGitDiffs.turn!.addedLines = 'one' as never; } },
      { name: 'account rate limits', mutate: (snapshot) => { snapshot.accountRateLimits!.primary!.usedPercent = 'half' as never; } },
      { name: 'active ids', mutate: (snapshot) => { snapshot.activeAgentId = 42 as never; } },
    ];

    for (const { name, mutate } of invalidCases) {
      const snapshot = structuredClone(completeSnapshot());
      mutate(snapshot);
      expect(decodeAppSnapshot(snapshot), name).toBeNull();
      expect(isAppSnapshot(snapshot), name).toBe(false);
    }
  });

  it('allows additive unknown fields at every record seam', () => {
    const snapshot = completeSnapshot();
    Object.assign(snapshot, { futureSnapshotField: { enabled: true } });
    Object.assign(snapshot.agents[0]!, { futureAgentField: ['preserved'] });
    Object.assign(snapshot.general, { futureGeneralField: 42 });

    expect(decodeAppSnapshot(snapshot)).toStrictEqual({ value: snapshot });
  });

  it('allows stale references and duplicate ids because validation is structural only', () => {
    const snapshot = completeSnapshot();
    snapshot.teams.push(structuredClone(snapshot.teams[0]!));
    snapshot.activeAgentId = 'missing-agent';
    snapshot.activeTeamId = 'missing-team';
    snapshot.teams[0]!.agentIds.push(snapshot.teams[0]!.agentIds[0]!);
    snapshot.agentGitStatuses.unrelated = snapshot.agentGitStatuses.agent!;

    expect(isAppSnapshot(snapshot)).toBe(true);
  });

  it('validates the complete client-state structure without rejecting additive fields', () => {
    expect(isClientState({
      sourceFolderPath: '/repo',
      shouldPreventDisplaySleep: false,
      shouldPreventDisplaySleepForRemoteAccess: true,
      futureField: 'preserved',
    })).toBe(true);
    expect(isClientState({
      sourceFolderPath: '/repo',
      shouldPreventDisplaySleep: false,
      shouldPreventDisplaySleepForRemoteAccess: 'yes',
    })).toBe(false);
  });
});

function completeSnapshot(): AppSnapshot {
  const snapshot = createInitialSnapshot();
  const codexAgent = snapshot.agents[0]!;
  Object.assign(codexAgent, {
    delegatedByAgentId: 'agent-parent',
    pullRequest: {
      provider: 'github',
      repository: 'openai/agent-workspace',
      branch: 'feature/deep-guards',
      number: 12,
      title: 'Deepen snapshot validation',
      url: 'https://github.com/openai/agent-workspace/pull/12',
      draft: false,
      headSha: 'abc123',
      state: 'open',
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    },
    conversationTitle: 'Snapshot validation',
    workspace: {
      kind: 'git',
      folder: '/repo',
      repositoryName: 'agent-workspace',
      repositoryRoot: '/repo',
      branch: 'feature/deep-guards',
      isLinkedWorktree: true,
      primaryWorktreeRoot: '/repo-main',
      originUrl: 'git@github.com:openai/agent-workspace.git',
      updatedAt: '2026-09-04T00:00:00.000Z',
    },
    backendSession: { kind: 'codex', threadId: 'thread-codex' },
    backendDefaults: {
      kind: 'codex',
      model: 'gpt-5',
      approvalPreset: 'ask-for-approval',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandboxMode: 'workspace-write',
      reasoningEffort: 'high',
      serviceTier: null,
    },
    openInApplication: 'vscode',
    contextUsage: {
      totalTokens: 10,
      inputTokens: 4,
      cachedInputTokens: 1,
      outputTokens: 3,
      reasoningOutputTokens: 2,
      lastTotalTokens: 8,
      modelContextWindow: 200_000,
      usedPercent: 5,
    },
    plan: {
      threadId: 'thread-codex',
      turnId: 'turn-1',
      kind: 'execution',
      status: 'inProgress',
      explanation: 'Validate snapshots',
      steps: [{ step: 'Inspect', status: 'completed' }],
      markdown: '# Plan',
      updatedAt: '2026-09-04T00:00:00.000Z',
    },
    goal: {
      threadId: 'thread-codex',
      objective: 'Deep validation',
      status: 'active',
      tokenBudget: null,
      tokensUsed: 10,
      timeUsedSeconds: 2,
      createdAt: 1,
      updatedAt: 2,
    },
    isRegistered: true,
    mcpSessionId: 'mcp-1',
    statusText: 'Validating',
    status: { type: 'working', detail: { key: 'agent.working', params: { count: 1 } } },
  } satisfies Partial<Agent>);
  const claudeAgent: Agent = {
    id: 'agent-claude',
    teamId: snapshot.teams[0]!.id,
    sessionKind: 'quickChat',
    name: null,
    folder: null,
    backend: 'claude',
    backendSession: {
      kind: 'claude',
      sessionId: 'session-claude',
      transport: 'websocket',
      transcriptSessionId: 'transcript-claude',
      serverUrl: 'ws://localhost',
      model: 'claude-opus',
      reasoningEffort: 'high',
    },
    backendDefaults: {
      kind: 'claude',
      model: 'claude-opus',
      reasoningEffort: 'high',
      permissionMode: 'default',
      thinking: { type: 'enabled', budgetTokens: 4_096 },
    },
    status: { type: 'error', message: 'Stopped' },
    createdAt: '2026-09-04T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
  };
  snapshot.agents.push(claudeAgent);
  snapshot.teams[0]!.agentIds.push(claudeAgent.id);
  snapshot.teams[0]!.activeAgentId = codexAgent.id;
  snapshot.teams[0]!.remoteConnectionId = 'remote-1';
  snapshot.teams[0]!.remoteTeamId = 'remote-team-1';
  snapshot.automations = [{
    id: 'automation-1',
    name: 'Backlog',
    enabled: true,
    prompt: 'Implement it', target: { kind: 'newQuickChat' as const, teamId: snapshot.teams[0]!.id, backend: 'codex' as const },



    schedule: { intervalMinutes: 60 },
    executionLog: [{
      id: 'execution-1',
      automationId: 'automation-1',
      startedAt: '2026-09-04T00:00:00.000Z',
      completedAt: '2026-09-04T00:01:00.000Z',
      status: 'completed',

      agentId: codexAgent.id, agentName: 'Dina', conversationRef: { backend: 'codex', threadId: 'thread-codex' },
    }],
    createdAt: '2026-09-04T00:00:00.000Z',
    updatedAt: '2026-09-04T00:01:00.000Z',
    lastRunAt: '2026-09-04T00:00:00.000Z',

  }];
  snapshot.queuedPrompts = [{
    id: 'prompt-1',
    agentId: codexAgent.id,
    text: 'Continue',
    createdAt: '2026-09-04T00:00:00.000Z',
    attempts: 1,
    lastError: 'Busy',
    retryAt: '2026-09-04T00:01:00.000Z',
    submitted: true,
    options: {
      delegation: { startingContext: 'conversation', instructions: 'Task instructions' },
      attachments: [
        { type: 'image', path: '/tmp/image.png', detail: 'high', name: 'image.png', mimeType: 'image/png', previewUrl: 'data:image/png;base64,AA==' },
        { type: 'file', path: '/tmp/plan.md', name: 'plan.md', mimeType: 'text/markdown' },
      ],
      model: null,
      planMode: true,
      reasoningEffort: 'high',
      serviceTier: null,
      skills: [{ name: 'review', path: '/skills/review' }],
      inputMethod: 'typed',
      backendOptions: { kind: 'codex', reasoningEffort: 'high', serviceTier: null, skills: [{ name: 'review', path: '/skills/review' }] },
    },
  }, {
    id: 'prompt-2',
    agentId: claudeAgent.id,
    text: 'Continue',
    createdAt: '2026-09-04T00:00:00.000Z',
    options: { backendOptions: { kind: 'claude', thinkingBudgetTokens: 4_096, permissionMode: null } },
  }];
  snapshot.backendApprovals = {
    agent: [{
      id: 'approval-1',
      kind: 'permissions',
      conversationId: 'thread-codex',
      turnId: 'turn-1',
      itemId: 'tool-1',
      title: 'Allow command',
      description: 'Run tests',
      command: 'npm test',
      cwd: '/repo',
      requestedPermissions: [
        { kind: 'filesystem', access: 'write', path: '/repo' },
        { kind: 'network', enabled: true, host: 'github.com', protocol: 'https' },
      ],
      allowedScopes: ['once', 'session'],
      canDeny: true,
    }],
  };
  snapshot.agentGitStatuses = {
    agent: {
      folder: '/repo',
      repository: 'agent-workspace',
      githubRepository: 'openai/agent-workspace',
      branch: 'feature/deep-guards',
      upstream: 'origin/feature/deep-guards',
      ahead: 1,
      behind: 0,
      changedFiles: 2,
      addedLines: 10,
      removedLines: 1,
      hasUntracked: true,
      state: 'dirty',
      updatedAt: '2026-09-04T00:00:00.000Z',
    },
  };
  snapshot.turnGitDiffs = {
    turn: {
      agentId: codexAgent.id,
      turnId: 'turn-1',
      addedLines: 10,
      removedLines: 1,
      diff: 'diff --git',
      updatedAt: '2026-09-04T00:00:00.000Z',
    },
  };
  snapshot.subagentTrees = {
    root: {
      rootConversationId: 'thread-codex',
      nodes: {
        child: {
          conversationId: 'thread-child',
          parentConversationId: 'thread-codex',
          createdAt: '2026-09-04T00:00:00.000Z',
          status: 'running',
          statusMessage: 'Working',
          agentPath: 'agent/child',
          agentNickname: 'Child',
          agentRole: 'Reviewer',
          prompt: 'Review',
          model: 'gpt-5',
          reasoningEffort: 'high',
          updatedAt: '2026-09-04T00:01:00.000Z',
        },
      },
      operations: {
        operation: {
          id: 'operation-1',
          turnId: 'turn-1',
          lifecycle: 'completed',
          kind: 'spawnAgent',
          status: 'completed',
          senderConversationId: 'thread-codex',
          receiverConversationIds: ['thread-child'],
          prompt: 'Review',
          model: 'gpt-5',
          reasoningEffort: 'high',
          occurredAt: '2026-09-04T00:00:00.000Z',
        },
      },
      activities: {
        activity: {
          id: 'activity-1',
          turnId: 'turn-1',
          lifecycle: 'started',
          kind: 'interacted',
          conversationId: 'thread-child',
          agentPath: 'agent/child',
          occurredAt: '2026-09-04T00:00:00.000Z',
        },
      },
    },
  };
  snapshot.backendRuntimes = [{
    backend: 'codex',
    status: 'running',
    detail: { key: 'backend.running' },
    capabilities: {
      attachments: true,
      models: true,
      skills: true,
      reasoningEffort: true,
      serviceTier: true,
      thinkingBudget: false,
      planMode: 'native',
      goals: true,
      steerPrompt: true,
      interrupt: true,
      history: true,
      conversationFork: true,
      deleteTurn: true,
      editTurn: true,
      retryTurn: true,
      approvals: true,
      approvalPresets: ['ask-for-approval'],
      permissionModes: [{ id: 'default', label: 'Default', description: { key: 'permission.default' }, dangerous: false }],
    },
  }, {
    backend: 'claude',
    status: 'starting',
  }];
  snapshot.accountRateLimits = {
    limitId: 'primary',
    limitName: 'Primary',
    primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1_000 },
    secondary: null,
    credits: { remaining: 10 },
    individualLimit: null,
    planType: 'team',
    rateLimitReachedType: null,
  };
  snapshot.workBacklog = {
    connections: [{
      provider: 'github',
      status: 'connected',
      accountLabel: 'openai',
      detail: { key: 'work.connected' },
      connectedAt: '2026-09-04T00:00:00.000Z',
    }],
    providerConfigurations: {
      github: { sourceId: 'openai/agent-workspace', assigneeLogin: 'octocat', tagName: 'codex' },
    },
    providerSettings: {
      github: { oauthClientId: 'client-id' },
    },
    assignments: {
      item: {
        provider: 'github',
        itemId: 'issue-1',
        agentId: codexAgent.id,
        assignedAt: '2026-09-04T00:00:00.000Z',
        policy: 'review',
        status: 'inProgress',
        completedAt: '2026-09-04T00:02:00.000Z',
        note: 'Review',
        updatedAt: '2026-09-04T00:01:00.000Z',
        automationId: 'automation-1',
        automationExecutionId: 'execution-1',
      },
    },
  };
  snapshot.remoteConnections = {
    connections: [{
      id: 'remote-1',
      kind: 'ssh',
      name: 'Remote',
      host: 'remote.example.com',
      hostName: 'remote.example.com',
      user: 'codex',
      port: 22,
      identityFile: '~/.ssh/id_ed25519',
      status: 'ready',
      detail: 'Connected',
      sourceFolderPath: '/repo',
      transport: { type: 'ssh-stdio', command: 'ssh', args: ['remote.example.com'] },
      installedAt: '2026-09-04T00:00:00.000Z',
      lastCheckedAt: '2026-09-04T00:01:00.000Z',
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:01:00.000Z',
    }],
  };
  snapshot.general.plugins = { computerUseEnabled: true, chromeEnabled: true };
  snapshot.general.repositoryIcons = { repo: '🦞' };
  snapshot.sourceFolder = { path: '/repo', initialized: true, recentRepoNames: ['agent-workspace'] };
  snapshot.theme = { id: 'dark', mode: 'system', uiFontSize: 14, chatFontSize: 15, codeFontSize: 13 };
  return snapshot;
}
