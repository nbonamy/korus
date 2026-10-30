<template>
  <div class="window-edge" aria-hidden="true" />
  <JoinSharedChatDialog v-if="inviteVisible" :view="guestInviteView" :busy="guestBusy" :failed="guestFailed" :control="runGuest" :save-display-name="saveGuestDisplayName" @close="closeGuestInvite" />
  <AppShell
    v-if="hasLoadedSnapshot"
    @join-invite="showGuestInvite"
    :guest-state="guestState" :guest-busy="guestBusy" :guest-control="runGuest"
    :inert="backendRestartInProgress || pendingSessionCompression !== null ? '' : undefined"
    :aria-hidden="backendRestartInProgress || pendingSessionCompression !== null ? 'true' : undefined"
    :snapshot="snapshot"
    :mission-implementation-start-progress="missionImplementationStartProgress"
    :mission-focus-request="missionFocusRequest"
    :agent-creation-progresses="agentCreationProgresses"
    @clear-agent-creation-progress="clearAgentCreationProgress"
    @background-agent-creation-progress="backgroundAgentCreationProgress"
    :active-agent="activeAgent"
    :unread-agent-ids="unreadAgentIds"
    :codex-conversation-snapshot="activeCodexConversationSnapshot"
    :claude-conversation-snapshot="activeClaudeConversationSnapshot"
    :antigravity-conversation-snapshot="activeAntigravityConversationSnapshot"
    :is-loading="isLoading"
    :is-conversation-loading="isHydratingActiveAgentHistory"
    :is-conversation-load-failed="isActiveAgentHistoryFailed"
    :retry-agent-history="retryActiveAgentHistory"
    :send-prompt-action="sendPrompt"
    :update-plan-review="updatePlanReview"
    :respond-to-thread-flag-action="respondToThreadFlag"
    :agent-conversation-for="agentConversationFor"
    :agent-conversation-actions="agentConversationActions"
    :start-visualize="startVisualize"
    :set-visualize-open="setVisualizeOpen"
    :generate-visualization-suggestion="generateVisualizationSuggestion"
    :select-visualization="selectVisualization"
    :delete-visualization="deleteVisualization"
    :read-visualization-asset="readVisualizationAsset"
    :start-code-review="startCodeReview"
    :decide-code-review-finding="decideCodeReviewFinding"
    :discuss-code-review-finding="discussCodeReviewFinding"
    :submit-code-review-round="submitCodeReviewRound"
    :finish-code-review="finishCodeReview"
    :commit-code-review="commitCodeReview"
    :discard-code-review="discardCodeReview"
    :review-code-again="reviewCodeAgain"
    :delete-turn-action="deleteTurn"
    :edit-turn-action="editTurn"
    :retry-turn-action="retryTurn"
    :continue-interrupted-turn-action="continueInterruptedTurn"
    :history-has-older="activeHistoryHasOlder"
    :history-loading-older="isLoadingOlderHistory"
    :load-older-agent-history="loadOlderAgentHistory"
    :load-agent-turn-history="loadAgentTurnHistory"
    :is-sending="isSending"
    :connection-state="connectionState"
    :answered-client-request-ids="answeredClientRequestIds"
    :agent-files="agentFiles"
    :backend-models="backendModels"
    :backend-commands="activeBackendCommands"
    :backend-plugins="backendPlugins"
    :backend-skills="backendSkills"
    :backend-capabilities="activeBackendCapabilities"
    :model-catalog-status="modelCatalogStatus"
    :skill-catalog-status="skillCatalogStatus"
    :goal="activeGoal"
    :approvals="activeBackendApprovals"
    :approval-preset="activeApprovalPreset"
    :permission-mode="activePermissionMode"
    :plan-mode="planMode"
    :selected-model-id="selectedModelId"
    :selected-reasoning-effort="selectedReasoningEffort"
    :selected-service-tier="selectedServiceTier"
    :queued-prompts="activeQueuedPrompts"
    :composer-state="activeComposerState"
    :composer-attachments="activeComposerAttachments"
    :update-status="updateStatus"
    :side-panel-request="sidePanelRequest"
    :markdown-display-requests="markdownDisplayRequests"
    @consume-markdown-displays="consumeMarkdownDisplayRequests"
    :file-activity="fileActivity"
    :work-provider-authorization="workProviderAuthorization"
    :work-provider-authorizations="workProviderAuthorizations"
    :work-provider-authorization-errors="workProviderAuthorizationErrors"
    :work-repositories-by-provider="workRepositoriesByProvider"
    :work-items-by-repository="workItemsByRepository"
    :assigned-work-items-by-provider="assignedWorkItemsByProvider"
    :work-backlog-status="workBacklogStatus"
    :work-backlog-error="workBacklogError"
    :work-backlog-state-for="workBacklogStateFor"
    :daemon-status="daemonStatus"
    :daemon-status-error="daemonStatusError"
    :codex-resource-sharing-migration-required="codexResourceSharingStatus.migrationRequired"
    :source-repositories="sourceRepositories"
    :choose-agent-folder="chooseAgentFolder"
    :choose-source-folder="chooseSourceFolder"
    :list-source-folders="listSourceFolders"
    :list-source-repositories="listSourceRepositories"
    :clone-source-repository="cloneSourceRepository"
    :create-project="createProject"
    :list-source-branches="listSourceBranches"
    :list-source-worktrees="listSourceWorktrees"
    :suggest-source-worktree-path="suggestSourceWorktreePath"
    :choose-source-worktree-destination="chooseSourceWorktreeDestination"
    :create-source-worktree="createSourceWorktree"
    :preview-agent-file="previewAgentFile"
    :get-agent-git-diff="getAgentGitDiff"
    :get-agent-git-workflow="getAgentGitWorkflow"
    :generate-agent-git-message="generateAgentGitMessage"
    :stage-agent-git-files="stageAgentGitFiles"
    :commit-agent-git-changes="commitAgentGitChanges"
    :push-agent-git-branch="pushAgentGitBranch"
    :create-agent-git-branch="createAgentGitBranch"
    :create-agent-git-pull-request="createAgentGitPullRequest"
    :merge-agent-git-branch="mergeAgentGitBranch"
    :update-agent-git-branch-from-base="updateAgentGitBranchFromBase"
    :pull-agent-git-branch="pullAgentGitBranch"
    :revert-agent-git-changes="revertAgentGitChanges"
    :open-in-applications="openInApplications"
    :open-agent-path="openAgentPath"
    :create-agent="createAgent"
    :create-mission="createMission"
    :select-mission="selectMission"
    :delete-mission="deleteMission"
    :delete-repository-action="deleteRepository"
    :read-mission-artifact="readMissionArtifact"
    :execute-mission="executeMission"
    :create-quick-chat="createQuickChat"
    :create-team="createTeam"
    :update-team="updateTeam"
    :update-agent="updateAgent"
    :update-settings="updateSettings"
    :set-codex-resource-sharing="setCodexResourceSharing"
    :get-plugin-status="getPluginStatus"
    :list-ssh-hosts="listSshHosts"
    :add-ssh-connection="addSshConnection"
    :check-remote-connection="checkRemoteConnection"
    :update-remote-connection="updateRemoteConnection"
    :remove-remote-connection="removeRemoteConnection"
    :companion-control="companionControl"
    :get-remote-control-status="getRemoteControlStatus"
    :enable-remote-control="enableRemoteControl"
    :disable-remote-control="disableRemoteControl"
    :start-device-pairing="startDevicePairing"
    :check-device-pairing="checkDevicePairing"
    :list-paired-devices="listPairedDevices"
    :revoke-paired-device="revokePairedDevice"
    :set-daemon-enabled="setDaemonEnabled"
    :connect-work-provider="connectWorkProvider"
    :open-work-provider-authorization="openWorkProviderAuthorization"
    :complete-work-provider-connection="pollWorkProviderAuthorization"
    :disconnect-work-provider="disconnectWorkProvider"
    :get-automation-snapshot="getAutomationSnapshot"
    :create-automation="createAutomation"
    :update-automation="updateAutomation"
    :run-automation="runAutomation"
    :clear-automation-history="clearAutomationHistory"
    :delete-automation-execution="deleteAutomationExecution"
    :delete-automation="deleteAutomation"
    :list-agent-conversations="listAgentConversations"
    :resume-agent-conversation="resumeAgentConversation"
    :handoff-agent-action="handoffAgent"
    :read-conversation-messages="readConversationMessages"
    :configure-work-backlog="configureWorkBacklog"
    :load-work-repositories="loadWorkRepositories"
    :list-work-sources="(provider, location) => appApi!.listWorkSources(provider, location)"
    :load-work-items="loadWorkItems"
    :load-global-work-items="loadGlobalWorkItems"
    :load-assigned-work-items="loadAssignedWorkItems"
    :duplicate-agent-action="duplicateAgent"
    :assign-work-item-action="assignWorkItemToAgent"
    :quit="quit"
    :restart-app="restartApp"
    @close-team="closeTeam"
    @close-agent="requestCloseAgent"
    @compress-session="requestSessionCompression"
    @cleanup-pull-request="requestPullRequestCleanup"
    @duplicate-agent="duplicateAgent"
    @fork-agent="forkAgent"
    @fork-turn="forkActiveAgentTurn"
    @move-agent-to-team="moveAgentToTeam"
    @reorder-agents="reorderAgents"
    @reorder-repositories="reorderRepositories"
    @reorder-teams="reorderTeams"
    @assign-work-item="assignWorkItemToAgent"
    @remove-work-item-assignment="removeWorkItemAssignment"
    @restart-agent="restartAgent"
    @select-agent="selectAgent"
    @select-team="selectTeam"
    @select-model="selectModel"
    @select-reasoning-effort="selectReasoningEffort"
    @select-service-tier="selectServiceTier"
    @select-approval-preset="setApprovalPreset"
    @select-permission-mode="setPermissionMode"
    @resolve-approval="resolveBackendApproval"
    @update:plan-mode="setPlanMode"
    @clear-goal="clearActiveGoal"
    @client-response="respondToClientRequest"
    @delete-queued-prompt="removeQueuedPrompt"
    @debug-mark-unread="markDebugAgentsUnread"
    @interrupt-agent="interruptActiveAgent"
    @send-agent-prompt="sendAgentPrompt($event.agentId, $event.prompt)"
    @send-prompt="sendPrompt"
    @steer-prompt="steerPrompt"
    @steer-queued-prompt="steerQueuedPrompt"
    @update-queued-prompt="updateQueuedPrompt"
    @update:composer-state="updateComposerState($event.agentId, $event.state)"
    @update:composer-attachments="updateComposerAttachments($event.agentId, $event.attachments)"
    @install-update="installUpdate"
  />
  <CodexLoginLanding v-else variant="connecting" :connection-status="startupDelayed ? $t('auth.retryingDaemon') : undefined" />
  <AgentCloseDialog
    :visible="pendingAgentClose !== null"
    :agent="pendingAgentClose?.agent"
    :preview="pendingAgentClose?.preview"
    :busy="agentCloseBusy"
    :deleting-worktree="pendingAgentClose?.deleteWorktree"
    :error="agentCloseError"
    @close="cancelAgentClose"
    @background="backgroundAgentClose"
    @keep-worktree="confirmAgentClose(false)"
    @delete-worktree="(deleteRemoteBranch, discardChanges) => confirmAgentClose(true, deleteRemoteBranch, discardChanges)"
  />
  <SessionCompressionDialog
    :visible="pendingSessionCompression !== null"
    :busy="sessionCompressionBusy"
    :error="sessionCompressionError"
    @close="cancelSessionCompression"
    @confirm="confirmSessionCompression"
  />
  <PullRequestCleanupDialog
    :visible="pendingPullRequestCleanup !== null"
    :agent="pendingPullRequestCleanup"
    :busy="pullRequestCleanupBusy"
    :error="pullRequestCleanupError"
    @close="cancelPullRequestCleanup"
    @confirm="confirmPullRequestCleanup"
  />
  <ConfettiOverlay />
  <Transition name="backend-restart-overlay">
    <div
      v-if="backendRestartInProgress"
      class="backend-restart-overlay"
      data-testid="backend-restart-overlay"
      role="status"
      aria-live="assertive"
      aria-busy="true"
    >
      <div class="backend-restart-overlay__card">
        <span class="app-spinner app-spinner--lg app-spinner--primary" aria-hidden="true" />
        <div class="backend-restart-overlay__copy">
          <strong>{{ $t('surface.app.applyingResourceChanges') }}</strong>
          <span>{{ $t('surface.app.restartingTheBackendAndReconnectingYourChats') }}</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';
import type { Agent, DesktopUpdateStatus } from '@workspace/core/contracts';
import AppShell from './components/AppShell.vue';
import JoinSharedChatDialog from './components/JoinSharedChatDialog.vue';
import { useGuestNavigation } from './guest-navigation';
import type { AgentClosePreview } from '@workspace/core/agent-close';
import CodexLoginLanding from './components/CodexLoginLanding.vue';
import type { AgentConversationActions } from './components/use-agent-conversation';
import AgentCloseDialog from './components/AgentCloseDialog.vue';
import PullRequestCleanupDialog from './components/PullRequestCleanupDialog.vue';
import SessionCompressionDialog from './components/SessionCompressionDialog.vue';
import { useAppState } from './app-state';
import ConfettiOverlay from './shared/confetti/ConfettiOverlay.vue';
import { applyAppTheme, subscribeToSystemAppearance } from './theme/apply-theme';
import { appHostCapabilities, appApi } from './platform-api';
import { localizedErrorMessage } from './i18n/errors';
import { agentDisplayName } from '@workspace/core/agent-display';

const { t } = useI18n();

const {
  snapshot,
  activeAgent,
  activeGoal,
  activeBackendApprovals,
  activeApprovalPreset,
  activePermissionMode,
  activeQueuedPrompts,
  activeComposerState,
  activeComposerAttachments,
  unreadAgentIds,
  isLoading,
  hasLoadedSnapshot,
  isActiveAgentHistoryFailed,
  isHydratingActiveAgentHistory,
  retryActiveAgentHistory,
  activeHistoryHasOlder,
  isLoadingOlderHistory,
  isSending,
  connectionState,
  answeredClientRequestIds,
  agentFiles,
  backendModels,
  activeBackendCommands,
  activeCodexConversationSnapshot,
  activeClaudeConversationSnapshot,
  activeAntigravityConversationSnapshot,
  agentConversationFor,
  prepareAgentConversation,
  backendPlugins,
  activeBackendCapabilities,
  modelCatalogStatus,
  backendSkills,
  skillCatalogStatus,
  selectedModelId,
  selectedReasoningEffort,
  selectedServiceTier,
  planMode,
  sidePanelRequest,
  markdownDisplayRequests,
  consumeMarkdownDisplayRequests,
  fileActivity,
  workProviderAuthorization,
  workProviderAuthorizations,
  workProviderAuthorizationErrors,
  workRepositoriesByProvider,
  workItemsByRepository,
  assignedWorkItemsByProvider,
  workBacklogStatus,
  workBacklogError,
  workBacklogStateFor,
  daemonStatus,
  daemonStatusError,
  codexResourceSharingStatus,
  backendRestartInProgress,
  agentCreationProgresses,
  missionImplementationStartProgress,
  missionFocusRequest,
  sourceRepositories,
  openInApplications,
  loadBackendModels,
  loadSnapshot,
  loadOlderAgentHistory,
  loadAgentTurnHistory,
  chooseAgentFolder,
  chooseSourceFolder,
  listSourceFolders,
  listSourceRepositories,
  cloneSourceRepository,
  createProject,
  listSourceBranches,
  listSourceWorktrees,
  suggestSourceWorktreePath,
  chooseSourceWorktreeDestination,
  createSourceWorktree,
  previewAgentFile,
  getAgentGitDiff,
  getAgentGitWorkflow,
  generateAgentGitMessage,
  stageAgentGitFiles,
  commitAgentGitChanges,
  pushAgentGitBranch,
  createAgentGitBranch,
  createAgentGitPullRequest,
  mergeAgentGitBranch,
  updateAgentGitBranchFromBase,
  pullAgentGitBranch,
  revertAgentGitChanges,
  loadOpenInApplications,
  openAgentPath,
  createAgent,
  clearAgentCreationProgress,
  backgroundAgentCreationProgress,
  createMission,
  selectMission,
  deleteMission,
  deleteRepository,
  readMissionArtifact,
  executeMission,
  createQuickChat,
  createTeam,
  updateTeam,
  reorderTeams,
  closeTeam,
  updateAgent,
  duplicateAgent,
  forkAgent,
  handoffAgent,
  forkActiveAgentTurn,
  moveAgentToTeam,
  reorderAgents,
  reorderRepositories,
  restartAgent,
  closeAgent: closeAgentAction,
  updateSettings,
  setCodexResourceSharing,
  listSshHosts,
  addSshConnection,
  checkRemoteConnection,
  updateRemoteConnection,
  removeRemoteConnection,
  companionControl,
  getRemoteControlStatus,
  enableRemoteControl,
  disableRemoteControl,
  startDevicePairing,
  checkDevicePairing,
  listPairedDevices,
  revokePairedDevice,
  setDaemonEnabled,
  connectWorkProvider,
  openWorkProviderAuthorization,
  pollWorkProviderAuthorization,
  disconnectWorkProvider,
  getAutomationSnapshot,
  createAutomation,
  updateAutomation,
  runAutomation,
  clearAutomationHistory,
  deleteAutomationExecution,
  deleteAutomation,
  listAgentConversations,
  resumeAgentConversation,
  compressAgentSession,
  readConversationMessages,
  configureWorkBacklog,
  loadWorkRepositories,
  loadWorkItems,
  loadGlobalWorkItems,
  loadAssignedWorkItems,
  assignWorkItemToAgent,
  removeWorkItemAssignment,
  resolveBackendApproval,
  resolveBackendApprovalForAgent,
  respondToClientRequest,
  selectModel,
  selectModelForAgent,
  selectReasoningEffort,
  selectReasoningEffortForAgent,
  selectServiceTier,
  selectServiceTierForAgent,
  setApprovalPreset,
  setApprovalPresetForAgent,
  setPermissionMode,
  setPermissionModeForAgent,
  updateComposerState,
  updateComposerAttachments,
  setPlanMode,
  setPlanModeForAgent,
  clearActiveGoal,
  selectAgent,
  setRendererWindowFocused,
  markDebugAgentsUnread,
  selectTeam,
  sendPrompt,
  sendPromptToAgent,
  updatePlanReview,
  respondToPlanReviewForAgent,
  respondToThreadFlag,
  respondToThreadFlagForAgent,
  clearGoalForAgent,
  startVisualize,
  setVisualizeOpen,
  generateVisualizationSuggestion,
  selectVisualization,
  deleteVisualization,
  readVisualizationAsset,
  startCodeReview,
  decideCodeReviewFinding,
  discussCodeReviewFinding,
  submitCodeReviewRound,
  finishCodeReview,
  commitCodeReview,
  discardCodeReview,
  reviewCodeAgain,
  sendAgentPrompt,
  steerPrompt,
  steerPromptToAgent,
  interruptActiveAgent,
  interruptAgentById,
  deleteTurn,
  deleteTurnForAgent,
  editTurn,
  editTurnForAgent,
  retryTurn,
  retryTurnForAgent,
  continueInterruptedTurn,
  continueInterruptedTurnForAgent,
  steerQueuedPrompt,
  steerQueuedPromptForAgent,
  updateQueuedPrompt,
  updateQueuedPromptForAgent,
  removeQueuedPrompt,
  removeQueuedPromptForAgent,
  quit,
  restartApp,
  getPluginStatus,
} = useAppState();
const { inviteVisible, inviteView: guestInviteView, state: guestState, busy: guestBusy, failed: guestFailed, run: runGuest, show: showGuestInvite, close: closeGuestInvite } = useGuestNavigation(() => snapshot.value, selectAgent, () => hasLoadedSnapshot.value);
async function saveGuestDisplayName(name: string): Promise<void> {
  await updateSettings({ general: { guestDisplayName: name } });
}

const agentConversationActions: AgentConversationActions = {
  planReview: respondToPlanReviewForAgent,
  clearGoal: clearGoalForAgent,
  threadFlag: respondToThreadFlagForAgent,
  prepare: prepareAgentConversation,
  loadOlder: loadOlderAgentHistory,
  loadTurn: loadAgentTurnHistory,
  send: sendPromptToAgent,
  steer: steerPromptToAgent,
  interrupt: interruptAgentById,
  deleteTurn: deleteTurnForAgent,
  editTurn: editTurnForAgent,
  forkTurn: forkAgent,
  retryTurn: retryTurnForAgent,
  continueInterruptedTurn: continueInterruptedTurnForAgent,
  resolveApproval: resolveBackendApprovalForAgent,
  clientResponse: respondToClientRequest,
  selectModel: selectModelForAgent,
  selectReasoningEffort: selectReasoningEffortForAgent,
  selectServiceTier: selectServiceTierForAgent,
  setPlanMode: setPlanModeForAgent,
  setApprovalPreset: setApprovalPresetForAgent,
  setPermissionMode: setPermissionModeForAgent,
  updateComposerState,
  updateAttachments: updateComposerAttachments,
  deleteQueuedPrompt: removeQueuedPromptForAgent,
  updateQueuedPrompt: updateQueuedPromptForAgent,
  steerQueuedPrompt: steerQueuedPromptForAgent,
};

const updateStatus = ref<DesktopUpdateStatus>({ state: 'idle' });
const pendingAgentClose = ref<{
  agent: Agent; preview: AgentClosePreview; running: boolean; error: string | null;
  deleteWorktree: boolean; backgrounded: boolean;
} | null>(null);
const agentCloseBusy = computed(() => pendingAgentClose.value?.running ?? false);
const agentCloseError = computed(() => pendingAgentClose.value?.error ?? null);
const closingAgentIds = new Set<string>();
const pendingPullRequestCleanup = ref<Agent | null>(null);
const pullRequestCleanupBusy = ref(false);
const pullRequestCleanupError = ref<string | null>(null);
const pendingSessionCompression = ref<Agent | null>(null);
const sessionCompressionBusy = ref(false);
const sessionCompressionError = ref<string | null>(null);
let unsubscribeSystemAppearance: (() => void) | null = null;
let unsubscribeUpdateStatus: (() => void) | null = null;

async function installUpdate(): Promise<void> {
  await appApi?.installUpdate?.();
}

async function requestCloseAgent(agentId: string): Promise<void> {
  if (closingAgentIds.has(agentId) || agentCloseBusy.value) return;
  const agent = snapshot.value.agents.find((candidate) => candidate.id === agentId);
  if (!agent) return;
  try {
    const preview = await appApi!.getAgentClosePreview(agentId);
    if (preview.isLinkedWorktree) {
      pendingAgentClose.value = { agent, preview, running: false, error: null, deleteWorktree: false, backgrounded: false };
      return;
    }
  } catch {
    // Non-Git folders and unavailable Git hosts use the normal close behavior.
  }
  await closeAgentAction(agentId);
}

function cancelAgentClose(): void {
  if (agentCloseBusy.value) return;
  pendingAgentClose.value = null;
}

function backgroundAgentClose(): void {
  const pending = pendingAgentClose.value;
  if (!pending?.running) return;
  pending.backgrounded = true;
  pendingAgentClose.value = null;
}

async function confirmAgentClose(deleteWorktree: boolean, deleteRemoteBranch = false, discardChanges = false): Promise<void> {
  const pending = pendingAgentClose.value;
  if (!pending || agentCloseBusy.value) return;
  pending.running = true;
  pending.error = null;
  pending.deleteWorktree = deleteWorktree;
  closingAgentIds.add(pending.agent.id);
  try {
    await closeAgentAction(pending.agent.id, deleteWorktree ? {
      deleteWorktree: true,
      deleteRemoteBranch,
      discardChanges,
      confirmed: true,
    } : undefined);
    if (pending.backgrounded) {
      const title = t(deleteWorktree ? 'surface.agentCloseDialog.worktreeDeleted' : 'surface.agentCloseDialog.agentClosed');
      ElMessage.success(`${title}: ${pending.preview.branch ?? agentDisplayName(pending.agent)}`);
    }
    if (pendingAgentClose.value === pending) pendingAgentClose.value = null;
  } catch (error) {
    pending.error = localizedErrorMessage(error, t);
    if (pending.backgrounded) {
      const title = t(deleteWorktree ? 'surface.agentCloseDialog.worktreeDeletionFailed' : 'surface.agentCloseDialog.agentCloseFailed');
      ElMessage.error(`${title}: ${pending.error}`);
    }
  } finally {
    pending.running = false;
    closingAgentIds.delete(pending.agent.id);
  }
}

function requestPullRequestCleanup(agentId: string): void {
  const agent = snapshot.value.agents.find((candidate) => candidate.id === agentId);
  if (agent?.pullRequest?.state !== 'merged' && agent?.pullRequest?.state !== 'closed') return;
  pendingPullRequestCleanup.value = agent;
  pullRequestCleanupError.value = null;
}

function cancelPullRequestCleanup(): void {
  if (pullRequestCleanupBusy.value) return;
  pendingPullRequestCleanup.value = null;
  pullRequestCleanupError.value = null;
}

async function confirmPullRequestCleanup(): Promise<void> {
  const agent = pendingPullRequestCleanup.value;
  if (!agent || pullRequestCleanupBusy.value) return;
  pullRequestCleanupBusy.value = true;
  pullRequestCleanupError.value = null;
  try {
    await closeAgentAction(agent.id, {
      deleteWorktree: true,
      pullRequestCleanup: true,
      confirmed: true,
    });
    pendingPullRequestCleanup.value = null;
  } catch (error) {
    pullRequestCleanupError.value = localizedErrorMessage(error, t);
  } finally {
    pullRequestCleanupBusy.value = false;
  }
}

function requestSessionCompression(agentId: string): void {
  if (sessionCompressionBusy.value) return;
  const agent = snapshot.value.agents.find((candidate) => candidate.id === agentId);
  if (
    !agent ||
    agent.backend !== 'codex' ||
    agent.backendSession?.kind !== 'codex' ||
    agent.status.type !== 'idle'
  ) {
    return;
  }
  pendingSessionCompression.value = agent;
  sessionCompressionError.value = null;
  if (!snapshot.value.general.sessionCompressionWarningEnabled) {
    void confirmSessionCompression(false);
  }
}

function cancelSessionCompression(): void {
  if (sessionCompressionBusy.value) return;
  pendingSessionCompression.value = null;
  sessionCompressionError.value = null;
}

async function confirmSessionCompression(dontShowAgain: boolean): Promise<void> {
  const agent = pendingSessionCompression.value;
  if (!agent || sessionCompressionBusy.value) return;
  sessionCompressionBusy.value = true;
  sessionCompressionError.value = null;
  try {
    if (dontShowAgain && snapshot.value.general.sessionCompressionWarningEnabled) {
      await updateSettings({ general: { sessionCompressionWarningEnabled: false } }).catch(() => undefined);
    }
    await compressAgentSession(agent.id);
    pendingSessionCompression.value = null;
  } catch (error) {
    sessionCompressionError.value = localizedErrorMessage(error, t);
  } finally {
    sessionCompressionBusy.value = false;
  }
}

const startupDelayed = ref(false);
let startupDelayTimer: ReturnType<typeof setTimeout> | undefined;
watch(hasLoadedSnapshot, loaded => {
  if (loaded) clearTimeout(startupDelayTimer);
});

function syncRendererWindowFocus(): void {
  setRendererWindowFocused(document.visibilityState === 'visible' && document.hasFocus());
}

onMounted(() => {
  startupDelayTimer = setTimeout(() => { startupDelayed.value = true; }, 15_000);
  window.addEventListener('focus', syncRendererWindowFocus);
  window.addEventListener('blur', syncRendererWindowFocus);
  document.addEventListener('visibilitychange', syncRendererWindowFocus);
  syncRendererWindowFocus();
  unsubscribeSystemAppearance = subscribeToSystemAppearance();
  void loadSnapshot();
  void loadBackendModels();
  void loadOpenInApplications();
  const updateStatusPromise = appHostCapabilities.appUpdates
    ? appApi?.getUpdateStatus?.()
    : undefined;
  if (updateStatusPromise) {
    void updateStatusPromise.then((status) => {
      updateStatus.value = status;
    });
  }
  unsubscribeUpdateStatus = appHostCapabilities.appUpdates
    ? appApi?.onUpdateStatusChanged?.((status) => {
      updateStatus.value = status;
    }) ?? null
    : null;
});

onBeforeUnmount(() => {
  clearTimeout(startupDelayTimer);
  window.removeEventListener('focus', syncRendererWindowFocus);
  window.removeEventListener('blur', syncRendererWindowFocus);
  document.removeEventListener('visibilitychange', syncRendererWindowFocus);
  unsubscribeSystemAppearance?.();
  unsubscribeSystemAppearance = null;
  unsubscribeUpdateStatus?.();
  unsubscribeUpdateStatus = null;
});

watch(() => snapshot.value.theme, (theme) => {
  applyAppTheme(theme);
}, { deep: true, immediate: true });
</script>

<style scoped>
.backend-restart-overlay {
  position: fixed;
  z-index: 10000;
  inset: 0;
  display: grid;
  place-items: center;
  padding: var(--space-12);
  background: var(--color-overlay);
  backdrop-filter: blur(6px);
}

.backend-restart-overlay__card {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  width: min(420px, 100%);
  padding: var(--space-8);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-lg);
}

.backend-restart-overlay__copy {
  display: grid;
  gap: var(--space-1);
  color: var(--color-text);
}

.backend-restart-overlay__copy strong {
  font-size: var(--font-size-16);
  line-height: var(--line-height-22);
}

.backend-restart-overlay__copy span {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.backend-restart-overlay-enter-active,
.backend-restart-overlay-leave-active {
  transition: opacity 120ms ease;
}

.backend-restart-overlay-enter-from,
.backend-restart-overlay-leave-to {
  opacity: 0;
}

</style>
