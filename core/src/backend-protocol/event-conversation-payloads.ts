import { isAgentGitStatus } from '../snapshot-guard-collections';
import { isDelegationOverrides } from '../delegation-context';
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
  type EventValueValidator,
} from './event-validation';

function expectPromptAttachment(value: unknown, path: string): void {
  expectRecord(value, path);
  expectLiteral(value.type, ['image', 'file'], `${path}.type`);
  expectString(value.path, `${path}.path`);
  ['name', 'mimeType'].forEach((key) =>
    expectOptional(value, key, path, expectString),
  );
  if (value.type === 'image') {
    expectOptional(value, 'detail', path, (candidate, candidatePath) => {
      expectLiteral(
        candidate,
        ['auto', 'low', 'high', 'original'],
        candidatePath,
      );
    });
    expectOptional(value, 'previewUrl', path, expectString);
  }
}

function expectPromptSkill(value: unknown, path: string): void {
  expectRecord(value, path);
  expectString(value.name, `${path}.name`);
  expectString(value.path, `${path}.path`);
}

function expectSendPromptOptions(value: unknown, path: string): void {
  expectRecord(value, path);
  expectOptional(value, 'delegation', path, (candidate, candidatePath) => {
    if (!isDelegationOverrides(candidate)) throw new Error(`${candidatePath}: invalid delegation options`);
  });
  expectOptional(value, 'attachments', path, (candidate, candidatePath) =>
    expectArray(candidate, candidatePath, expectPromptAttachment),
  );
  ['model', 'reasoningEffort', 'serviceTier'].forEach((key) => {
    expectOptional(value, key, path, (candidate, candidatePath) =>
      expectNullable(candidate, candidatePath, expectString),
    );
  });
  expectOptional(value, 'planMode', path, expectBoolean);
  expectOptional(value, 'skills', path, (candidate, candidatePath) =>
    expectArray(candidate, candidatePath, expectPromptSkill),
  );
  expectOptional(value, 'inputMethod', path, (candidate, candidatePath) =>
    expectLiteral(candidate, ['typed', 'dictated'], candidatePath),
  );
  expectOptional(value, 'recordUserMessage', path, expectBoolean);
  expectOptional(value, 'backendOptions', path, (candidate, candidatePath) => {
    expectRecord(candidate, candidatePath);
    expectLiteral(candidate.kind, ['codex', 'claude', 'antigravity'], `${candidatePath}.kind`);
    if (candidate.kind === 'codex') {
      ['reasoningEffort', 'serviceTier'].forEach((key) => {
        expectOptional(candidate, key, candidatePath, (item, itemPath) =>
          expectNullable(item, itemPath, expectString),
        );
      });
      expectOptional(candidate, 'skills', candidatePath, (item, itemPath) =>
        expectArray(item, itemPath, expectPromptSkill),
      );
      return;
    }
    expectOptional(
      candidate,
      'thinkingBudgetTokens',
      candidatePath,
      (item, itemPath) => expectNullable(item, itemPath, expectNumber),
    );
    expectOptional(
      candidate,
      'permissionMode',
      candidatePath,
      (item, itemPath) => expectNullable(item, itemPath, expectString),
    );
  });
}

function expectBackendApproval(value: unknown, path: string): void {
  expectRecord(value, path);
  ['id', 'conversationId', 'itemId', 'title'].forEach((key) =>
    expectString(value[key], `${path}.${key}`),
  );
  expectLiteral(
    value.kind,
    ['command', 'file-change', 'permissions'],
    `${path}.kind`,
  );
  ['turnId', 'description', 'command', 'cwd'].forEach((key) =>
    expectOptional(value, key, path, expectString),
  );
  expectOptional(
    value,
    'requestedPermissions',
    path,
    (candidate, candidatePath) => {
      expectArray(candidate, candidatePath, (permission, permissionPath) => {
        expectRecord(permission, permissionPath);
        expectLiteral(
          permission.kind,
          ['filesystem', 'network'],
          `${permissionPath}.kind`,
        );
        if (permission.kind === 'filesystem') {
          expectLiteral(
            permission.access,
            ['read', 'write', 'deny'],
            `${permissionPath}.access`,
          );
          expectString(permission.path, `${permissionPath}.path`);
          return;
        }
        expectBoolean(permission.enabled, `${permissionPath}.enabled`);
        ['host', 'protocol'].forEach((key) =>
          expectOptional(permission, key, permissionPath, expectString),
        );
      });
    },
  );
  expectOptional(value, 'allowedScopes', path, (candidate, candidatePath) => {
    expectArray(candidate, candidatePath, (scope, scopePath) =>
      expectLiteral(scope, ['once', 'session'], scopePath),
    );
  });
  expectOptional(value, 'canDeny', path, expectBoolean);
}

function expectGitDiff(value: unknown, path: string): void {
  expectRecord(value, path);
  expectNumber(value.addedLines, `${path}.addedLines`);
  expectNumber(value.removedLines, `${path}.removedLines`);
  expectOptional(value, 'diff', path, expectString);
}

function expectFileActivity(value: unknown, path: string): void {
  expectRecord(value, path);
  ['messageId', 'itemId', 'path'].forEach((key) =>
    expectString(value[key], `${path}.${key}`),
  );
  expectLiteral(value.action, ['read', 'edit', 'create'], `${path}.action`);
  expectLiteral(
    value.status,
    ['running', 'completed', 'failed'],
    `${path}.status`,
  );
}

export const conversationPayloadValidators = {
  'agent.promptQueued': (value, path) => {
    expectRecord(value, path);
    ['id', 'text'].forEach((key) => expectString(value[key], `${path}.${key}`));
    expectOptional(value, 'options', path, expectSendPromptOptions);
    expectOptional(value, 'submitted', path, expectBoolean);
  },
  'agent.promptRetryScheduled': (value, path) => {
    expectRecord(value, path);
    ['id', 'lastError'].forEach((key) =>
      expectString(value[key], `${path}.${key}`),
    );
    expectNumber(value.attempts, `${path}.attempts`);
    expectOptional(value, 'retryAt', path, expectString);
  },
  'agent.promptDequeued': (value, path) => {
    expectRecord(value, path);
    expectStringArray(value.ids, `${path}.ids`);
  },
  'conversation.turnDiffUpdated': expectGitDiff,
  'workspace.fileActivityDetected': expectFileActivity,
  'git.statusUpdated': (value, path) =>
    expectKnownShape(value, path, isAgentGitStatus, 'agent git status'),
  'agentRequest.created': (value, path) => {
    expectRecord(value, path);
    const request = value.request;
    expectRecord(request, `${path}.request`);
    expectString(request.id, `${path}.request.id`);
    expectString(request.conversationId, `${path}.request.conversationId`);
    expectOptional(request, 'turnId', `${path}.request`, expectString);
    expectOptional(request, 'itemId', `${path}.request`, expectString);
    expectLiteral(request.kind, ['approval', 'question', 'toolConfirmation'], `${path}.request.kind`);
    if (request.kind === 'approval') expectBackendApproval(request.approval, `${path}.request.approval`);
    if (request.kind === 'question') {
      expectRecord(request.question, `${path}.request.question`);
      expectString(request.question.itemId, `${path}.request.question.itemId`);
      expectLiteral(request.question.delivery, ['tool', 'async'], `${path}.request.question.delivery`);
      expectBoolean(request.question.blocking, `${path}.request.question.blocking`);
      expectArray(request.question.questions, `${path}.request.question.questions`, (question, questionPath) => {
        expectRecord(question, questionPath);
        ['id', 'header', 'question'].forEach((key) => expectString(question[key], `${questionPath}.${key}`));
      });
    }
    if (request.kind === 'toolConfirmation') {
      expectRecord(request.confirmation, `${path}.request.confirmation`);
      ['argumentsPreview', 'integrationId', 'integrationName', 'summary', 'toolName'].forEach((key) => expectString((request.confirmation as Record<string, unknown>)[key], `${path}.request.confirmation.${key}`));
    }
  },
  'agentRequest.resolved': (value, path) => {
    expectRecord(value, path);
    expectString(value.id, `${path}.id`);
    expectRecord(value.outcome, `${path}.outcome`);
    expectLiteral(value.outcome.kind, ['answered', 'decision', 'cancelled', 'completed'], `${path}.outcome.kind`);
    if (value.outcome.kind === 'decision') expectLiteral(value.outcome.decision, ['allow', 'allow_conversation', 'always_allow', 'deny'], `${path}.outcome.decision`);
    if (value.outcome.kind === 'answered') {
      expectRecord(value.outcome.answers, `${path}.outcome.answers`);
      for (const [id, answer] of Object.entries(value.outcome.answers)) {
        expectRecord(answer, `${path}.outcome.answers.${id}`);
        expectStringArray(answer.answers, `${path}.outcome.answers.${id}.answers`);
      }
    }
    expectOptional(value.outcome, 'reason', `${path}.outcome`, expectString);
  },
} satisfies Record<string, EventValueValidator>;
