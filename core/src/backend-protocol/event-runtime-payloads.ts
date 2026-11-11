import { operationCapabilityFlags } from '../capability-flags';
import { isDelegationContext } from '../delegation-context';
import { product } from '../product';
import { isProviderAuthentication } from '../contracts/provider-setup';
import { isAppTextDescriptor } from '../app-text';
import { isAccountRateLimits } from '../snapshot-guard-collections';
import { decodeAppSnapshot } from '../snapshot-guards';
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
  type EventValueValidator,
} from './event-validation';
import { harnessProviders } from '@korus-dev/multi-agent-sdk/contracts';

function expectAppText(value: unknown, path: string): void {
  if (typeof value !== 'string' && !isAppTextDescriptor(value)) {
    throw new Error(
      `Invalid ${product.name} backend event at ${path}: expected application text.`,
    );
  }
}

function expectProviderCapabilities(value: unknown, path: string): void {
  expectRecord(value, path);
  const booleans = [
    'attachments',
    'models',
    'skills',
    'reasoningEffort',
    'serviceTier',
    'thinkingBudget',
    'goals',
    'steerPrompt',
    'interrupt',
    'history',
    'conversationFork',
    'planReview', 'questions', 'plugins', 'conversationArchive', 'conversationResume', 'conversationReplaceWithSummary', 'remoteControl', 'conversationShare', ...operationCapabilityFlags,
    'deleteTurn',
    'editTurn',
    'retryTurn',
    'approvals',
  ];
  booleans.forEach((key) => expectOptional(value, key, path, expectBoolean));
  expectOptional(value, 'planMode', path, (candidate, candidatePath) => {
    expectLiteral(
      candidate,
      ['native', 'prompted', 'unsupported'],
      candidatePath,
    );
  });
  expectOptional(value, 'approvalPresets', path, (candidate, candidatePath) => {
    expectArray(candidate, candidatePath, (item, itemPath) => {
      expectLiteral(
        item,
        ['ask-for-approval', 'approve-for-me', 'full-access'],
        itemPath,
      );
    });
  });
  expectOptional(value, 'permissionModes', path, (candidate, candidatePath) => {
    expectArray(candidate, candidatePath, (item, itemPath) => {
      expectRecord(item, itemPath);
      expectString(item.id, `${itemPath}.id`);
      expectAppText(item.label, `${itemPath}.label`);
      expectAppText(item.description, `${itemPath}.description`);
      expectOptional(item, 'dangerous', itemPath, expectBoolean);
    });
  });
}

function expectProviderRuntimeStatus(value: unknown, path: string): void {
  expectRecord(value, path);
  expectLiteral(value.provider, harnessProviders, `${path}.provider`);
  expectLiteral(
    value.status,
    ['notConfigured', 'starting', 'running', 'error'],
    `${path}.status`,
  );
  expectOptional(value, 'detail', path, expectAppText);
  expectOptional(value, 'capabilities', path, expectProviderCapabilities);
}

function expectConnectionState(value: unknown, path: string): void {
  expectRecord(value, path);
  expectLiteral(
    value.status,
    ['connecting', 'connected', 'reconnecting', 'error'],
    `${path}.status`,
  );
  expectOptional(value, 'detail', path, expectAppText);
}

function expectAppSnapshot(value: unknown, path: string): void {
  const decoded = decodeAppSnapshot(value);
  if (!decoded) {
    throw new Error(
      `Invalid ${product.name} backend event at ${path}: expected an app snapshot.`,
    );
  }
}

function expectRateLimits(value: unknown, path: string): void {
  expectRecord(value, path);
  expectKnownShape(
    value.rateLimits,
    `${path}.rateLimits`,
    isAccountRateLimits,
    'account rate limits',
  );
}

function expectDevicePairingStatus(value: unknown, path: string): void {
  expectRecord(value, path);
  expectLiteral(
    value.status,
    ['disabled', 'connecting', 'connected', 'errored'],
    `${path}.status`,
  );
  expectOptional(value, 'serverName', path, expectString);
  expectOptional(value, 'installationId', path, expectString);
  expectOptional(value, 'environmentId', path, (candidate, candidatePath) =>
    expectNullable(candidate, candidatePath, expectString),
  );
  expectOptional(
    value,
    'allowRemoteControl',
    path,
    (candidate, candidatePath) =>
      expectNullable(candidate, candidatePath, expectBoolean),
  );
  expectOptional(value, 'detail', path, expectString);
}

function expectModel(value: unknown, path: string): void {
  expectRecord(value, path);
  expectString(value.id, `${path}.id`);
  expectString(value.model, `${path}.model`);
  expectString(value.displayName, `${path}.displayName`);
  expectOptional(value, 'description', path, expectString);
  expectOptional(value, 'hidden', path, expectBoolean);
  expectOptional(
    value,
    'supportedReasoningEfforts',
    path,
    (candidate, candidatePath) => {
      expectArray(candidate, candidatePath, (item, itemPath) => {
        expectRecord(item, itemPath);
        expectString(item.reasoningEffort, `${itemPath}.reasoningEffort`);
        expectString(item.description, `${itemPath}.description`);
      });
    },
  );
  expectOptional(
    value,
    'defaultReasoningEffort',
    path,
    (candidate, candidatePath) =>
      expectNullable(candidate, candidatePath, expectString),
  );
  expectOptional(value, 'serviceTiers', path, (candidate, candidatePath) => {
    expectArray(candidate, candidatePath, (item, itemPath) => {
      expectRecord(item, itemPath);
      expectString(item.id, `${itemPath}.id`);
      expectString(item.name, `${itemPath}.name`);
      expectString(item.description, `${itemPath}.description`);
    });
  });
  expectOptional(
    value,
    'defaultServiceTier',
    path,
    (candidate, candidatePath) =>
      expectNullable(candidate, candidatePath, expectString),
  );
  expectOptional(value, 'isDefault', path, expectBoolean);
  expectOptional(value, 'capabilities', path, expectProviderCapabilities);
  expectOptional(value, 'providerMetadata', path, expectRecord);
}

function expectSkill(value: unknown, path: string): void {
  expectRecord(value, path);
  expectOptional(value, 'id', path, expectString);
  expectString(value.name, `${path}.name`);
  [
    'description',
    'shortDescription',
    'displayName',
    'iconSmall',
    'iconLarge',
    'brandColor',
    'defaultPrompt',
    'scope',
  ].forEach((key) => expectOptional(value, key, path, expectString));
  expectString(value.path, `${path}.path`);
  expectBoolean(value.enabled, `${path}.enabled`);
  expectOptional(value, 'providerMetadata', path, expectRecord);
}


function expectSidePanelMarkdown(value: unknown, path: string): void {
  expectRecord(value, path);
  expectLiteral(value.kind, ['markdown'], `${path}.kind`);
  expectOptional(value, 'documentId', path, expectString);
  expectOptional(value, 'agentId', path, expectString);
  expectOptional(value, 'purpose', path, (candidate, candidatePath) =>
    expectLiteral(candidate, ['plan'], candidatePath),
  );
  expectOptional(value, 'title', path, expectAppText);
  expectOptional(value, 'path', path, expectString);
  expectString(value.content, `${path}.content`);
}


function expectAgentCreationProgress(value: unknown, path: string): void {
  expectRecord(value, path);
  expectString(value.id, `${path}.id`);
  expectLiteral(value.state, ['running', 'success', 'error'], `${path}.state`);
  expectLiteral(value.provider, harnessProviders, `${path}.provider`);
  expectString(value.repositoryName, `${path}.repositoryName`);
  expectBoolean(value.createWorktree, `${path}.createWorktree`);
  expectOptional(value, 'createProject', path, expectBoolean);
  expectOptional(value, 'branchName', path, expectString);
  expectBoolean(value.hasPrompt, `${path}.hasPrompt`);
  expectOptional(value, 'delegationContext', path, (candidate, candidatePath) => {
    if (!isDelegationContext(candidate)) throw new Error(`${candidatePath}: invalid delegation context`);
  });
  expectOptional(value, 'phase', path, (candidate, candidatePath) => {
    expectLiteral(
      candidate,
      [
        'creatingProject',
        'creatingWorktree',
        'initializingWorktree',
        'creatingAgent',
        'startingPrompt',
      ],
      candidatePath,
    );
  });
  ['initializationDetail', 'agentId', 'agentName', 'error'].forEach((key) =>
    expectOptional(value, key, path, expectString),
  );
}

function expectMissionImplementationStartProgress(value: unknown, path: string): void {
  expectRecord(value, path);
  expectString(value.missionId, `${path}.missionId`);
  expectLiteral(
    value.phase,
    ['creatingWorktrees', 'initializingWorkspaces', 'startingAgents'],
    `${path}.phase`,
  );
  expectNumber(value.repositoryCount, `${path}.repositoryCount`);
  expectNumber(value.ticketCount, `${path}.ticketCount`);
}

function expectBrowserAnnotation(value: unknown, path: string): void {
  expectRecord(value, path);
  ['id', 'agentId', 'browserId', 'url'].forEach((key) =>
    expectString(value[key], `${path}.${key}`),
  );
  expectLiteral(value.kind, ['element', 'area'], `${path}.kind`);
  ['selector', 'label', 'comment'].forEach((key) =>
    expectOptional(value, key, path, expectString),
  );
  expectRecord(value.rect, `${path}.rect`);
  const rect = value.rect as Record<string, unknown>;
  ['x', 'y', 'width', 'height'].forEach((key) =>
    expectNumber(rect[key], `${path}.rect.${key}`),
  );
}

function expectWorkBacklogAssignment(value: unknown, path: string): void {
  expectRecord(value, path);
  expectLiteral(value.provider, ['github'], `${path}.provider`);
  ['itemId', 'agentId', 'assignedAt'].forEach((key) =>
    expectString(value[key], `${path}.${key}`),
  );
  expectOptional(value, 'policy', path, (candidate, candidatePath) =>
    expectLiteral(candidate, ['complete', 'review'], candidatePath),
  );
  expectLiteral(
    value.status,
    ['blocked', 'completed', 'inProgress', 'readyForReview', 'working'],
    `${path}.status`,
  );
  [
    'completedAt',
    'note',
    'updatedAt',
    'automationId',
    'automationExecutionId',
  ].forEach((key) => expectOptional(value, key, path, expectString));
}

function expectId(value: unknown, path: string): void {
  expectRecord(value, path);
  expectString(value.id, `${path}.id`);
}





export const runtimePayloadValidators = {
  'conversation.sessionSnapshot': (value, path) => {
    expectRecord(value, path);
    expectNullable(value.conversation, `${path}.conversation`, expectString);
    expectString(value.epoch, `${path}.epoch`);
    expectRecord(value.snapshot, `${path}.snapshot`);
    if (!Number.isSafeInteger(value.snapshot.revision) || Number(value.snapshot.revision) < 0) throw new Error('Invalid conversation session revision.');
    expectRecord(value.snapshot.state, `${path}.snapshot.state`);
    expectArray(value.snapshot.state.messages, `${path}.snapshot.state.messages`, expectRecord);
  },
  'conversation.sessionPatch': (value, path) => {
    expectRecord(value, path);
    expectNullable(value.conversation, `${path}.conversation`, expectString);
    expectString(value.epoch, `${path}.epoch`);
    expectRecord(value.patch, `${path}.patch`);
    if (!Number.isSafeInteger(value.patch.revision) || Number(value.patch.revision) < 1) throw new Error('Invalid conversation session revision.');
    expectArray(value.patch.ops, `${path}.patch.ops`, expectRecord);
  },
  // Conversation activity relayed between daemons.
  'turn.started': expectRecord,
  'turn.output': expectRecord,
  'diff.updated': expectRecord,
  'turn.completed': (value, path) => {
    expectRecord(value, path);
    expectString(value.status, `${path}.status`);
    if (typeof value.willRetry !== 'boolean') throw new Error('Invalid turn completion.');
  },
  'session.error': (value, path) => {
    expectRecord(value, path);
    expectRecord(value.error, `${path}.error`);
    expectString(value.error.message, `${path}.error.message`);
  },
  'tool.updated': (value, path) => {
    expectRecord(value, path);
    expectRecord(value.tool, `${path}.tool`);
    expectString(value.tool.id, `${path}.tool.id`);
    expectLiteral(value.tool.status, ['running', 'completed', 'failed'], `${path}.tool.status`);
  },
  'file.activity': (value, path) => {
    expectRecord(value, path);
    expectString(value.action, `${path}.action`);
    expectString(value.status, `${path}.status`);
  },
  'provider.authenticationChanged': (value, path) => {
    if (!isProviderAuthentication(value)) {
      throw new Error(`Invalid ${product.name} backend event at ${path}: expected provider authentication.`);
    }
  },
  'provider.statusChanged': expectProviderRuntimeStatus,
  'snapshot.updated': expectAppSnapshot,
  'account.rateLimitsUpdated': expectRateLimits,
  'remoteControl.statusChanged': expectDevicePairingStatus,
  'models.changed': (value, path) => {
    expectRecord(value, path);
    expectArray(value.models, `${path}.models`, expectModel);
  },
  'skills.changed': (value, path) => {
    expectRecord(value, path);
    expectNullable(value.cwd, `${path}.cwd`, expectString);
    expectLiteral(value.status, ['loaded'], `${path}.status`);
    expectArray(value.skills, `${path}.skills`, expectSkill);
  },
  'client.markdownDisplayRequested': expectSidePanelMarkdown,
  'plan.reviewResolved': (value, path) => {
    expectRecord(value, path);
    expectString(value.reviewId, `${path}.reviewId`);
    expectLiteral(value.resolution, ['accept', 'revise', 'cancel'], `${path}.resolution`);
  },
  'plan.readyForReview': (value, path) => {
    expectRecord(value, path);
    expectString(value.markdown, `${path}.markdown`);
    expectOptional(value, 'itemId', path, expectString);
  },
  'client.celebrationRequested': (value, path) => {
    expectRecord(value, path);
    expectLiteral(
      value.kind,
      ['confetti', 'stars', 'shapes', 'schoolPride'],
      `${path}.kind`,
    );
  },
  'agentCreation.progress': expectAgentCreationProgress,
  'mission.implementationStartProgress': expectMissionImplementationStartProgress,
  'mission.focusRequested': (value, path) => {
    expectRecord(value, path);
    expectString(value.missionId, `${path}.missionId`);
  },
  'git.branchWorkProgress': (value, path) => {
    expectRecord(value, path);
    for (const key of ['id', 'agentId', 'branchName']) expectString(value[key], `${path}.${key}`);
    expectLiteral(value.state, ['running', 'success', 'error'], `${path}.state`);
    expectLiteral(value.phase, ['creatingWorktree', 'movingChanges', 'creatingAgent', 'resettingSource'], `${path}.phase`);
    expectOptional(value, 'error', path, expectString);
  },
  'git.operationProgress': (value, path) => {
    expectRecord(value, path);
    expectLiteral(
      value.operation,
      ['pullRequest', 'merge'],
      `${path}.operation`,
    );
    expectLiteral(value.phase, ['handoff', 'delivery'], `${path}.phase`);
  },
  'browser.annotationCreated': expectBrowserAnnotation,
  'workItem.assignmentUpdated': expectWorkBacklogAssignment,
} satisfies Record<string, EventValueValidator>;
