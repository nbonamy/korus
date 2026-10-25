import { product } from '../product';
import { emptyAntigravitySnapshot } from '../antigravity-conversation-replica';
import { approvalAgentRequest, approvalOutcome } from '@workspace/core/agent-request';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { AppBackendEvent as RpcAppBackendEvent } from '../backend-protocol/rpc';
import {
  decodeAppBackendEvent,
  type AppBackendEvent,
} from '../backend-protocol/events';
import type { AppSnapshot } from '../contracts';
import { createInitialSnapshot } from '../snapshot-construction';

type EventOf<Type extends AppBackendEvent['type']> = Extract<
  AppBackendEvent,
  { type: Type }
>;
type EventFixtures = { [Type in AppBackendEvent['type']]: EventOf<Type> };

const occurredAt = '2026-09-04T12:00:00.000Z';
const usage = {
  totalTokens: 10,
  inputTokens: 4,
  cachedInputTokens: 1,
  outputTokens: 5,
  reasoningOutputTokens: 2,
  lastTotalTokens: 9,
  modelContextWindow: 1000,
  usedPercent: 1,
};
const message = {
  id: 'message-1',
  agentId: 'agent-1',
  role: 'assistant' as const,
  status: 'complete' as const,
  parts: [{ type: 'text' as const, text: 'Done' }],
  createdAt: occurredAt,
};
const toolPart = {
  type: 'tool' as const,
  id: 'tool-1',
  kind: 'command',
  title: 'Run tests',
  status: 'completed' as const,
};
const gitStatus = {
  folder: '/repo',
  ahead: 0,
  behind: 0,
  changedFiles: 0,
  addedLines: 0,
  removedLines: 0,
  hasUntracked: false,
  state: 'clean' as const,
  updatedAt: occurredAt,
};
const approval = {
  id: 'approval-1',
  kind: 'command' as const,
  conversationId: 'thread-1',
  itemId: 'item-1',
  title: 'Run command',
};
const confirmTool = {
  id: 'request-1',
  kind: 'confirm_tool' as const,
  payload: {
    confirmation: {
      argumentsPreview: 'npm test',
      integrationId: 'shell',
      integrationName: 'Shell',
      summary: 'Run tests',
      toolName: 'exec',
    },
  },
};
const askUser = {
  id: 'request-2',
  kind: 'ask_user' as const,
  payload: {
    request: {
      itemId: 'item-2',
      questions: [
        {
          id: 'question-1',
          header: 'Choice',
          question: 'Continue?',
          isOther: false,
          isSecret: false,
          options: [{ label: 'Yes', description: 'Continue' }],
        },
      ],
    },
  },
};

function createFixtures(): EventFixtures {
  const snapshot = createInitialSnapshot();
  const metadata = snapshot;
  const base = { seq: 1, occurredAt };
  const agent = { ...base, agentId: 'agent-1' };
  const codexThread = {
    ...agent,
    backend: 'codex' as const,
    threadId: 'thread-1',
  };
  const turn = { ...codexThread, turnId: 'turn-1' };

  return {
    'antigravity.conversationSnapshotChanged': {
      ...base, type: 'antigravity.conversationSnapshotChanged', agentId: 'agent-1', backend: 'antigravity', backendSessionId: 'session-1',
      payload: { revision: 1, snapshot: emptyAntigravitySnapshot('agent-1', 'session-1') },
    },
    'antigravity.conversationEventReceived': {
      ...base, type: 'antigravity.conversationEventReceived', agentId: 'agent-1', backend: 'antigravity', backendSessionId: 'session-1',
      payload: { revision: 2, event: { agentId: 'agent-1', sessionId: 'session-1', turnId: 'turn-1', occurredAt: base.occurredAt, type: 'turn.started', payload: { turn: { id: 'turn-1' } } } },
    },
    'provider.authenticationChanged': {
      ...base, type: 'provider.authenticationChanged',
      payload: { kind: 'claude', connected: false, state: { loggedIn: false } },
    },
    'plan.reviewResolved': {
      ...base, agentId: 'agent-1', type: 'plan.reviewResolved',
      payload: { reviewId: 'review-1', resolution: 'accept' },
    },
    'backend.statusChanged': {
      ...base,
      type: 'backend.statusChanged',
      backend: 'codex',
      payload: { backend: 'codex', status: 'running' },
    },
    'snapshot.updated': {
      ...base,
      type: 'snapshot.updated',
      payload: metadata,
    },
    'account.rateLimitsUpdated': {
      ...base,
      type: 'account.rateLimitsUpdated',
      backend: 'codex',
      payload: { rateLimits: {
        limitId: null,
        limitName: null,
        primary: null,
        secondary: null,
        credits: null,
        individualLimit: null,
        planType: null,
        rateLimitReachedType: null,
      } },
    },
    'remoteControl.statusChanged': {
      ...base,
      type: 'remoteControl.statusChanged',
      payload: { status: 'connected' },
    },
    'models.changed': {
      ...base,
      type: 'models.changed',
      backend: 'codex',
      payload: { models: [{ id: 'gpt', model: 'gpt', displayName: 'GPT' }] },
    },
    'skills.changed': {
      ...base,
      type: 'skills.changed',
      backend: 'codex',
      payload: {
        cwd: null,
        status: 'loaded',
        skills: [{ name: 'test', path: '/skill', enabled: true }],
      },
    },
    'codex.conversationSnapshotChanged': {
      ...codexThread,
      type: 'codex.conversationSnapshotChanged',
      payload: {
        revision: 1,
        snapshot: {
          status: 'ready',
          authentication: {
            status: 'loaded', account: null, requiresOpenaiAuth: false,
            error: null, login: { status: 'idle', loginId: null, authUrl: null, error: null },
          },
          conversations: [],
          activeConversationId: 'thread-1',
          activeTurnId: null,
          turnIds: [],
          turns: [],
          messages: [],
          historyLoading: false,
          historyState: { loadingStrategy: 'eager', hasOlder: false, loadingOlder: false, fullyLoaded: true },
          clientRequests: [],
          answeredClientRequestIds: [],
          approvals: [],
          models: [],
          modelCatalogStatus: 'loaded',
          skills: [],
          skillCatalogStatus: 'loaded',
          plugins: [],
          pluginCatalogStatus: 'loaded',
          permissionProfiles: [],
          approvalPresets: [],
          approvalPreset: null,
          selectedModelId: null,
          selectedReasoningEffort: null,
          selectedServiceTier: null,
          planMode: false,
          contextUsage: null,
          goal: null,
          turnGitDiff: null,
          threadStatus: null,
          rateLimits: null,
          queuedPrompts: [],
          busy: false,
          error: null,
        },
      },
    },
    'codex.conversationEventReceived': {
      ...codexThread,
      type: 'codex.conversationEventReceived',
      payload: {
        revision: 2,
        event: {
          seq: 7,
          occurredAt,
          origin: 'notification',
          type: 'message.delta',
          conversationId: 'thread-1',
          turnId: 'turn-1',
          payload: {
            messageId: 'message-1',
            itemId: 'item-1',
            delta: 'Hello',
          },
        },
      },
    },
    'claude.conversationSnapshotChanged': {
      ...agent,
      backend: 'claude',
      type: 'claude.conversationSnapshotChanged',
      payload: {
        revision: 1,
        snapshot: {
          agentId: 'agent-1',
          sessionId: 'claude-session-1',
          activeTurnId: null,
          turnIds: [],
          turns: [],
          messages: [],
          answeredClientRequestIds: [],
          busy: false,
          historyLoading: false,
          historyState: { hasOlder: false, loadingOlder: false },
          contextUsage: null,
          plan: null,
          error: null,
        },
      },
    },
    'claude.conversationEventReceived': {
      ...agent,
      backend: 'claude',
      type: 'claude.conversationEventReceived',
      payload: {
        revision: 2,
        event: {
          seq: 2,
          occurredAt,
          agentId: 'agent-1',
          backend: 'claude',
          backendSessionId: 'claude-session-1',
          turnId: 'turn-1',
          type: 'message.delta',
          payload: { delta: 'Hello' },
        },
      },
    },
    'client.markdownDisplayRequested': {
      ...agent,
      type: 'client.markdownDisplayRequested',
      payload: { kind: 'markdown', content: '# Plan' },
    },
    'plan.readyForReview': {
      ...agent,
      type: 'plan.readyForReview',
      turnId: 'turn-1',
      payload: { markdown: '# Plan', itemId: 'plan-1' },
    },
    'client.celebrationRequested': {
      ...agent,
      type: 'client.celebrationRequested',
      payload: { kind: 'stars' },
    },
    'agentCreation.progress': {
      ...agent,
      type: 'agentCreation.progress',
      payload: {
        id: 'creation-1',
        state: 'running',
        backend: 'codex',
        repositoryName: 'repo',
        createWorktree: false,
        createProject: true,
        phase: 'creatingProject',
        hasPrompt: true,
      },
    },
    'mission.implementationStartProgress': {
      ...base,
      type: 'mission.implementationStartProgress',
      payload: {
        missionId: 'mission-1',
        phase: 'initializingWorkspaces',
        repositoryCount: 2,
        ticketCount: 3,
      },
    },
    'git.branchWorkProgress': {
      ...agent, type: 'git.branchWorkProgress',
      payload: { id: 'branch-move-1', agentId: 'agent-1', branchName: 'feature/work', state: 'running', phase: 'movingChanges' },
    },
    'git.operationProgress': {
      ...agent,
      type: 'git.operationProgress',
      payload: { operation: 'merge', phase: 'delivery' },
    },
    'browser.annotationCreated': {
      ...base,
      type: 'browser.annotationCreated',
      payload: {
        id: 'annotation-1',
        agentId: 'agent-1',
        browserId: 'primary',
        url: 'https://example.com',
        kind: 'area',
        rect: { x: 1, y: 2, width: 3, height: 4 },
      },
    },
    'workItem.assignmentUpdated': {
      ...base,
      type: 'workItem.assignmentUpdated',
      payload: {
        provider: 'github',
        itemId: '7',
        agentId: 'agent-1',
        assignedAt: occurredAt,
        status: 'inProgress',
      },
    },
    'agent.updated': {
      ...agent,
      type: 'agent.updated',
      payload: { id: 'agent-1' },
    },
    'agent.statusChanged': {
      ...agent,
      type: 'agent.statusChanged',
      payload: { type: 'idle' },
    },
    'agent.conversationAttached': { conversationId: 'thread-1',
      ...codexThread,
      type: 'agent.conversationAttached',
      payload: { cwd: '/repo' },
    },
    'conversation.settingsUpdated': {
      ...codexThread,
      type: 'conversation.settingsUpdated',
      payload: { settings: {} },
    },
    'conversation.modeUpdated': {
      ...codexThread,
      type: 'conversation.modeUpdated',
      payload: { mode: 'plan' },
    },
    'conversation.goalUpdated': {
      ...agent,
      threadId: 'thread-1',
      type: 'conversation.goalUpdated',
      payload: { goal: {
        threadId: 'thread-1',
        objective: 'Ship',
        status: 'active',
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: 1,
        updatedAt: 1,
      } },
    },
    'conversation.goalCleared': { ...agent, type: 'conversation.goalCleared', payload: {} },
    'conversation.contextUsageUpdated': {
      ...codexThread,
      type: 'conversation.contextUsageUpdated',
      payload: { contextUsage: usage },
    },
    'conversation.historyLoadFailed': {
      ...agent,
      type: 'conversation.historyLoadFailed',
      payload: { error: 'History unavailable' },
    },
    'subagent.operationChanged': {
      ...codexThread,
      type: 'subagent.operationChanged',
      payload: {
        rootConversationId: 'thread-1',
        operation: {
          id: 'operation-1',
          lifecycle: 'started',
          kind: 'spawnAgent',
          status: 'inProgress',
          senderConversationId: 'thread-1',
          receiverConversationIds: [],
          occurredAt,
        },
        agentStates: {},
      },
    },
    'subagent.activityChanged': {
      ...codexThread,
      type: 'subagent.activityChanged',
      payload: {
        rootConversationId: 'thread-1',
        parentConversationId: 'thread-1',
        activity: {
          id: 'activity-1',
          lifecycle: 'started',
          kind: 'started',
          conversationId: 'child-1',
          agentPath: 'child',
          occurredAt,
        },
      },
    },
    'subagent.identityChanged': {
      ...codexThread,
      type: 'subagent.identityChanged',
      payload: { rootConversationId: 'thread-1', conversationId: 'child-1' },
    },
    'subagent.statusChanged': {
      ...codexThread,
      type: 'subagent.statusChanged',
      payload: {
        rootConversationId: 'thread-1',
        conversationId: 'child-1',
        status: 'running',
      },
    },
    'agent.promptQueued': {
      ...agent,
      type: 'agent.promptQueued',
      payload: { id: 'prompt-1', text: 'Fix it' },
    },
    'agent.promptRetryScheduled': {
      ...agent,
      type: 'agent.promptRetryScheduled',
      payload: { id: 'prompt-1', attempts: 1, lastError: 'retry' },
    },
    'agent.promptDequeued': {
      ...agent,
      type: 'agent.promptDequeued',
      payload: { ids: ['prompt-1'] },
    },
    'conversation.turnDiffUpdated': {
      ...turn,
      type: 'conversation.turnDiffUpdated',
      payload: { addedLines: 1, removedLines: 0, diff: '+line' },
    },
    'workspace.fileActivityDetected': {
      ...turn,
      type: 'workspace.fileActivityDetected',
      payload: {
        messageId: 'message-1',
        itemId: 'item-1',
        path: 'src/a.ts',
        action: 'edit',
        status: 'completed',
      },
    },
    'git.statusUpdated': {
      ...agent,
      type: 'git.statusUpdated',
      payload: gitStatus,
    },
    'agentRequest.created': {
      ...codexThread,
      type: 'agentRequest.created',
      payload: { request: approvalAgentRequest(approval) },
    },
    'agentRequest.resolved': {
      ...codexThread,
      type: 'agentRequest.resolved',
      payload: { id: (approval).id, outcome: approvalOutcome('approve', 'once', 'host') },
    },
  };
}

describe(`${product.name} backend event decoder`, () => {
  it.each(['github', 'gitlab'] as const)('decodes %s merged tracking updates without losing provider identity', provider => {
    const tracking = { provider, repository: provider === 'gitlab' ? 'gitlab.com/group/sub/repo' : 'owner/repo', branch: 'feature', number: 7, title: 'Work', url: provider === 'gitlab' ? 'https://gitlab.com/group/sub/repo/-/merge_requests/7' : 'https://github.com/owner/repo/pull/7', draft: false, headSha: 'head', state: 'merged', mergedAt: occurredAt, createdAt: occurredAt, updatedAt: occurredAt };
    const event = { seq: 1, occurredAt, type: 'agent.updated', agentId: 'agent-1', payload: { id: 'agent-1', pullRequest: tracking } };
    expect(decodeAppBackendEvent(event)).toStrictEqual(event);
  });
  it('accepts one representative for every typed event key without cloning it', () => {
    const fixtures = createFixtures();

    for (const event of Object.values(fixtures)) {
      expect(decodeAppBackendEvent(event)).toBe(event);
    }
  });

  it('accepts rich queued-prompt options for both provider backends', () => {
    const fixture = createFixtures()['agent.promptQueued'];
    const codexPrompt = {
      ...fixture,
      payload: {
        id: 'prompt-codex',
        text: 'Inspect the attached files',
        submitted: true,
        options: {
          attachments: [
            {
              type: 'image',
              path: '/tmp/screenshot.png',
              name: 'screenshot.png',
              mimeType: 'image/png',
              detail: 'original',
              previewUrl: 'data:image/png;base64,AA==',
            },
            {
              type: 'file',
              path: '/tmp/report.txt',
              name: 'report.txt',
              mimeType: 'text/plain',
            },
          ],
          model: null,
          reasoningEffort: 'high',
          serviceTier: null,
          planMode: true,
          skills: [{ name: 'review', path: '/skills/review/SKILL.md' }],
          inputMethod: 'dictated',
          recordUserMessage: false,
          backendOptions: {
            kind: 'codex',
            reasoningEffort: null,
            serviceTier: 'priority',
            skills: [{ name: 'review', path: '/skills/review/SKILL.md' }],
          },
        },
      },
    };
    const claudePrompt = {
      ...fixture,
      payload: {
        id: 'prompt-claude',
        text: 'Use extended thinking',
        options: {
          inputMethod: 'typed',
          backendOptions: {
            kind: 'claude',
            thinkingBudgetTokens: 8_000,
            permissionMode: null,
          },
        },
      },
    };

    expect(decodeAppBackendEvent(codexPrompt)).toBe(codexPrompt);
    expect(decodeAppBackendEvent(claudePrompt)).toBe(claudePrompt);
  });

  it('accepts rich coordination metadata for retries and approvals', () => {
    const fixtures = createFixtures();
    const retry = {
      ...fixtures['agent.promptRetryScheduled'],
      payload: {
        id: 'prompt-1',
        attempts: 2,
        lastError: 'provider temporarily unavailable',
        retryAt: '2026-09-04T12:01:00.000Z',
      },
    };
    const richApproval: import('../contracts').BackendApprovalRequest = {
      id: 'approval-permissions',
      kind: 'permissions',
      conversationId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      title: 'Expand sandbox access',
      description: 'Read the fixture and call the package registry',
      command: 'npm test',
      cwd: '/repo',
      requestedPermissions: [
        { kind: 'filesystem', access: 'read', path: '/repo/fixtures' },
        { kind: 'network', enabled: true, host: 'registry.npmjs.org', protocol: 'https' },
      ],
      allowedScopes: ['once', 'session'],
      canDeny: true,
    };
    const requested = {
      ...fixtures['agentRequest.created'],
      turnId: 'turn-1',
      payload: { request: approvalAgentRequest(richApproval) },
    };
    const resolved = {
      ...fixtures['agentRequest.resolved'],
      turnId: 'turn-1',
      payload: {
        id: richApproval.id,
        outcome: { kind: 'cancelled', reason: 'surface_disconnected' },
      },
    };

    expect(decodeAppBackendEvent(retry)).toBe(retry);
    expect(decodeAppBackendEvent(requested)).toBe(requested);
    expect(decodeAppBackendEvent(resolved)).toBe(resolved);
  });

  it('accepts populated provider conversation snapshot frames', () => {
    const fixtures = createFixtures();
    const codexFrame = structuredClone(
      fixtures['codex.conversationSnapshotChanged'],
    );
    codexFrame.payload.snapshot.activeTurnId = 'turn-1';
    codexFrame.payload.snapshot.turnIds = ['turn-1'];
    codexFrame.payload.snapshot.turns = [{
      id: 'turn-1',
      status: 'inProgress',
      error: null,
      willRetry: false,
      startedAt: occurredAt,
      completedAt: null,
      durationMs: null,
    }];
    codexFrame.payload.snapshot.messages = [message];
    codexFrame.payload.snapshot.busy = true;
    codexFrame.payload.snapshot.historyLoading = true;
    codexFrame.payload.snapshot.historyState = {
      loadingStrategy: 'lazy',
      hasOlder: true,
      loadingOlder: true,
      fullyLoaded: false,
    };

    const claudeFrame = structuredClone(
      fixtures['claude.conversationSnapshotChanged'],
    );
    claudeFrame.payload.snapshot.sessionId = 'claude-session-1';
    claudeFrame.payload.snapshot.activeTurnId = 'turn-1';
    claudeFrame.payload.snapshot.turnIds = ['turn-1'];
    claudeFrame.payload.snapshot.turns = [{
      id: 'turn-1',
      status: 'interrupted',
      error: null,
      willRetry: false,
      startedAt: occurredAt,
      completedAt: occurredAt,
      durationMs: 10,
    }];
    claudeFrame.payload.snapshot.messages = [
      { ...message, role: 'user' },
      message,
      { ...message, id: 'message-system', role: 'system' },
    ];
    claudeFrame.payload.snapshot.contextUsage = usage;
    claudeFrame.payload.snapshot.plan = {
      threadId: 'claude-session-1',
      turnId: 'turn-1',
      kind: 'execution',
      status: 'inProgress',
      explanation: 'Verify the change',
      steps: [{ step: 'Run tests', status: 'inProgress' }],
      markdown: '- [ ] Run tests',
      updatedAt: occurredAt,
    };
    claudeFrame.payload.snapshot.error = 'Interrupted by user';

    expect(decodeAppBackendEvent(codexFrame)).toBe(codexFrame);
    expect(decodeAppBackendEvent(claudeFrame)).toBe(claudeFrame);
  });

  it('accepts provider event frames with all optional routing context', () => {
    const fixtures = createFixtures();
    const codexFixture = fixtures['codex.conversationEventReceived'];
    const codexFrame = {
      ...codexFixture,
      payload: {
        ...codexFixture.payload,
        event: {
          ...codexFixture.payload.event,
          origin: 'action',
          turnId: 'turn-1',
        },
      },
    };

    const claudeFrame = structuredClone(
      fixtures['claude.conversationEventReceived'],
    );
    claudeFrame.payload.event.backendSessionId = 'claude-session-1';
    claudeFrame.payload.event.threadId = 'claude-session-1';
    claudeFrame.payload.event.turnId = 'turn-1';

    expect(decodeAppBackendEvent(codexFrame)).toBe(codexFrame);
    expect(decodeAppBackendEvent(claudeFrame)).toBe(claudeFrame);
  });

  it('rejects a Claude event routed under a different agent', () => {
    const event = createFixtures()['claude.conversationEventReceived'];

    expect(() => decodeAppBackendEvent({
      ...event,
      agentId: 'agent-other',
    })).toThrow('$.payload.event.agentId: expected the outer agent id');
  });

  it('accepts valid full snapshot and client-state side channels', () => {
    const event = createFixtures()['snapshot.updated'];
    const withSideChannels = {
      ...event,
      snapshot: createInitialSnapshot(),
      clientState: {
        sourceFolderPath: '/src',
        shouldPreventDisplaySleep: false,
        shouldPreventDisplaySleepForRemoteAccess: true,
      },
    };

    expect(decodeAppBackendEvent(withSideChannels)).toBe(withSideChannels);
  });

  it('rejects a Codex event routed under a different conversation', () => {
    const event = createFixtures()['codex.conversationEventReceived'];
    expect(() => decodeAppBackendEvent({
      ...event,
      threadId: 'thread-other',
    })).toThrow('$.payload.event.conversationId: expected the outer thread id');
  });

  it.each([
    [null, '$: expected an object'],
    [
      { seq: 1, occurredAt, type: 'provider.authenticationChanged', payload: { kind: 'claude', connected: false, state: {} } },
      '$.payload: expected provider authentication',
    ],
    [
      {
        seq: '1',
        occurredAt,
        type: 'client.connectionChanged',
        payload: { status: 'connected' },
      },
      '$.seq: expected a number',
    ],
    [
      {
        seq: 1,
        occurredAt: 2,
        type: 'client.connectionChanged',
        payload: { status: 'connected' },
      },
      '$.occurredAt: expected a string',
    ],
    [
      { seq: 1, occurredAt, type: 'unknown', payload: {} },
      '$.type: expected a supported event type',
    ],
  ])(
    'rejects malformed envelopes with structural diagnostics',
    (value, diagnostic) => {
      expect(() => decodeAppBackendEvent(value)).toThrow(diagnostic);
    },
  );

  it('reports a precise nested payload path', () => {
    const event = createFixtures()['models.changed'];
    const malformed = {
      ...event,
      payload: { models: [{ id: 42, model: 'gpt', displayName: 'GPT' }] },
    };

    expect(() => decodeAppBackendEvent(malformed)).toThrow(
      '$.payload.models[0].id: expected a string',
    );
  });

  it('requires an actionable history load failure description', () => {
    const event = createFixtures()['conversation.historyLoadFailed'];

    expect(() => decodeAppBackendEvent({
      ...event,
      payload: { detail: 'provider diagnostics stay in backend logs' },
    })).toThrow('$.payload.error: expected a string');
  });

  it('rejects missing required provider context', () => {
    const event = createFixtures()['conversation.turnDiffUpdated'];
    const malformed = { ...event, turnId: undefined };

    expect(() => decodeAppBackendEvent(malformed)).toThrow(
      '$.turnId: expected a string',
    );
  });

  it('rejects malformed snapshot and client-state side channels', () => {
    const event = createFixtures()['snapshot.updated'];

    expect(() =>
      decodeAppBackendEvent({ ...event, snapshot: { teams: [] } }),
    ).toThrow('$.snapshot: expected full application snapshot');
    expect(() =>
      decodeAppBackendEvent({
        ...event,
        clientState: { sourceFolderPath: '/src' },
      }),
    ).toThrow('$.clientState: expected client state');
  });

  it('never includes payload values in validation errors', () => {
    const secret = 'sk-secret-do-not-log';
    const event = createFixtures()['agentRequest.created'];
    const malformed = { ...event, payload: { approval: { password: secret } } };

    let error: unknown;
    try {
      decodeAppBackendEvent(malformed);
    } catch (candidate) {
      error = candidate;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(secret);
  });

  it('keeps the rpc compatibility export identical to the owner type', () => {
    expectTypeOf<AppBackendEvent>().toEqualTypeOf<RpcAppBackendEvent>();
    expectTypeOf<
      ReturnType<typeof decodeAppBackendEvent>
    >().toEqualTypeOf<AppBackendEvent>();
    expectTypeOf<
      Extract<AppBackendEvent, { type: 'snapshot.updated' }>['snapshot']
    >().toEqualTypeOf<AppSnapshot | undefined>();
  });
});
