<template>
  <aside class="right-workspace-panel" :aria-label="$t('surface.rightWorkspacePanel.rightWorkspace')">
    <WorkspaceLinkDropTarget v-if="linkDropActive" />
    <header class="right-workspace-panel__tabs">
      <div ref="tabStripRoot" class="right-workspace-panel__tab-strip">
        <button
          v-if="tabsOverflow"
          class="right-workspace-panel__tab-nav"
          type="button"
          :aria-label="$t('surface.rightWorkspacePanel.scrollTabsLeft')"
          :disabled="!canScrollTabsLeft"
          @click="scrollTabs(-1)"
        >
          <IconChevronLeft aria-hidden="true" />
        </button>
        <div
          ref="tabListRoot"
          class="right-workspace-panel__tab-list"
          role="tablist"
          :aria-label="$t('surface.rightWorkspacePanel.rightWorkspaceTabs')"
          @scroll="updateTabScrollState"
        >
          <div ref="tabTrackRoot" class="right-workspace-panel__tab-track">
            <div
              v-for="tab in tabs"
              :key="tab"
              class="right-workspace-panel__tab"
              :class="{ 'right-workspace-panel__tab--active': activeTab === tab }"
              @contextmenu="openTabContextMenu(tab, $event)"
            >
              <el-tooltip :content="tabLabel(tab)" placement="top" :show-after="800">
                <button
                  class="right-workspace-panel__tab-select"
                  type="button"
                  role="tab"
                  :aria-label="tabLabel(tab)"
                  :aria-selected="activeTab === tab"
                  @click="emit('selectTab', tab)"
                  @keydown="openTabContextMenuFromKeyboard(tab, $event)"
                >
                  <BacklogIcon v-if="tab === 'backlog'" aria-hidden="true" />
                  <IconChecklist v-if="tab === 'codeReview'" aria-hidden="true" />
                  <IconSitemap v-else-if="tab === 'visualize'" aria-hidden="true" />
                  <ClockHour8Icon v-else-if="tab === 'gitLog'" aria-hidden="true" />
                  <FileDiffIcon v-else-if="tab === 'review'" aria-hidden="true" />
                  <IconDeviceMobile v-else-if="tab === 'simulator'" aria-hidden="true" />
                  <IconWorld v-else-if="tab === 'browser' || isRightWorkspaceBrowserTab(tab)" aria-hidden="true" />
                  <FoldersIcon v-else-if="tab === 'files'" aria-hidden="true" />
                  <FileTextIcon v-else-if="tab === 'plan'" aria-hidden="true" />
                  <IconLego v-else-if="isRightWorkspaceSubagentTab(tab)" aria-hidden="true" />
                  <FileDiffIcon v-else-if="diffPanel(tab)" aria-hidden="true" />
                  <PhotoIcon v-else-if="imagePanel(tab)" aria-hidden="true" />
                  <FileTextIcon v-else-if="filePanel(tab)?.kind === 'markdown'" aria-hidden="true" />
                  <CodeIcon v-else aria-hidden="true" />
                  <span>{{ tabLabel(tab) }}</span>
                </button>
              </el-tooltip>
              <button
                v-if="isRightWorkspaceFileTab(tab) && filePanel(tab)?.documentId && saveDocument"
                class="right-workspace-panel__tab-save"
                type="button"
                :aria-label="$t('documents.saveTabAs', { title: tabLabel(tab) })"
                :title="$t('documents.saveAs')"
                :disabled="savingDocument"
                @click="saveTabDocument(tab)"
              >
                <DownloadIcon aria-hidden="true" />
              </button>
              <button
                class="right-workspace-panel__tab-close"
                type="button"
                :aria-label="$t('dynamic.files.closeTab', { tab: tabLabel(tab) })"
                @click="emit('closeTab', tab)"
              >
                <X aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
        <button
          v-if="tabsOverflow"
          class="right-workspace-panel__tab-nav"
          type="button"
          :aria-label="$t('surface.rightWorkspacePanel.scrollTabsRight')"
          :disabled="!canScrollTabsRight"
          @click="scrollTabs(1)"
        >
          <IconChevronRight aria-hidden="true" />
        </button>
      </div>

      <OpenInControl
        v-if="activeProjectFilePath && openInAvailable && openInCatalog && openInCatalog.applications.length > 0"
        :application="effectiveOpenInApplication(agent, openInCatalog)"
        :catalog="openInCatalog"
        variant="compact"
        @open="emit('openIn', { application: $event, filePath: activeProjectFilePath })"
      />

      <button
        v-if="fileExplorerToggleVisible"
        class="right-workspace-panel__files-toggle"
        type="button"
        :aria-label="filesPaneOpen ? $t('surface.rightWorkspacePanel.collapseFileExplorer') : $t('surface.rightWorkspacePanel.showFileExplorer')"
        :aria-pressed="filesPaneOpen"
        @click="emit('toggleFilesPane')"
      >
        <IconLayoutSidebarRightCollapse v-if="filesPaneOpen" aria-hidden="true" />
        <IconLayoutSidebarRightExpand v-else aria-hidden="true" />
      </button>

      <div ref="addMenuRoot" class="right-workspace-panel__add">
        <button
          type="button"
          :aria-label="$t('surface.rightWorkspacePanel.openRightWorkspaceTab')"
          :title="$t('surface.rightWorkspacePanel.newTab')"
          :aria-expanded="addMenuOpen"
          @click.stop="addMenuOpen = !addMenuOpen"
        >
          <PlusIcon aria-hidden="true" />
        </button>
        <AppMenu
          v-if="addMenuOpen"
          class="right-workspace-panel__add-menu"
          :ariaLabel="$t('surface.rightWorkspacePanel.openRightWorkspaceTab')"
          :items="addMenuItems"
          @select="openTabFromMenu"
        />
      </div>
    </header>

    <AppContextMenu
      v-if="tabContextMenu"
      :ariaLabel="$t('surface.rightWorkspacePanel.tabActions')"
      :items="tabContextMenuItems"
      :x="tabContextMenu.x"
      :y="tabContextMenu.y"
      @close="tabContextMenu = null"
      @select="selectTabContextMenuItem"
    />

    <div ref="bodyRoot" class="right-workspace-panel__body">
      <div class="right-workspace-panel__content">

        <nav
      v-if="tabs.length === 0"
      class="right-workspace-panel__launcher"
      :aria-label="$t('surface.rightWorkspacePanel.openAWorkspaceTab')"
    >
      <button type="button" @click="emit('openTab', 'codeReview')">
        <IconChecklist aria-hidden="true" />
        <span>{{ $t('surface.rightWorkspacePanel.review') }}</span>
      </button>
      <button type="button" @click="emit('openTab', 'visualize')">
        <IconSitemap aria-hidden="true" />
        <span>{{ $t('surface.rightWorkspacePanel.visualize') }}</span>
      </button>
      <button type="button" @click="emit('openTab', 'review')">
        <FileDiffIcon aria-hidden="true" />
        <span>{{ $t('surface.rightWorkspacePanel.changes') }}</span>
        <kbd>{{ workspaceShortcuts.changes }}</kbd>
      </button>
      <button v-if="simulatorAvailable" type="button" @click="emit('openTab', 'simulator')"><IconDeviceMobile aria-hidden="true" /><span>{{ $t('surface.mobileSimulator.tab') }}</span></button>
      <button v-if="browserAvailable" type="button" @click="emit('openTab', 'browser')">
        <IconWorld aria-hidden="true" />
        <span>{{ $t('surface.rightWorkspacePanel.browser') }}</span>
        <kbd>{{ workspaceShortcuts.browser }}</kbd>
      </button>
      <button type="button" @click="emit('openTab', 'files')">
        <FoldersIcon aria-hidden="true" />
        <span>{{ $t('surface.rightWorkspacePanel.files') }}</span>
      </button>
        </nav>

    <GitLogPanel
      v-if="tabs.includes('gitLog')"
      v-show="activeTab === 'gitLog'"
      :agent="agent"
      :branch="gitStatus?.branch ?? (agent.workspace?.kind === 'git' ? agent.workspace.branch : undefined)"
    />
    <GitReviewPanel
      v-if="tabs.includes('review')"
      v-show="activeTab === 'review'"
      :agent="agent"
      :git-status="gitStatus"
      :panel="gitPanel"
      @open-file="emit('previewFile', $event)"
      @refresh="emit('refreshGitDiff', gitPanel.target)"
    />

    <CodeReviewPanel
      v-if="tabs.includes('codeReview')"
      v-show="activeTab === 'codeReview'"
      :agent="agent"
      :git-status="gitStatus"
      :start-review="startCodeReview"
      v-model:instructions="codeReviewInstructions"
      :decide-finding="decideCodeReviewFinding"
      :submit-review-round="submitCodeReviewRound"
      :finish-review="finishCodeReview"
      :commit-review="commitCodeReview"
      :review-again="reviewCodeAgain"
      @clarify-finding="emit('clarifyFinding', $event)"
      @open-file="emit('previewFile', $event)"
    />

    <VisualizePanel
      v-if="tabs.includes('visualize') && agent.visualize"
      v-show="activeTab === 'visualize'"
      :busy="agent.status.type === 'working' || agent.status.type === 'awaitingInput'"
      :visualize="agent.visualize"
      :save-canvas="input => saveCanvas(agent.id, input)"
      :read-asset="visualizationId => readVisualizationAsset(agent.id, visualizationId)"
      @annotate="emit('annotateVisualization', $event)"
      @generate="generateVisualizationSuggestion(agent.id, { suggestionId: $event })"
      @select="selectVisualization(agent.id, { visualizationId: $event })"
      @delete="deleteVisualization(agent.id, { visualizationId: $event })"
    />

    <RepositoryBacklogPanel
      v-if="tabs.includes('backlog') && startRepositoryWork"
      v-show="activeTab === 'backlog'"
      :agent="agent"
      :agents="agents ?? []"
      :location="backlogLocation"
      :assignments="workAssignments"
      :branch="gitStatus?.branch"
      :repository-id="githubRepository ?? ''"
      :clear-assignment-action="clearRepositoryWorkAssignment"
      :close-agent-action="closeRepositoryWorkAgent"
      :show-agent-action="showRepositoryWorkAgent"
      :start-work-action="startRepositoryWork"
      :visible="visible && activeTab === 'backlog'"
    />

    <MobileSimulatorPanel v-if="simulatorAvailable && tabs.includes('simulator')" v-show="activeTab === 'simulator'" :agent-id="agent.id" :visible="activeTab === 'simulator' && visible" />
    <BrowserPanel
      v-if="browserAvailable && tabs.includes('browser')"
      :key="browserVisualization ? 'visualization' : 'browser'"
      v-show="activeTab === 'browser'"
      :agent-id="agent.id"
      :browser-id="browserId"
      :initial-url="browserInitialUrl"
      :open-request-id="browserOpenRequestId"
      :visualization="browserVisualization"
      :visible="visible && activeTab === 'browser'"
      @send-prompt="emit('sendPrompt', $event)"
      @url-change="updateBrowserUrl('browser', $event)"
    />

    <template v-if="browserAvailable">
      <BrowserPanel
        v-for="tab in browserTabs"
        :key="tab"
        v-show="activeTab === tab"
        :agent-id="agent.id"
        :browser-id="browserPanels[tab]!.browserId"
        :initial-url="browserPanels[tab]!.url"
        :visible="visible && activeTab === tab"
        @send-prompt="emit('sendPrompt', $event)"
        @url-change="updateBrowserUrl(tab, $event)"
      />
    </template>

        <div
          v-if="tabs.includes('files')"
          v-show="activeTab === 'files'"
          class="right-workspace-panel__open-file"
        >
          <span>{{ $t('surface.rightWorkspacePanel.selectAFileFromTheExplorer') }}</span>
          <button
            v-if="!fileExplorerVisible"
            class="app-button app-button--secondary"
            type="button"
            @click="emit('toggleFilesPane')"
          >
            {{ $t('surface.rightWorkspacePanel.browseFiles') }}
          </button>
        </div>

    <PlanReviewPanel
      v-if="tabs.includes('plan') && currentNativeReview"
      v-show="activeTab === 'plan'"
      :key="`${agent.id}:${currentNativeReview.id}`"
      :review="currentNativeReview"
      :interactive="interactivePlansEnabled !== false"
      :respond="planReviewResponder"
      :plan-updating="planUpdating"
    />
    <MarkdownPanel v-else-if="tabs.includes('plan') && planPanel" v-show="activeTab === 'plan'" :content="planPanel.content" :state="planPanel.state" :error="planPanel.error" @open-file="openMarkdownFile($event, planPanel)" />

    <template v-if="subagentTree && loadSubagentMessages">
      <SubagentPanel
        v-for="tab in subagentTabs"
        :key="tab"
        v-show="activeTab === tab"
        :agents="agents"
        :tree="subagentTree"
        :conversation-id="rightWorkspaceSubagentConversationId(tab)"
        :visible="visible && activeTab === tab"
        :load-messages="loadSubagentMessages"
        @open-link="emit('openLink', $event)"
      />
    </template>

    <div
      v-for="tab in fileTabs"
      :key="tab"
      v-show="activeTab === tab"
      class="right-workspace-panel__file-preview"
    >
      <MarkdownPanel
        v-if="markdownFilePanel(tab)"
        outline-enabled
        :content="markdownFilePanel(tab)?.content ?? ''"
        :error="markdownFilePanel(tab)?.error"
        :state="markdownFilePanel(tab)?.state"
        @open-file="openMarkdownFile($event, markdownFilePanel(tab))"
      />
      <SourcePreviewPanel
        v-else-if="sourceFilePanel(tab)"
        :content="sourceFilePanel(tab)?.content ?? ''"
        :error="sourceFilePanel(tab)?.error"
        :language="sourceFilePanel(tab)?.language"
        :state="sourceFilePanel(tab)?.state"
      />
    </div>

    <div
      v-for="tab in diffTabs"
      :key="tab"
      v-show="activeTab === tab"
      class="right-workspace-panel__file-preview"
    >
      <GitDiffPreviewPanel
        :diff="diffPanel(tab)?.diff ?? ''"
        :error="diffPanel(tab)?.error"
        :state="diffPanel(tab)?.state"
      />
    </div>

        <div
      v-for="tab in imageTabs"
      :key="tab"
      v-show="activeTab === tab"
      class="right-workspace-panel__file-preview"
    >
      <ImagePreviewPanel :panel="imagePanel(tab)!" />
        </div>
      </div>

      <Transition name="right-workspace-files">
        <div
          v-if="fileExplorerVisible"
          class="right-workspace-panel__files-shell"
          :style="{
            flexBasis: `${visualFilesPaneWidth}px`,
            width: `${visualFilesPaneWidth}px`,
          }"
        >
          <div
            class="right-workspace-panel__files-resizer"
            role="separator"
            :aria-label="$t('surface.rightWorkspacePanel.resizeFileExplorer')"
            aria-orientation="vertical"
            tabindex="0"
            @pointerdown="startFilesPaneResize"
            @keydown.left.prevent="resizeFilesPane(visualFilesPaneWidth + 16)"
            @keydown.right.prevent="resizeFilesPane(visualFilesPaneWidth - 16)"
          />
          <FileExplorerPanel
            class="right-workspace-panel__files-pane"
            :files="files ?? []"
            :loading="filesLoading"
            :error="filesError"
            @preview="emit('previewFile', $event)"
          />
        </div>
      </Transition>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { appApi } from '../platform-api';
import type { SaveCanvasInput } from '@workspace/core/visualize-canvas';
async function saveCanvas(agentId: string, input: SaveCanvasInput) {
  if (!appApi) throw new Error('Visualize is not available.');
  return appApi.saveVisualizationCanvas(agentId, input);
}
import { translate } from '../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { IconDeviceMobile, IconChecklist, IconChevronLeft, IconChevronRight, IconLayoutSidebarRightCollapse, IconLayoutSidebarRightExpand, IconLego, IconSitemap, IconWorld } from '@tabler/icons-vue';
import type { Agent, AgentFileSearchItem, AgentGitStatus, AgentSubagentTree, AppSnapshot, OpenInApplication, OpenInApplicationCatalog, RendererMessage, WorkBacklogAssignment, WorkItem } from '@workspace/core/contracts';
import type { CodexConversationLink, CodexConversationVisualization } from '@codex-app-sdk/vue';
import { ArrowUpRightIcon, ClockHour8Icon, BacklogIcon, CircleXIcon, CodeIcon, CopyIcon, DownloadIcon, FileDiffIcon, FileTextIcon, FoldersIcon, PhotoIcon, PlusIcon, X } from '../shared/icons/app-icons';
import AppContextMenu from '../shared/menu/AppContextMenu.vue';
import AppMenu from '../shared/menu/AppMenu.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import OpenInControl from '../shared/OpenInControl.vue';
import { effectiveOpenInApplication } from '../shared/open-in';
import BrowserPanel from './BrowserPanel.vue';
import MobileSimulatorPanel from './MobileSimulatorPanel.vue';

import WorkspaceLinkDropTarget from './WorkspaceLinkDropTarget.vue';
import { externalBrowserUrl, openInExternalBrowser } from './browser-external';
import CodeReviewPanel from './CodeReviewPanel.vue';
import VisualizePanel from './VisualizePanel.vue';
import FileExplorerPanel from './FileExplorerPanel.vue';
import GitDiffPreviewPanel from './GitDiffPreviewPanel.vue';
import GitReviewPanel from './GitReviewPanel.vue';
import GitLogPanel from './GitLogPanel.vue';
import ImagePreviewPanel from './ImagePreviewPanel.vue';
import MarkdownPanel from './MarkdownPanel.vue';
import { agentConversationId } from '@workspace/core/plan-review';
import PlanReviewPanel from './PlanReviewPanel.vue';
import RepositoryBacklogPanel from './RepositoryBacklogPanel.vue';
import SourcePreviewPanel from './SourcePreviewPanel.vue';
import SubagentPanel from './SubagentPanel.vue';
import type { SidePanelGitDiffState, SidePanelMarkdownState, SidePanelSourceState } from './side-panel';
import {
  isRightWorkspaceBrowserTab,
  type RightWorkspaceBrowserPanel,
  type RightWorkspaceBrowserTab,
  isRightWorkspaceDiffTab,
  isRightWorkspaceFileTab,
  isRightWorkspaceImageTab,
  isRightWorkspaceSubagentTab,
  rightWorkspaceSubagentConversationId,
  type RightWorkspaceDiffPanel,
  type RightWorkspaceDiffTab,
  type RightWorkspaceFilePanel,
  type RightWorkspaceFileTab,
  type RightWorkspaceImagePanel,
  type RightWorkspaceImageTab,
  type RightWorkspaceSubagentTab,
  type RightWorkspaceTab,
} from './right-workspace';

const workspaceShortcuts = { changes: '⌘G', browser: '⌘B' } as const;

const props = withDefaults(defineProps<{
  saveDocument?: (tab: RightWorkspaceFileTab) => Promise<void>;
  linkDropActive?: boolean;
  browserPanels?: Partial<Record<RightWorkspaceBrowserTab, RightWorkspaceBrowserPanel>>;
  activeTab: RightWorkspaceTab | null;
  agent: Agent;
  agents?: readonly Agent[];
  files?: AgentFileSearchItem[];
  filesLoading?: boolean;
  filesError?: string | null;
  filesPaneOpen?: boolean;
  filesPaneWidth?: number;
  gitPanel: SidePanelGitDiffState;
  gitStatus?: AgentGitStatus | null;
  planPanel?: SidePanelMarkdownState | null;
  planUpdating?: boolean;
  interactivePlansEnabled?: boolean;
  updatePlanReview?: (agentId: string, response: import('@workspace/core/plan-review').PlanReviewResponse) => Promise<import('@workspace/core/plan-review').PlanReview>;

  diffPanels?: Partial<Record<RightWorkspaceDiffTab, RightWorkspaceDiffPanel>>;
  filePanels?: Partial<Record<RightWorkspaceFileTab, RightWorkspaceFilePanel>>;
  imagePanels?: Partial<Record<RightWorkspaceImageTab, RightWorkspaceImagePanel>>;
  tabs: RightWorkspaceTab[];
  visible?: boolean;
  browserId?: string;
  browserInitialUrl?: string;
  browserOpenRequestId?: number;
  browserVisualization?: CodexConversationVisualization | null;
  browserAvailable?: boolean;
  openInAvailable?: boolean;
  openInCatalog?: OpenInApplicationCatalog;
  subagentTree?: AgentSubagentTree | null;
  loadSubagentMessages?: (conversationId: string) => Promise<RendererMessage[]>;
  backlogLocation?: import('@workspace/core/contracts').AutomationLocation;
  githubRepository?: string | null;
  workAssignments?: Record<string, WorkBacklogAssignment>;
  clearRepositoryWorkAssignment?: (item: WorkItem) => void;
  closeRepositoryWorkAgent?: (agentId: string) => void;
  showRepositoryWorkAgent?: (agentId: string) => void;
  startRepositoryWork?: (input: import('./right-workspace').RepositoryWorkStartInput) => Promise<void>;
  startCodeReview?: (agentId: string, input: import('@workspace/core/code-review').CodeReviewStartInput) => Promise<AppSnapshot>;
  decideCodeReviewFinding?: (agentId: string, input: import('@workspace/core/code-review').CodeReviewDecisionInput) => Promise<AppSnapshot>;
  submitCodeReviewRound?: (agentId: string, sessionId: string) => Promise<AppSnapshot>;
  finishCodeReview?: (agentId: string, sessionId: string) => Promise<AppSnapshot>;
  commitCodeReview?: (agentId: string, sessionId: string) => Promise<AppSnapshot>;
  reviewCodeAgain?: (agentId: string, sessionId: string) => Promise<AppSnapshot>;
  generateVisualizationSuggestion?: (agentId: string, input: import('@workspace/core/visualize').GenerateVisualizationSuggestionInput) => Promise<AppSnapshot>;
  selectVisualization?: (agentId: string, input: import('@workspace/core/visualize').SelectVisualizationInput) => Promise<AppSnapshot>;
  deleteVisualization?: (agentId: string, input: import('@workspace/core/visualize').DeleteVisualizationInput) => Promise<AppSnapshot>;
  readVisualizationAsset?: (agentId: string, visualizationId: string) => Promise<import('@workspace/core/visualize').VisualizationAsset>;
}>(), {
  browserPanels: () => ({}),
  filesPaneWidth: 280,
  githubRepository: null,
  workAssignments: () => ({}),
  startCodeReview: async () => { throw new Error('Code review is not available.'); },
  decideCodeReviewFinding: async () => { throw new Error('Code review is not available.'); },
  submitCodeReviewRound: async () => { throw new Error('Code review is not available.'); },
  finishCodeReview: async () => { throw new Error('Code review is not available.'); },
  commitCodeReview: async () => { throw new Error('Code review is not available.'); },
  reviewCodeAgain: async () => { throw new Error('Code review is not available.'); },
  generateVisualizationSuggestion: async () => { throw new Error('Visualize is not available.'); },
  selectVisualization: async () => { throw new Error('Visualize is not available.'); },
  deleteVisualization: async () => { throw new Error('Visualize is not available.'); },
  interactivePlansEnabled: true,
  readVisualizationAsset: async () => { throw new Error('Visualize is not available.'); },
});

const planReviewResponder = computed(() => {
  const agentId = props.agent.id;
  const respond = props.updatePlanReview;
  return respond ? (response: import('@workspace/core/plan-review').PlanReviewResponse) => respond(agentId, response) : undefined;
});
const currentNativeReview = computed(() => {
  const review = props.agent.planReview;
  return (review?.status === 'pending' || review?.status === 'revise') && review.conversationId === agentConversationId(props.agent) ? review : null;
});

const codeReviewInstructions = defineModel<string>('codeReviewInstructions', { default: '' });
const emit = defineEmits<{
  annotateVisualization: [annotation: import('./use-visualization-annotations').VisualizationAnnotationInput];
  browserUrlChange: [tab: 'browser' | RightWorkspaceBrowserTab, url: string];
  closeTab: [tab: RightWorkspaceTab];
  openTab: [tab: RightWorkspaceTab];
  openIn: [payload: { application: OpenInApplication; filePath: string }];
  openLink: [link: CodexConversationLink];
  refreshGitDiff: [target?: import('@workspace/core/contracts').AgentGitDiffTarget];
  clarifyFinding: [payload: {
    sessionId: string;
    roundId: string;
    finding: import('@workspace/core/code-review').CodeReviewFinding;
  }];
  selectTab: [tab: RightWorkspaceTab];
  sendPrompt: [prompt: string];
  previewFile: [path: string];
  toggleFilesPane: [];
  resizeFilesPane: [width: number];
}>();

const addMenuRoot = ref<HTMLElement | null>(null);
const bodyRoot = ref<HTMLElement | null>(null);
const tabStripRoot = ref<HTMLElement | null>(null);
const tabListRoot = ref<HTMLElement | null>(null);
const tabTrackRoot = ref<HTMLElement | null>(null);
const addMenuOpen = ref(false);
const tabContextMenu = ref<{ tab: RightWorkspaceTab; x: number; y: number } | null>(null);
const savingDocument = ref(false);
async function saveTabDocument(tab: RightWorkspaceFileTab): Promise<void> {
  if (!props.saveDocument || savingDocument.value) return;
  savingDocument.value = true;
  try { await props.saveDocument(tab); }
  catch (error) { ElMessage.error(String(error)); }
  finally { savingDocument.value = false; }
}
function updateBrowserUrl(tab: 'browser' | RightWorkspaceBrowserTab, url: string): void {
  if (tab === 'browser') browserUrl.value = url;
  else browserUrls.value[tab] = url;
  // BrowserPanel emits an empty initial state before the host opens its page.
  if (url && !(tab === 'browser' && props.browserVisualization)) emit('browserUrlChange', tab, url);
}
const browserUrl = ref('');
const browserUrls = ref<Partial<Record<RightWorkspaceBrowserTab, string>>>({});
const browserTabs = computed(() => props.tabs.filter(isRightWorkspaceBrowserTab).filter(tab => props.browserPanels[tab]));
const tabsOverflow = ref(false);
const canScrollTabsLeft = ref(false);
const canScrollTabsRight = ref(false);
let tabResizeObserver: ResizeObserver | null = null;
const visualFilesPaneWidth = ref(props.filesPaneWidth);
const fileTabs = computed(() => props.tabs.filter(isRightWorkspaceFileTab));
const diffTabs = computed(() => props.tabs.filter(isRightWorkspaceDiffTab));
const imageTabs = computed(() => props.tabs.filter(isRightWorkspaceImageTab));
const subagentTabs = computed<RightWorkspaceSubagentTab[]>(() => props.tabs.filter(isRightWorkspaceSubagentTab));
const fileExplorerToggleVisible = computed(() => (
  props.activeTab === 'files'
  || (props.activeTab !== null && isRightWorkspaceFileTab(props.activeTab))
));
const fileExplorerVisible = computed(() => props.filesPaneOpen && fileExplorerToggleVisible.value);
const activeProjectFilePath = computed(() => {
  if (!props.activeTab) return null;
  const filePath = (isRightWorkspaceFileTab(props.activeTab)
    ? filePanel(props.activeTab)?.subtitle
    : isRightWorkspaceImageTab(props.activeTab)
      ? imagePanel(props.activeTab)?.path
      : isRightWorkspaceDiffTab(props.activeTab)
        ? diffPanel(props.activeTab)?.subtitle
        : null)?.trim();
  if (!filePath || isAbsoluteFilePath(filePath)) return null;
  return filePath;
});
const simulatorAvailable = Boolean(appApi?.mobileSimulator);
const addMenuItems = computed<AppMenuItem[]>(() => [
  { id: 'codeReview', type: 'action', label: translate('surface.rightWorkspacePanel.review'), icon: IconChecklist },
  { id: 'visualize', type: 'action', label: translate('surface.rightWorkspacePanel.visualize'), icon: IconSitemap },
  { id: 'review', type: 'action', label: translate('surface.rightWorkspacePanel.changes'), icon: FileDiffIcon },
  ...(simulatorAvailable ? [{ id: 'simulator', type: 'action', label: translate('surface.mobileSimulator.tab'), icon: IconDeviceMobile } satisfies AppMenuItem] : []),
  ...(props.browserAvailable ? [{ id: 'browser', type: 'action', label: translate('surface.rightWorkspacePanel.browser'), icon: IconWorld } satisfies AppMenuItem] : []),
  { id: 'files', type: 'action', label: translate('surface.rightWorkspacePanel.files'), icon: FoldersIcon },
]);
const tabContextMenuItems = computed(() => tabContextMenu.value ? menuItemsForTab(tabContextMenu.value.tab) : []);

watch(() => props.tabs, (tabs) => {
  browserUrls.value = Object.fromEntries(Object.entries(browserUrls.value).filter(([tab]) => tabs.includes(tab as RightWorkspaceTab)));
  if (tabContextMenu.value && !tabs.includes(tabContextMenu.value.tab)) tabContextMenu.value = null;
  if (!tabs.includes('browser')) browserUrl.value = '';
  void nextTick(() => {
    updateTabScrollState();
    revealActiveTab();
  });
});

watch(() => [props.activeTab, props.visible], () => {
  void nextTick(() => {
    updateTabScrollState();
    revealActiveTab();
  });
});

watch(tabsOverflow, () => {
  void nextTick(updateTabScrollState);
});

watch(() => props.filesPaneWidth, (width) => {
  visualFilesPaneWidth.value = width;
});

onMounted(() => {
  document.addEventListener('click', closeAddMenuOnOutsideClick);
  window.addEventListener('resize', updateTabScrollState);
  if (typeof ResizeObserver !== 'undefined' && tabStripRoot.value && tabTrackRoot.value) {
    tabResizeObserver = new ResizeObserver(updateTabScrollState);
    tabResizeObserver.observe(tabStripRoot.value);
    tabResizeObserver.observe(tabTrackRoot.value);
  }
  void nextTick(() => {
    updateTabScrollState();
    revealActiveTab();
  });
});
onBeforeUnmount(() => {
  document.removeEventListener('click', closeAddMenuOnOutsideClick);
  window.removeEventListener('resize', updateTabScrollState);
  tabResizeObserver?.disconnect();
  stopFilesPaneResize();
});

function updateTabScrollState(): void {
  const strip = tabStripRoot.value;
  const list = tabListRoot.value;
  const track = tabTrackRoot.value;
  if (!strip || !list || !track) return;
  tabsOverflow.value = track.scrollWidth > strip.clientWidth + 1;
  canScrollTabsLeft.value = list.scrollLeft > 1;
  canScrollTabsRight.value = list.scrollLeft + list.clientWidth < list.scrollWidth - 1;
}

function scrollTabs(direction: -1 | 1): void {
  const list = tabListRoot.value;
  if (!list) return;
  const maxScroll = Math.max(0, list.scrollWidth - list.clientWidth);
  const step = Math.max(40, list.clientWidth - 48);
  list.scrollLeft = Math.max(0, Math.min(maxScroll, list.scrollLeft + direction * step));
  updateTabScrollState();
}

function revealActiveTab(): void {
  const list = tabListRoot.value;
  const track = tabTrackRoot.value;
  const index = props.tabs.findIndex((tab) => tab === props.activeTab);
  const tab = index >= 0 ? track?.children[index] : null;
  if (!list || !(tab instanceof HTMLElement)) return;
  const viewport = list.getBoundingClientRect();
  const bounds = tab.getBoundingClientRect();
  if (bounds.left < viewport.left) list.scrollLeft -= viewport.left - bounds.left;
  else if (bounds.right > viewport.right) list.scrollLeft += bounds.right - viewport.right;
  updateTabScrollState();
}

function startFilesPaneResize(event: PointerEvent): void {
  event.preventDefault();
  document.addEventListener('pointermove', handleFilesPaneResize);
  document.addEventListener('pointerup', stopFilesPaneResize, { once: true });
}

function handleFilesPaneResize(event: PointerEvent): void {
  const body = bodyRoot.value;
  if (!body) return;
  resizeFilesPane(body.getBoundingClientRect().right - event.clientX);
}

function resizeFilesPane(width: number): void {
  const bodyWidth = bodyRoot.value?.getBoundingClientRect().width ?? 420;
  const nextWidth = Math.round(Math.min(Math.max(width, 180), Math.max(180, bodyWidth - 160)));
  visualFilesPaneWidth.value = nextWidth;
  emit('resizeFilesPane', nextWidth);
}

function stopFilesPaneResize(): void {
  document.removeEventListener('pointermove', handleFilesPaneResize);
}

function tabLabel(tab: RightWorkspaceTab): string {
  if (tab === 'gitLog') return translate('gitLog.title');
  if (tab === 'simulator') return translate('surface.mobileSimulator.tab');
  if (tab === 'backlog') return translate('surface.rightWorkspacePanel.backlog');
  if (tab === 'codeReview') return translate('surface.rightWorkspacePanel.review');
  if (tab === 'visualize') return translate('surface.rightWorkspacePanel.visualize');
  if (tab === 'review') return translate('surface.rightWorkspacePanel.changes');
  if (tab === 'browser') return props.browserVisualization?.title || 'Browser';
  if (isRightWorkspaceBrowserTab(tab)) return props.browserPanels[tab]?.title ?? 'Browser';
  if (tab === 'files') return translate('surface.rightWorkspacePanel.openFile');
  if (tab === 'plan') return props.planPanel?.title ?? 'Plan';
  if (isRightWorkspaceSubagentTab(tab)) {
    const node = props.subagentTree?.nodes[rightWorkspaceSubagentConversationId(tab)];
    return node?.agentNickname?.trim()
      || node?.agentPath?.split('/').filter(Boolean).at(-1)?.trim()
      || 'Subagent';
  }
  if (diffPanel(tab)) return diffPanel(tab)?.title ?? 'Diff';
  if (imagePanel(tab)) return imagePanel(tab)?.title ?? 'Image';
  return filePanel(tab)?.title ?? 'File';
}

function diffPanel(tab: RightWorkspaceTab): RightWorkspaceDiffPanel | undefined {
  return isRightWorkspaceDiffTab(tab) ? props.diffPanels?.[tab] : undefined;
}

function filePanel(tab: RightWorkspaceTab): RightWorkspaceFilePanel | undefined {
  return isRightWorkspaceFileTab(tab) ? props.filePanels?.[tab] : undefined;
}

function menuItemsForTab(tab: RightWorkspaceTab): AppMenuItem[] {
  const specificItems: AppMenuItem[] = [
    ...((tab === 'browser' && !props.browserVisualization) || isRightWorkspaceBrowserTab(tab)
      ? [
        { id: 'copy-url', type: 'action', label: translate('surface.rightWorkspacePanel.copyUrl'), icon: CopyIcon, disabled: !urlForTab(tab) } satisfies AppMenuItem,
        { id: 'open-external', type: 'action', label: translate('surface.browserPanel.openInExternalBrowser'), icon: ArrowUpRightIcon, disabled: !externalBrowserUrl(urlForTab(tab)) } satisfies AppMenuItem,
      ] : []),
    ...(absoluteFilePathForTab(tab)
      ? [{ id: 'copy-path', type: 'action', label: translate('surface.rightWorkspacePanel.copyPath'), icon: CopyIcon } satisfies AppMenuItem]
      : []),
    ...(relativeFilePathForTab(tab)
      ? [{ id: 'copy-relative-path', type: 'action', label: translate('surface.rightWorkspacePanel.copyRelativePath'), icon: CopyIcon } satisfies AppMenuItem]
      : []),
  ];
  return [
    ...specificItems,
    ...(specificItems.length ? [{ id: 'tab-actions-divider', type: 'separator' } satisfies AppMenuItem] : []),
    { id: 'close-tab', type: 'action', label: translate('surface.rightWorkspacePanel.closeTab'), icon: X },
    {
      id: 'close-other-tabs',
      type: 'action',
      label: translate('surface.rightWorkspacePanel.closeOtherTabs'),
      icon: CircleXIcon,
      disabled: props.tabs.length <= 1,
    },
  ];
}

function openTabContextMenu(tab: RightWorkspaceTab, event: MouseEvent): void {
  event.preventDefault();
  addMenuOpen.value = false;
  tabContextMenu.value = { tab, x: event.clientX, y: event.clientY };
}

function openTabContextMenuFromKeyboard(tab: RightWorkspaceTab, event: KeyboardEvent): void {
  if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
  event.preventDefault();
  const bounds = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
  addMenuOpen.value = false;
  tabContextMenu.value = { tab, x: bounds?.left ?? 0, y: bounds?.bottom ?? 0 };
}

async function selectTabContextMenuItem(itemId: string): Promise<void> {
  const tab = tabContextMenu.value?.tab;
  tabContextMenu.value = null;
  if (!tab) return;
  if (itemId === 'close-tab') {
    emit('closeTab', tab);
    return;
  }
  if (itemId === 'close-other-tabs') {
    emit('selectTab', tab);
    for (const otherTab of props.tabs) {
      if (otherTab !== tab) emit('closeTab', otherTab);
    }
    return;
  }
  if ((tab === 'browser' || isRightWorkspaceBrowserTab(tab)) && itemId === 'open-external') {
    try {
      await openInExternalBrowser(urlForTab(tab));
    } catch {
      ElMessage.error(translate('surface.browserPanel.openExternalFailed'));
    }
    return;
  }
  if ((tab === 'browser' || isRightWorkspaceBrowserTab(tab)) && itemId === 'copy-url') {
    if (!urlForTab(tab)) return;
    try {
      await navigator.clipboard.writeText(urlForTab(tab));
    } catch {
      ElMessage.error(translate('surface.rightWorkspacePanel.copyUrlFailed'));
    }
    return;
  }
  const path = itemId === 'copy-path'
    ? absoluteFilePathForTab(tab)
    : itemId === 'copy-relative-path'
      ? relativeFilePathForTab(tab)
      : null;
  if (!path) return;
  try {
    await navigator.clipboard.writeText(path);
  } catch {
    ElMessage.error(translate('surface.rightWorkspacePanel.copyPathFailed'));
  }
}

function absoluteFilePathForTab(tab: RightWorkspaceTab): string | null {
  const filePath = filePanel(tab)?.subtitle?.trim();
  if (!filePath) return null;
  if (isAbsoluteFilePath(filePath)) return filePath;
  const folder = (props.agent.folder ?? '').trim().replace(/[\\/]+$/u, '');
  if (!isAbsoluteFilePath(folder)) return null;
  const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  return `${folder}${separator}${filePath.replace(/\\/gu, '/').replace(/^(?:\.\/)+/u, '').replace(/\//gu, separator)}`;
}

function relativeFilePathForTab(tab: RightWorkspaceTab): string | null {
  const filePath = filePanel(tab)?.subtitle?.trim();
  if (!filePath) return null;
  if (!isAbsoluteFilePath(filePath)) return filePath;
  const folder = (props.agent.folder ?? '').trim().replace(/[\\/]+$/u, '').replace(/\\/gu, '/');
  if (!isAbsoluteFilePath(folder)) return null;
  const normalizedPath = filePath.replace(/\\/gu, '/');
  return normalizedPath.startsWith(`${folder}/`) ? normalizedPath.slice(folder.length + 1) : null;
}

function imagePanel(tab: RightWorkspaceTab): RightWorkspaceImagePanel | undefined {
  return isRightWorkspaceImageTab(tab) ? props.imagePanels?.[tab] : undefined;
}

function openMarkdownFile(href: string, panel: SidePanelMarkdownState | null): void {
  // Resolve on the agent's host, never against the renderer's own page URL.
  const folder = (props.agent.folder ?? '/').replace(/\\/gu, '/').replace(/\/?$/u, '/');
  const folderUrl = new URL(folder, 'file:///');
  const documentPath = panel?.savedPath ?? panel?.path ?? panel?.subtitle;
  try {
    const base = documentPath ? new URL(documentPath.replace(/\\/gu, '/'), folderUrl) : folderUrl;
    const target = new URL(href, base);
    if (target.protocol !== 'file:') return;
    const path = decodeURIComponent(target.pathname);
    emit('openLink', { kind: 'file', href, path });
  } catch {
    // Malformed links must never navigate the application window.
  }
}

function markdownFilePanel(tab: RightWorkspaceFileTab): SidePanelMarkdownState | null {
  const panel = filePanel(tab);
  return panel?.kind === 'markdown' ? panel : null;
}

function sourceFilePanel(tab: RightWorkspaceFileTab): SidePanelSourceState | null {
  const panel = filePanel(tab);
  return panel?.kind === 'source' ? panel : null;
}

function openTabFromMenu(tab: string): void {
  addMenuOpen.value = false;
  if ((tab === 'simulator' && simulatorAvailable) || tab === 'backlog' || tab === 'codeReview' || tab === 'visualize' || tab === 'review' || tab === 'files' || (tab === 'browser' && props.browserAvailable)) {
    emit('openTab', tab);
  }
}

function closeAddMenuOnOutsideClick(event: MouseEvent): void {
  if (!addMenuRoot.value?.contains(event.target as Node)) {
    addMenuOpen.value = false;
  }
}

function isAbsoluteFilePath(filePath: string): boolean {
  return filePath.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(filePath);
}

function urlForTab(tab: RightWorkspaceTab): string {
  return isRightWorkspaceBrowserTab(tab)
    ? browserUrls.value[tab] ?? props.browserPanels[tab]?.url ?? ''
    : browserUrl.value;
}
</script>

<style scoped>
.right-workspace-panel {
  position: relative;
  flex: 0 0 420px;
  order: 2;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-shell-main);
}

.right-workspace-panel__tabs {
  flex: 0 0 40px;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-shell-main);
}

.right-workspace-panel__tab-strip {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.right-workspace-panel__tab-list {
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.right-workspace-panel__tab-list::-webkit-scrollbar {
  display: none;
}

.right-workspace-panel__tab-track {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.right-workspace-panel__tab-nav {
  flex: 0 0 var(--space-12);
  display: grid;
  place-items: center;
  width: var(--space-12);
  height: var(--space-12);
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.right-workspace-panel__tab-nav svg {
  width: var(--icon-md);
  height: var(--icon-md);
}

.right-workspace-panel__tab-nav:hover:not(:disabled) {
  color: var(--color-text);
  background: var(--color-surface-high);
}

.right-workspace-panel__tab-nav:disabled {
  opacity: 0.4;
  cursor: default;
}

.right-workspace-panel__tab {
  flex: 0 1 176px;
  min-width: 40px;
  max-width: 176px;
  display: flex;
  align-items: center;
  container-type: inline-size;
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
  background: transparent;
}

.right-workspace-panel__tab--active {
  color: var(--color-text);
  background: var(--color-surface-low);
}

.right-workspace-panel__tab-select,
.right-workspace-panel__tab-save,
.right-workspace-panel__tab-close,
.right-workspace-panel__files-toggle,
.right-workspace-panel__add > button {
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.right-workspace-panel__tab-select {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--space-16);
  padding: 0 var(--space-4);
  font-size: var(--font-size-13);
}

.right-workspace-panel__tab-select span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.right-workspace-panel__tab-select svg,
.right-workspace-panel__tab-save svg,
.right-workspace-panel__tab-close svg,
.right-workspace-panel__files-toggle svg,
.right-workspace-panel__add svg {
  flex: 0 0 auto;
  width: var(--icon-md);
  height: var(--icon-md);
}

.right-workspace-panel__tab-save,
.right-workspace-panel__tab-close {
  flex: 0 0 var(--space-12);
  display: grid;
  place-items: center;
  width: var(--space-12);
  height: var(--space-12);
  margin-right: var(--space-2);
  padding: 0;
  border-radius: var(--radius-full);
}

.right-workspace-panel__tab-save {
  display: none;
  margin-right: 0;
}

.right-workspace-panel__tab:hover .right-workspace-panel__tab-save,
.right-workspace-panel__tab:focus-within .right-workspace-panel__tab-save {
  display: grid;
}

.right-workspace-panel__tab-save:disabled {
  cursor: default;
}

@container (max-width: 72px) {
  .right-workspace-panel__tab-select {
    justify-content: center;
    gap: 0;
    padding: 0;
  }

  .right-workspace-panel__tab-select span {
    display: none;
  }

  .right-workspace-panel__tab-close {
    margin-right: 0;
  }
}

@container (max-width: 48px) {
  .right-workspace-panel__tab-save,
  .right-workspace-panel__tab-close {
    display: none;
  }
}

.right-workspace-panel__tab-save:hover:not(:disabled),
.right-workspace-panel__tab-close:hover,
.right-workspace-panel__files-toggle:hover,
.right-workspace-panel__add > button:hover,
.right-workspace-panel__add > button[aria-expanded="true"] {
  color: var(--color-text);
  background: var(--color-surface-high);
}

.right-workspace-panel__files-toggle {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: var(--space-16);
  height: var(--space-16);
  padding: 0;
  border: 0;
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.right-workspace-panel__files-toggle[aria-pressed="true"] {
  color: var(--color-text);
  background: var(--color-surface-low);
}

.right-workspace-panel__add {
  position: relative;
  flex: 0 0 auto;
}

.right-workspace-panel__add > button {
  display: grid;
  place-items: center;
  width: var(--space-16);
  height: var(--space-16);
  padding: 0;
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
}

.right-workspace-panel__add-menu {
  position: absolute;
  z-index: 20;
  top: calc(100% + var(--space-3));
  right: 0;
}

.right-workspace-panel__launcher {
  width: min(100%, 360px);
  display: grid;
  gap: var(--space-6);
  margin: auto;
  padding: var(--space-12);
}

.right-workspace-panel__body {
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
}

.right-workspace-panel__content {
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
}

.right-workspace-panel__files-shell {
  min-width: 0;
  max-width: calc(100% - 160px);
  flex: 0 0 auto;
  display: flex;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}

.right-workspace-panel__files-pane {
  min-width: 0;
  flex: 1 1 auto;
}

.right-workspace-files-enter-active,
.right-workspace-files-leave-active {
  transition:
    flex-basis 180ms ease,
    width 180ms ease,
    max-width 180ms ease,
    opacity 140ms ease,
    transform 180ms ease;
}

.right-workspace-files-enter-from,
.right-workspace-files-leave-to {
  flex-basis: 0 !important;
  width: 0 !important;
  min-width: 0;
  max-width: 0;
  opacity: 0;
  transform: translateX(8px);
}

@media (prefers-reduced-motion: reduce) {
  .right-workspace-files-enter-active,
  .right-workspace-files-leave-active {
    transition-duration: 1ms;
  }
}

.right-workspace-panel__files-resizer {
  position: relative;
  z-index: 1;
  flex: 0 0 5px;
  margin-left: 0px;
  border-left: 0.75px solid var(--color-border);
  cursor: col-resize;
}

.right-workspace-panel__files-resizer:hover,
.right-workspace-panel__files-resizer:focus-visible {
  border-left-color: var(--color-primary);
  outline: 0;
}

.right-workspace-panel__open-file {
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-6);
  padding: var(--space-8);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
}

.right-workspace-panel__launcher > button {
  min-width: 0;
  display: grid;
  grid-template-columns: var(--icon-lg) minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-6) var(--space-8);
  border: 0;
  border-radius: var(--radius-lg);
  color: var(--color-text);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.right-workspace-panel__launcher > button:hover,
.right-workspace-panel__launcher > button:focus-visible {
  background: var(--color-surface-low);
}

.right-workspace-panel__launcher svg {
  width: var(--icon-lg);
  height: var(--icon-lg);
  color: var(--color-text-muted);
}

.right-workspace-panel__launcher span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-16);
}

.right-workspace-panel__launcher kbd {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: var(--color-surface-low);
  font-family: var(--font-family-base);
  font-size: var(--font-size-12);
  line-height: var(--line-height-16);
}

.right-workspace-panel__file-preview {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
}
</style>
