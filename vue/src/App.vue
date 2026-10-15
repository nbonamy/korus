<template>
  <div class="window-edge" aria-hidden="true" />
  <AppShell
    v-if="hasLoadedSnapshot"
    :inert="backendRestartInProgress || pendingSessionCompression !== null ? '' : undefined"
    :aria-hidden="backendRestartInProgress || pendingSessionCompression !== null ? 'true' : undefined"
    :snapshot="snapshot"
    :mission-implementation-start-progress="missionImplementationStartProgress"
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
    :respond-to-plan-review="respondToPlanReview"
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
    :work-repositories-by-provider="workRepositoriesByProvider"
    :work-items-by-repository="workItemsByRepository"
    :assigned-work-items-by-provider="assignedWorkItemsByProvider"
    :work-backlog-status="workBacklogStatus"
    :work-backlog-error="workBacklogError"
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
    :load-work-items="loadWorkItems"
    :load-global-work-items="loadGlobalWorkItems"
    :load-assigned-work-items="loadAssignedWorkItems"
    :duplicate-agent-action="duplicateAgent"
    :assign-work-item-action="assignWorkItemToAgent"
    :quit="quit"
    :restart-app="restartApp"
    @close-team="closeTeam"
    @disconnect-team="disconnectTeam"
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
  <main v-else class="app-startup">
    <BackendConnectionBanner :connection-state="connectionState.status === 'connected' ? { status: 'connecting' } : connectionState" />
    <button v-if="connectionState.status === 'error'" class="app-button app-button--secondary" :disabled="isLoading" @click="loadSnapshot">
      {{ $t('common.retry') }}
    </button>
  </main>
  <AgentCloseDialog
    :visible="pendingAgentClose !== null"
    :agent="pendingAgentClose?.agent"
    :workflow="pendingAgentClose?.workflow"
    :busy="agentCloseBusy"
    :error="agentCloseError"
    @close="cancelAgentClose"
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
  <WorkspaceProvisioningProgressDialog
    :operation="agentCreationProgress ? { mode: 'single', progress: agentCreationProgress } : null"
    @close="clearAgentCreationProgress"
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
        <span class="backend-restart-overlay__spinner" aria-hidden="true" />
        <div class="backend-restart-overlay__copy">
          <strong>{{ $t('surface.app.applyingResourceChanges') }}</strong>
          <span>{{ $t('surface.app.restartingTheBackendAndReconnectingYourChats') }}</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Agent, AgentGitWorkflow, DesktopUpdateStatus } from '@workspace/core/contracts';
import AppShell from './components/AppShell.vue';
import BackendConnectionBanner from './components/BackendConnectionBanner.vue';
import type { AgentConversationActions } from './components/use-agent-conversation';
import AgentCloseDialog from './components/AgentCloseDialog.vue';
import PullRequestCleanupDialog from './components/PullRequestCleanupDialog.vue';
import WorkspaceProvisioningProgressDialog from './components/WorkspaceProvisioningProgressDialog.vue';
import SessionCompressionDialog from './components/SessionCompressionDialog.vue';
import { useAppState } from './app-state';
import ConfettiOverlay from './shared/confetti/ConfettiOverlay.vue';
import { applyAppTheme, subscribeToSystemAppearance } from './theme/apply-theme';
import { appHostCapabilities, appApi } from './platform-api';
import { localizedErrorMessage } from './i18n/errors';

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
  workRepositoriesByProvider,
  workItemsByRepository,
  assignedWorkItemsByProvider,
  workBacklogStatus,
  workBacklogError,
  daemonStatus,
  daemonStatusError,
  codexResourceSharingStatus,
  backendRestartInProgress,
  agentCreationProgress,
  missionImplementationStartProgress,
  sourceRepositories,
  openInApplications,
  loadBackendModels,
  loadSnapshot,
  loadOlderAgentHistory,
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
  createMission,
  selectMission,
  deleteMission,
  readMissionArtifact,
  executeMission,
  createQuickChat,
  createTeam,
  updateTeam,
  reorderTeams,
  closeTeam,
  disconnectTeam,
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
  respondToPlanReview,
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

const agentConversationActions: AgentConversationActions = {
  planReview: respondToPlanReviewForAgent,
  clearGoal: clearGoalForAgent,
  threadFlag: respondToThreadFlagForAgent,
  prepare: prepareAgentConversation,
  loadOlder: loadOlderAgentHistory,
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
const pendingAgentClose = ref<{ agent: Agent; workflow: AgentGitWorkflow } | null>(null);
const agentCloseBusy = ref(false);
const agentCloseError = ref<string | null>(null);
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
  const agent = snapshot.value.agents.find((candidate) => candidate.id === agentId);
  if (!agent) return;
  if (isAgentFolderShared(agent)) {
    await closeAgentAction(agentId);
    return;
  }
  try {
    const workflow = await getAgentGitWorkflow(agentId);
    if (workflow.isLinkedWorktree) {
      pendingAgentClose.value = { agent, workflow };
      agentCloseError.value = null;
      return;
    }
  } catch {
    // Non-Git folders and unavailable Git hosts use the normal close behavior.
  }
  await closeAgentAction(agentId);
}

function isAgentFolderShared(agent: Agent): boolean {
  if (!agent.folder) return false;
  const location = agentBackendLocation(agent);
  return snapshot.value.agents.some((candidate) => (
    candidate.id !== agent.id
    && candidate.folder === agent.folder
    && agentBackendLocation(candidate) === location
  ));
}

function agentBackendLocation(agent: Agent): string {
  const team = snapshot.value.teams.find((candidate) => candidate.id === agent.teamId);
  return team?.remoteConnectionId ? `remote:${team.remoteConnectionId}` : 'local';
}

function cancelAgentClose(): void {
  if (agentCloseBusy.value) return;
  pendingAgentClose.value = null;
  agentCloseError.value = null;
}

async function confirmAgentClose(deleteWorktree: boolean, deleteRemoteBranch = false, discardChanges = false): Promise<void> {
  const pending = pendingAgentClose.value;
  if (!pending || agentCloseBusy.value) return;
  agentCloseBusy.value = true;
  agentCloseError.value = null;
  try {
    await closeAgentAction(pending.agent.id, deleteWorktree ? {
      deleteWorktree: true,
      deleteRemoteBranch,
      discardChanges,
      confirmed: true,
    } : undefined);
    pendingAgentClose.value = null;
  } catch (error) {
    agentCloseError.value = error instanceof Error ? error.message : String(error);
  } finally {
    agentCloseBusy.value = false;
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

function syncRendererWindowFocus(): void {
  setRendererWindowFocused(document.visibilityState === 'visible' && document.hasFocus());
}

onMounted(() => {
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
.app-startup {
  padding-top: var(--workbench-appbar-height);
}

.app-startup > .app-button {
  margin: var(--space-4);
}

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

.backend-restart-overlay__spinner {
  width: var(--space-10);
  height: var(--space-10);
  flex: 0 0 auto;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: backend-restart-spin 0.8s linear infinite;
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

@keyframes backend-restart-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .backend-restart-overlay__spinner {
    animation: none;
  }
}
</style>
