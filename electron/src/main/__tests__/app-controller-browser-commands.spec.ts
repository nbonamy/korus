import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import { AppController, requiresSingleInstanceLock, shouldBlockDisplaySleep } from '../app-controller';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AddSshConnectionInput, AgentFilePreviewResult, AgentFileSearchItem, AppSnapshot, BackendConversationRef, BrowserAnnotation, BrowserState, ClientRequestResponse, CloneSourceRepositoryInput, CodexAuthentication, CodexChatGptLogin, ConversationSummary, CreateAgentInput, CreateAutomationInput, CreateQuickChatInput, CreateSourceWorktreeInput, CreateTeamInput, ClientState, DevicePairingSession, DevicePairingStatus, DuplicateAgentOptions, Automation, AutomationLocation, MainToRendererEvent, MoveAgentToTeamInput, PairedDevice, RendererMessage, RendererSendPromptOptions, RendererSnapshotState, ReorderAgentsInput, ReorderRepositoriesInput, ReorderTeamsInput, SetCodexResourceSharingInput, SourceFolderListInput, SourceRepository, SourceWorktree, SshHostCandidate, SystemPermissionsStatus, UpdateAgentInput, UpdateAutomationInput, UpdateRemoteConnectionInput, UpdateSettingsInput, UpdateTeamInput, WorkBacklogConfigurationInput, WorkItem, WorkProviderConnectResult, WorkProviderKind } from '@workspace/core/contracts';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { ipcChannels } from '@workspace/core/ipc';
import { createMission, type MissionStage } from '@workspace/core/missions';
import type { OpenInProvider } from '../open-in';
import { setMainWindowSend, createBackendClient } from './app-controller-test-harness';

describe('AppController', () => {

  it('routes the Debug message fixture to the active agent through daemon', async () => {
    const request = vi.fn().mockResolvedValue({ recipientId: 'agent-dina' });
    const controller = new AppController(createInitialSnapshot(), createBackendClient({ request }));
    const options = (controller as unknown as {
      debugMenuOptions(): { sendDebugAgentMessage(): void };
    }).debugMenuOptions();

    options.sendDebugAgentMessage();

    await vi.waitFor(() => expect(request).toHaveBeenCalledWith(
      backendMethods.debugAgentMessageSend,
      { agentId: 'agent-dina' },
    ));
  });

  it.each(['text', 'html'] as const)('routes the Debug %s plan fixture to its owning backend', async format => {
    const snapshot = createInitialSnapshot();
    const request = vi.fn().mockResolvedValue(snapshot);
    const controller = new AppController(snapshot, createBackendClient({ request }));
    const options = (controller as unknown as {
      debugMenuOptions(): { injectDebugPlanReview(format: 'text' | 'html'): void };
    }).debugMenuOptions();
    options.injectDebugPlanReview(format);
    await vi.waitFor(() => expect(request).toHaveBeenCalledExactlyOnceWith(
      backendMethods.debugPlanReadyForReviewInject, { agentId: 'agent-dina', format },
    ));
  });

  it('routes Mission stage fixtures for the Mission selected by the renderer', async () => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'Debug mission', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    const request = vi.fn().mockResolvedValue(snapshot);
    const controller = new AppController(snapshot, createBackendClient({ request }));
    (controller as unknown as { selectMission(missionId: string | null): void }).selectMission(mission.id);
    const options = (controller as unknown as {
      debugMenuOptions(): { getDebugMissionStage(): MissionStage | undefined; setDebugMissionStage(stage: MissionStage, reviewState?: 'identified' | 'remediated'): void };
    }).debugMenuOptions();

    expect(options.getDebugMissionStage()).toBe('requirements');
    options.setDebugMissionStage('implementation');
    options.setDebugMissionStage('review', 'remediated');

    await vi.waitFor(() => expect(request).toHaveBeenCalledWith(
      backendMethods.debugMissionStageSet,
      { missionId: mission.id, stage: 'implementation' },
    ));
    expect(request).toHaveBeenCalledWith(
      backendMethods.debugMissionStageSet,
      { missionId: mission.id, stage: 'review', reviewState: 'remediated' },
    );
  });

  it('routes Review fixtures through daemon and opens the real Review pane', async () => {
    const snapshot = createInitialSnapshot();
    const request = vi.fn().mockResolvedValue(snapshot);
    const controller = new AppController(snapshot, createBackendClient({ request }));
    const send = vi.fn();
    setMainWindowSend(controller, send);
    const options = (controller as unknown as {
      debugMenuOptions(): {
        injectDebugCodeReview(scenario: 'reviewing' | 'ready' | 'fixing'): void;
        setDebugThreadFlag(id: 'delegate_to_worktree' | 'ready_for_review', value: boolean): void;
      };
    }).debugMenuOptions();

    options.injectDebugCodeReview('fixing');
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith(
      backendMethods.debugCodeReviewSet,
      { agentId: 'agent-dina', scenario: 'fixing' },
    ));
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('app:command', {
      type: 'debug-open-code-review',
    }));

    options.setDebugThreadFlag('ready_for_review', true);
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith(
      backendMethods.debugThreadFlagSet,
      { agentId: 'agent-dina', id: 'ready_for_review', value: true },
    ));
  });

  it('populates Visualize through daemon and opens the real Visualize pane', async () => {
    const snapshot = createInitialSnapshot();
    const request = vi.fn().mockResolvedValue(snapshot);
    const controller = new AppController(snapshot, createBackendClient({ request }));
    const send = vi.fn();
    setMainWindowSend(controller, send);
    const options = (controller as unknown as {
      debugMenuOptions(): { populateDebugVisualize(scenario: 'complete' | 'suggestions'): void };
    }).debugMenuOptions();

    options.populateDebugVisualize('suggestions');

    await vi.waitFor(() => expect(request).toHaveBeenCalledWith(
      backendMethods.debugVisualizePopulate,
      { agentId: 'agent-dina', scenario: 'suggestions' },
    ));
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('app:command', {
      type: 'debug-open-visualize',
    }));
  });

  it('queues valid deep links until the renderer is ready, then focuses and dispatches them', () => {
    const controller = new AppController(createInitialSnapshot(), null);
    const send = vi.fn();
    const show = vi.fn();
    const focus = vi.fn();
    setDeepLinkWindow(controller, { send, show, focus });

    expect(controller.openDeepLink(`${product.protocolScheme}://new?prompt=Measure%20this`)).toBe(true);
    expect(controller.openDeepLink('https://example.com')).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();

    (controller as unknown as { rendererReady: boolean }).rendererReady = true;
    (controller as unknown as { flushPendingDeepLinkCommands(): void }).flushPendingDeepLinkCommands();

    expect(send).toHaveBeenCalledWith('app:command', {
      type: 'open-agent-composer',
      prompt: 'Measure this',
      submit: true,
    });
  });

  it('waits for the renderer browser pane to load a model-requested URL', async () => {
    const controller = new AppController(createInitialSnapshot(), null);
    const send = vi.fn();
    setMainWindowSend(controller, send);
    const state = {
      url: 'https://example.com/',
      title: 'Example',
      canGoBack: false,
      canGoForward: false,
    };

    const opened = requestBrowserOpen(controller, 'agent-dina', 'primary', 'https://example.com');

    expect(send).toHaveBeenCalledWith('app:command', {
      type: 'open-browser',
      agentId: 'agent-dina',
      browserId: 'primary',
      url: 'https://example.com',
    });
    resolvePendingBrowserOpen(controller, 'agent-dina', 'primary', 'https://example.com', state);
    await expect(opened).resolves.toStrictEqual(state);
  });

  it('does not complete a model-requested URL from the browser pane blank startup', async () => {
    const controller = new AppController(createInitialSnapshot(), null);
    setMainWindowSend(controller, vi.fn());
    const requestedUrl = 'http://127.0.0.1:4174/videos/visualize-film.html?t=25';
    const opened = requestBrowserOpen(controller, 'agent-dina', 'primary', requestedUrl);
    const blank: BrowserState = { url: 'about:blank', title: '', canGoBack: false, canGoForward: false };
    const loaded: BrowserState = { url: requestedUrl, title: 'Visualize and refine', canGoBack: false, canGoForward: false };
    const pane = (controller as unknown as { browserPane: { open: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn> } }).browserPane;
    vi.spyOn(pane, 'open').mockResolvedValue(blank);
    vi.spyOn(pane, 'navigate').mockResolvedValue(loaded);
    const settled = vi.fn();
    void opened.then(settled);

    await openBrowser(controller, 'agent-dina', 'primary', '');
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    await (controller as unknown as { browserNavigate(agentId: string, browserId: string, url: string): Promise<BrowserState> }).browserNavigate('agent-dina', 'primary', requestedUrl);
    await expect(opened).resolves.toStrictEqual(loaded);
  });

  it('scopes in-app browser files to the owning agent folder', async () => {
    const controller = new AppController(createInitialSnapshot(), null);
    setMainWindowSend(controller, vi.fn());
    const state: BrowserState = {
      url: 'file:///Users/nbonamy/src/agent-workspace/README.md',
      title: 'README.md',
      canGoBack: false,
      canGoForward: false,
    };
    const browserPane = (controller as unknown as {
      browserPane: { open: ReturnType<typeof vi.fn> };
    }).browserPane;
    const open = vi.spyOn(browserPane, 'open').mockResolvedValue(state);

    await expect(openBrowser(controller, 'agent-dina', 'primary', state.url)).resolves.toStrictEqual(state);
    expect(open).toHaveBeenCalledWith(
      expect.anything(),
      'agent-dina',
      'primary',
      state.url,
      '~/src/agent-workspace',
      42,
    );
  });

  it('opens visualization documents through the dedicated browser boundary', async () => {
    const controller = new AppController(createInitialSnapshot(), null);
    setMainWindowSend(controller, vi.fn());
    const state: BrowserState = {
      url: '',
      title: 'Backlog icon candidates',
      canGoBack: false,
      canGoForward: false,
    };
    const browserPane = (controller as unknown as {
      browserPane: { openVisualization: ReturnType<typeof vi.fn> };
    }).browserPane;
    const openVisualization = vi.spyOn(browserPane, 'openVisualization').mockResolvedValue(state);

    await expect(openBrowserVisualization(
      controller,
      'agent-dina',
      'primary',
      '/tmp/backlog-icon-candidates.html',
      'Backlog icon candidates',
    )).resolves.toStrictEqual(state);
    expect(openVisualization).toHaveBeenCalledWith(
      expect.anything(),
      'agent-dina',
      'primary',
      '/tmp/backlog-icon-candidates.html',
      'Backlog icon candidates',
      42,
    );
  });

  it('emits native browser annotations as client-scoped renderer events', () => {
    const controller = new AppController(createInitialSnapshot(), null);
    const send = vi.fn();
    const annotation: BrowserAnnotation = {
      id: 'annotation-one',
      agentId: 'agent-dina',
      browserId: 'primary',
      url: 'https://example.com/',
      kind: 'element',
      selector: '#save',
      comment: 'Keep this compact.',
      rect: { x: 30, y: 40, width: 100, height: 30 },
    };
    setMainWindowSend(controller, send);

    (controller as unknown as {
      emitBrowserAnnotation(annotation: BrowserAnnotation): void;
    }).emitBrowserAnnotation(annotation);

    expect(send).toHaveBeenCalledWith(ipcChannels.event, {
      seq: 1,
      source: 'client',
      type: 'browser.annotationCreated',
      payload: annotation,
      occurredAt: expect.any(String),
    });
  });

  it('tracks concurrent browser opens independently by agent and browser id', async () => {
    const controller = new AppController(createInitialSnapshot(), null);
    const send = vi.fn();
    setMainWindowSend(controller, send);
    const firstState = { url: 'https://one.example/', title: 'One', canGoBack: false, canGoForward: false };
    const secondState = { url: 'https://two.example/', title: 'Two', canGoBack: false, canGoForward: false };

    const first = requestBrowserOpen(controller, 'agent-dina', 'primary', 'https://one.example');
    const second = requestBrowserOpen(controller, 'agent-jesse', 'primary', 'https://two.example');
    resolvePendingBrowserOpen(controller, 'agent-jesse', 'primary', 'https://two.example', secondState);
    resolvePendingBrowserOpen(controller, 'agent-dina', 'primary', 'https://one.example', firstState);

    await expect(first).resolves.toStrictEqual(firstState);
    await expect(second).resolves.toStrictEqual(secondState);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

function setDeepLinkWindow(
  controller: AppController,
  callbacks: { send(...args: unknown[]): void; show(): void; focus(): void },
): void {
  (controller as unknown as {
    mainWindow: {
      isDestroyed(): boolean;
      isMinimized(): boolean;
      restore(): void;
      show(): void;
      focus(): void;
      webContents: { send(...args: unknown[]): void };
    };
  }).mainWindow = {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: callbacks.show,
    focus: callbacks.focus,
    webContents: { send: callbacks.send },
  };
}

function requestBrowserOpen(controller: AppController, agentId: string, browserId: string, url: string) {
  return (controller as unknown as {
    requestBrowserOpen(agentId: string, browserId: string, url: string): Promise<unknown>;
  }).requestBrowserOpen(agentId, browserId, url);
}

function openBrowser(controller: AppController, agentId: string, browserId: string, url: string): Promise<BrowserState> {
  return (controller as unknown as {
    browserOpen(agentId: string, browserId: string, url: string, guestWebContentsId: number): Promise<BrowserState>;
  }).browserOpen(agentId, browserId, url, 42);
}

function openBrowserVisualization(
  controller: AppController,
  agentId: string,
  browserId: string,
  filePath: string,
  title: string,
): Promise<BrowserState> {
  return (controller as unknown as {
    browserOpenVisualization(
      agentId: string,
      browserId: string,
      filePath: string,
      title: string,
      guestWebContentsId: number,
    ): Promise<BrowserState>;
  }).browserOpenVisualization(agentId, browserId, filePath, title, 42);
}

function resolvePendingBrowserOpen(controller: AppController, agentId: string, browserId: string, url: string, state: BrowserState): void {
  (controller as unknown as {
    resolvePendingBrowserOpen(agentId: string, browserId: string, url: string, state: BrowserState): void;
  }).resolvePendingBrowserOpen(agentId, browserId, url, state);
}
