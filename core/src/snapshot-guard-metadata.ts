import { isDelegationContext, isTurnDelegationOverrides, isDelegationUserInstructions } from './delegation-context';
import { isAutomationTarget } from './automation-manager';
import { normalizeAutomationSchedule } from './automation-schedule';
import { isWorkProviderKind } from './work-providers';
import { isMission } from './missions';
import { sanitizeWorkItemAssignmentSource } from './work-assignments';
import { isAgentHandoff } from './agent-handoff';
import { isProviderConnection } from './contracts/provider-setup';
import { isThreadFlags } from './thread-flags';
import { isAppTextDescriptor } from './app-text';
import { isApprovalPreset, isApprovalsReviewer } from './approval-presets';
import { spokenAnnouncementVoices } from './contracts';
import { isInteractivePlan } from './interactive-plan';
import { isPlanReview } from './plan-review';
import { isVisualization, isVisualizeSession } from './visualize';
import { isCodeReviewSession, isCodeReviewPreferences } from './code-review';
import {
  isSubagentActivityKind,
  isSubagentOperationKind,
  isSubagentOperationLifecycle,
  isSubagentOperationStatus,
  isSubagentStatus,
} from './subagent-values';
import {
  includes,
  isAgentBackend,
  isArrayOf,
  isBoolean,
  isNullableNumber,
  isNullableString,
  isNumber,
  isRecord,
  isRecordMapOf,
  isString,
  optional,
} from './snapshot-guard-primitives';
import {
  isAccountRateLimits,
  isAgentGitDiffTarget,
  isAgentGitStatus,
  isQueuedPrompt,
  isTurnGitDiff,
} from './snapshot-guard-collections';

export function isSnapshotMetadata(value: unknown): value is Record<string, unknown> {
  return isRecord(value) &&
    isArrayOf(value.teams, isTeam) &&
    isArrayOf(value.agents, isAgent) &&
    isArrayOf(value.automations, isAutomation) &&
    optional(value, 'missions', (candidate) => isArrayOf(candidate, isMission)) &&
    optional(value, 'repositoryVisualizations', (candidate) => isRecordMapOf(candidate, (visualizations) => isArrayOf(visualizations, isVisualization))) &&
    isNullableString(value.activeTeamId) &&
    isNullableString(value.activeAgentId) &&
    optional(value, 'queuedPrompts', (candidate) => isArrayOf(candidate, isQueuedPrompt)) &&
    isRecordMapOf(value.backendApprovals, (candidate) => isArrayOf(candidate, isBackendApprovalRequest)) &&
    optional(value, 'agentRequests', (candidate) => isRecordMapOf(candidate, (requests) => isArrayOf(requests, isAgentRequest))) &&
    optional(value, 'clientPreferences', (candidate) => isRecordMapOf(candidate, isClientPreferences)) &&
    isRecordMapOf(value.agentGitStatuses, isAgentGitStatus) &&
    isRecordMapOf(value.turnGitDiffs, isTurnGitDiff) &&
    isRecordMapOf(value.subagentTrees, isSubagentTree) &&
    isArrayOf(value.backendRuntimes, isBackendRuntimeStatus) &&
    optional(value, 'providerConnections', candidate => isArrayOf(candidate, isProviderConnection)) &&
    optional(value, 'accountRateLimits', isAccountRateLimits) &&
    optional(value, 'backendAccountRateLimits', candidate => isRecord(candidate) && Object.entries(candidate).every(([backend, limits]) => isAgentBackend(backend) && isAccountRateLimits(limits))) &&
    isWorkBacklog(value.workBacklog) &&
    isRemoteConnections(value.remoteConnections) &&
    isGeneralSettings(value.general) &&
    isSourceFolder(value.sourceFolder) &&
    isTheme(value.theme);
}

function isAgentRequest(value: unknown): boolean {
  if (!isRecord(value) || !isString(value.id) || !isString(value.conversationId)
    || !optional(value, 'turnId', isString) || !optional(value, 'itemId', isString)) return false;
  if (value.kind === 'approval') return isBackendApprovalRequest(value.approval);
  if (value.kind === 'toolConfirmation') {
    const confirmation = value.confirmation;
    return isRecord(confirmation)
      && ['argumentsPreview', 'integrationId', 'integrationName', 'summary', 'toolName'].every((key) => isString(confirmation[key]));
  }
  return value.kind === 'question' && isRecord(value.question)
    && isString(value.question.itemId) && ['tool', 'async'].includes(value.question.delivery as string)
    && isBoolean(value.question.blocking) && isArrayOf(value.question.questions, (question) => isRecord(question)
      && ['id', 'header', 'question'].every((key) => isString(question[key])));
}

function isClientPreferences(value: unknown): boolean {
  return isRecord(value)
    && optional(value, 'activeAgentId', isNullableString) && optional(value, 'activeTeamId', isNullableString)
    && optional(value, 'activeAgentByTeam', (candidate) => isRecordMapOf(candidate, isString))
    && optional(value, 'teamOrder', (candidate) => isArrayOf(candidate, isString))
    && optional(value, 'agentOrderByTeam', (candidate) => isRecordMapOf(candidate, (ids) => isArrayOf(ids, isString)))
    && optional(value, 'externalApplications', (candidate) => isRecordMapOf(candidate, isString))
    && optional(value, 'general', isRecord) && optional(value, 'theme', isRecord);
}

function isTeam(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    optional(value, 'avatar', isString) &&
    optional(value, 'color', isString) &&
    optional(value, 'remoteConnectionId', isString) &&
    optional(value, 'remoteTeamId', isString) &&
    isArrayOf(value.agentIds, isString) &&
    optional(value, 'activeAgentId', isString);
}

function isAgent(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    optional(value, 'teamId', isString) &&
    optional(value, 'delegatedByAgentId', isString) &&
    optional(value, 'delegationContext', isDelegationContext) &&
    optional(value, 'userDelegationOverrides', isTurnDelegationOverrides) &&
    optional(value, 'delegationUserInstructions', isDelegationUserInstructions) &&
    optional(value, 'handoff', isAgentHandoff) &&
    optional(value, 'pullRequest', isAgentPullRequestTracking) &&
    optional(value, 'sessionKind', (candidate) => candidate === 'quickChat') &&
    isNullableString(value.name) &&
    optional(value, 'conversationTitle', isString) &&
    optional(value, 'avatar', isString) &&
    isNullableString(value.folder) &&
    optional(value, 'workspace', isAgentWorkspaceIdentity) &&
    isAgentBackend(value.backend) &&
    optional(value, 'backendSession', isBackendSession) &&
    optional(value, 'backendDefaults', isBackendDefaults) &&
    optional(value, 'openInApplication', isOpenInApplication) &&
    optional(value, 'gitDiffTarget', isAgentGitDiffTarget) &&
    optional(value, 'contextUsage', isAgentContextUsage) &&
    optional(value, 'plan', isThreadPlan) &&
    optional(value, 'interactivePlan', isInteractivePlan) &&
    optional(value, 'planReview', isPlanReview) &&
    optional(value, 'codeReview', isCodeReviewSession) &&
    optional(value, 'threadFlags', isThreadFlags) &&
    optional(value, 'suggestedPrompt', isString) &&
    optional(value, 'goal', isThreadGoal) &&
    optional(value, 'visualize', isVisualizeSession) &&
    optional(value, 'isRegistered', isBoolean) &&
    optional(value, 'mcpSessionId', isString) &&
    optional(value, 'statusText', isString) &&
    isAgentStatus(value.status) &&
    typeof value.createdAt === 'string' &&
    optional(value, 'lastActivityAt', isString) &&
    optional(value, 'hasSubmittedPrompt', isBoolean) &&
    typeof value.updatedAt === 'string';
}

function isAgentStatus(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'idle':
      return true;
    case 'working':
    case 'awaitingInput':
      return optional(value, 'detail', isAppText);
    case 'error':
      return isAppText(value.message);
    default:
      return false;
  }
}

function isAppText(value: unknown): boolean {
  return typeof value === 'string' || isAppTextDescriptor(value);
}

function isAgentPullRequestTracking(value: unknown): boolean {
  return isRecord(value) &&
    value.provider === 'github' &&
    typeof value.repository === 'string' &&
    typeof value.branch === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    isAgentGitPullRequest(value);
}

function isAgentGitPullRequest(value: Record<string, unknown>): boolean {
  return typeof value.number === 'number' &&
    typeof value.title === 'string' &&
    typeof value.url === 'string' &&
    typeof value.draft === 'boolean' &&
    typeof value.headSha === 'string' &&
    includes(['open', 'merged', 'closed'], value.state) &&
    optional(value, 'mergedAt', isString);
}

function isAgentWorkspaceIdentity(value: unknown): boolean {
  if (!isRecord(value) || typeof value.folder !== 'string' || typeof value.updatedAt !== 'string') return false;
  if (value.kind === 'folder') return typeof value.label === 'string';
  return value.kind === 'git' &&
    typeof value.repositoryName === 'string' &&
    typeof value.repositoryRoot === 'string' &&
    isNullableString(value.branch) &&
    typeof value.isLinkedWorktree === 'boolean' &&
    typeof value.primaryWorktreeRoot === 'string' &&
    optional(value, 'originUrl', isString);
}

function isBackendSession(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'antigravity') return typeof value.sessionId === 'string';
  if (value.kind === 'codex') return typeof value.threadId === 'string';
  return value.kind === 'claude' &&
    typeof value.sessionId === 'string' &&
    includes(['stdio', 'websocket'], value.transport) &&
    optional(value, 'transcriptSessionId', isString) &&
    optional(value, 'transcriptFolder', isString) &&
    optional(value, 'serverUrl', isString) &&
    optional(value, 'model', isString) &&
    optional(value, 'reasoningEffort', isString);
}

function isBackendDefaults(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'antigravity') return optional(value, 'model', isString)
    && optional(value, 'userSelectedModel', isBoolean) && optional(value, 'permissionMode', isString);
  if (value.kind === 'codex') {
    return optional(value, 'model', isString) &&
      optional(value, 'userSelectedModel', isBoolean) &&
      optional(value, 'approvalPreset', isApprovalPreset) &&
      optional(value, 'approvalPolicy', isString) &&
      optional(value, 'approvalsReviewer', isApprovalsReviewer) &&
      optional(value, 'sandboxMode', isString) &&
      optional(value, 'reasoningEffort', isString) &&
      optional(value, 'serviceTier', isNullableString);
  }
  return value.kind === 'claude' &&
    optional(value, 'model', isString) &&
    optional(value, 'userSelectedModel', isBoolean) &&
    optional(value, 'reasoningEffort', isString) &&
    optional(value, 'permissionMode', isString) &&
    optional(value, 'thinking', isThinkingDefaults);
}

function isThinkingDefaults(value: unknown): boolean {
  return isRecord(value) &&
    includes(['enabled', 'disabled'], value.type) &&
    optional(value, 'budgetTokens', isNumber);
}

function isOpenInApplication(value: unknown): boolean {
  return includes(['vscode', 'finder', 'terminal', 'iterm2', 'ghostty', 'xcode', 'android-studio', 'jetbrains'], value);
}

function isAgentContextUsage(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.totalTokens === 'number' &&
    typeof value.inputTokens === 'number' &&
    typeof value.cachedInputTokens === 'number' &&
    typeof value.outputTokens === 'number' &&
    typeof value.reasoningOutputTokens === 'number' &&
    typeof value.lastTotalTokens === 'number' &&
    isNullableNumber(value.modelContextWindow) &&
    isNullableNumber(value.usedPercent);
}

function isThreadPlan(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.threadId === 'string' &&
    typeof value.turnId === 'string' &&
    includes(['execution', 'proposed'], value.kind) &&
    includes(['inProgress', 'completed', 'incomplete', 'interrupted', 'failed'], value.status) &&
    typeof value.explanation === 'string' &&
    isArrayOf(value.steps, isThreadPlanStep) &&
    typeof value.markdown === 'string' &&
    typeof value.updatedAt === 'string';
}

function isThreadPlanStep(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.step === 'string' &&
    includes(['pending', 'inProgress', 'completed'], value.status);
}

function isThreadGoal(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.threadId === 'string' &&
    typeof value.objective === 'string' &&
    includes(['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'], value.status) &&
    isNullableNumber(value.tokenBudget) &&
    typeof value.tokensUsed === 'number' &&
    typeof value.timeUsedSeconds === 'number' &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number';
}

function isAutomation(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.enabled === 'boolean' &&
    isAutomationTarget(value.target) &&
    typeof value.prompt === 'string' &&
    isAutomationSchedule(value.schedule) &&
    isArrayOf(value.executionLog, isAutomationExecution) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    optional(value, 'lastRunAt', isString) &&
    optional(value, 'scheduleAnchorAt', isString) &&
    optional(value, 'lastError', isString);
}

function isAutomationSchedule(value: unknown): boolean {
  return normalizeAutomationSchedule(value) !== null;
}

function isAutomationExecution(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.automationId === 'string' &&
    typeof value.startedAt === 'string' &&
    optional(value, 'completedAt', isString) &&
    includes(['working', 'awaitingInput', 'completed', 'failed'], value.status) &&
    optional(value, 'agentId', isString) &&
    optional(value, 'agentName', isString) &&
    optional(value, 'conversationRef', isBackendConversationRef) &&
    optional(value, 'error', isString);
}

function isBackendConversationRef(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.backend === 'codex') return typeof value.threadId === 'string';
  return (value.backend === 'claude' || value.backend === 'antigravity') && isNullableString(value.folder) && typeof value.sessionId === 'string';
}

function isBackendRuntimeStatus(value: unknown): boolean {
  return isRecord(value) &&
    isAgentBackend(value.backend) &&
    includes(['notConfigured', 'starting', 'running', 'error'], value.status) &&
    optional(value, 'detail', isAppText) &&
    optional(value, 'capabilities', isBackendCapabilities);
}

function isBackendCapabilities(value: unknown): boolean {
  return isRecord(value) &&
    optional(value, 'attachments', isBoolean) &&
    optional(value, 'models', isBoolean) &&
    optional(value, 'skills', isBoolean) &&
    optional(value, 'reasoningEffort', isBoolean) &&
    optional(value, 'serviceTier', isBoolean) &&
    optional(value, 'thinkingBudget', isBoolean) &&
    optional(value, 'planMode', (candidate) => includes(['native', 'prompted', 'unsupported'], candidate)) &&
    optional(value, 'goals', isBoolean) &&
    optional(value, 'steerPrompt', isBoolean) &&
    optional(value, 'interrupt', isBoolean) &&
    optional(value, 'history', isBoolean) &&
    optional(value, 'conversationFork', isBoolean) &&
    ['codeReview', 'planReview', 'questions', 'plugins', 'conversationArchive', 'conversationResume', 'conversationReplaceWithSummary', 'remoteControl'].every((key) => optional(value, key, isBoolean)) &&
    optional(value, 'deleteTurn', isBoolean) &&
    optional(value, 'editTurn', isBoolean) &&
    optional(value, 'retryTurn', isBoolean) &&
    optional(value, 'approvals', isBoolean) &&
    optional(value, 'approvalPresets', (candidate) => isArrayOf(candidate, isApprovalPreset)) &&
    optional(value, 'permissionModes', (candidate) => isArrayOf(candidate, isPermissionModeOption));
}

function isPermissionModeOption(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    isAppText(value.label) &&
    isAppText(value.description) &&
    optional(value, 'dangerous', isBoolean);
}

function isBackendApprovalRequest(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    includes(['command', 'file-change', 'permissions'], value.kind) &&
    typeof value.conversationId === 'string' &&
    optional(value, 'turnId', isString) &&
    typeof value.itemId === 'string' &&
    typeof value.title === 'string' &&
    optional(value, 'description', isString) &&
    optional(value, 'command', isString) &&
    optional(value, 'cwd', isString) &&
    optional(value, 'requestedPermissions', (candidate) => isArrayOf(candidate, isRequestedPermission)) &&
    optional(value, 'allowedScopes', (candidate) => isArrayOf(candidate, (scope) => includes(['once', 'session'], scope))) &&
    optional(value, 'canDeny', isBoolean);
}

function isRequestedPermission(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'filesystem') {
    return includes(['read', 'write', 'deny'], value.access) && typeof value.path === 'string';
  }
  return value.kind === 'network' &&
    typeof value.enabled === 'boolean' &&
    optional(value, 'host', isString) &&
    optional(value, 'protocol', isString);
}

function isSubagentTree(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.rootConversationId === 'string' &&
    isRecordMapOf(value.nodes, isSubagentNode) &&
    isRecordMapOf(value.operations, isSubagentOperation) &&
    isRecordMapOf(value.activities, isSubagentActivity);
}

function isSubagentNode(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.conversationId === 'string' &&
    typeof value.parentConversationId === 'string' &&
    typeof value.createdAt === 'string' &&
    isSubagentStatus(value.status) &&
    optional(value, 'statusMessage', isString) &&
    optional(value, 'agentPath', isString) &&
    optional(value, 'agentNickname', isString) &&
    optional(value, 'agentRole', isString) &&
    optional(value, 'prompt', isString) &&
    optional(value, 'model', isString) &&
    optional(value, 'reasoningEffort', isString) &&
    typeof value.updatedAt === 'string';
}

function isSubagentOperation(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    optional(value, 'turnId', isString) &&
    isSubagentOperationLifecycle(value.lifecycle) &&
    isSubagentOperationKind(value.kind) &&
    isSubagentOperationStatus(value.status) &&
    typeof value.senderConversationId === 'string' &&
    isArrayOf(value.receiverConversationIds, isString) &&
    optional(value, 'prompt', isString) &&
    optional(value, 'model', isString) &&
    optional(value, 'reasoningEffort', isString) &&
    typeof value.occurredAt === 'string';
}

function isSubagentActivity(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    optional(value, 'turnId', isString) &&
    isSubagentOperationLifecycle(value.lifecycle) &&
    isSubagentActivityKind(value.kind) &&
    typeof value.conversationId === 'string' &&
    typeof value.agentPath === 'string' &&
    typeof value.occurredAt === 'string';
}

function isWorkBacklog(value: unknown): boolean {
  return isRecord(value) &&
    isArrayOf(value.connections, isWorkIntegrationConnection) &&
    isProviderConfigurations(value.providerConfigurations) &&
    isProviderSettings(value.providerSettings) &&
    isRecordMapOf(value.assignments, isWorkBacklogAssignment);
}

function isWorkIntegrationConnection(value: unknown): boolean {
  return isRecord(value) &&
    isWorkProviderKind(value.provider) &&
    includes(['notConfigured', 'disconnected', 'connecting', 'connected', 'error'], value.status) &&
    optional(value, 'accountLabel', isString) &&
    optional(value, 'detail', isAppText) &&
    optional(value, 'connectedAt', isString);
}

function isProviderConfigurations(value: unknown): boolean {
  return isRecord(value) && Object.entries(value).every(([provider, configuration]) => isWorkProviderKind(provider) && isWorkSourceConfiguration(configuration));
}

function isWorkSourceConfiguration(value: unknown): boolean {
  return isRecord(value) &&
    optional(value, 'sourceId', isString) &&
    optional(value, 'assigneeLogin', isString) &&
    optional(value, 'tagName', isString);
}

function isProviderSettings(value: unknown): boolean {
  return isRecord(value) && Object.entries(value).every(([provider, settings]) => isWorkProviderKind(provider) && isWorkProviderSettings(settings));
}

function isWorkProviderSettings(value: unknown): boolean {
  return isRecord(value) && optional(value, 'oauthClientId', isString);
}

function isWorkBacklogAssignment(value: unknown): boolean {
  return isRecord(value) &&
    isWorkProviderKind(value.provider) &&
    optional(value, 'item', item => Boolean(sanitizeWorkItemAssignmentSource(item))) &&
    typeof value.itemId === 'string' &&
    typeof value.agentId === 'string' &&
    typeof value.assignedAt === 'string' &&
    includes(['complete', 'review'], value.policy) &&
    includes(['blocked', 'completed', 'inProgress', 'readyForReview'], value.status) &&
    optional(value, 'completedAt', isString) &&
    optional(value, 'note', isString) &&
    optional(value, 'updatedAt', isString) &&
    optional(value, 'automationId', isString) &&
    optional(value, 'automationExecutionId', isString);
}

function isRemoteConnections(value: unknown): boolean {
  return isRecord(value) && isArrayOf(value.connections, isRemoteConnection);
}

function isRemoteConnection(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    value.kind === 'ssh' &&
    typeof value.name === 'string' &&
    typeof value.host === 'string' &&
    optional(value, 'hostName', isString) &&
    optional(value, 'user', isString) &&
    optional(value, 'port', isNumber) &&
    optional(value, 'identityFile', isString) &&
    includes(['saved', 'checking', 'ready', 'error'], value.status) &&
    optional(value, 'daemonVersion', isString) &&
    optional(value, 'codexVersion', isString) &&
    optional(value, 'providerConnections', candidate => isArrayOf(candidate, isProviderConnection)) &&
    optional(value, 'detail', isString) &&
    optional(value, 'sourceFolderPath', isString) &&
    optional(value, 'transport', isRemoteConnectionTransport) &&
    optional(value, 'installedAt', isString) &&
    optional(value, 'lastCheckedAt', isString) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string';
}

function isRemoteConnectionTransport(value: unknown): boolean {
  return isRecord(value) &&
    value.type === 'ssh-stdio' &&
    value.command === 'ssh' &&
    isArrayOf(value.args, isString);
}

function isGeneralSettings(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.commitMessageInstructions === 'string' &&
    typeof value.pullRequestInstructions === 'string' &&
    typeof value.preventSleepWhenAgentsRun === 'boolean' &&
    typeof value.preventSleepWhenRemoteAccessEnabled === 'boolean' &&
    typeof value.celebrationsEnabled === 'boolean' &&
    includes(['queue', 'steer'], value.followUpBehavior) &&
    typeof value.spokenAnnouncementsEnabled === 'boolean' &&
    typeof value.spokenAnnouncementsMuted === 'boolean' &&
    typeof value.spokenAnnouncementsOnlyForDictatedPrompts === 'boolean' &&
    typeof value.spokenAnnouncementsOnlyWhenFocused === 'boolean' &&
    includes(['selected', 'all'], value.spokenAnnouncementScope) &&
    includes(spokenAnnouncementVoices, value.spokenAnnouncementVoice) &&
    typeof value.codexBinaryPath === 'string' &&
    typeof value.claudeCodeEnabled === 'boolean' &&
    (value.codexEnabled === undefined || typeof value.codexEnabled === 'boolean') &&
    (value.providerOnboardingComplete === undefined || typeof value.providerOnboardingComplete === 'boolean') &&
    optional(value, 'providerEnabled', candidate => isRecord(candidate) && Object.entries(candidate).every(([backend, enabled]) => (backend === 'codex' || backend === 'claude' || backend === 'antigravity') && isBoolean(enabled))) &&
    optional(value, 'codeReviewDefaults', isCodeReviewPreferences) &&
    optional(value, 'providerApprovalDefaults', candidate => isRecord(candidate)
      && optional(candidate, 'codex', isApprovalPreset) && optional(candidate, 'claude', isString) && optional(candidate, 'antigravity', isString)) &&
    optional(value, 'providerModelDefaults', candidate => isRecord(candidate) && Object.entries(candidate).every(([backend, selection]) =>
      (backend === 'codex' || backend === 'claude' || backend === 'antigravity') && isRecord(selection) && isString(selection.model)
      && (selection.reasoningEffort === null || isString(selection.reasoningEffort))
      && (selection.serviceTier === null || isString(selection.serviceTier)))) &&
    optional(value, 'providerHomes', candidate => isRecord(candidate) && Object.entries(candidate).every(([backend, home]) =>
      (backend === 'codex' || backend === 'claude' || backend === 'antigravity') && isRecord(home) && isString(home.homePath) && isBoolean(home.isolated) && isBoolean(home.shareSkills))) &&
    typeof value.agentListCompact === 'boolean' &&
    includes(['teams', 'recent'], value.cockpitAgentViewMode) &&
    isArrayOf(value.collapsedRepositoryKeys, isString) &&
    isArrayOf(value.savedPromptDrafts, (draft) => isRecord(draft)
      && isString(draft.id) && isString(draft.agentId) && isString(draft.text) && isNumber(draft.createdAt)) &&
    typeof value.sessionCompressionWarningEnabled === 'boolean' &&
    includes(['automatic', 'repository', 'off'], value.worktreeInitializationMode) &&
    optional(value, 'worktreeDelegationStartingContext', candidate => includes(['conversation', 'handoff'], candidate)) &&
    optional(value, 'worktreeDelegationInstructions', isString) &&
    isRecordMapOf(value.repositoryIcons, isString) &&
    isAppshotSettings(value.appshots) &&
    optional(value, 'plugins', isPluginSettings);
}

function isAppshotSettings(value: unknown): boolean {
  return isRecord(value) &&
    includes(['command', 'option', 'shift', 'none'], value.hotkey) &&
    value.destination === 'active-agent' &&
    typeof value.playSound === 'boolean';
}

function isPluginSettings(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.computerUseEnabled === 'boolean' &&
    typeof value.chromeEnabled === 'boolean';
}

function isSourceFolder(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.path === 'string' &&
    typeof value.initialized === 'boolean' &&
    isArrayOf(value.recentRepoNames, isString);
}

function isTheme(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    includes(['dark', 'light', 'system'], value.mode) &&
    typeof value.uiFontSize === 'number' &&
    typeof value.chatFontSize === 'number' &&
    typeof value.codeFontSize === 'number';
}
