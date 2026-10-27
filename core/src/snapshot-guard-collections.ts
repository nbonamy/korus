import { normalizePromptContent } from '@codex-app-sdk/core/surface';
import { fileKinds } from './file-kind';
import { isDelegationOverrides } from './delegation-context';
import {
  hasOwn,
  includes,
  isArrayOf,
  isBoolean,
  isNullable,
  isNullableNumber,
  isNullableString,
  isNumber,
  isRecord,
  isString,
  optional,
} from './snapshot-guard-primitives';
import type { AgentGitDiffTarget } from './contracts/git';

export function isRendererMessage(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.agentId === 'string' &&
    optional(value, 'kind', (candidate) => includes(['compaction', 'steer'], candidate)) &&
    includes(['user', 'assistant', 'system'], value.role) &&
    includes(['complete', 'streaming', 'error'], value.status) &&
    optional(value, 'turnId', isString) &&
    optional(value, 'metadata', metadata => isRecord(metadata) && optional(metadata, 'promptContent', isPromptContent)) &&
    isArrayOf(value.parts, isRendererMessagePart) &&
    typeof value.createdAt === 'string';
}

function isRendererMessagePart(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'attachment':
      return isRendererMessageAttachment(value.attachment);
    case 'media':
      return isRendererMessageMedia(value.media) && optional(value, 'itemId', isString);
    case 'reasoning':
      return typeof value.summary === 'string' && typeof value.itemId === 'string' && typeof value.summaryIndex === 'number';
    case 'text':
      return typeof value.text === 'string' &&
        optional(value, 'itemId', isString) &&
        optional(value, 'phase', (candidate) => includes(['commentary', 'final_answer'], candidate));
    case 'tool':
      return typeof value.id === 'string' &&
        typeof value.kind === 'string' &&
        typeof value.title === 'string' &&
        includes(['running', 'completed', 'failed'], value.status) &&
        optional(value, 'statusText', isString) &&
        optional(value, 'body', isString) &&
        optional(value, 'metadata', isRecord);
    case 'status':
      return typeof value.text === 'string';
    default:
      return false;
  }
}

function isRendererMessageAttachment(value: unknown): boolean {
  return isRecord(value) &&
    includes(['file', 'image'], value.kind) &&
    typeof value.name === 'string' &&
    optional(value, 'path', isString) &&
    optional(value, 'url', isString) &&
    optional(value, 'mimeType', isString);
}

function isRendererMessageMedia(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.url === 'string' &&
    optional(value, 'alt', isString) &&
    optional(value, 'mimeType', isString) &&
    optional(value, 'prompt', isString) &&
    optional(value, 'title', isString);
}

export function isQueuedPrompt(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.agentId === 'string' &&
    typeof value.text === 'string' &&
    typeof value.createdAt === 'string' &&
    optional(value, 'options', isSendPromptOptions) &&
    optional(value, 'attempts', isNumber) &&
    optional(value, 'lastError', isString) &&
    optional(value, 'retryAt', isString) &&
    optional(value, 'submitted', isBoolean);
}

function isSendPromptOptions(value: unknown): boolean {
  return isRecord(value) &&
    optional(value, 'content', isPromptContent) &&
    optional(value, 'delegation', isDelegationOverrides) &&
    optional(value, 'attachments', (candidate) => isArrayOf(candidate, isPromptAttachment)) &&
    optional(value, 'model', isNullableString) &&
    optional(value, 'planMode', isBoolean) &&
    optional(value, 'reasoningEffort', isNullableString) &&
    optional(value, 'serviceTier', isNullableString) &&
    optional(value, 'skills', (candidate) => isArrayOf(candidate, isPromptSkill)) &&
    optional(value, 'inputMethod', (candidate) => includes(['typed', 'dictated'], candidate)) &&
    optional(value, 'recordUserMessage', isBoolean) &&
    optional(value, 'backendOptions', isBackendPromptOptions);
}

export function isPromptContent(value: unknown): boolean {
  try { normalizePromptContent(value); return true; }
  catch { return false; }
}

function isPromptAttachment(value: unknown): boolean {
  if (!isRecord(value) || typeof value.path !== 'string') return false;
  if (value.type === 'file') {
    return optional(value, 'name', isString) && optional(value, 'mimeType', isString);
  }
  return value.type === 'image' &&
    optional(value, 'detail', (candidate) => includes(['auto', 'low', 'high', 'original'], candidate)) &&
    optional(value, 'name', isString) &&
    optional(value, 'mimeType', isString) &&
    optional(value, 'previewUrl', isString);
}

function isPromptSkill(value: unknown): boolean {
  return isRecord(value) && typeof value.name === 'string' && typeof value.path === 'string';
}

function isBackendPromptOptions(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'antigravity') return optional(value, 'permissionMode', isNullableString);
  if (value.kind === 'codex') {
    return optional(value, 'reasoningEffort', isNullableString) &&
      optional(value, 'serviceTier', isNullableString) &&
      optional(value, 'skills', (candidate) => isArrayOf(candidate, isPromptSkill));
  }
  return value.kind === 'claude' &&
    optional(value, 'thinkingBudgetTokens', isNullableNumber) &&
    optional(value, 'permissionMode', isNullableString);
}

export function isAgentGitStatus(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.folder === 'string' &&
    optional(value, 'repository', isString) &&
    optional(value, 'githubRepository', isString) &&
    optional(value, 'repositoryProvider', candidate => includes(['github', 'gitlab'], candidate)) &&
    optional(value, 'branch', isString) &&
    optional(value, 'upstream', isString) &&
    typeof value.ahead === 'number' &&
    typeof value.behind === 'number' &&
    typeof value.changedFiles === 'number' &&
    typeof value.addedLines === 'number' &&
    typeof value.removedLines === 'number' &&
    typeof value.hasUntracked === 'boolean' &&
    includes(['clean', 'dirty', 'unknown'], value.state) &&
    optional(value, 'diffCatalog', isAgentGitDiffCatalog) &&
    typeof value.updatedAt === 'string' &&
    optional(value, 'error', isString);
}

function isAgentGitDiffCatalog(value: unknown): boolean {
  if (!isRecord(value) || !isAgentGitDiffTarget(value.defaultTarget)) return false;
  return value.defaultTarget.type !== 'commit' && value.defaultTarget.type !== 'turn' &&
    optional(value, 'branch', (branch) => isRecord(branch) && isAgentGitDiffSummary(branch) && typeof branch.baseRef === 'string') &&
    isAgentGitDiffSummary(value.uncommitted) &&
    isAgentGitDiffSummary(value.unstaged) &&
    isAgentGitDiffSummary(value.staged) &&
    Array.isArray(value.commits) && value.commits.every((commit) => (
      isAgentGitDiffSummary(commit) &&
      typeof commit.sha === 'string' &&
      typeof commit.shortSha === 'string' &&
      typeof commit.subject === 'string'
    ));
}

export function isAgentGitDiffTarget(value: unknown): value is AgentGitDiffTarget {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'branch') return optional(value, 'baseRef', isString);
  if (value.type === 'uncommitted' || value.type === 'unstaged' || value.type === 'staged') return true;
  if (value.type === 'commit') return typeof value.sha === 'string';
  return value.type === 'turn' && typeof value.turnId === 'string';
}

function isAgentGitDiffSummary(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.addedLines === 'number' &&
    typeof value.removedLines === 'number' &&
    typeof value.changedFiles === 'number' &&
    optional(value, 'byKind', isKindBreakdown);
}

function isKindBreakdown(value: unknown): boolean {
  return isRecord(value) && fileKinds.every(kind => {
    const stats = value[kind];
    return isRecord(stats) && typeof stats.addedLines === 'number' && typeof stats.removedLines === 'number' && typeof stats.changedFiles === 'number';
  });
}

export function isTurnGitDiff(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.turnId === 'string' &&
    typeof value.addedLines === 'number' &&
    typeof value.removedLines === 'number' &&
    optional(value, 'diff', isString) &&
    typeof value.updatedAt === 'string';
}

export function isAccountRateLimits(value: unknown): boolean {
  return isRecord(value) &&
    isNullableString(value.limitId) &&
    isNullableString(value.limitName) &&
    isNullable(value.primary, isAccountRateLimitWindow) &&
    isNullable(value.secondary, isAccountRateLimitWindow) &&
    hasOwn(value, 'credits') &&
    hasOwn(value, 'individualLimit') &&
    isNullableString(value.planType) &&
    isNullableString(value.rateLimitReachedType);
}

function isAccountRateLimitWindow(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.usedPercent === 'number' &&
    isNullableNumber(value.windowDurationMins) &&
    isNullableNumber(value.resetsAt);
}
