import { product } from '../product';
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
    provider: 'codex' as const,
    threadId: 'thread-1',
  };
  const turn = { ...codexThread, turnId: 'turn-1' };

  return {
    'turn.started': { ...base, type: 'turn.started', agentId: 'agent-1', provider: 'claude', turnId: 'turn-1', conversationId: 'session-1', payload: {} },
    'turn.completed': { ...base, type: 'turn.completed', agentId: 'agent-1', provider: 'claude', turnId: 'turn-1', payload: { status: 'failed', error: { message: 'Limit', rateLimit: { resumeAt: 1 } }, willRetry: false } },
    'session.error': { ...base, type: 'session.error', agentId: 'agent-1', provider: 'claude', payload: { error: { message: 'Broken' }, willRetry: true } },
    'tool.updated': { ...base, type: 'tool.updated', agentId: 'agent-1', provider: 'claude', payload: { tool: { id: 'tool-1', kind: 'command', status: 'running' } } },
    'turn.output': { ...base, type: 'turn.output', agentId: 'agent-1', provider: 'claude', payload: {} },
    'diff.updated': { ...base, type: 'diff.updated', agentId: 'agent-1', provider: 'claude', payload: {} },
    'file.activity': { ...base, type: 'file.activity', agentId: 'agent-1', provider: 'claude', payload: { path: '/repo/a', action: 'edit', status: 'completed' } },
    'conversation.sessionSnapshot': { ...base, type: 'conversation.sessionSnapshot', agentId: 'agent-1', provider: 'claude', payload: { conversation: 'session-1', epoch: 'e1',
      snapshot: { revision: 2, state: { messages: [], busy: false, activeTurnId: null, turns: [], requests: [], error: null, title: null, goal: null, contextUsage: null, plan: null } } } },
    'conversation.sessionPatch': { ...base, type: 'conversation.sessionPatch', agentId: 'agent-1', provider: 'claude', payload: { conversation: 'session-1', epoch: 'e1',
      patch: { revision: 3, ops: [{ op: 'set', key: 'busy', value: true }] } } },
    'conversation.shareChanged': { ...base, type: 'conversation.shareChanged', agentId: 'agent-1', payload: {
      active: true, handle: 'a'.repeat(32), connectedGuests: null, availability: 'ready',
      proposals: [{ id: 'proposal-1', handle: 'a'.repeat(32), identity: 'guest-1', name: 'Guest', discriminator: '1234abcd', text: '2026-10-29T13:19:32.126Z', status: 'pending', createdAt: occurredAt, messageId: 'message-1', turnId: 'turn-1' }],
      authors: [{ messageId: 'message-1', identity: 'guest-1', name: 'Guest', discriminator: '1234abcd' }],
    } },
    'provider.authenticationChanged': {
      ...base, type: 'provider.authenticationChanged',
      payload: { kind: 'claude', connected: false, state: { loggedIn: false } },
    },
    'plan.reviewResolved': {
      ...base, agentId: 'agent-1', type: 'plan.reviewResolved',
      payload: { reviewId: 'review-1', resolution: 'accept' },
    },
    'provider.statusChanged': {
      ...base,
      type: 'provider.statusChanged',
      provider: 'codex',
      payload: { provider: 'codex', status: 'running' },
    },
    'snapshot.updated': {
      ...base,
      type: 'snapshot.updated',
      payload: metadata,
    },
    'account.rateLimitsUpdated': {
      ...base,
      type: 'account.rateLimitsUpdated',
      provider: 'codex',
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
      provider: 'codex',
      payload: { models: [{ id: 'gpt', model: 'gpt', displayName: 'GPT' }] },
    },
    'skills.changed': {
      ...base,
      type: 'skills.changed',
      provider: 'codex',
      payload: {
        cwd: null,
        status: 'loaded',
        skills: [{ name: 'test', path: '/skill', enabled: true }],
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
        provider: 'codex',
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
    'mission.focusRequested': { ...base, type: 'mission.focusRequested', payload: { missionId: 'mission-1' } },
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
      conversationId: 'thread-1',
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
  it('accepts optional monetary billing while preserving legacy quota frames and rejects malformed balances', () => {
    const event = createFixtures()['account.rateLimitsUpdated'];
    expect(decodeAppBackendEvent(event)).toStrictEqual(event);
    const billing = { includedBalanceUsd: '15.00', onDemand: { enabled: false, unlimited: false, usedUsd: 0, limitUsd: 0, remainingUsd: 0 } };
    const frame = { ...event, provider: 'cursor', payload: { rateLimits: { ...event.payload.rateLimits, billing } } };
    expect(decodeAppBackendEvent(frame)).toStrictEqual(frame);
    for (const invalid of [{ ...billing, includedBalanceUsd: 'private' }, { ...billing, onDemand: { ...billing.onDemand, usedUsd: -1 } }, { ...billing, onDemand: { ...billing.onDemand, enabled: 'false' } }]) {
      expect(() => decodeAppBackendEvent({ ...frame, payload: { rateLimits: { ...frame.payload.rateLimits, billing: invalid } } })).toThrow();
    }
  });
  it('decodes Cursor identity, session and authentication in app-owned envelopes', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.provider = 'cursor';
    snapshot.agents[0]!.providerSession = { kind: 'cursor', sessionId: 'cursor-session' };
    snapshot.agents[0]!.providerDefaults = { kind: 'cursor', permission: 'allowlist' };
    const authentication = { kind: 'cursor', connected: false, state: { loggedIn: false, homePath: '/cursor' } } as const;
    snapshot.providerConnections = [{ provider: 'cursor', installed: false, connected: false, checking: false, authentication }];
    const event = { seq: 1, occurredAt, type: 'snapshot.updated', payload: snapshot };
    expect(decodeAppBackendEvent(JSON.parse(JSON.stringify(event)))).toStrictEqual(event);
    const authEvent = { seq: 2, occurredAt, type: 'provider.authenticationChanged', payload: authentication };
    expect(decodeAppBackendEvent(authEvent)).toStrictEqual(authEvent);
    expect(() => decodeAppBackendEvent({ ...authEvent, payload: { ...authentication, state: { loggedIn: 'no', homePath: '/cursor' } } })).toThrow();
  });

  it.each(['github', 'gitlab'] as const)('decodes %s merged tracking updates without losing provider identity', provider => {
    const tracking = { provider, repository: provider === 'gitlab' ? 'gitlab.com/group/sub/repo' : 'owner/repo', branch: 'feature', number: 7, title: 'Work', url: provider === 'gitlab' ? 'https://gitlab.com/group/sub/repo/-/merge_requests/7' : 'https://github.com/owner/repo/pull/7', draft: false, headSha: 'head', state: 'merged', mergedAt: occurredAt, createdAt: occurredAt, updatedAt: occurredAt };
    const event = { seq: 1, occurredAt, type: 'agent.updated', agentId: 'agent-1', payload: { id: 'agent-1', pullRequest: tracking } };
    expect(decodeAppBackendEvent(event)).toStrictEqual(event);
  });
  it('round-trips transient prompt presentation and its empty acknowledgment', () => {
    const event = { seq: 1, occurredAt, type: 'agent.updated', agentId: 'agent-1', payload: { id: 'agent-1',
      pendingPrompts: [{ id: 'pending', text: 'Implement the ticket', createdAt: occurredAt }] } };
    expect(decodeAppBackendEvent(JSON.parse(JSON.stringify(event)))).toStrictEqual(event);
    expect(decodeAppBackendEvent({ ...event, payload: { id: 'agent-1', pendingPrompts: [] } })).toMatchObject({ payload: { pendingPrompts: [] } });
    expect(() => decodeAppBackendEvent({ ...event, payload: { id: 'agent-1', pendingPrompts: [{ id: 'pending', text: null }] } })).toThrow();
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
        options: { attachments: [
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
          ], planMode: true, skills: [{ name: 'review', path: '/skills/review/SKILL.md' }], inputMethod: 'dictated', recordUserMessage: false, providerOptions: { kind: 'codex', skills: [{ name: 'review', path: '/skills/review/SKILL.md' }] }, selection: { model: null, reasoningEffort: 'high', serviceTier: null } },
      },
    };
    const claudePrompt = {
      ...fixture,
      payload: {
        id: 'prompt-claude',
        text: 'Use extended thinking',
        options: {
          inputMethod: 'typed',
          providerOptions: {
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
    const richApproval: import('../contracts').ProviderApprovalRequest = {
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

  it.each([
    [{ proposals: {} }, '$.payload.proposals'],
    [{ proposals: [{ id: 42 }] }, '$.payload.proposals[0].id'],
    [{ authors: [{ messageId: 'message-1', identity: 'guest', name: null }] }, '$.payload.authors[0].name'],
    [{ credential: 'PRIVATE_SHARE_CANARY' }, '$.payload'],
  ])('rejects malformed sharing updates without exposing values', (override, diagnostic) => {
    const event = createFixtures()['conversation.shareChanged'];
    const malformed = { ...event, payload: { ...event.payload, ...override } };
    expect(() => decodeAppBackendEvent(malformed)).toThrow(diagnostic);
    try { decodeAppBackendEvent(malformed); } catch (error) { expect(String(error)).not.toContain('PRIVATE_SHARE_CANARY'); }
  });

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
