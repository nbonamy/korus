import { PRIMARY_BROWSER_ID } from '@workspace/core/contracts';
import type { CodexConversationVisualization } from '@codex-app-sdk/vue';
import { computed, onScopeDispose, reactive, ref, watch, watchEffect } from 'vue';
import type { SidePanelGitDiffState, SidePanelImageState, SidePanelMarkdownState } from './side-panel';
import {
  isRightWorkspaceBrowserTab,
  type RightWorkspaceBrowserPanel,
  type RightWorkspaceBrowserTab,
  isRightWorkspaceDiffTab,
  isRightWorkspaceFileTab,
  isRightWorkspaceImageTab,
  type RightWorkspaceDiffPanel,
  type RightWorkspaceDiffTab,
  type RightWorkspaceFilePanel,
  type RightWorkspaceFileTab,
  type RightWorkspaceImageTab,
  type RightWorkspaceTab,
} from './right-workspace';

export type AgentRightWorkspaceState = {
  activeTab: RightWorkspaceTab | null;
  codeReviewInstructions?: string;
  browserId: string;
  browserInitialUrl: string;
  browserOpenRequestId: number;
  browserVisualization: CodexConversationVisualization | null;
  browserPanels: Partial<Record<RightWorkspaceBrowserTab, RightWorkspaceBrowserPanel>>;
  filePanels: Partial<Record<RightWorkspaceFileTab, RightWorkspaceFilePanel>>;
  filesPaneOpen: boolean;
  filesPaneWidth: number;
  filePreviewRequestIds: Partial<Record<RightWorkspaceFileTab, number>>;
  diffPanels: Partial<Record<RightWorkspaceDiffTab, RightWorkspaceDiffPanel>>;
  gitReviewPanel: SidePanelGitDiffState | null;
  imagePanels: Partial<Record<RightWorkspaceImageTab, SidePanelImageState>>;
  planPanel: SidePanelMarkdownState | null;
  open: boolean;
  expanded?: boolean;
  tabs: RightWorkspaceTab[];
  width: number;
};

export function constrainedRightWorkspaceWidth(preferredWidth: number, bodyWidth: number): number {
  // Reserve the chat minimum and the divider before allocating sidebar space.
  return Math.min(Math.max(preferredWidth, 240), Math.max(0, bodyWidth - 480 - 5));
}

export function useRightWorkspaceState(options: {
  currentAgentId: () => string | undefined;
  sharedVisibilityGroupId?: () => string | undefined;
  workspaceBody: () => HTMLElement | null;
}) {
  const workspaces = reactive<Record<string, AgentRightWorkspaceState>>({});
  // Workspace state survives navigation away from AgentWorkspace. Its image
  // tabs own these URLs independently of both transcript and pane lifetimes.
  const imageTabUrls = new Set<string>();
  watchEffect(() => {
    const sources = new Set(Object.values(workspaces).flatMap(workspace => Object.values(workspace.imagePanels).map(panel => panel?.src)).filter((src): src is string => Boolean(src?.startsWith('blob:'))));
    for (const url of imageTabUrls) if (!sources.has(url)) { URL.revokeObjectURL(url); imageTabUrls.delete(url); }
    for (const url of sources) imageTabUrls.add(url);
  });
  onScopeDispose(() => {
    for (const url of imageTabUrls) URL.revokeObjectURL(url);
    imageTabUrls.clear();
    // Invalidate pending reads as well as releasing completed images.
    for (const workspace of Object.values(workspaces)) workspace.imagePanels = {};
  });
  const resizing = ref(false);
  let stopActiveResize: (() => void) | null = null;
  const visible = computed(() => {
    const agentId = options.currentAgentId();
    return Boolean(agentId && workspaceFor(agentId).open);
  });

  watch(
    [options.currentAgentId, () => options.sharedVisibilityGroupId?.()],
    ([agentId, groupId], [previousAgentId, previousGroupId]) => {
      if (groupId && groupId === previousGroupId && agentId && previousAgentId && agentId !== previousAgentId) {
        workspaceFor(agentId).open = workspaceFor(previousAgentId).open;
      }
    },
  );

  function workspaceFor(agentId: string): AgentRightWorkspaceState {
    const existing = workspaces[agentId];
    if (existing) return existing;
    const created: AgentRightWorkspaceState = {
      activeTab: null,
      browserId: PRIMARY_BROWSER_ID,
      browserInitialUrl: '',
      browserOpenRequestId: 0,
      browserVisualization: null,
      browserPanels: {},
      filePanels: {},
      filesPaneOpen: false,
      filesPaneWidth: 280,
      filePreviewRequestIds: {},
      diffPanels: {},
      gitReviewPanel: null,
      imagePanels: {},
      planPanel: null,
      open: false,
      tabs: [],
      width: 420,
    };
    workspaces[agentId] = created;
    return created;
  }

  function isVisible(agentId: string): boolean {
    return options.currentAgentId() === agentId && workspaceFor(agentId).open;
  }

  function toggle(): void {
    const agentId = options.currentAgentId();
    if (!agentId) return;
    const workspace = workspaceFor(agentId);
    workspace.open = !visible.value;
  }

  function openTab(tab: RightWorkspaceTab, agentId = options.currentAgentId()): void {
    if (!agentId) return;
    const workspace = workspaceFor(agentId);
    if (!workspace.tabs.includes(tab)) workspace.tabs = [...workspace.tabs, tab];
    workspace.activeTab = tab;
    workspace.open = true;
  }

  function selectTab(agentId: string, tab: RightWorkspaceTab): void {
    const workspace = workspaceFor(agentId);
    if (workspace.tabs.includes(tab)) workspace.activeTab = tab;
  }

  function closeTab(agentId: string, tab: RightWorkspaceTab): void {
    const workspace = workspaceFor(agentId);
    const tabIndex = workspace.tabs.indexOf(tab);
    if (tabIndex === -1) return;
    const nextTabs = workspace.tabs.filter((candidate) => candidate !== tab);
    workspace.tabs = nextTabs;
    if (tab === 'review') workspace.gitReviewPanel = null;
    if (tab === 'codeReview') delete workspace.codeReviewInstructions;
    if (tab === 'plan') workspace.planPanel = null;
    if (tab === 'files') workspace.filesPaneOpen = false;
    if (isRightWorkspaceBrowserTab(tab)) {
      const { [tab]: _closedPanel, ...browserPanels } = workspace.browserPanels;
      workspace.browserPanels = browserPanels;
    }
    if (isRightWorkspaceFileTab(tab)) {
      const { [tab]: _closedPanel, ...filePanels } = workspace.filePanels;
      const { [tab]: _closedRequest, ...requestIds } = workspace.filePreviewRequestIds;
      workspace.filePanels = filePanels;
      workspace.filePreviewRequestIds = requestIds;
    }
    if (isRightWorkspaceDiffTab(tab)) {
      const { [tab]: _closedPanel, ...diffPanels } = workspace.diffPanels;
      workspace.diffPanels = diffPanels;
    }
    if (isRightWorkspaceImageTab(tab)) {
      const { [tab]: _closedPanel, ...imagePanels } = workspace.imagePanels;
      workspace.imagePanels = imagePanels;
    }
    if (workspace.activeTab === tab) {
      workspace.activeTab = nextTabs[Math.min(tabIndex, nextTabs.length - 1)] ?? null;
    }
    if (nextTabs.length === 0) {
      workspace.activeTab = null;
      workspace.open = false;
    }
  }

  function toggleFiles(agentId: string): void {
    const workspace = workspaceFor(agentId);
    workspace.filesPaneOpen = !workspace.filesPaneOpen;
  }

  function startResize(event: PointerEvent): void {
    event.preventDefault();
    const body = options.workspaceBody();
    const agentId = options.currentAgentId();
    if (!body || !agentId) return;
    stopActiveResize?.();
    resizing.value = true;
    const updateWidth = (moveEvent: PointerEvent) => {
      const bounds = body.getBoundingClientRect();
      workspaceFor(agentId).width = constrainedRightWorkspaceWidth(bounds.right - moveEvent.clientX, bounds.width);
    };
    const stop = () => {
      window.removeEventListener('pointermove', updateWidth);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
      resizing.value = false;
      stopActiveResize = null;
    };
    stopActiveResize = stop;
    window.addEventListener('pointermove', updateWidth);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
    window.addEventListener('blur', stop, { once: true });
  }

  onScopeDispose(() => stopActiveResize?.());

  return {
    closeTab,
    isVisible,
    openTab,
    resizing,
    rightWorkspaceVisible: visible,
    selectTab,
    startResize,
    toggle,
    toggleFiles,
    workspaceFor,
    workspaces,
  };
}
