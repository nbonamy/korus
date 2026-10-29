<template>
  <WorkspaceHeader
    class="agent-header"
    :sidebar-collapsed="sidebarCollapsed"
  >
    <SidebarExpandButton
      v-if="sidebarCollapsed"
      class="agent-header__expand"
      :label="$t('surface.agentHeader.showAgentSidebar')"
      @click="emit('expand-sidebar')"
    />

    <div
      v-if="agent"
      class="agent-header__identity"
    >
      <AgentAvatar
        v-if="repositoryIcon"
        class="agent-header__avatar"
        :avatar="repositoryIcon"
        :name="displayName"
        shape="square"
        size="sm"
      />
      <div class="agent-header__agent-line">
        <strong class="workspace-header__title" :title="displayName">{{ displayName }}</strong>
        <div v-if="!agent.sharedConversation" class="agent-header__context">
          <span
            v-if="agentLocationLabel"
            class="agent-header__folder"
            :title="agent.folder ?? undefined"
          >
            {{ agentLocationLabel }}
          </span>
          <span
            class="agent-header__inline-dot"
            :data-status="agent.status.type"
            aria-hidden="true"
          />
          <span
            class="agent-header__inline-status"
            :title="agentStatusDetail ?? undefined"
          >
            {{ agentStatusDetail }}
          </span>
        </div>
        <div v-else class="agent-header__context" role="status">
          <span>{{ $t('guest.shared') }}<template v-if="guestStatus"> · {{ $t(`guest.status.${guestStatus}`) }}</template></span>
        </div>
      </div>
    </div>
    <div
      v-else
      class="agent-header__identity"
    >
      <strong class="workspace-header__title">{{ $t('surface.agentHeader.noAgent') }}</strong>
    </div>

    <div class="agent-header__activity">
      <AgentMoreMenu
        v-if="agent && !agent.sharedConversation"
        :agent-id="agent.id"
        :share-available="shareAvailable && !shareActive"
        @share="emit('share')"
      />
      <button
        v-if="agent && !agent.sharedConversation && shareAvailable && shareActive"
        class="app-button app-button--neutral agent-header__share"
        type="button"
        :aria-label="$t('sharing.share')"
        :title="$t('sharing.share')"
        @click="emit('share')"
      >
        <ShareIcon aria-hidden="true" />
      </button>
      <RunProfilesControl v-if="agent?.folder" :agent="agent" :host-label="runHostLabel ?? $t('runProfiles.localHost')" :preview-available="runPreviewAvailable ?? false" @preview="emit('run-preview', $event)" @visibility="emit('run-profiles-visible', $event)" />
      <GitDiffControl
        v-if="gitReviewAvailable && agent && gitStatus"
        class="agent-header__git-status"
        :agent-id="agent.id"
        :git-status="gitStatus"
        :last-turn-git-diff="lastTurnGitDiff"
        :selected-target="agent.gitDiffTarget"
        @open="(target, kind) => (kind ? emit('open-git-diff', target, kind) : emit('open-git-diff', target))"
        @select="emit('select-git-diff-target', $event)"
      />
      <GitWorkflowControl
        v-if="gitWorkflowAvailable && agent"
        ref="gitWorkflowControl"
        :agent="agent"
        :git-status="gitStatus"
        :get-workflow="getGitWorkflow"
        :generate-message="generateGitMessage"
        :commit-changes="commitGitChanges"
        :push-branch="pushGitBranch"
        :create-pull-request="createGitPullRequest"
        :merge-branch="mergeGitBranch"
        :update-from-base="updateGitBranchFromBase"
        :pull-branch="pullGitBranch"
        :revert-changes="revertGitChanges"
        :report-back-agent-name="reportBackAgentName"
        :report-back-agents="reportBackAgents"
        @open-git-log="emit('open-git-log')"
        @inspect-agent="emit('select-agent', $event)"
      />
      <OpenInControl
        class="agent-header__open-in"
        v-if="agent?.folder && openInAvailable && openInCatalog && openInCatalog.applications.length > 0"
        :application="effectiveOpenInApplication(agent, openInCatalog)"
        :catalog="openInCatalog"
        @open="emit('open-in', $event)"
      />
      <SubagentControl
        v-if="displaySubagentTree"
        :tree="displaySubagentTree"
        :selected-conversation-id="selectedSubagentConversationId"
        @select="emit('select-subagent', $event)"
      />
      <button
        v-if="executionPlanAvailable"
        class="agent-header__execution-plan"
        type="button"
        :aria-label="$t('surface.agentHeader.toggleExecutionPlan')"
        :title="$t('surface.agentHeader.toggleExecutionPlan')"
        :aria-pressed="executionPlanOpen"
        @click="emit('toggle-execution-plan')"
      >
        <ListIcon aria-hidden="true" />
      </button>
      <button
        v-if="workspaceOpen && workspaceToggleAvailable !== false"
        class="agent-header__workspace"
        type="button"
        :aria-label="$t(workspaceExpanded ? 'surface.agentHeader.restoreWorkspaceWidth' : 'surface.agentHeader.expandWorkspace')"
        :title="$t(workspaceExpanded ? 'surface.agentHeader.restoreWorkspaceWidth' : 'surface.agentHeader.expandWorkspace')"
        :aria-pressed="Boolean(workspaceExpanded)"
        :disabled="workspaceToggleDisabled ?? !agent"
        @click="emit('toggle-workspace-expanded')"
      >
        <ArrowsDiagonalMinimize2Icon v-if="workspaceExpanded" aria-hidden="true" />
        <ArrowsDiagonalIcon v-else aria-hidden="true" />
      </button>
      <button
        v-if="workspaceToggleAvailable !== false"
        class="agent-header__workspace"
        data-global-workspace-toggle
        type="button"
        :aria-label="$t('surface.agentHeader.toggleRightWorkspace')"
        :title="workspaceOpen ? $t('surface.agentHeader.closeRightWorkspace') : $t('surface.agentHeader.openRightWorkspace')"
        :aria-pressed="workspaceOpen"
        :disabled="workspaceToggleDisabled ?? !agent"
        @click="emit('toggle-workspace')"
      >
        <IconLayoutSidebarRight aria-hidden="true" />
      </button>
      <UpdateAvailableBadge
        v-if="updateStatus"
        :status="updateStatus"
        @install="emit('install-update')"
      />
      <button
        v-if="agent?.sharedConversation && guestStatus !== 'rejected' && guestStatus !== 'storageUnavailable'"
        class="app-button app-button--neutral agent-header__leave"
        type="button"
        :aria-label="$t('guest.leave')"
        :disabled="guestBusy"
        @click="emit('leave-shared-conversation')"
      >{{ $t('guest.leave') }}</button>
    </div>
  </WorkspaceHeader>
</template>

<script setup lang="ts">
import { translate } from '../i18n';
import { localizedText } from '../i18n/errors';
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { FileKind } from '@workspace/core/file-kind';
import type { Agent, AgentGitDiffTarget, AgentGitStatus, AgentSubagentTree, BackendRuntimeStatus, DesktopUpdateStatus, OpenInApplication, OpenInApplicationCatalog, TurnGitDiff } from '@workspace/core/contracts';
import { agentDisplayName } from '@workspace/core/agent-display';
import { conversationShareTarget } from '@workspace/core/conversation-sharing';
import type { GuestJoinStatus } from '@workspace/core/guest-navigation';
import { ArrowsDiagonalIcon, ArrowsDiagonalMinimize2Icon, ListIcon, ShareIcon } from '../shared/icons/app-icons';
import SidebarExpandButton from '../shared/SidebarExpandButton.vue';
import WorkspaceHeader from '../shared/WorkspaceHeader.vue';
import { IconLayoutSidebarRight } from '@tabler/icons-vue';
import AgentMoreMenu from './AgentMoreMenu.vue';
import AgentAvatar from './AgentAvatar.vue';
import UpdateAvailableBadge from './UpdateAvailableBadge.vue';
import OpenInControl from '../shared/OpenInControl.vue';
import SubagentControl from './SubagentControl.vue';
import GitWorkflowControl from './GitWorkflowControl.vue';
import GitDiffControl from './GitDiffControl.vue';
import RunProfilesControl from './RunProfilesControl.vue';
import { effectiveOpenInApplication } from '../shared/open-in';
import { appApi } from '../platform-api';
import { conversationShareActiveByAgentIdKey } from './conversation-share-state';

const props = withDefaults(defineProps<{
  runHostLabel?: string;
  runPreviewAvailable?: boolean;
  agent: Agent | null;
  guestStatus?: GuestJoinStatus | null;
  guestBusy?: boolean;
  shareAvailable?: boolean;
  shareStatusOnMount?: boolean;
  repositoryIcon?: string;
  gitStatus?: AgentGitStatus | null;
  lastTurnGitDiff?: TurnGitDiff | null;
  backendRuntime: BackendRuntimeStatus;
  workspaceOpen?: boolean;
  workspaceExpanded?: boolean;
  workspaceToggleAvailable?: boolean;
  workspaceToggleDisabled?: boolean;
  isLoading: boolean;
  sidebarCollapsed: boolean;
  updateStatus?: DesktopUpdateStatus;
  executionPlanAvailable?: boolean;
  executionPlanOpen?: boolean;
  openInAvailable?: boolean;
  openInCatalog?: OpenInApplicationCatalog;
  subagentTree?: AgentSubagentTree | null;
  selectedSubagentConversationId?: string | null;
  reportBackAgentName?: string | null;
  reportBackAgents?: { id: string; name: string }[];
  getGitWorkflow?: (agentId: string) => Promise<import('@workspace/core/contracts').AgentGitWorkflow>;
  generateGitMessage?: (agentId: string, input: import('@workspace/core/contracts').AgentGitMessageGenerationInput) => Promise<import('@workspace/core/contracts').AgentGitMessageGenerationResult>;
  commitGitChanges?: (agentId: string, input: import('@workspace/core/contracts').AgentGitCommitInput) => Promise<import('@workspace/core/contracts').AgentGitWorkflow>;
  pushGitBranch?: (agentId: string, input: import('@workspace/core/contracts').AgentGitPushInput) => Promise<import('@workspace/core/contracts').AgentGitWorkflow>;
  createGitPullRequest?: (agentId: string, input: import('@workspace/core/contracts').AgentGitPullRequestInput) => Promise<import('@workspace/core/contracts').AgentGitWorkflow>;
  mergeGitBranch?: (agentId: string, input: import('@workspace/core/contracts').AgentGitMergeInput) => Promise<import('@workspace/core/contracts').AgentGitWorkflow>;
  updateGitBranchFromBase?: (agentId: string, input: import('@workspace/core/contracts').AgentGitUpdateFromBaseInput) => Promise<import('@workspace/core/contracts').AgentGitUpdateFromBaseResult>;
  pullGitBranch?: (agentId: string, input: import('@workspace/core/contracts').AgentGitPullInput) => Promise<import('@workspace/core/contracts').AgentGitPullResult>;
  revertGitChanges?: (agentId: string, input: import('@workspace/core/contracts').AgentGitRevertInput) => Promise<import('@workspace/core/contracts').AgentGitWorkflow>;
}>(), { workspaceToggleAvailable: true, workspaceToggleDisabled: undefined, shareStatusOnMount: false });

const shareActiveByAgentId = inject(conversationShareActiveByAgentIdKey, null);
const localShareActive = ref(false);
const shareActive = computed(() => props.agent
  ? shareActiveByAgentId?.[props.agent.id] ?? localShareActive.value
  : false);
function shareTargetKey() {
  return props.agent && props.shareAvailable ? JSON.stringify(conversationShareTarget(props.agent)) : '';
}
let shareStatusGeneration = 0;
let unsubscribeShareState: (() => void) | undefined;
async function loadShareStatus() {
  const agent = props.agent;
  const target = agent && props.shareAvailable ? conversationShareTarget(agent) : null;
  const expected = ++shareStatusGeneration;
  if (!agent || !target || !appApi) return;
  try {
    const result = await appApi.conversationShareControl({ action: 'status', target });
    if (expected !== shareStatusGeneration || props.agent?.id !== agent.id) return;
    if (shareActiveByAgentId) shareActiveByAgentId[agent.id] = result.state.active;
    else localShareActive.value = result.state.active;
  } catch { /* A sharing status failure must not block the conversation header. */ }
}
watch(() => props.shareStatusOnMount ? shareTargetKey() : '', target => {
  if (target) void loadShareStatus();
}, { immediate: true });
onMounted(() => {
  unsubscribeShareState = appApi?.onEvent(event => {
    if (event.type !== 'conversation.shareChanged' || event.agentId !== props.agent?.id) return;
    if (shareActiveByAgentId) shareActiveByAgentId[event.agentId] = event.payload.active;
    else localShareActive.value = event.payload.active;
  });
});
onBeforeUnmount(() => { shareStatusGeneration++; unsubscribeShareState?.(); });

const emit = defineEmits<{
  'run-preview': [url: string];
  'run-profiles-visible': [visible: boolean];
  'expand-sidebar': [];
  'share': [];
  'leave-shared-conversation': [];
  'select-agent': [agentId: string];
  'toggle-workspace': [];
  'toggle-workspace-expanded': [];
  'toggle-execution-plan': [];
  'open-git-log': [];
  'open-git-diff': [target: AgentGitDiffTarget, focusKind?: FileKind];
  'select-git-diff-target': [target: AgentGitDiffTarget];
  'install-update': [];
  'open-in': [application: OpenInApplication];
  'select-subagent': [conversationId: string];
}>();

const gitWorkflowControl = ref<InstanceType<typeof GitWorkflowControl> | null>(null);

function showDebugGitOperationProgress(operation: 'pullRequest' | 'merge'): void | Promise<void> {
  return gitWorkflowControl.value?.showDebugOperationProgress(operation);
}

function getCommandActions() { return gitWorkflowControl.value?.getCommandActions() ?? []; }
defineExpose({ showDebugGitOperationProgress, getCommandActions });

const displayName = computed(() => props.agent ? agentDisplayName(props.agent) : '');

const displaySubagentTree = computed(() => {
  const tree = props.subagentTree;
  return tree && Object.values(tree.nodes).some((node) => node.conversationId !== tree.rootConversationId)
    ? tree
    : null;
});

const statusLabel = computed(() => {
  if (props.isLoading) {
    return translate('surface.agentHeader.loading');
  }

  if (props.backendRuntime.status === 'running') {
    return translate('surface.agentHeader.connected');
  }

  if (props.backendRuntime.status === 'error') {
    return `${backendLabel.value} error`;
  }

  return `${backendLabel.value} pending`;
});
const backendLabel = computed(() => (props.backendRuntime.backend === 'claude' ? translate('surface.agentHeader.claude') : translate('surface.agentHeader.codex')));
const agentLocationLabel = computed(() => {
  const agent = props.agent;
  const gitStatus = props.gitStatus;
  if (!agent) return '';

  const workspace = agent.workspace?.kind === 'git' ? agent.workspace : null;
  const availableGitStatus = gitStatus?.state !== 'unknown' ? gitStatus : null;
  const branch = availableGitStatus?.branch ?? workspace?.branch;
  if (!branch) return agent.folder ?? '';

  const repository = availableGitStatus?.repository ?? workspace?.repositoryName ?? availableGitStatus?.folder
    .replace(/[\\/]+$/u, '')
    .split(/[\\/]/u)
    .filter(Boolean)
    .at(-1);

  if (!repository) return agent.name?.trim() ? branch : '';
  return agent.name?.trim() ? `${branch} @ ${repository}` : `@ ${repository}`;
});
const agentStatusDetail = computed(() => {
  if (!props.agent) {
    return statusLabel.value;
  }

  if (props.agent.statusText) {
    return props.agent.statusText;
  }

  switch (props.agent.status.type) {
    case 'working':
      return localizedText(props.agent.status.detail, translate) ?? translate('status.working');
    case 'awaitingInput':
      return localizedText(props.agent.status.detail, translate) ?? translate('dynamic.misc.awaitingInput');
    case 'error':
      return localizedText(props.agent.status.message, translate);
    case 'idle':
      return translate('surface.agentHeader.readyToGetGoing');
  }
});

const gitWorkflowAvailable = computed(() => gitReviewAvailable.value || props.agent?.workspace?.kind === 'git');
const gitReviewAvailable = computed(() => {
  const gitStatus = props.gitStatus;
  return Boolean(gitStatus && gitStatus.state !== 'unknown');
});
</script>

<style scoped>
.agent-header {
  --agent-status-dot-size: 10px;
  container: agent-header / inline-size;
}

.agent-header.agent-header--pane {
  -webkit-app-region: no-drag;
}

.agent-header__identity {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: var(--space-6);
  min-width: 0;
}

.agent-header__agent-line {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.agent-header__agent-line > .workspace-header__title {
  flex: 0 0 auto;
  max-width: 100%;
}

.agent-header__context {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  gap: var(--space-6);
  min-width: 0;
  overflow: hidden;
}

.agent-header__folder,
.agent-header__inline-status {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-header__identity .agent-header__agent-line {
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-header__inline-dot {
  flex: 0 0 auto;
  width: var(--agent-status-dot-size);
  height: var(--agent-status-dot-size);
  border-radius: var(--radius-full);
  background: var(--color-outline);
}

.agent-header__inline-status {
  color: var(--color-text-muted);
}

.agent-header__activity {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-6);
  min-width: 0;
  color: var(--color-text-muted);
  text-align: right;
}

.agent-header__leave {
  white-space: nowrap;
  -webkit-app-region: no-drag;
}

.agent-header__share {
  -webkit-app-region: no-drag;
  width: 32px;
  height: 32px;
  padding: 0;
  color: var(--color-primary);
}

.agent-header__share :deep(svg) {
  width: var(--icon-md);
  height: var(--icon-md);
}

.agent-header__workspace {
  -webkit-app-region: no-drag;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  cursor: pointer;
}

.agent-header__execution-plan {
  -webkit-app-region: no-drag;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
}

.agent-header__execution-plan:hover,
.agent-header__execution-plan[aria-pressed="true"] {
  background: var(--color-surface-high);
  color: var(--color-text);
}

.agent-header__execution-plan :deep(svg) {
  width: var(--icon-md);
  height: var(--icon-md);
}

.agent-header__workspace:hover,
.agent-header__workspace[aria-pressed="true"] {
  background: var(--color-surface-high);
  color: var(--color-text);
}

.agent-header__workspace :deep(svg) {
  width: var(--icon-md);
  height: var(--icon-md);
}


/* Narrow split panes keep the same essential controls as phones. */
@container agent-header (max-width: 400px) {
  .agent-header__inline-status,
  .agent-header__git-status,
  .agent-header__open-in {
    display: none;
  }
}

/* Phones keep identity, the git workflow and the workspace toggle; the rest stays reachable from the workspace. */
@media (max-width: 768px) {
  .agent-header__inline-status,
  .agent-header__git-status,
  .agent-header__open-in {
    display: none;
  }
}
</style>
