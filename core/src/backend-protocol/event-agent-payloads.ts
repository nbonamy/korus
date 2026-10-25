import { isRateLimitPause } from '../auto-resume';
import { isAgentReadState } from '../agent-read-state';
import { isDelegationContext } from '../delegation-context';
import { product } from '../product';
import { isThreadFlags } from '../thread-flags';
import { isAppTextDescriptor } from '../app-text';
import {
  isSubagentActivityKind,
  isSubagentOperationKind,
  isSubagentOperationLifecycle,
  isSubagentOperationStatus,
  isSubagentStatus,
} from '../subagent-values';
import {
  expectArray,
  expectBoolean,
  expectKnownShape,
  expectLiteral,
  expectNullable,
  expectNumber,
  expectOptional,
  expectRecord,
  expectString,
  expectStringArray,
  failEventValidation,
  type EventValueValidator,
} from './event-validation';

function expectAppText(value: unknown, path: string): void {
  if (typeof value !== 'string' && !isAppTextDescriptor(value)) {
    throw new Error(
      `Invalid ${product.name} backend event at ${path}: expected application text.`,
    );
  }
}

function expectAgentStatus(value: unknown, path: string): void {
  expectRecord(value, path);
  expectLiteral(
    value.type,
    ['idle', 'working', 'awaitingInput', 'error'],
    `${path}.type`,
  );
  if (value.type === 'working' || value.type === 'awaitingInput')
    expectOptional(value, 'detail', path, expectAppText);
  if (value.type === 'error') expectAppText(value.message, `${path}.message`);
}

function expectWorkspace(value: unknown, path: string): void {
  expectRecord(value, path);
  expectLiteral(value.kind, ['git', 'folder'], `${path}.kind`);
  expectString(value.folder, `${path}.folder`);
  expectString(value.updatedAt, `${path}.updatedAt`);
  if (value.kind === 'folder') {
    expectString(value.label, `${path}.label`);
    return;
  }
  ['repositoryName', 'repositoryRoot', 'primaryWorktreeRoot'].forEach((key) =>
    expectString(value[key], `${path}.${key}`),
  );
  expectNullable(value.branch, `${path}.branch`, expectString);
  expectBoolean(value.isLinkedWorktree, `${path}.isLinkedWorktree`);
  expectOptional(value, 'originUrl', path, expectString);
}

function expectBackendSession(value: unknown, path: string): void {
  expectRecord(value, path);
  expectLiteral(value.kind, ['codex', 'claude', 'antigravity'], `${path}.kind`);
  if (value.kind === 'codex') {
    expectString(value.threadId, `${path}.threadId`);
    return;
  }
  expectString(value.sessionId, `${path}.sessionId`);
  if (value.kind === 'antigravity') return;
  expectLiteral(value.transport, ['stdio', 'websocket'], `${path}.transport`);
  ['transcriptSessionId', 'transcriptFolder', 'serverUrl', 'model', 'reasoningEffort'].forEach(
    (key) => expectOptional(value, key, path, expectString),
  );
}

function expectBackendDefaults(value: unknown, path: string): void {
  expectRecord(value, path);
  expectLiteral(value.kind, ['codex', 'claude', 'antigravity'], `${path}.kind`);
  ['model', 'reasoningEffort'].forEach((key) =>
    expectOptional(value, key, path, expectString),
  );
  expectOptional(value, 'userSelectedModel', path, expectBoolean);
  if (value.kind === 'codex') {
    expectOptional(
      value,
      'approvalPreset',
      path,
      (candidate, candidatePath) => {
        expectLiteral(
          candidate,
          ['ask-for-approval', 'approve-for-me', 'full-access'],
          candidatePath,
        );
      },
    );
    ['approvalPolicy', 'sandboxMode'].forEach((key) =>
      expectOptional(value, key, path, expectString),
    );
    expectOptional(
      value,
      'approvalsReviewer',
      path,
      (candidate, candidatePath) => {
        expectLiteral(
          candidate,
          ['user', 'auto_review', 'guardian_subagent'],
          candidatePath,
        );
      },
    );
    expectOptional(value, 'serviceTier', path, (candidate, candidatePath) =>
      expectNullable(candidate, candidatePath, expectString),
    );
    return;
  }
  expectOptional(value, 'permissionMode', path, expectString);
  expectOptional(value, 'thinking', path, (candidate, candidatePath) => {
    expectRecord(candidate, candidatePath);
    expectLiteral(
      candidate.type,
      ['enabled', 'disabled'],
      `${candidatePath}.type`,
    );
    expectOptional(candidate, 'budgetTokens', candidatePath, expectNumber);
  });
}

function expectContextUsage(value: unknown, path: string): void {
  expectRecord(value, path);
  [
    'totalTokens',
    'inputTokens',
    'cachedInputTokens',
    'outputTokens',
    'reasoningOutputTokens',
    'lastTotalTokens',
  ].forEach((key) => expectNumber(value[key], `${path}.${key}`));
  expectNullable(
    value.modelContextWindow,
    `${path}.modelContextWindow`,
    expectNumber,
  );
  expectNullable(value.usedPercent, `${path}.usedPercent`, expectNumber);
}

function expectGoal(value: unknown, path: string): void {
  expectRecord(value, path);
  expectString(value.threadId, `${path}.threadId`);
  expectString(value.objective, `${path}.objective`);
  expectLiteral(
    value.status,
    [
      'active',
      'paused',
      'blocked',
      'usageLimited',
      'budgetLimited',
      'complete',
    ],
    `${path}.status`,
  );
  expectNullable(value.tokenBudget, `${path}.tokenBudget`, expectNumber);
  ['tokensUsed', 'timeUsedSeconds', 'createdAt', 'updatedAt'].forEach((key) =>
    expectNumber(value[key], `${path}.${key}`),
  );
}

function expectPlan(value: unknown, path: string): void {
  expectRecord(value, path);
  ['threadId', 'turnId', 'explanation', 'markdown', 'updatedAt'].forEach(
    (key) => expectString(value[key], `${path}.${key}`),
  );
  expectLiteral(value.kind, ['execution', 'proposed'], `${path}.kind`);
  expectLiteral(
    value.status,
    ['inProgress', 'completed', 'incomplete', 'interrupted', 'failed'],
    `${path}.status`,
  );
  expectArray(value.steps, `${path}.steps`, expectPlanStep);
}

function expectPlanStep(value: unknown, path: string): void {
  expectRecord(value, path);
  expectString(value.step, `${path}.step`);
  expectLiteral(
    value.status,
    ['pending', 'inProgress', 'completed'],
    `${path}.status`,
  );
}

function expectPullRequest(value: unknown, path: string): void {
  expectRecord(value, path);
  expectLiteral(value.provider, ['github', 'gitlab'], `${path}.provider`);
  [
    'repository',
    'branch',
    'createdAt',
    'updatedAt',
    'title',
    'url',
    'headSha',
  ].forEach((key) => expectString(value[key], `${path}.${key}`));
  expectNumber(value.number, `${path}.number`);
  expectBoolean(value.draft, `${path}.draft`);
  expectLiteral(value.state, ['open', 'merged', 'closed'], `${path}.state`);
  expectOptional(value, 'mergedAt', path, expectString);
}

function expectAgentUpdate(value: unknown, path: string): void {
  expectRecord(value, path);
  expectString(value.id, `${path}.id`);
  expectOptional(value, 'rateLimitPause', path, (candidate, at) => { if (candidate !== null && !isRateLimitPause(candidate)) throw new Error(`${at}: invalid rate-limit pause`); });
  expectOptional(value, 'delegationContext', path, (candidate, candidatePath) => {
    if (!isDelegationContext(candidate)) throw new Error(`${candidatePath}: invalid delegation context`);
  });
  [
    'teamId',
    'delegatedByAgentId',
    'conversationTitle',
    'avatar',
    'mcpSessionId',
    'createdAt',
    'updatedAt',
  ].forEach((key) => expectOptional(value, key, path, expectString));
  ['name', 'folder', 'statusText'].forEach((key) => {
    expectOptional(value, key, path, (candidate, candidatePath) =>
      expectNullable(candidate, candidatePath, expectString),
    );
  });
  expectOptional(value, 'pullRequest', path, expectPullRequest);
  expectOptional(value, 'sessionKind', path, (candidate, candidatePath) =>
    expectLiteral(candidate, ['quickChat'], candidatePath),
  );
  expectOptional(value, 'workspace', path, expectWorkspace);
  expectOptional(value, 'backend', path, (candidate, candidatePath) =>
    expectLiteral(candidate, ['codex', 'claude', 'antigravity'], candidatePath),
  );
  expectOptional(value, 'backendSession', path, expectBackendSession);
  expectOptional(value, 'backendDefaults', path, expectBackendDefaults);
  expectOptional(
    value,
    'openInApplication',
    path,
    (candidate, candidatePath) => {
      expectLiteral(
        candidate,
        [
          'vscode',
          'finder',
          'terminal',
          'iterm2',
          'ghostty',
          'xcode',
          'android-studio',
          'jetbrains',
        ],
        candidatePath,
      );
    },
  );
  expectOptional(value, 'contextUsage', path, expectContextUsage);
  expectOptional(value, 'suggestedPrompt', path, (candidate, candidatePath) => expectNullable(candidate, candidatePath, expectString));
  expectOptional(value, 'plan', path, expectPlan);
  expectOptional(value, 'goal', path, expectGoal);
  expectOptional(value, 'threadFlags', path, (candidate, candidatePath) => expectNullable(candidate, candidatePath, (flagValue, flagPath) => expectKnownShape(flagValue, flagPath, isThreadFlags, 'thread flags')));
  expectOptional(value, 'readState', path, (value, path) => expectKnownShape(value, path, isAgentReadState, 'agent read state'));
  expectOptional(value, 'isRegistered', path, expectBoolean);
  expectOptional(value, 'status', path, expectAgentStatus);
}

function expectSubagentOperation(value: unknown, path: string): void {
  expectRecord(value, path);
  expectString(value.id, `${path}.id`);
  expectOptional(value, 'turnId', path, expectString);
  expectKnownShape(
    value.lifecycle,
    `${path}.lifecycle`,
    isSubagentOperationLifecycle,
    'subagent operation lifecycle',
  );
  expectKnownShape(
    value.kind,
    `${path}.kind`,
    isSubagentOperationKind,
    'subagent operation kind',
  );
  expectKnownShape(
    value.status,
    `${path}.status`,
    isSubagentOperationStatus,
    'subagent operation status',
  );
  expectString(value.senderConversationId, `${path}.senderConversationId`);
  expectStringArray(
    value.receiverConversationIds,
    `${path}.receiverConversationIds`,
  );
  ['prompt', 'model', 'reasoningEffort'].forEach((key) =>
    expectOptional(value, key, path, expectString),
  );
  expectString(value.occurredAt, `${path}.occurredAt`);
}

function expectSubagentOperationChange(value: unknown, path: string): void {
  expectRecord(value, path);
  expectString(value.rootConversationId, `${path}.rootConversationId`);
  expectSubagentOperation(value.operation, `${path}.operation`);
  expectRecord(value.agentStates, `${path}.agentStates`);
  Object.values(value.agentStates).forEach((state, index) => {
    const statePath = `${path}.agentStates[*${index}]`;
    expectRecord(state, statePath);
    expectKnownShape(
      state.status,
      `${statePath}.status`,
      isSubagentStatus,
      'subagent status',
    );
    expectOptional(state, 'message', statePath, expectString);
  });
}

function expectSubagentActivityChange(value: unknown, path: string): void {
  expectRecord(value, path);
  expectString(value.rootConversationId, `${path}.rootConversationId`);
  expectString(value.parentConversationId, `${path}.parentConversationId`);
  expectRecord(value.activity, `${path}.activity`);
  const activity = value.activity;
  expectString(activity.id, `${path}.activity.id`);
  expectOptional(activity, 'turnId', `${path}.activity`, expectString);
  expectKnownShape(
    activity.lifecycle,
    `${path}.activity.lifecycle`,
    isSubagentOperationLifecycle,
    'subagent operation lifecycle',
  );
  expectKnownShape(
    activity.kind,
    `${path}.activity.kind`,
    isSubagentActivityKind,
    'subagent activity kind',
  );
  ['conversationId', 'agentPath', 'occurredAt'].forEach((key) =>
    expectString(activity[key], `${path}.activity.${key}`),
  );
}

function expectSubagentIdentityChange(value: unknown, path: string): void {
  expectRecord(value, path);
  ['rootConversationId', 'conversationId'].forEach((key) =>
    expectString(value[key], `${path}.${key}`),
  );
  ['agentNickname', 'agentRole'].forEach((key) =>
    expectOptional(value, key, path, expectString),
  );
}

function expectSubagentStatusChange(value: unknown, path: string): void {
  expectRecord(value, path);
  ['rootConversationId', 'conversationId'].forEach((key) =>
    expectString(value[key], `${path}.${key}`),
  );
  expectKnownShape(
    value.status,
    `${path}.status`,
    isSubagentStatus,
    'subagent status',
  );
  expectOptional(value, 'statusMessage', path, expectString);
}

export const agentPayloadValidators = {
  'agent.updated': expectAgentUpdate,
  'agent.statusChanged': expectAgentStatus,
  'agent.conversationAttached': (value, path) => {
    expectRecord(value, path);
    expectOptional(value, 'cwd', path, expectString);
  },
  'conversation.settingsUpdated': (value, path) => {
    expectRecord(value, path);
    expectRecord(value.settings, `${path}.settings`);
    ['model', 'reasoningEffort', 'permissionMode'].forEach((key) => expectOptional(value.settings as Record<string, unknown>, key, `${path}.settings`, expectString));
    expectOptional(value.settings, 'serviceTier', `${path}.settings`, (candidate, candidatePath) => expectNullable(candidate, candidatePath, expectString));
    expectOptional(value.settings, 'approvalPreset', `${path}.settings`, (candidate, candidatePath) => expectLiteral(candidate, ['ask-for-approval', 'approve-for-me', 'full-access'], candidatePath));
  },
  'conversation.modeUpdated': (value, path) => {
    expectRecord(value, path);
    expectLiteral(value.mode, ['default', 'plan'], `${path}.mode`);
    expectOptional(value, 'permissionMode', path, expectString);
  },
  'conversation.goalUpdated': (value, path) => {
    expectRecord(value, path);
    expectGoal(value.goal, `${path}.goal`);
  },
  'conversation.goalCleared': (value, path) => {
    expectRecord(value, path);
    if (Object.keys(value).length > 0)
      failEventValidation(path, 'expected an empty object');
  },
  'conversation.contextUsageUpdated': (value, path) => {
    expectRecord(value, path);
    expectContextUsage(value.contextUsage, `${path}.contextUsage`);
  },
  'conversation.historyLoadFailed': (value, path) => {
    expectRecord(value, path);
    expectString(value.error, `${path}.error`);
  },
  'subagent.operationChanged': expectSubagentOperationChange,
  'subagent.activityChanged': expectSubagentActivityChange,
  'subagent.identityChanged': expectSubagentIdentityChange,
  'subagent.statusChanged': expectSubagentStatusChange,
} satisfies Record<string, EventValueValidator>;
