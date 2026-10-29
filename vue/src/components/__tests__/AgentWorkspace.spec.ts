import type { Agent, AppCommand } from '@workspace/core/contracts';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { CodexConversationPaneController, CodexMessageImage, CodexMessageImageContext } from '@codex-app-sdk/vue';
import { reactive } from 'vue';
import { shallowMount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import AgentWorkspace from '../AgentWorkspace.vue';
import type { AgentRightWorkspaceState } from '../use-right-workspace-state';
import type { RightWorkspaceTab } from '../right-workspace';

function createWorkspaceState(): AgentRightWorkspaceState {
  return {
    activeTab: null,
    browserId: 'primary',
    browserInitialUrl: '',
    browserOpenRequestId: 0,
    browserVisualization: null,
    browserPanels: {},
    diffPanels: {},
    filePanels: {},
    filePreviewRequestIds: {},
    filesPaneOpen: false,
    filesPaneWidth: 280,
    gitReviewPanel: null,
    imagePanels: {},
    open: false,
    planPanel: null,
    tabs: [],
    width: 420,
  };
}

function mountWorkspace(configureSnapshot?: (snapshot: ReturnType<typeof createInitialSnapshot>) => void) {
  const snapshot = createInitialSnapshot();
  configureSnapshot?.(snapshot);
  const currentAgent = snapshot.agents[0] as Agent;
  const workspace = reactive(createWorkspaceState());
  const closeRightWorkspaceTab = vi.fn();
  const discardCodeReview = vi.fn().mockResolvedValue(snapshot);
  const openRightWorkspaceTab = vi.fn((tab: RightWorkspaceTab) => {
    workspace.activeTab = tab;
    workspace.tabs = workspace.tabs.includes(tab) ? workspace.tabs : [...workspace.tabs, tab];
    workspace.open = true;
  });
  const updateAgent = vi.fn().mockResolvedValue(undefined);
  const wrapper = shallowMount(AgentWorkspace, {
    attachTo: document.body,
    global: { stubs: { AgentHeader: false } },
    props: {
      activeAttachmentAnnotationCounts: {},
      addChatTextAnnotation: vi.fn(),
      addVisualizationAnnotation: vi.fn(),
      addCodeAnnotation: vi.fn(),
      agentFiles: [],
      agentSidebarCollapsed: false,
      chatTextAnnotations: [],
      visualizationAnnotations: [],
      codeAnnotations: [],
      closeRightWorkspaceTab,
      commitAgentGitChanges: vi.fn(),
      threadFlagBusy: false,
      conversationPaneController: {} as CodexConversationPaneController,
      savePromptDraft: vi.fn(),
      removePromptDraft: vi.fn(),
      conversationPlan: currentAgent.plan ?? null,
      respondToThreadFlag: vi.fn(),
      createAgentGitPullRequest: vi.fn(),
      currentAgent,
      currentAgentGitStatus: null,
      currentBackendRuntime: { backend: 'codex', status: 'running' },
      forwardPrompt: vi.fn(),
      generateAgentGitMessage: vi.fn(),
      generateVisualizationSuggestion: vi.fn(),
      startVisualize: vi.fn(),
      getAgentGitWorkflow: vi.fn(),
      handleStartWorkAction: vi.fn(),
      isAgentEmpty: false,
      isConversationLoading: false,
      historyLoadFailed: false,
      isLoading: false,
      isModalDialogVisible: false,
      isRightWorkspaceVisible: () => true,
      hasRunningPlanTool: false,
      hasVisibleMessages: false,
      latestConversationTurnId: null,
      mergeAgentGitBranch: vi.fn(),
      updateAgentGitBranchFromBase: vi.fn(),
      updateAgent,
      openAgentGitDiffPreview: vi.fn(),
      openAgentIn: vi.fn(),
      openAttachmentImageAnnotation: vi.fn(),
      removeChatTextAnnotation: vi.fn(),
      removeVisualizationAnnotation: vi.fn(),
      removeCodeAnnotation: vi.fn(),
      openConversationLink: vi.fn(),
      openFilePreviewForAgent: vi.fn(),
      openInApplications: { defaultApplication: 'finder', applications: [] },
      openRightWorkspaceTab,
      pushAgentGitBranch: vi.fn(),
      readConversationMessages: vi.fn(),
      readVisualizationAsset: vi.fn(),
      retryConversationHistory: vi.fn(),
      rightWorkspaceFor: () => workspace,
      rightWorkspaces: { [currentAgent.id]: workspace },
      rightWorkspaceVisible: false,
      selectAgentFromShell: vi.fn(),
      selectVisualization: vi.fn(),
      deleteVisualization: vi.fn(),
      selectRightWorkspaceTab: vi.fn(),
      snapshot,
      startRepositoryWork: vi.fn(),
      startRightWorkspaceResize: vi.fn(),
      toggleFileExplorer: vi.fn(),
      toggleRightWorkspace: vi.fn(),
      discardCodeReview,
    },
  });
  return {
    closeRightWorkspaceTab,
    currentAgent,
    discardCodeReview,
    openRightWorkspaceTab,
    updateAgent,
    workspace,
    wrapper,
  };
}

describe('AgentWorkspace', () => {
  it('opens a profile preview in the selected agent’s existing browser workspace', async () => {
    const { wrapper, workspace, currentAgent, openRightWorkspaceTab } = mountWorkspace();
    wrapper.getComponent({ name: 'AgentHeader' }).vm.$emit('run-preview', 'http://127.0.0.1:43210');
    await wrapper.vm.$nextTick();
    expect(workspace.browserInitialUrl).toBe('http://127.0.0.1:43210');
    expect(workspace.browserOpenRequestId).toBe(1);
    expect(openRightWorkspaceTab).toHaveBeenCalledExactlyOnceWith('browser', currentAgent.id);
  });

  it('hides hosted browser views while the profile dialog covers the workspace', async () => {
    const { wrapper } = mountWorkspace();
    const header = wrapper.getComponent({ name: 'AgentHeader' });
    header.vm.$emit('run-profiles-visible', true);
    await wrapper.vm.$nextTick();
    expect(wrapper.getComponent({ name: 'RightWorkspacePanel' }).props('visible')).toBe(false);
    header.vm.$emit('run-profiles-visible', false);
    await wrapper.vm.$nextTick();
    expect(wrapper.getComponent({ name: 'RightWorkspacePanel' }).props('visible')).toBe(true);
  });

  it('routes inspecting a transferred agent through shell selection', () => {
    const { wrapper } = mountWorkspace();
    wrapper.getComponent({ name: 'AgentHeader' }).vm.$emit('select-agent', 'transferred-agent');
    expect(wrapper.props('selectAgentFromShell')).toHaveBeenCalledExactlyOnceWith('transferred-agent');
    wrapper.unmount();
  });

  it('reserves chat space when the workspace shrinks and restores the preferred sidebar width when it grows', async () => {
    let onResize: ResizeObserverCallback = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { onResize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    try {
      const { wrapper, workspace } = mountWorkspace();
      await wrapper.setProps({ rightWorkspaceVisible: true });
      const body = wrapper.get('.app-shell__body').element;
      const bounds = vi.spyOn(body, 'getBoundingClientRect');
      const resize = async (width: number) => {
        bounds.mockReturnValue({ width } as DOMRect);
        onResize([{ target: body } as ResizeObserverEntry], {} as ResizeObserver);
        await wrapper.vm.$nextTick();
      };
      const panel = wrapper.get('.app-shell__right-workspace').element as HTMLElement;

      await resize(1200);
      expect(panel.style.flexBasis).toBe('420px');
      await resize(600);
      expect(panel.style.flexBasis).toBe('115px');
      await resize(400);
      expect(panel.style.flexBasis).toBe('0px');
      expect(workspace.width).toBe(420);
      await resize(1200);
      expect(panel.style.flexBasis).toBe('420px');
      wrapper.unmount();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('expands and restores the artifact pane while retaining mounted conversations and the split-layout restore control', async () => {
    const { wrapper, workspace } = mountWorkspace();
    expect(wrapper.find('[aria-label="Expand workspace"]').exists()).toBe(false);
    await wrapper.setProps({ rightWorkspaceVisible: true });
    const conversation = wrapper.get('.app-shell__conversations');
    const mountedConversation = wrapper.getComponent({ name: 'ConversationPane' });
    const expand = wrapper.get('[aria-label="Expand workspace"]');
    expect(expand.element.nextElementSibling?.hasAttribute('data-global-workspace-toggle')).toBe(true);
    await expand.trigger('click');
    expect(conversation.isVisible()).toBe(false);
    expect(wrapper.get('.app-shell__right-workspace').attributes('style')).toContain('flex-basis: 100%');
    expect(wrapper.find('.app-shell__right-workspace-resizer').exists()).toBe(false);
    await wrapper.setProps({ splitHeaders: true });
    await wrapper.get('[aria-label="Restore workspace width"]').trigger('click');
    expect(conversation.isVisible()).toBe(true);
    expect(wrapper.getComponent({ name: 'ConversationPane' }).vm).toBe(mountedConversation.vm);
    expect(wrapper.get('.app-shell__right-workspace').attributes('style')).toContain('flex-basis: 420px');
    expect(workspace.width).toBe(420);
    expect(wrapper.find('.app-shell__right-workspace-resizer').exists()).toBe(true);
    wrapper.unmount();
  });

  describe('task list panel', () => {
    const plan = (status: 'inProgress' | 'completed', turnId = 'turn-1') => ({
      threadId: 'thread-1', turnId, kind: 'execution' as const, status, explanation: '', markdown: '', updatedAt: '',
      steps: [{ step: 'First', status: status === 'completed' ? 'completed' as const : 'inProgress' as const }],
    });
    const planVisible = (wrapper: ReturnType<typeof mountWorkspace>['wrapper']) =>
      wrapper.findComponent({ name: 'ConversationPane' }).props('planVisible');

    it('stays open when the last task completes and goes away when the next turn starts', async () => {
      const { wrapper } = mountWorkspace();
      await wrapper.setProps({ conversationPlan: plan('inProgress'), latestConversationTurnId: 'turn-1' });
      expect(planVisible(wrapper)).toBe(true);
      await wrapper.setProps({ conversationPlan: plan('completed') });
      expect(planVisible(wrapper)).toBe(true);
      expect(wrapper.findComponent({ name: 'ConversationPane' }).props('plan')).not.toBeNull();
      await wrapper.setProps({ latestConversationTurnId: 'turn-2' });
      expect(wrapper.findComponent({ name: 'ConversationPane' }).props('plan')).toBeNull();
      wrapper.unmount();
    });

    it('treats a restored list with every step done as finished even if its stored status is stale', async () => {
      const { wrapper } = mountWorkspace();
      await wrapper.setProps({ conversationPlan: { ...plan('inProgress'), steps: [{ step: 'Only step', status: 'completed' }] } });
      expect(planVisible(wrapper)).toBe(false);
      wrapper.unmount();
    });

    it('starts closed when a finished list is restored, and opens again for a new list', async () => {
      const { wrapper } = mountWorkspace();
      await wrapper.setProps({ conversationPlan: plan('completed') });
      expect(planVisible(wrapper)).toBe(false);
      await wrapper.setProps({ conversationPlan: plan('inProgress', 'turn-2') });
      expect(planVisible(wrapper)).toBe(true);
      wrapper.unmount();
    });
  });

  it('persists the selected Git diff target on the active agent', async () => {
    const { currentAgent, updateAgent, wrapper } = mountWorkspace();

    wrapper.getComponent({ name: 'AgentHeader' }).vm.$emit('select-git-diff-target', { type: 'staged' });
    await wrapper.vm.$nextTick();

    expect(updateAgent).toHaveBeenCalledWith({
      id: currentAgent.id,
      gitDiffTarget: { type: 'staged' },
    });
  });

  it('discards review state before closing its workspace tab', async () => {
    const { closeRightWorkspaceTab, currentAgent, discardCodeReview, wrapper } = mountWorkspace((snapshot) => {
      snapshot.agents[0]!.codeReview = {
        id: 'review-1', targetAgentId: snapshot.agents[0]!.id, reviewerAgentId: snapshot.agents[0]!.id,
        scope: { type: 'uncommitted' }, threadMode: 'current', status: 'failed', activeRoundId: 'round-1',
        rounds: [{ id: 'round-1', number: 1, status: 'failed', findings: [], startedAt: 'now' }],
        createdAt: 'now', updatedAt: 'now',
      };
    });

    wrapper.getComponent({ name: 'RightWorkspacePanel' }).vm.$emit('close-tab', 'codeReview');
    await wrapper.vm.$nextTick();

    expect(discardCodeReview).toHaveBeenCalledWith(currentAgent.id, 'review-1');
    await vi.waitFor(() => expect(closeRightWorkspaceTab).toHaveBeenCalledWith(currentAgent.id, 'codeReview'));
    expect(discardCodeReview.mock.invocationCallOrder[0]).toBeLessThan(
      closeRightWorkspaceTab.mock.invocationCallOrder[0]!,
    );
  });

  it('resolves the delegating agent name for Git workflow report-back', () => {
    const { wrapper } = mountWorkspace((snapshot) => {
      const worker = snapshot.agents[0] as Agent;
      worker.delegatedByAgentId = 'agent-main';
      snapshot.agents.push({
        ...worker,
        id: 'agent-main',
        name: 'Main agent',
        delegatedByAgentId: undefined,
      });
    });

    expect(wrapper.findComponent({ name: 'AgentHeader' }).props('reportBackAgentName')).toBe('Main agent');
  });

  it('lets the SDK handle fullscreen images and opens inline images in the agent workspace', () => {
    const { currentAgent, openRightWorkspaceTab, workspace, wrapper } = mountWorkspace();
    const image: CodexMessageImage = {
      alt: 'Architecture diagram',
      kind: 'attachment',
      mimeType: 'image/png',
      name: 'diagram.png',
      path: '/repo/diagram.png',
      src: 'data:image/png;base64,aW1hZ2U=',
    };
    const context: CodexMessageImageContext = {
      intent: 'fullscreen',
      index: 2,
      message: { id: 'message-with-image', role: 'assistant', content: '' },
    };

    expect(wrapper.vm.openConversationImage(image, context)).toBe(false);
    expect(openRightWorkspaceTab).not.toHaveBeenCalled();

    expect(wrapper.vm.openConversationImage(image, { ...context, intent: 'open' })).toBe(true);
    expect(openRightWorkspaceTab).toHaveBeenCalledWith(expect.stringMatching(/^image:/), currentAgent.id);
    expect(Object.values(workspace.imagePanels)[0]).toMatchObject({
      path: '/repo/diagram.png',
      title: 'diagram.png',
    });
  });

  it('routes browser commands to the requested agent workspace', () => {
    const { currentAgent, openRightWorkspaceTab, workspace, wrapper } = mountWorkspace();
    const command: Extract<AppCommand, { type: 'open-browser' }> = {
      type: 'open-browser',
      agentId: currentAgent.id,
      browserId: 'docs',
      url: 'https://example.com',
    };

    wrapper.vm.handleBrowserOpenCommand(command);

    expect(workspace.browserId).toBe('docs');
    expect(workspace.browserInitialUrl).toBe('https://example.com');
    expect(openRightWorkspaceTab).toHaveBeenCalledWith('browser', currentAgent.id);
  });
});
