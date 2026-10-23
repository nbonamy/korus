<template>
  <AgentHeader
    v-if="!splitHeaders && !isAgentEmpty && currentAgent"
    v-bind="headerBindingsFor(emptySplitPane ? null : currentAgent.id, true, true)"
  />
  <div ref="workspaceBody" class="app-shell__body workspace-body" @dragstart.capture="linkDrag.start">
    <AgentEmptyState v-if="isAgentEmpty" @start-work="handleStartWorkAction" />
    <div v-else class="app-shell__conversations" :class="{ 'app-shell__conversations--split': splitHeaders }">
    <div v-if="$slots['layout-control']" class="app-shell__layout-control">
      <slot name="layout-control" />
    </div>
    <slot name="conversation" :plan="currentTurnPlan" :plan-visible="executionPlanVisible" :close-plan="closeExecutionPlan" :header-bindings-for="headerBindingsFor">
    <ConversationPane
      ref="conversationPane"
      :controller="conversationPaneController"
      :agent="currentAgent"
      :agents="snapshot.agents"
      :saved-prompt-drafts="snapshot.general.savedPromptDrafts"
      :save-prompt-draft="savePromptDraft"
      :remove-prompt-draft="removePromptDraft"
      :attachment-annotation-counts="activeAttachmentAnnotationCounts"
      :text-annotations="chatTextAnnotations"
      :visualization-annotations="visualizationAnnotations"
      :review-finding="reviewFindingAttachment"
      :plan="currentTurnPlan"
      :plan-visible="executionPlanVisible"
      :history-load-failed="historyLoadFailed"
      :history-loading="isConversationLoading"
      :has-visible-messages="hasVisibleMessages"
      :thread-flag-busy="threadFlagBusy"
      @annotate-attachment="openAttachmentImageAnnotation"
      @add-text-annotation="addChatTextAnnotation($event.selection, $event.comment)"
      @close-plan="closeExecutionPlan"
      @retry-history="retryConversationHistory"
      @thread-flag="respondToThreadFlag($event)"
      @remove-text-annotation="removeChatTextAnnotation"
      @remove-visualization-annotation="removeVisualizationAnnotation"
      @remove-review-finding="emit('removeReviewFindingAttachment')"
    />
    </slot>
    </div>
    <RightWorkspacePanel
      v-for="agent in snapshot.agents"
      :key="agent.id"
      v-show="!emptySplitPane && isRightWorkspaceVisible(agent.id)"
      class="app-shell__right-workspace"
      :style="{ flexBasis: `${workspaceWidthFor(agent.id)}px` }"
      :active-tab="rightWorkspaceFor(agent.id).activeTab"
      :agent="agent"
      :agents="snapshot.agents"
      :files-pane-open="rightWorkspaceFor(agent.id).filesPaneOpen"
      :files-pane-width="rightWorkspaceFor(agent.id).filesPaneWidth"
      :git-panel="effectiveGitReviewPanelFor(agent)"
      :git-status="snapshot.agentGitStatuses[agent.id] ?? null"
      :plan-panel="rightWorkspaceFor(agent.id).planPanel"
      :interactive-plans-enabled="snapshot.general.useInteractivePlans !== false"
      :update-plan-review="props.updatePlanReview"
      :plan-updating="isPlanPreviewUpdatingFor(agent.id)"
      :file-panels="rightWorkspaceFor(agent.id).filePanels"
      :image-panels="rightWorkspaceFor(agent.id).imagePanels"
      :diff-panels="rightWorkspaceFor(agent.id).diffPanels"
      :tabs="rightWorkspaceFor(agent.id).tabs"
      :visible="!emptySplitPane && isRightWorkspaceVisible(agent.id) && !isModalDialogVisible && !runProfileDialogs.size"
      :browser-id="rightWorkspaceFor(agent.id).browserId"
      :browser-initial-url="rightWorkspaceFor(agent.id).browserInitialUrl"
      :browser-open-request-id="rightWorkspaceFor(agent.id).browserOpenRequestId"
      :browser-visualization="rightWorkspaceFor(agent.id).browserVisualization"
      :browser-panels="rightWorkspaceFor(agent.id).browserPanels"
      :link-drop-active="Boolean(linkDrag.draggedLink.value) && isRightWorkspaceVisible(agent.id)"
      :browser-available="appHostCapabilities.embeddedBrowser"
      :open-in-available="appHostCapabilities.openInApplications && isLocalAgent(agent)"
      :open-in-catalog="openInApplications"
      :subagent-tree="subagentTreeFor(agent.id)"
      :load-subagent-messages="(conversationId) => loadSubagentMessages(agent.id, conversationId)"
      :backlog-location="snapshot.teams.find(team => team.id === agent.teamId)?.remoteConnectionId ? { kind: 'remote', remoteConnectionId: snapshot.teams.find(team => team.id === agent.teamId)!.remoteConnectionId! } : undefined"
      :github-repository="snapshot.agentGitStatuses[agent.id]?.githubRepository ?? null"
      :work-assignments="snapshot.workBacklog.assignments"
      :clear-repository-work-assignment="(item) => $emit('remove-work-item-assignment', item)"
      :close-repository-work-agent="(agentId) => $emit('close-agent', agentId)"
      :start-repository-work="(input) => startRepositoryWork(agent.id, input)"
      :show-repository-work-agent="selectAgentFromShell"
      :start-code-review="startCodeReview"
      v-model:code-review-instructions="rightWorkspaceFor(agent.id).codeReviewInstructions"
      :decide-code-review-finding="decideCodeReviewFinding"
      :submit-code-review-round="submitCodeReviewRound"
      :finish-code-review="finishCodeReview"
      :commit-code-review="commitCodeReview"
      :review-code-again="reviewCodeAgain"
      :generate-visualization-suggestion="generateVisualizationSuggestion"
      :select-visualization="selectVisualization"
      :delete-visualization="deleteVisualization"
      :read-visualization-asset="readVisualizationAsset"
      :save-document="saveDocumentAs ? tab => saveDocumentAs!(agent.id, tab) : undefined"
      @close-tab="closeWorkspaceTab(agent, $event)"
      @browser-url-change="(tab, url) => updateBrowserUrl(agent.id, tab, url)"
      @open-tab="openRightWorkspaceTabFromMenu(agent.id, $event)"
      @open-in="openAgentIn(agent.id, $event.application, $event.filePath)"
      @preview-file="openFilePreviewForAgent(agent.id, $event)"
      @toggle-files-pane="toggleFileExplorer(agent.id)"
      @resize-files-pane="rightWorkspaceFor(agent.id).filesPaneWidth = $event"
      @open-link="openConversationLink"
      @refresh-git-diff="openAgentGitDiffPreview(agent.id, $event)"
      @clarify-finding="emit('clarifyCodeReviewFinding', { agentId: agent.id, ...$event })"
      @select-tab="selectRightWorkspaceTab(agent.id, $event)"
      @send-prompt="forwardPrompt"
      @annotate-visualization="attachVisualizationAnnotation"
      @dragover="linkDrag.over"
      @drop="linkDrag.drop"
    />
    <WorkspaceLinkDropTarget
      v-if="linkDrag.draggedLink.value && !rightWorkspaceVisible"
      class="app-shell__closed-workspace-drop"
      @dragover="linkDrag.over"
      @drop="linkDrag.drop"
    />
    <div
      v-if="!emptySplitPane && rightWorkspaceVisible"
      class="app-shell__right-workspace-resizer"
      :aria-label="$t('surface.appShell.resizeRightWorkspace')"
      @pointerdown="startRightWorkspaceResize"
    />
    <div v-if="rightWorkspaceResizing" class="app-shell__right-workspace-resize-shield" aria-hidden="true" />
  </div>
</template>

<script setup lang="ts">
import type {
  Agent,
  AgentFileSearchItem,
  AgentGitCommitInput,
  AgentGitDiffTarget,
  AgentGitMergeInput,
  AgentGitMessageGenerationInput,
  AgentGitMessageGenerationResult,
  AgentGitPullRequestInput,
  AgentGitPushInput,
  AgentGitStatus,
  AgentGitWorkflow,
  AgentSubagentTree,
  AppSnapshot,
  AutomationLocation,
  BackendConversationRef,
  BackendRuntimeStatus,
  ConversationFileLink,
  DesktopUpdateStatus,
  OpenInApplication,
  OpenInApplicationCatalog,
  RendererMessage,
  RendererSendPromptOptions,
  ThreadPlan,
  WorkItem,
} from '@workspace/core/contracts';
import { PRIMARY_BROWSER_ID, type AppCommand } from '@workspace/core/contracts';
import { conversationRefFromAgent } from '@workspace/core/conversation-ref';
import type {
  CodexConversationLink,
  CodexConversationPaneController,
  CodexConversationVisualization,
  CodexMessageImage,
  CodexMessageImageContext,
  CodexNativeAttachment,
  CodexMessageTextSelection,
} from '@codex-app-sdk/vue';
import { ElMessage } from 'element-plus';
import { computed, reactive, ref, toRefs, watch, type ComponentPublicInstance } from 'vue';
import { repositoryIconForAgent } from '@workspace/core/workspace-sidebar';
import { agentDisplayName } from '@workspace/core/agent-display';
import { repositoryPeersForAgent } from '@workspace/core/agent-folder';
import { translate } from '../i18n';
import { localizedErrorMessage } from '../i18n/errors';
import { appHostCapabilities } from '../platform-api';
import AgentEmptyState from './AgentEmptyState.vue';
import AgentHeader from './AgentHeader.vue';
import ConversationPane from './ConversationPane.vue';
import RightWorkspacePanel from './RightWorkspacePanel.vue';
import WorkspaceLinkDropTarget from './WorkspaceLinkDropTarget.vue';
import { useWorkspaceLinkDrag } from './use-workspace-link-drag';
import { constrainedRightWorkspaceWidth, type AgentRightWorkspaceState } from './use-right-workspace-state';
import type { SidePanelGitDiffState } from './side-panel';
import type { ChatTextAnnotation } from './use-chat-text-annotations';
import type { VisualizationAnnotation, VisualizationAnnotationInput } from './use-visualization-annotations';
import type { ThreadFlagResponse } from '@workspace/core/thread-flags';
import { fileBasename } from './use-workspace-previews';
import {
  isRightWorkspaceSubagentTab,
  rightWorkspaceSubagentConversationId,
  rightWorkspaceSubagentTab,
  rightWorkspaceImageTab,
  type RepositoryWorkStartInput,
  type RightWorkspaceTab,
  type RightWorkspaceBrowserTab,
} from './right-workspace';

const props = defineProps<{
  activeAttachmentAnnotationCounts: Readonly<Record<string, number>>;
  addChatTextAnnotation: (selection: CodexMessageTextSelection, comment: string) => void;
  addVisualizationAnnotation: (annotation: VisualizationAnnotationInput) => void;
  agentFiles: AgentFileSearchItem[];
  agentSidebarCollapsed: boolean;
  saveDocumentAs?: (agentId: string, tabId: string) => Promise<void>;
  closeRightWorkspaceTab: (agentId: string, tab: RightWorkspaceTab) => void;
  updatePlanReview?: (agentId: string, response: import('@workspace/core/plan-review').PlanReviewResponse) => Promise<import('@workspace/core/plan-review').PlanReview>;
  respondToThreadFlag: (response: ThreadFlagResponse) => Promise<void>;
  threadFlagBusy: boolean;
  conversationPaneController: CodexConversationPaneController;
  savePromptDraft: (agentId: string, text: string) => Promise<void>;
  removePromptDraft: (id: string) => Promise<void>;
  conversationPlan: ThreadPlan | null;
  chatTextAnnotations: readonly ChatTextAnnotation[];
  visualizationAnnotations: readonly VisualizationAnnotation[];
  reviewFindingAttachment?: import('@workspace/core/code-review').CodeReviewFinding | null;
  currentAgent: Agent | null;
  emptySplitPane?: boolean;
  splitHeaders?: boolean;
  latestTurnIdForAgent?: (agentId: string) => string | null;
  currentAgentGitStatus: AgentGitStatus | null;
  currentBackendRuntime: BackendRuntimeStatus;
  forwardPrompt: (prompt: string, options?: RendererSendPromptOptions) => void;
  generateAgentGitMessage: (
    agentId: string,
    input: AgentGitMessageGenerationInput,
  ) => Promise<AgentGitMessageGenerationResult>;
  getAgentGitWorkflow: (agentId: string) => Promise<AgentGitWorkflow>;
  handleStartWorkAction: (action: 'new' | 'github' | 'local' | 'url') => void;
  isAgentEmpty: boolean;
  isConversationLoading: boolean;
  historyLoadFailed: boolean;
  isLoading: boolean;
  isModalDialogVisible: boolean;
  isRightWorkspaceVisible: (agentId: string) => boolean;
  hasVisibleMessages: boolean;
  hasRunningPlanTool: boolean;
  latestConversationTurnId: string | null;
  mergeAgentGitBranch: (agentId: string, input: AgentGitMergeInput) => Promise<AgentGitWorkflow>;
  updateAgentGitBranchFromBase: (agentId: string, input: import('@workspace/core/contracts').AgentGitUpdateFromBaseInput) => Promise<import('@workspace/core/contracts').AgentGitUpdateFromBaseResult>;
  pullAgentGitBranch?: (agentId: string, input: import('@workspace/core/contracts').AgentGitPullInput) => Promise<import('@workspace/core/contracts').AgentGitPullResult>;
  revertAgentGitChanges?: (agentId: string, input: import('@workspace/core/contracts').AgentGitRevertInput) => Promise<import('@workspace/core/contracts').AgentGitWorkflow>;
  updateAgent: (input: import('@workspace/core/contracts').UpdateAgentInput) => Promise<void>;
  openAgentGitDiffPreview: (agentId?: string, target?: AgentGitDiffTarget) => Promise<void>;
  openAgentIn: (agentId: string, application: OpenInApplication, filePath?: string) => Promise<void>;
  openAttachmentImageAnnotation: (attachment: CodexNativeAttachment) => void;
  removeChatTextAnnotation: (annotationId: string) => void;
  removeVisualizationAnnotation: (annotationId: string) => void;
  openFilePreview: (link: ConversationFileLink) => Promise<void>;
  openFilePreviewForAgent: (agentId: string, filePath: string) => Promise<void>;
  openInApplications: OpenInApplicationCatalog;
  openRightWorkspaceTab: (tab: RightWorkspaceTab, agentId?: string) => void;
  pushAgentGitBranch: (agentId: string, input: AgentGitPushInput) => Promise<AgentGitWorkflow>;
  rightWorkspaceFor: (agentId: string) => AgentRightWorkspaceState;
  rightWorkspaces: Record<string, AgentRightWorkspaceState>;
  rightWorkspaceVisible: boolean;
  rightWorkspaceResizing?: boolean;
  readConversationMessages: (
    ref: BackendConversationRef,
    agentId: string,
    location?: AutomationLocation,
  ) => Promise<RendererMessage[]>;
  retryConversationHistory: () => Promise<void>;
  selectAgentFromShell: (agentId: string) => void;
  selectRightWorkspaceTab: (agentId: string, tab: RightWorkspaceTab) => void;
  snapshot: AppSnapshot;
  startRepositoryWork: (agentId: string, input: RepositoryWorkStartInput) => Promise<void>;
  startRightWorkspaceResize: (event: PointerEvent) => void;
  toggleFileExplorer: (agentId: string) => void;
  toggleRightWorkspace: () => void;
  updateStatus?: DesktopUpdateStatus;
  commitAgentGitChanges: (agentId: string, input: AgentGitCommitInput) => Promise<AgentGitWorkflow>;
  createAgentGitPullRequest: (agentId: string, input: AgentGitPullRequestInput) => Promise<AgentGitWorkflow>;
  startCodeReview?: (agentId: string, input: import('@workspace/core/code-review').CodeReviewStartInput) => Promise<AppSnapshot>;
  decideCodeReviewFinding?: (agentId: string, input: import('@workspace/core/code-review').CodeReviewDecisionInput) => Promise<AppSnapshot>;
  submitCodeReviewRound?: (agentId: string, sessionId: string) => Promise<AppSnapshot>;
  finishCodeReview?: (agentId: string, sessionId: string) => Promise<AppSnapshot>;
  commitCodeReview?: (agentId: string, sessionId: string) => Promise<AppSnapshot>;
  discardCodeReview?: (agentId: string, sessionId: string) => Promise<AppSnapshot>;
  reviewCodeAgain?: (agentId: string, sessionId: string) => Promise<AppSnapshot>;
  generateVisualizationSuggestion: (agentId: string, input: import('@workspace/core/visualize').GenerateVisualizationSuggestionInput) => Promise<AppSnapshot>;
  startVisualize: (agentId: string, input?: import('@workspace/core/visualize').StartVisualizeInput) => Promise<void>;
  selectVisualization: (agentId: string, input: import('@workspace/core/visualize').SelectVisualizationInput) => Promise<AppSnapshot>;
  deleteVisualization: (agentId: string, input: import('@workspace/core/visualize').DeleteVisualizationInput) => Promise<AppSnapshot>;
  readVisualizationAsset: (agentId: string, visualizationId: string) => Promise<import('@workspace/core/visualize').VisualizationAsset>;
}>();

const agentHeaders = new Map<string, InstanceType<typeof AgentHeader>>();

const emit = defineEmits<{
  'close-agent': [agentId: string];
  'expand-sidebar': [];
  'install-update': [];
  'remove-work-item-assignment': [item: WorkItem];
  clarifyCodeReviewFinding: [payload: {
    agentId: string;
    sessionId: string;
    roundId: string;
    finding: import('@workspace/core/code-review').CodeReviewFinding;
  }];
  removeReviewFindingAttachment: [];
  sendPrompt: [prompt: string];
  'update:planMode': [enabled: boolean];
}>();

const {
  activeAttachmentAnnotationCounts,
  agentFiles,
  saveDocumentAs,
  closeRightWorkspaceTab,
  conversationPaneController,
  currentAgent,
  forwardPrompt,
  handleStartWorkAction,
  isAgentEmpty,
  isConversationLoading,
  historyLoadFailed,
  isModalDialogVisible,
  isRightWorkspaceVisible,
  openAgentIn,
  openAttachmentImageAnnotation,
  openFilePreviewForAgent,
  openInApplications,
  rightWorkspaceVisible,
  retryConversationHistory,
  selectAgentFromShell,
  selectRightWorkspaceTab,
  snapshot,
  startRepositoryWork,
  startCodeReview,
  decideCodeReviewFinding,
  submitCodeReviewRound,
  finishCodeReview,
  commitCodeReview,
  discardCodeReview,
  reviewCodeAgain,
  generateVisualizationSuggestion,
  selectVisualization,
  deleteVisualization,
  readVisualizationAsset,
  startRightWorkspaceResize,
  toggleFileExplorer,
  toggleRightWorkspace,
} = toRefs(props);

const workspaceBody = ref<HTMLElement | null>(null);
const workspaceBodyWidth = ref<number | null>(null);
watch(workspaceBody, (body, _previous, onCleanup) => {
  workspaceBodyWidth.value = null;
  if (!body) return;
  const measure = () => {
    const width = body.getBoundingClientRect().width;
    if (width > 0) workspaceBodyWidth.value = width;
  };
  measure();
  if (typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(measure);
  observer.observe(body);
  onCleanup(() => observer.disconnect());
}, { flush: 'post' });

function workspaceWidthFor(agentId: string): number {
  const preferredWidth = props.rightWorkspaceFor(agentId).width;
  return workspaceBodyWidth.value === null
    ? preferredWidth
    : constrainedRightWorkspaceWidth(preferredWidth, workspaceBodyWidth.value);
}

const conversationPane = ref<{ focusComposer(): void; openSavedDraftPicker(): void; saveCurrentDraft(): Promise<void> } | null>(null);
const rightWorkspaces = props.rightWorkspaces;
const executionPlanStates = reactive<Record<string, { open: boolean; turnId: string }>>({});

const currentTurnPlan = computed<ThreadPlan | null>(() => {
  const plan = props.conversationPlan;
  if (!plan?.steps.length) {
    return null;
  }
  if (props.isConversationLoading && !props.hasVisibleMessages) {
    return null;
  }
  const latestTurnId = props.latestConversationTurnId;
  return plan.turnId.startsWith('debug-plan-') || !latestTurnId || latestTurnId === plan.turnId ? plan : null;
});
const executionPlanVisible = computed(() => {
  const agentId = currentAgent.value?.id;
  const plan = currentTurnPlan.value;
  if (!agentId || !plan) {
    return false;
  }

  return executionPlanStates[agentId]?.turnId === plan.turnId ? executionPlanStates[agentId].open : true;
});

watch(
  () => ({
    agentId: currentAgent.value?.id ?? null,
    turnId: currentTurnPlan.value?.turnId ?? null,
  }),
  ({ agentId, turnId }) => {
    if (!agentId || !turnId) {
      return;
    }

    const existing = executionPlanStates[agentId];
    if (!existing || existing.turnId !== turnId) {
      executionPlanStates[agentId] = { open: true, turnId };
    }
  },
  { immediate: true },
);

function toggleExecutionPlan(): void {
  const agentId = currentAgent.value?.id;
  const plan = currentTurnPlan.value;
  if (!agentId || !plan) {
    return;
  }

  const existing = executionPlanStates[agentId];
  executionPlanStates[agentId] = {
    turnId: plan.turnId,
    open: existing?.turnId === plan.turnId ? !existing.open : false,
  };
}

function closeExecutionPlan(): void {
  const agentId = currentAgent.value?.id;
  const plan = currentTurnPlan.value;
  if (!agentId || !plan) {
    return;
  }

  executionPlanStates[agentId] = { turnId: plan.turnId, open: false };
}

function rightWorkspaceFor(agentId: string): AgentRightWorkspaceState {
  return props.rightWorkspaceFor(agentId);
}

async function closeWorkspaceTab(agent: Agent, tab: RightWorkspaceTab): Promise<void> {
  if (tab === 'codeReview' && agent.codeReview && props.discardCodeReview) {
    await props.discardCodeReview(agent.id, agent.codeReview.id);
  }
  props.closeRightWorkspaceTab(agent.id, tab);
}

const runProfileDialogs = reactive(new Set<string>());

function headerBindingsFor(agentId: string | null, topRight: boolean, topLeft: boolean) {
  const agent = props.snapshot.agents.find(candidate => candidate.id === agentId) ?? null;
  const focused = Boolean(agentId && agentId === props.currentAgent?.id && !props.emptySplitPane);
  const turnId = focused ? props.latestConversationTurnId : agentId ? props.latestTurnIdForAgent?.(agentId) : null;
  const diff = turnId ? props.snapshot.turnGitDiffs[turnId] : null;
  const recipient = props.snapshot.agents.find(candidate => candidate.id === agent?.delegatedByAgentId);
  const backend = agent?.backend ?? props.currentBackendRuntime.backend;
  return {
    ref: (instance: Element | ComponentPublicInstance | null) => {
      if (!agentId) return;
      if (instance) agentHeaders.set(agentId, instance as InstanceType<typeof AgentHeader>);
      else agentHeaders.delete(agentId);
    },
    class: props.splitHeaders ? 'agent-header--pane' : undefined,
    agent,
    repositoryIcon: agent ? repositoryIconForAgent(agent, props.snapshot.general.repositoryIcons) : undefined,
    gitStatus: focused ? props.currentAgentGitStatus : agentId ? props.snapshot.agentGitStatuses[agentId] ?? null : null,
    lastTurnGitDiff: diff?.agentId === agentId && diff.diff ? diff : null,
    backendRuntime: focused ? props.currentBackendRuntime : props.snapshot.backendRuntimes.find(runtime => runtime.backend === backend) ?? { backend, status: 'notConfigured' as const },
    workspaceOpen: props.rightWorkspaceVisible && !props.emptySplitPane,
    workspaceToggleAvailable: topRight,
    workspaceToggleDisabled: !props.currentAgent || Boolean(props.emptySplitPane),
    isLoading: props.isLoading,
    sidebarCollapsed: topLeft && props.agentSidebarCollapsed,
    updateStatus: topRight && appHostCapabilities.appUpdates ? props.updateStatus : undefined,
    executionPlanAvailable: focused && Boolean(currentTurnPlan.value),
    executionPlanOpen: focused && executionPlanVisible.value,
    runHostLabel: props.snapshot.remoteConnections.connections.find(connection => connection.id === props.snapshot.teams.find(team => team.id === agent?.teamId)?.remoteConnectionId)?.name ?? translate('runProfiles.localHost'),
    runPreviewAvailable: Boolean(agent && isLocalAgent(agent) && appHostCapabilities.embeddedBrowser),
    onRunProfilesVisible: (visible: boolean) => { if (agentId) { if (visible) runProfileDialogs.add(agentId); else runProfileDialogs.delete(agentId); } },
    onRunPreview: (url: string) => agentId && openRequestedBrowser(agentId, { type: 'open-browser', url }),
    openInAvailable: Boolean(agent && appHostCapabilities.openInApplications && isLocalAgent(agent)),
    openInCatalog: props.openInApplications,
    subagentTree: agentId ? subagentTreeFor(agentId) : null,
    selectedSubagentConversationId: agentId ? selectedSubagentConversationIdFor(agentId) : null,
    getGitWorkflow: props.getAgentGitWorkflow,
    generateGitMessage: props.generateAgentGitMessage,
    commitGitChanges: props.commitAgentGitChanges,
    pushGitBranch: props.pushAgentGitBranch,
    createGitPullRequest: props.createAgentGitPullRequest,
    mergeGitBranch: props.mergeAgentGitBranch,
    updateGitBranchFromBase: props.updateAgentGitBranchFromBase,
    pullGitBranch: props.pullAgentGitBranch,
    revertGitChanges: props.revertAgentGitChanges,
    reportBackAgentName: recipient ? agentDisplayName(recipient) : null,
    reportBackAgents: agent ? repositoryPeersForAgent(agent, props.snapshot).map(candidate => ({ id: candidate.id, name: agentDisplayName(candidate) })) : [],
    onExpandSidebar: () => emit('expand-sidebar'),
    onToggleExecutionPlan: toggleExecutionPlan,
    onToggleWorkspace: props.toggleRightWorkspace,
    onOpenGitLog: () => agentId && openRightWorkspaceTab('gitLog', agentId),
    onOpenGitDiff: (target: AgentGitDiffTarget) => agentId && openAgentGitDiffPreview(agentId, target),
    onSelectGitDiffTarget: (target: AgentGitDiffTarget) => agentId && persistGitDiffTarget(agentId, target),
    onOpenIn: (application: OpenInApplication) => agentId && props.openAgentIn(agentId, application),
    onSelectAgent: props.selectAgentFromShell,
    onSelectSubagent: (conversationId: string) => agentId && openSubagent(agentId, conversationId),
    onInstallUpdate: () => emit('install-update'),
  };
}

function openAgentGitDiffPreview(agentId?: string, target?: AgentGitDiffTarget): Promise<void> {
  return props.openAgentGitDiffPreview(agentId, target);
}

function persistGitDiffTarget(agentId: string, target: AgentGitDiffTarget): void {
  void props.updateAgent({ id: agentId, gitDiffTarget: { ...target } }).catch(() => undefined);
}

function openRightWorkspaceTab(tab: RightWorkspaceTab, agentId?: string): void {
  props.openRightWorkspaceTab(tab, agentId);
}

function readConversationMessages(ref: BackendConversationRef, agentId: string): Promise<RendererMessage[]> {
  return props.readConversationMessages(ref, agentId);
}

function openFilePreview(link: ConversationFileLink): Promise<void> {
  return props.openFilePreview(link);
}

function updateBrowserUrl(agentId: string, tab: 'browser' | RightWorkspaceBrowserTab, url: string): void {
  const workspace = rightWorkspaceFor(agentId);
  if (tab === 'browser') workspace.browserInitialUrl = url;
  else if (workspace.browserPanels[tab]) workspace.browserPanels[tab]!.url = url;
}

function openRequestedBrowser(agentId: string, command: Extract<AppCommand, { type: 'open-browser' }>): void {
  const workspace = rightWorkspaceFor(agentId);
  workspace.browserId = command.browserId ?? PRIMARY_BROWSER_ID;
  workspace.browserInitialUrl = command.url ?? '';
  workspace.browserVisualization = null;
  workspace.browserOpenRequestId += 1;
  openRightWorkspaceTab('browser', agentId);
}

function openConversationVisualization(visualization: CodexConversationVisualization, agentId = currentAgent.value?.id): void {
  const agent = props.snapshot.agents.find(agent => agent.id === agentId);
  if (!agent || !appHostCapabilities.embeddedBrowser) return;
  const workspace = rightWorkspaceFor(agent.id);
  workspace.browserId = PRIMARY_BROWSER_ID;
  workspace.browserInitialUrl = '';
  workspace.browserVisualization = { ...visualization };
  workspace.browserOpenRequestId += 1;
  openRightWorkspaceTab('browser', agent.id);
}

function handleBrowserOpenCommand(command: Extract<AppCommand, { type: 'open-browser' }>): void {
  const agentId = command.agentId ?? currentAgent.value?.id;
  if (!agentId || !props.snapshot.agents.some((agent) => agent.id === agentId)) return;
  openRequestedBrowser(agentId, command);
}

function openConversationImage(image: CodexMessageImage, context?: CodexMessageImageContext, agentId = currentAgent.value?.id): boolean {
  if (context?.intent === 'fullscreen') return false;

  const agent = props.snapshot.agents.find(agent => agent.id === agentId);
  if (!agent) return false;

  const durablePath = image.path?.trim() || undefined;
  const messageIdentifier = context?.message?.id ?? `message-${context?.index ?? 'unknown'}`;
  const tab = rightWorkspaceImageTab([messageIdentifier, image.kind, durablePath ?? image.src].join('\0'));
  const title =
    image.title?.trim() ||
    image.name?.trim() ||
    (durablePath ? fileBasename(durablePath) : '') ||
    image.alt.trim() ||
    'Image';
  const workspace = rightWorkspaceFor(agent.id);
  workspace.imagePanels = {
    ...workspace.imagePanels,
    [tab]: {
      kind: 'image',
      title,
      ...(durablePath ? { subtitle: durablePath, path: durablePath } : {}),
      ...(image.mimeType ? { mimeType: image.mimeType } : {}),
      alt: image.alt || title,
      src: image.src,
      state: 'idle',
      error: null,
    },
  };
  openRightWorkspaceTab(tab, agent.id);
  return true;
}

function openConversationLink(link: CodexConversationLink): void | Promise<void> {
  if (link.kind === 'external') {
    window.open(link.href, '_blank', 'noopener,noreferrer');
    return;
  }
  const context = link as CodexConversationLink &
    Partial<Pick<ConversationFileLink, 'turnId' | 'messageId' | 'itemId'>>;
  return openFilePreview({
    kind: 'file',
    href: link.href,
    path: link.path,
    ...(link.filepath ? { filepath: link.filepath } : {}),
    ...(link.action ? { action: link.action } : {}),
    ...(link.line === undefined ? {} : { line: link.line }),
    ...(link.column === undefined ? {} : { column: link.column }),
    ...(context.turnId ? { turnId: context.turnId } : {}),
    ...(context.messageId ? { messageId: context.messageId } : {}),
    ...(context.itemId ? { itemId: context.itemId } : {}),
  });
}

const linkDrag = useWorkspaceLinkDrag({
  browserAvailable: appHostCapabilities.embeddedBrowser,
  open: (agentId, link) => {
    if (!props.snapshot.agents.some(agent => agent.id === agentId)) return;
    if (agentId !== currentAgent.value?.id) props.selectAgentFromShell(agentId);
    if (link.kind === 'file') {
      void props.openFilePreviewForAgent(agentId, link.filepath ?? link.path);
      return;
    }
    const browserId = crypto.randomUUID();
    const tab: RightWorkspaceBrowserTab = `browser:${browserId}`;
    const workspace = rightWorkspaceFor(agentId);
    workspace.browserPanels[tab] = { browserId, url: link.href, title: new URL(link.href).hostname };
    openRightWorkspaceTab(tab, agentId);
  },
});

function isPlanPreviewUpdatingFor(agentId: string): boolean {
  const panel = rightWorkspaceFor(agentId).planPanel;
  if (!panel || panel.purpose !== 'plan') return false;
  return agentId === currentAgent.value?.id && props.hasRunningPlanTool;
}

function effectiveGitReviewPanelFor(agent: Agent): SidePanelGitDiffState {
  return (
    rightWorkspaceFor(agent.id).gitReviewPanel ?? {
      kind: 'gitDiff',
      title: translate('surface.appShell.review'),
      ...(agent.folder ? { subtitle: agent.folder } : {}),
      diff: '',
      state: 'loading',
      error: null,
    }
  );
}

function subagentTreeFor(agentId: string): AgentSubagentTree | null {
  const agent = props.snapshot.agents.find((candidate) => candidate.id === agentId);
  const tree = props.snapshot.subagentTrees[agentId];
  const session = agent?.backendSession;
  const rootId = session?.kind === 'codex' ? session.threadId : session?.kind === 'claude' ? session.sessionId : null;
  return rootId && tree?.rootConversationId === rootId
    ? tree
    : null;
}

watch(
  () =>
    props.snapshot.agents.map(
      (agent) =>
        `${agent.id}:${agent.backendSession?.kind === 'codex' ? agent.backendSession.threadId : agent.backendSession?.kind === 'claude' ? agent.backendSession.sessionId : ''}:${props.snapshot.subagentTrees[agent.id]?.rootConversationId ?? ''}:${Object.keys(
          props.snapshot.subagentTrees[agent.id]?.nodes ?? {},
        )
          .sort()
          .join(',')}`,
    ),
  () => {
    for (const [agentId, workspace] of Object.entries(rightWorkspaces)) {
      for (const tab of workspace.tabs.filter(isRightWorkspaceSubagentTab)) {
        const conversationId = rightWorkspaceSubagentConversationId(tab);
        if (!subagentTreeFor(agentId)?.nodes[conversationId]) {
          closeRightWorkspaceTab.value(agentId, tab);
        }
      }
    }
  },
);

function openSubagent(agentId: string, conversationId: string): void {
  const tree = subagentTreeFor(agentId);
  if (!tree?.nodes[conversationId]) return;
  openRightWorkspaceTab(rightWorkspaceSubagentTab(conversationId), agentId);
}

function selectedSubagentConversationIdFor(agentId: string): string | null {
  const tab = rightWorkspaceFor(agentId).activeTab;
  return tab && isRightWorkspaceSubagentTab(tab) ? rightWorkspaceSubagentConversationId(tab) : null;
}

function loadSubagentMessages(agentId: string, conversationId: string): Promise<RendererMessage[]> {
  const tree = subagentTreeFor(agentId);
  if (!tree?.nodes[conversationId])
    return Promise.reject(new Error(translate('surface.appShell.subagentConversationIsUnavailable')));
  const agent = props.snapshot.agents.find(candidate => candidate.id === agentId);
  const ref = agent ? conversationRefFromAgent(agent) : null;
  if (!ref || ref.backend === 'antigravity') return Promise.reject(new Error(translate('surface.appShell.subagentConversationIsUnavailable')));
  return readConversationMessages(ref.backend === 'codex' ? { ...ref, threadId: conversationId } : { ...ref, subagentId: conversationId }, agentId);
}

function openRightWorkspaceTabFromMenu(agentId: string, tab: RightWorkspaceTab): void {
  if (tab === 'visualize') {
    void props.startVisualize(agentId).catch(error => {
      ElMessage.error(localizedErrorMessage(error, translate));
    });
    return;
  }
  if (tab === 'backlog') {
    void openRepositoryBacklog(agentId);
    return;
  }
  if (tab === 'review') {
    void openAgentGitDiffPreview(agentId);
    return;
  }
  if (tab === 'files') {
    rightWorkspaceFor(agentId).filesPaneOpen = true;
  }
  openRightWorkspaceTab(tab, agentId);
}

function openRepositoryBacklog(agentId: string): void {
  openRightWorkspaceTab('backlog', agentId);
}

function isLocalAgent(agent: Agent): boolean {
  const team = props.snapshot.teams.find((candidate) => candidate.id === agent.teamId);
  return !team?.remoteConnectionId;
}

function attachVisualizationAnnotation(annotation: VisualizationAnnotationInput): void {
  props.addVisualizationAnnotation(annotation);
  focusComposer();
}

function focusComposer(): void {
  conversationPane.value?.focusComposer();
}

function openSavedDraftPicker(): void { conversationPane.value?.openSavedDraftPicker(); }
function saveCurrentDraft(): void { void conversationPane.value?.saveCurrentDraft(); }

function workspaceBodyElement(): HTMLElement | null {
  return workspaceBody.value;
}

function showDebugGitOperationProgress(operation: 'pullRequest' | 'merge'): void | Promise<void> {
  return agentHeaders.get(props.currentAgent?.id ?? '')?.showDebugGitOperationProgress(operation);
}

defineExpose({
  openRightWorkspaceTabFromMenu,
  getCommandActions: () => agentHeaders.get(props.currentAgent?.id ?? '')?.getCommandActions() ?? [],
  focusComposer,
  openSavedDraftPicker,
  saveCurrentDraft,
  handleBrowserOpenCommand,
  openConversationLink,
  openConversationImage,
  openConversationVisualization,
  showDebugGitOperationProgress,
  workspaceBodyElement,
});
</script>

<style scoped>
.app-shell__closed-workspace-drop {
  left: auto;
  width: 240px;
}
.app-shell__body {
  display: flex;
}

.app-shell__right-workspace {
  flex: 0 0 420px;
}

.app-shell__conversations {
  position: relative;
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
}

.app-shell__layout-control {
  position: absolute;
  top: var(--space-3);
  right: var(--space-4);
  z-index: 3;
}

.app-shell__conversations--split .app-shell__layout-control {
  top: calc(var(--workbench-appbar-height) + var(--space-3));
}

.app-shell__right-workspace-resizer {
  position: relative;
  flex: 0 0 5px;
  order: 1;
  cursor: col-resize;
  touch-action: none;
  z-index: 1;
}

.app-shell__right-workspace-resizer::after {
  content: '';
  position: absolute;
  inset: 0 auto 0 2px;
  width: 1px;
  background: var(--color-border);
}

.app-shell__right-workspace-resizer:hover::after {
  background: var(--color-border-strong);
}

.app-shell__right-workspace-resize-shield {
  position: absolute;
  inset: 0;
  z-index: 2;
  cursor: col-resize;
  user-select: none;
}

@media (max-width: 768px) {
  .app-shell__right-workspace {
    position: absolute;
    inset: 0;
    z-index: 4;
    flex-basis: auto !important;
    width: auto;
    background: var(--color-shell-main);
  }

  .app-shell__right-workspace-resizer {
    display: none;
  }
}
</style>
