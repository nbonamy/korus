<template>
  <section class="mission-workspace" :aria-label="t('missions.workspace')">
    <WorkspaceHeader class="mission-workspace__header" :sidebar-collapsed="sidebarCollapsed">
      <SidebarExpandButton v-if="sidebarCollapsed" :label="t('surface.agentHeader.showAgentSidebar')" @click="emit('expand-sidebar')" />
      <div class="mission-workspace__identity">
        <h1 class="workspace-header__title">{{ mission.outcome }}</h1>
      </div>
      <span class="mission-workspace__mission-status" :data-status="mission.status">{{ t(`missions.${mission.status}`) }}</span>
      <MissionCostMenu :mission="mission" />
      <button
        class="app-icon-button"
        type="button"
        :aria-label="t('surface.agentHeader.toggleRightWorkspace')"
        :title="t(workspacePreviewOpen || conversationOnly ? 'surface.agentHeader.closeRightWorkspace' : 'surface.agentHeader.openRightWorkspace')"
        :aria-pressed="workspacePreviewOpen || conversationOnly"
        :disabled="!workspaceToggleAvailable"
        @click="emit('toggle-workspace')"
      >
        <IconLayoutSidebarRight aria-hidden="true" />
      </button>
    </WorkspaceHeader>

    <div
      ref="workspaceBody"
      class="mission-workspace__body workspace-body"
      :class="{ 'mission-workspace__body--conversation-only': conversationOnly || expandedPane === 'conversation', 'mission-workspace__body--resizing': chatResize }"
      :style="chatWidth === null ? undefined : { '--mission-chat-width': `${chatWidth}px` }"
    >
      <PaneTransition :enabled="workspaceWidth > 760">
      <main v-show="!conversationOnly && expandedPane !== 'conversation'" class="mission-workspace__workbench">
        <MissionStageRail :mission="mission" :viewed-stage="viewedStage" @view-stage="viewedStage = $event">
          <template #actions>
            <button
              class="app-icon-button mission-workspace__expand"
              type="button"
              :aria-label="t(expandedPane === 'workbench' ? 'missions.restoreSplitView' : 'missions.expandWorkbench')"
              :title="t(expandedPane === 'workbench' ? 'missions.restoreSplitView' : 'missions.expandWorkbench')"
              :aria-pressed="expandedPane === 'workbench'"
              @click="togglePane('workbench')"
            >
              <ArrowsDiagonalMinimize2Icon v-if="expandedPane === 'workbench'" aria-hidden="true" />
              <ArrowsDiagonalIcon v-else aria-hidden="true" />
            </button>
          </template>
        </MissionStageRail>
        <header v-if="viewedStage !== 'requirements'" class="mission-workspace__stage-header">
          <div class="mission-workspace__stage-heading">
            <h2>{{ stageHeadingTitle }}</h2>
            <span v-if="stageHeadingMeta">{{ stageHeadingMeta }}</span>
          </div>
          <div class="mission-workspace__stage-actions">
            <div v-if="activeStageRun && !showStageLoading" class="mission-workspace__run-status" role="status" aria-live="polite">
              <span class="app-spinner app-spinner--primary" aria-hidden="true" />
              <span>{{ activeStageStatus }}</span>
            </div>
            <button
              v-else-if="viewedStage === 'implementation' && mission.stage === 'implementation' && implementationReady"
              class="app-button app-button--primary"
              type="button"
              :aria-busy="busy"
              :disabled="busy || !executeMission || debugFixture"
              @click="continueToReview"
            >
              {{ t('missions.continueToReview') }}
              <ArrowRightIcon aria-hidden="true" />
            </button>
            <button
              v-else-if="viewedStage === mission.stage && !['requirements', 'implementation'].includes(mission.stage) && activeRun?.proposal"
              class="app-button app-button--primary"
              type="button"
              :aria-busy="busy"
              :disabled="busy || (viewedStage === 'tickets' && !missionLead)"
              @click="requestApproval"
            >
              {{ t(viewedStage === 'tickets' ? 'missions.approveTickets' : 'missions.approveAndContinue') }}
              <ArrowRightIcon aria-hidden="true" />
            </button>
            <span v-else-if="showAcceptedArtifactStatus" class="mission-workspace__accepted-status"><CheckIcon aria-hidden="true" />{{ t('missions.accepted') }}</span>
          </div>
        </header>

        <div class="mission-workspace__workbench-scroll" :class="{ 'mission-workspace__workbench-scroll--requirements': viewedStage === 'requirements', 'mission-workspace__workbench-scroll--stage-loading': showStageLoading }">
          <form v-if="membershipUnavailable && !debugFixture" class="mission-workspace__member-recovery" @submit.prevent="reassignMembers">
            <p role="alert">{{ t('missions.memberUnavailable') }}</p>
            <select v-model="replacementMemberId" :aria-label="t('missions.replacementMember')" :disabled="busy || !!activeStageRun">
              <option value="" disabled>{{ t('missions.replacementMember') }}</option>
              <option v-for="member in localMembers" :key="member.id" :value="member.id">{{ member.name }}</option>
            </select>
            <button class="app-button app-button--small" type="submit" data-testid="reassign-mission-member" :disabled="busy || !!activeStageRun || !replacementMemberId || !executeMission">{{ t('missions.reassignMembers') }}</button>
          </form>
          <p v-if="error || artifactError" class="mission-workspace__error" role="alert">{{ error || artifactError }}</p>
          <MissionTaskFilters v-if="filterTickets.length" v-model:statuses="taskStatuses" :tickets="filterTickets" :items="filterItems" />
          <div v-if="filterTickets.length && !visibleTicketIndexes.length" class="mission-workspace__filter-empty" role="status">
            <p>{{ t('missions.taskFilters.empty') }}</p>
            <button type="button" class="app-button app-button--small" :aria-label="t('missions.taskFilters.clear')" @click="taskStatuses = []">{{ t('missions.taskFilters.clear') }}</button>
          </div>
          <MissionImplementationBoard
            v-if="viewedStage === 'implementation' && mission.artifacts.tickets.length"
            :agents="agents"
            :active-agent-id="conversationAgentId"
            :mission="mission"
            :visible-ticket-indexes="visibleTicketIndexes"
            :busy="busy"
            :read-only="debugFixture"
            :open-in-available="openInAvailable"
            :open-in-applications="openInApplications"
            @open-conversation="selectConversation"
            @open-worktree="emit('open-worktree', $event)"
            @retry="retryImplementationTicket"
            @stop="stopRun"
          />

          <slot v-else-if="viewedStage === 'ship'" name="ship" :open-conversation="selectConversation" />

          <slot
            v-if="codeAgentId && viewedStage === 'review'"
            name="code-review"
            :agent-id="codeAgentId"
            :review-summary="artifactMarkdown"
            :chat-about-finding="chatAboutReviewFinding"
          />

          <section v-else-if="viewedStage === 'tickets' && visibleTickets.length" class="mission-workspace__artifact" :aria-label="t(activeRun?.draftTickets?.length && !activeRun.proposal ? 'missions.draftTickets' : viewedStage === mission.stage && activeRun?.proposal ? 'missions.proposal' : 'missions.acceptedArtifact')">
            <MissionTicketBoard
              :tickets="visibleTickets"
              :visible-ticket-indexes="visibleTicketIndexes"
              :annotatable="viewedStage === mission.stage && Boolean(activeRun?.proposal || activeRun?.draftTickets?.length)"
              :disabled="feedbackBusy || debugFixture"
              :reset-key="feedbackReset"
              @send-comments="sendTicketComments"
            />
          </section>

          <section v-else-if="!['implementation', 'ship'].includes(viewedStage) && viewedStage === mission.stage && activeRun?.proposal" class="mission-workspace__artifact" :aria-label="t('missions.proposal')">
            <MissionRequirementReview
              v-if="viewedStage === 'requirements'"
              :content="artifactMarkdown"
              :review-id="`${activeRun.id}:${activeRun.startedAt}:${activeRun.finishedAt ?? ''}`"
              :disabled="busy"
              :respond="debugFixture || executeMission ? respondToRequirements : undefined"
            />
            <MarkdownPanel v-else-if="viewedStage !== 'review'" :content="artifactMarkdown" />
          </section>

          <section v-else-if="!['implementation', 'ship'].includes(viewedStage) && artifactMarkdown" class="mission-workspace__artifact" :aria-label="t('missions.acceptedArtifact')">
            <MissionRequirementReview v-if="viewedStage === 'requirements'" :content="artifactMarkdown" :review-id="mission.id" read-only />
            <MarkdownPanel v-else-if="viewedStage !== 'review'" :content="artifactMarkdown" />
          </section>

          <section v-else-if="showStageLoading" class="mission-workspace__stage-loading" role="status" aria-live="polite">
            <template v-if="viewedStage === 'requirements'">
              <TargetArrowIcon class="mission-workspace__stage-icon" aria-hidden="true" />
              <h3>{{ t('missions.missionLeadWelcome') }}</h3>
              <p>{{ t('missions.missionLeadWelcomeDescription') }}</p>
            </template>
            <template v-else>
              <span class="app-spinner app-spinner--xl app-spinner--primary" aria-hidden="true" />
              <h3>{{ activeStageStatus }}</h3>
            </template>
          </section>

          <section v-else-if="!['implementation', 'ship'].includes(viewedStage) && !activeStageRun" class="mission-workspace__empty-artifact">
            <span class="mission-workspace__callout-icon"><FileTextIcon aria-hidden="true" /></span>
            <h3>{{ t('missions.noArtifactYet') }}</h3>
            <p>{{ t(conversationAgentId ? 'missions.keepWorkingInConversation' : 'missions.missionLeadStarting') }}</p>
            <button
              v-if="!initialRequirements && mission.execution && !activeRun && mission.status !== 'completed'"
              class="app-button app-button--primary"
              type="button"
              :aria-busy="busy"
              :disabled="busy || !executeMission"
              @click="continueMission"
            >
              <PlayerPlayIcon aria-hidden="true" />{{ t('missions.continueMission') }}
            </button>
          </section>
        </div>
      </main>
      </PaneTransition>

      <PaneTransition :enabled="workspaceWidth > 760">
      <MissionConversationRail
        v-show="conversationOnly || expandedPane !== 'workbench'"
        v-model:selected-agent-id="conversationAgentId"
        :mission="mission"
        :agents="agents"
        :repository-icons="repositoryIcons"
        :unread-agent-ids="unreadAgentIds"
        @open-conversation="emit('open-conversation', $event)"
      >
        <template #actions>
          <button
            v-if="!conversationOnly"
            class="app-icon-button mission-workspace__expand"
            type="button"
            :aria-label="t(expandedPane === 'conversation' ? 'missions.restoreSplitView' : 'missions.expandConversation')"
            :title="t(expandedPane === 'conversation' ? 'missions.restoreSplitView' : 'missions.expandConversation')"
            :aria-pressed="expandedPane === 'conversation'"
            @click="togglePane('conversation')"
          >
            <ArrowsDiagonalMinimize2Icon v-if="expandedPane === 'conversation'" aria-hidden="true" />
            <ArrowsDiagonalIcon v-else aria-hidden="true" />
          </button>
        </template>
        <template #conversation="{ agentId }"><slot name="conversation" :agent-id="agentId" /></template>
      </MissionConversationRail>
      </PaneTransition>
      <div
        v-show="!conversationOnly && !expandedPane"
        class="mission-workspace__chat-resizer"
        role="separator"
        :aria-label="t('missions.resizeChat')"
        aria-orientation="vertical"
        :aria-valuemin="300"
        :aria-valuemax="maximumChatWidth"
        :aria-valuenow="Math.round(effectiveChatWidth)"
        tabindex="0"
        @pointerdown="startChatResize"
        @keydown.left.prevent="resizeChat(effectiveChatWidth + 16)"
        @keydown.right.prevent="resizeChat(effectiveChatWidth - 16)"
        @keydown.home.prevent="resizeChat(300)"
        @keydown.end.prevent="resizeChat(maximumChatWidth)"
        @dblclick="resizeChat(workspaceWidth * 0.4)"
      />
    </div>
  </section>
  <FormDialog
    v-if="implementationApprovalVisible && missionLead"
    :model-value="!implementationStarting"
    :title="t('missions.startImplementation')"
    :subtitle="t('missions.ticketCount', { count: visibleTickets.length })"
    @update:model-value="visible => { if (!visible && !busy) implementationApprovalVisible = false; }"
  >
    <div class="mission-workspace__start-options">
      <el-select v-model="implementationMode" class="mission-workspace__execution-mode" :aria-label="t('missions.implementationExecution')" :disabled="busy">
        <el-option :label="t('missions.executionLead')" value="lead" />
        <el-option :label="t('missions.executionPerRepository')" value="perRepository" />
        <el-option :label="t('missions.executionMultiplePerRepository')" value="multiplePerRepository" />
      </el-select>
      <BackendModelSelector
        v-if="!leadExecutesImplementation"
        v-model:selection="implementationSelection"
        :agent-id="missionLead.id"
        :disabled="busy"
      />
      <p v-if="implementationMode === 'multiplePerRepository'" class="mission-workspace__parallel-warning">
        {{ t('missions.parallelImplementationWarning') }}
      </p>
      <p v-if="error" class="mission-workspace__error" role="alert">{{ error }}</p>
    </div>
    <template #footer>
      <button class="app-button app-button--tertiary" type="button" :disabled="busy" @click="implementationApprovalVisible = false">
        {{ t('common.cancel') }}
      </button>
      <button class="app-button app-button--primary" type="button" :disabled="busy || (!leadExecutesImplementation && !implementationModel)" @click="approveProposal">
        {{ t('missions.startImplementationAction') }}
      </button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { useExecutionSelection } from '../execution-selection';
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconLayoutSidebarRight } from '@tabler/icons-vue';
import type { Agent, OpenInApplicationCatalog } from '@workspace/core/contracts';
import type { Mission, MissionArtifacts, MissionReviewFinding, MissionStage } from '@workspace/core/missions';
import { missionWorkflow } from '@workspace/core/mission-workflows';
import { missionImplementationBusy, pendingMissionRun, type MissionArtifactReadResult, type MissionExecutionInput, type MissionImplementationStartProgress } from '@workspace/core/mission-execution';
import { ArrowRightIcon, ArrowsDiagonalIcon, ArrowsDiagonalMinimize2Icon, CheckIcon, FileTextIcon, PlayerPlayIcon, TargetArrowIcon } from '../shared/icons/app-icons';
import BackendModelSelector from './BackendModelSelector.vue';
import FormDialog from '../shared/dialog/FormDialog.vue';
import MarkdownPanel from './MarkdownPanel.vue';
import SidebarExpandButton from '../shared/SidebarExpandButton.vue';
import WorkspaceHeader from '../shared/WorkspaceHeader.vue';
import PaneTransition from '../shared/PaneTransition.vue';
import { useCollapsiblePaneResize } from '../shared/use-collapsible-pane-resize';
import MissionCostMenu from './MissionCostMenu.vue';
import MissionConversationRail from './MissionConversationRail.vue';
import MissionImplementationBoard from './MissionImplementationBoard.vue';
import MissionTaskFilters from './MissionTaskFilters.vue';
import { implementationTicketItems } from './mission-implementation-model';
import { matchesMissionTaskFilters, type MissionTaskStatus } from './mission-ticket-filters';
import type { WorkspaceProvisioningOperation } from './WorkspaceProvisioningProgressDialog.vue';
import { publishProvisioningOperation } from './provisioning-operations';
import MissionRequirementReview from './MissionRequirementReview.vue';
import type { PlanReviewResolution } from '@workspace/core/plan-review';
import MissionStageRail from './MissionStageRail.vue';
import MissionTicketBoard, { type MissionTicketComment } from './MissionTicketBoard.vue';
import type { MissionWorkspaceOpenRequest } from './MissionWorkspaceOpenIn.vue';

const props = withDefaults(defineProps<{
  agents?: Agent[];
  repositoryIcons?: Record<string, string>;
  unreadAgentIds?: string[];
  sidebarCollapsed?: boolean;
  conversationOnly?: boolean;
  workspaceToggleAvailable?: boolean;
  workspacePreviewOpen?: boolean;
  executeMission?: (input: MissionExecutionInput) => Promise<void>;
  implementationStartProgress?: MissionImplementationStartProgress | null;
  mission: Mission;
  readMissionArtifact?: (missionId: string, stage: MissionStage) => Promise<MissionArtifactReadResult>;
  sendMissionPrompt?: (prompt: string) => Promise<void> | void;
  openInAvailable?: boolean;
  openInApplications?: OpenInApplicationCatalog;
}>(), {
  agents: () => [],
  openInApplications: () => ({ defaultApplication: 'finder', applications: [] }),
});
const emit = defineEmits<{
  'open-conversation': [agentId: string];
  'chat-about-review-finding': [payload: { agentId: string; finding: MissionReviewFinding }];
  'expand-sidebar': [];
  'toggle-workspace': [];
  'open-worktree': [request: MissionWorkspaceOpenRequest];
}>();
const { t } = useI18n();
type ExpandedPane = 'workbench' | 'conversation' | null;
const zoomStorageKey = (id: string) => `app.missionExpandedPane.${id}`;
function readExpandedPane(): ExpandedPane {
  try {
    const saved = window.localStorage.getItem(zoomStorageKey(props.mission.id));
    return saved === 'workbench' || saved === 'conversation' ? saved : null;
  } catch { return null; }
}
const paneZoom = ref<ExpandedPane>(readExpandedPane());
const expandedPane = computed({
  get: () => paneZoom.value,
  set: (pane: ExpandedPane) => {
    paneZoom.value = pane;
    try {
      const key = zoomStorageKey(props.mission.id);
      if (pane) window.localStorage.setItem(key, pane);
      else window.localStorage.removeItem(key);
    } catch { /* Keep zoom available when local storage is unavailable. */ }
  },
});
function togglePane(pane: 'workbench' | 'conversation'): void {
  stopChatResize();
  expandedPane.value = expandedPane.value === pane ? null : pane;
}
const workspaceBody = useTemplateRef<HTMLElement>('workspaceBody');
const workspaceWidth = ref(0);
const chatWidthStorageKey = 'app.missionChatWidth';
const chatWidth = ref<number | null>(readChatWidth());
const maximumChatWidth = computed(() => Math.max(300, workspaceWidth.value - 360));
const effectiveChatWidth = computed(() => Math.min(maximumChatWidth.value,
  Math.max(300, chatWidth.value ?? workspaceWidth.value * 0.4)));
const { resizing: chatResize, start: startPaneResize, stop: stopChatResize } = useCollapsiblePaneResize();
let workspaceObserver: ResizeObserver | undefined;

function readChatWidth(): number | null {
  try {
    const value = Number(window.localStorage.getItem(chatWidthStorageKey));
    return Number.isFinite(value) && value >= 300 ? value : null;
  } catch { return null; }
}
function resizeChat(width: number, save = true): void {
  chatWidth.value = Math.round(Math.min(maximumChatWidth.value, Math.max(300, width)));
  if (save) {
    try { window.localStorage.setItem(chatWidthStorageKey, String(chatWidth.value)); }
    catch { /* Keep resizing available when local storage is unavailable. */ }
  }
}
function startChatResize(event: PointerEvent): void {
  workspaceWidth.value = workspaceBody.value?.getBoundingClientRect().width ?? 0;
  const width = effectiveChatWidth.value;
  const startX = event.clientX;
  startPaneResize(event, {
    minimum: 300,
    width,
    widthAt: move => width + startX - move.clientX,
    resize: value => resizeChat(value, false),
    setOpen: open => { expandedPane.value = open ? null : 'workbench'; },
    opposite: {
      maximum: maximumChatWidth.value,
      setOpen: open => { expandedPane.value = open ? null : 'conversation'; },
    },
    onEnd: () => { if (chatWidth.value !== null) resizeChat(chatWidth.value); },
  });
}
onMounted(() => {
  const measure = () => { workspaceWidth.value = workspaceBody.value?.getBoundingClientRect().width ?? 0; };
  measure();
  if (typeof ResizeObserver !== 'undefined' && workspaceBody.value) {
    workspaceObserver = new ResizeObserver(measure);
    workspaceObserver.observe(workspaceBody.value);
  }
});
watch(() => props.mission.id, () => {
  stopChatResize();
  paneZoom.value = readExpandedPane();
});
watch(() => props.conversationOnly, () => {
  stopChatResize();
  expandedPane.value = null;
});
onBeforeUnmount(() => { stopChatResize(); workspaceObserver?.disconnect(); });
const busy = ref(false);
const error = ref('');
const replacementMemberId = ref('');
const localMembers = computed(() => props.agents.filter(agent => agent.teamId === props.mission.teamId && !agent.remoteConnectionId));
const membershipUnavailable = computed(() => !!props.mission.execution && (!props.mission.execution.memberIds.length
  || props.mission.execution.memberIds.some(id => !localMembers.value.some(member => member.id === id))));
async function reassignMembers(): Promise<void> {
  if (!props.executeMission || !replacementMemberId.value) return;
  busy.value = true; error.value = '';
  try {
    const memberIds = [...new Set([...(props.mission.execution?.memberIds ?? []).filter(id => localMembers.value.some(member => member.id === id)), replacementMemberId.value])];
    await props.executeMission({ id: props.mission.id, revision: props.mission.revision, action: 'configure', teamId: props.mission.teamId, memberIds });
    replacementMemberId.value = '';
  } catch (cause) { error.value = String(cause); }
  finally { busy.value = false; }
}
const artifactError = ref('');
const feedbackBusy = ref(false);
const feedbackReset = ref(0);
const { selection: implementationSelection, backend: implementationBackend, model: implementationModel, reasoningEffort: implementationEffort, serviceTier: implementationTier } = useExecutionSelection();
const implementationStarting = ref(false);
const implementationStartRepositories = ref<string[]>([]);
const implementationStartTicketCount = ref(0);
const implementationOperation = computed<WorkspaceProvisioningOperation | null>(() => implementationStarting.value ? {
  mode: 'multiple',
  id: props.mission.id,
  state: 'running',
  repositories: implementationStartRepositories.value,
  ticketCount: implementationStartTicketCount.value,
  phase: props.implementationStartProgress?.missionId === props.mission.id
    ? props.implementationStartProgress.phase
    : undefined,
} : null);
watch(implementationOperation, (operation) => publishProvisioningOperation('mission', operation), { immediate: true });
onBeforeUnmount(() => publishProvisioningOperation('mission', null));
const viewedStageBinding = defineModel<MissionStage>('viewedStage');
const viewedStage = computed({
  get: () => viewedStageBinding.value ?? props.mission.stage,
  set: (stage: MissionStage) => { viewedStageBinding.value = stage; },
});
const canonicalArtifact = ref('');
let artifactRead = 0;
const activeRun = computed(() => pendingMissionRun(props.mission));
const initialRequirements = computed(() => props.mission.stage === 'requirements' && viewedStage.value === 'requirements'
  && !conversationAgentId.value && !props.mission.execution?.runs.length);
const activeStageRun = computed(() => {
  if (viewedStage.value !== props.mission.stage) return undefined;
  return props.mission.execution?.runs.slice().reverse().find(run => (
    run.stage === viewedStage.value
    && ['preparing', 'running'].includes(run.status)
  ));
});
const activeStageStatus = computed(() => {
  const run = activeStageRun.value;
  if (!run) return '';
  return run.status === 'running'
    ? t(`missions.stageActivity.${run.stage}`)
    : t(`missions.runStatus.${run.status}`);
});
const debugFixture = computed(() => props.mission.execution?.debugFixture === true);
const stageHeadingTitle = computed(() => (
  viewedStage.value === 'implementation'
    ? t('missions.implementation')
    : t(`missions.artifactTitle.${viewedStage.value}`)
));
const workflow = computed(() => missionWorkflow(props.mission.workflow.type));
const implementationReady = computed(() => workflow.value.stageReady('implementation', props.mission.artifacts)
  && !activeRun.value && !missionImplementationBusy(props.mission, props.agents));
const currentIndex = computed(() => workflow.value.stages.indexOf(props.mission.stage));
const codeAgentId = computed(() => props.mission.execution?.runs.slice().reverse().find(run => run.workerId)?.workerId);
const conversationAgentId = ref('');
watch(() => props.mission.stage, stage => {
  viewedStage.value = stage;
});
watch(
  [() => props.mission.id, () => viewedStage.value, () => props.mission.artifactFiles?.[viewedStage.value]?.revision],
  async ([missionId, stage, revision]) => {
    const request = ++artifactRead;
    canonicalArtifact.value = '';
    artifactError.value = '';
    if (!revision || !props.readMissionArtifact) return;
    try {
      const artifact = await props.readMissionArtifact(missionId, stage);
      if (request === artifactRead) canonicalArtifact.value = artifact.content;
    } catch (cause) {
      if (request === artifactRead) artifactError.value = cause instanceof Error ? cause.message : String(cause);
    }
  },
  { immediate: true },
);

function selectConversation(agentId: string): void {
  conversationAgentId.value = agentId;
}
function chatAboutReviewFinding(finding: MissionReviewFinding): void {
  const agentId = codeAgentId.value;
  if (!agentId) return;
  selectConversation(agentId);
  emit('chat-about-review-finding', { agentId, finding });
}

function stageState(stage: MissionStage): 'complete' | 'current' | 'upcoming' {
  const index = workflow.value.stages.indexOf(stage);
  if (index < currentIndex.value || props.mission.status === 'completed') return 'complete';
  return stage === props.mission.stage ? 'current' : 'upcoming';
}
const showStageLoading = computed(() => ['requirements', 'tickets'].includes(viewedStage.value)
  && Boolean(activeStageRun.value) && !artifactMarkdown.value && !activeRun.value?.proposal
  && !activeRun.value?.draftTickets?.length);
const artifactMarkdown = computed(() => canonicalArtifact.value || stageMarkdown(
  viewedStage.value,
  viewedStage.value === props.mission.stage && activeRun.value?.proposal
    ? activeRun.value.proposal
    : props.mission.artifacts,
));
const showAcceptedArtifactStatus = computed(() => (
  stageState(viewedStage.value) === 'complete'
  && !['implementation', 'ship'].includes(viewedStage.value)
  && Boolean(artifactMarkdown.value)
));
const visibleTickets = computed(() => {
  if (viewedStage.value !== 'tickets') return [];
  if (viewedStage.value === props.mission.stage && activeRun.value?.proposal) return activeRun.value.proposal.tickets;
  if (viewedStage.value === props.mission.stage && activeRun.value?.draftTickets?.length) return activeRun.value.draftTickets;
  return props.mission.artifacts.tickets;
});
const taskStatuses = ref<MissionTaskStatus[]>([]);
watch(() => props.mission.id, () => { taskStatuses.value = []; });
const filterTickets = computed(() => viewedStage.value === 'tickets' ? visibleTickets.value
  : viewedStage.value === 'implementation' ? props.mission.artifacts.tickets : []);
const filterItems = computed(() => implementationTicketItems(filterTickets.value, props.mission.execution?.runs ?? []));
const visibleTicketIndexes = computed(() => filterItems.value.filter(item => matchesMissionTaskFilters(item, filterTickets.value, taskStatuses.value)).map(item => item.index));
const stageHeadingMeta = computed(() => {
  if (viewedStage.value !== 'tickets') return '';
  if (viewedStage.value === props.mission.stage && activeRun.value?.draftTickets?.length && !activeRun.value.proposal) {
    return t('missions.draftTicketsHint', { count: activeRun.value.draftTickets.length });
  }
  return visibleTickets.value.length ? t('missions.ticketCount', { count: visibleTickets.value.length }) : '';
});
function stageMarkdown(stage: MissionStage, artifacts: MissionArtifacts): string {
  switch (stage) {
    case 'requirements': return artifacts.requirements.problem.trim() ? `## ${t('missions.problem')}\n\n${artifacts.requirements.problem}\n\n## ${t('missions.acceptance')}\n\n${artifacts.requirements.acceptance}` : '';
    case 'tickets': return artifacts.tickets.map((ticket, index) => [
      `## ${index + 1}. ${ticket.title}`,
      ticket.body?.trim() ?? '',
      ticket.reference ? `[${t('missions.canonicalReference')}](${ticket.reference})` : '',
      ticket.dependsOn?.length ? `${t('missions.blockedBy')}: ${ticket.dependsOn.map(blocker => blocker + 1).join(', ')}` : '',
    ].filter(Boolean).join('\n\n')).join('\n\n');
    case 'implementation': return artifacts.implementation.changes.trim() ? `## ${t('missions.changes')}\n\n${artifacts.implementation.changes}\n\n## ${t('missions.tests')}\n\n${artifacts.implementation.tests}` : '';
    case 'review': return artifacts.review.summary.trim() ? `## ${t('missions.reviewSummary')}\n\n${artifacts.review.summary}${artifacts.review.pullRequestUrl ? `\n\n[${t('missions.pullRequest')}](${artifacts.review.pullRequestUrl})` : ''}` : '';
    case 'ship': return '';
  }
}
const missionLead = computed(() => {
  const execution = props.mission.execution;
  const run = execution?.runs.slice().reverse().find(run => (run.stage === 'requirements' || run.stage === 'tickets') && run.workerId);
  return props.agents.find(agent => agent.id === (run?.workerId ?? execution?.memberIds[0]));
});
const implementationMode = ref<'lead' | 'perRepository' | 'multiplePerRepository'>('perRepository');
const leadExecutesImplementation = computed(() => implementationMode.value === 'lead');
const implementationApprovalVisible = ref(false);
function resetImplementationModel(): void {
  implementationMode.value = props.mission.execution?.implementationMode ?? (props.mission.execution?.parallelImplementation ? 'multiplePerRepository' : 'perRepository');
  const selected = props.mission.execution?.implementationModel;
  const lead = missionLead.value;
  implementationBackend.value = selected?.backend ?? lead?.backend;
  implementationModel.value = selected?.model ?? lead?.backendDefaults?.model ?? '';
  implementationEffort.value = selected?.reasoningEffort ?? lead?.backendDefaults?.reasoningEffort ?? '';
  // The selector drops a tier the model does not offer, so the lead's tier can only prefill what still applies.
  implementationTier.value = selected ? selected.serviceTier ?? '' : (lead?.backendDefaults && 'serviceTier' in lead.backendDefaults ? lead.backendDefaults.serviceTier : null) ?? '';
}
watch(() => `${props.mission.id}:${activeRun.value?.id}:${missionLead.value?.id ?? ''}`, resetImplementationModel, { immediate: true });
watch([() => props.mission.id, () => props.mission.revision, () => activeRun.value?.id, () => viewedStage.value], () => {
  implementationApprovalVisible.value = false;
});

function requestApproval(): void {
  if (props.mission.stage === 'tickets') {
    resetImplementationModel();
    error.value = '';
    implementationApprovalVisible.value = true;
  } else {
    void approveProposal();
  }
}

async function approveProposal(): Promise<void> {
  const run = activeRun.value;
  if (!run?.proposal || !props.executeMission) return;
  const startsImplementation = props.mission.stage === 'tickets';
  busy.value = true; error.value = '';
  if (startsImplementation) {
    implementationStartRepositories.value = [...new Set(visibleTickets.value.flatMap(ticket => (
      ticket.repositoryPath ? [ticket.repositoryPath] : []
    )))];
    implementationStartTicketCount.value = visibleTickets.value.length;
    implementationStarting.value = true;
  }
  try {
    await props.executeMission({ id: props.mission.id, revision: props.mission.revision, action: 'accept', runId: run.id,
      ...(startsImplementation ? { implementationMode: implementationMode.value, parallelImplementation: implementationMode.value === 'multiplePerRepository' } : {}),
      ...(startsImplementation && !leadExecutesImplementation.value && implementationBackend.value && implementationModel.value ? { implementationModel: { ...implementationSelection.value! } } : {}),
    });
    implementationApprovalVisible.value = false;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally {
    busy.value = false;
    implementationStarting.value = false;
  }
}
async function retryImplementationTicket(ticketIndex: number): Promise<void> {
  if (!props.executeMission) return;
  busy.value = true; error.value = '';
  try {
    await props.executeMission({ id: props.mission.id, revision: props.mission.revision, action: 'run', ticketIndex });
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
}
async function continueMission(): Promise<void> {
  if (!props.executeMission) return;
  busy.value = true; error.value = '';
  try { await props.executeMission({ id: props.mission.id, revision: props.mission.revision, action: 'run' }); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
}
async function continueToReview(): Promise<void> {
  if (!props.executeMission) return;
  busy.value = true; error.value = '';
  try { await props.executeMission({ id: props.mission.id, revision: props.mission.revision, action: 'continueToReview' }); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
}
async function stopRun(runId: string): Promise<void> {
  if (!props.executeMission) return;
  busy.value = true; error.value = '';
  try { await props.executeMission({ id: props.mission.id, revision: props.mission.revision, action: 'cancel', runId }); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
}
async function respondToRequirements(resolution: PlanReviewResolution, feedback?: string): Promise<void> {
  // Debug decisions resolve the local preview without starting a worker or advancing the Mission.
  if (debugFixture.value) return;
  const run = activeRun.value;
  if (!run || !props.executeMission) throw new Error(t('planFeedback.unavailable'));
  if (resolution === 'revise') {
    if (!props.sendMissionPrompt) throw new Error(t('planFeedback.unavailable'));
    await props.sendMissionPrompt(`${t('missions.requirementFeedbackPrompt')}\n\n${feedback}`);
  } else {
    await props.executeMission({ id: props.mission.id, revision: props.mission.revision, action: resolution === 'accept' ? 'accept' : 'cancel', runId: run.id });
  }
}
async function sendTicketComments(comments: MissionTicketComment[]): Promise<void> {
  if (!props.sendMissionPrompt || comments.length === 0) return;
  feedbackBusy.value = true; error.value = '';
  const details = comments.map((comment, index) => [
    `${index + 1}. ${t('missions.ticketCommentTarget', { number: comment.ticketNumber, title: comment.ticketTitle })}`,
    `   ${t('missions.commentQuote')}: "${comment.quote}"`,
    `   ${t('missions.commentBody')}: ${comment.body}`,
  ].join('\n')).join('\n\n');
  try {
    await props.sendMissionPrompt(`${t('missions.ticketFeedbackPrompt')}\n\n${details}`);
    feedbackReset.value += 1;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { feedbackBusy.value = false; }
}
</script>

<style scoped src="./MissionWorkspace.css"></style>
