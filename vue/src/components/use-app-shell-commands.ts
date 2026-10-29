import { matchesShellShortcut } from '@workspace/core/keyboard-shortcuts';
import { product } from '@workspace/core/product';
import type {
  Agent,
  AppCommand,
  BackendApprovalRequest,
  RemoteConnection,
  SidePanelMarkdownRequest,
  Team,
} from '@workspace/core/contracts';
import { getCodexNativeRendererApi, type CodexComposerState, type CodexNativeAttachment } from '@codex-app-sdk/vue';
import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import { ElMessage } from 'element-plus';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { translate } from '../i18n';
import { appApi, appHostCapabilities } from '../platform-api';
import { useConfetti } from '../shared/confetti/use-confetti';
import { confirmCloseTeam } from './team-close-confirmation';
import { imageDataUrlArrayBuffer } from './image-annotation';
import type { RightWorkspaceTab } from './right-workspace';

type DebugApproval = {
  agentId: string;
  request: BackendApprovalRequest;
};

type AppShellCommandOptions = {
  state: {
    activeTeam: () => Team | null;
    activeTeamAgents: () => Agent[];
    quickSwitchAgentIds: () => string[];
    agents: () => Agent[];
    attachmentsEnabled: () => boolean;
    composerAttachments: () => readonly CodexNativeAttachment[];
    currentAgent: () => Agent | null;
    canReplaceConversation?: () => boolean;
    isAgentWorkspaceVisible: () => boolean;
    isModalDialogVisible: () => boolean;
    showOnboardingGate: () => boolean;
    teams: () => Team[];
  };
  actions: {
    closeAgent: (agentId: string) => void;
    compactSession: (agentId: string) => void;
    replaceConversationWithSummary: (agentId: string) => void;
    closeTeam: (teamId: string) => void;
    debugMarkUnread: () => void;
    setDebugMissingEngines: (enabled: boolean) => void;
    setDebugProviderUpgrades: (enabled: boolean) => void;
    setDebugReviewUncommitted: (enabled: boolean) => void;
    duplicateAgent: (agentId: string) => void;
    editAgent: (agentId: string) => void;
    forkAgent: (agentId: string) => void;
    handoffAgent?: (agentId: string) => void;
    focusComposer: () => void;
    newTeam: () => void;
    openAgentSurface: () => void;
    openAgentPalette: () => void;
    openSavedPromptDrafts: () => void;
    openBrowser: (command: Extract<AppCommand, { type: 'open-browser' }>) => void;
    openDebugImageAnnotation: (imageDataUrl?: string, pixelRatio?: 1 | 2) => void | Promise<void>;
    openDebugOperationProgress: (
      kind: Extract<AppCommand, { type: 'debug-operation-progress' }>['kind'],
    ) => void | Promise<void>;
    openFileQuick: () => void;
    openGitReview: () => void | Promise<void>;
    openMarkdown: (request: SidePanelMarkdownRequest) => void;
    openRightWorkspaceTab: (tab: RightWorkspaceTab, agentId?: string) => void;
    closeRightWorkspaceTab: (tab: RightWorkspaceTab, agentId: string) => void;
    openSettings: () => void;
    openWhatsNew: () => void;
    openKeyboardShortcuts: () => void;
    openCommandPalette: () => void;
    quit: () => void | Promise<void>;
    restartAgent: (agentId: string) => void;
    resumeSession: (agentId: string) => void;
    savePromptDraft: () => void;
    selectAgent: (agentId: string) => void;
    selectTeam: (teamId: string) => void;
    sendAgentPrompt: (agentId: string, prompt: string) => void;
    setDebugApproval: (approval: DebugApproval | null) => void;
    showDebugUserQuestions: (agentId: string) => void;
    toggleSpokenAnnouncementsMuted: () => void;
    updateComposerAttachments: (agentId: string, attachments: readonly CodexNativeAttachment[]) => void;
    updateComposerState: (agentId: string, state: CodexComposerState) => void;
  };
};

export function useAppShellCommands(options: AppShellCommandOptions) {
  const currentAgent = computed(options.state.currentAgent);
  const activeTeam = computed(options.state.activeTeam);
  const activeTeamAgents = computed(options.state.activeTeamAgents);
  const showOnboardingGate = computed(options.state.showOnboardingGate);
  const isModalDialogVisible = computed(options.state.isModalDialogVisible);
  const isAgentWorkspaceVisible = computed(options.state.isAgentWorkspaceVisible);
  const quickAgentShortcutsVisible = ref(false);
  let quickAgentShortcutTimer: ReturnType<typeof setTimeout> | null = null;
  let commandKeyHeld = false;
  const quickAgentShortcutDelayMs = 350;
  let unsubscribeAppCommand: (() => void) | null = null;

  function handleShellShortcut(event: KeyboardEvent): void {
    const input = { key: event.key, code: event.code, meta: event.metaKey, control: event.ctrlKey, shift: event.shiftKey, alt: event.altKey };
    if (matchesShellShortcut('help', input) || matchesShellShortcut('commands', input)) {
      if (event.repeat) return;
      if (isModalDialogVisible.value || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"][aria-modal="true"]'))) return;
      event.preventDefault();
      if (matchesShellShortcut('commands', input)) options.actions.openCommandPalette();
      else options.actions.openKeyboardShortcuts();
      return;
    }
    if (matchesShellShortcut('mute', input)) {
      event.preventDefault();
      options.actions.toggleSpokenAnnouncementsMuted();
      return;
    }
    if (showOnboardingGate.value) {
      return;
    }
    if (isModalDialogVisible.value) {
      return;
    }

    if (
      matchesShellShortcut('palette', input)
    ) {
      event.preventDefault();
      resetQuickAgentShortcuts();
      options.actions.openAgentPalette();
      return;
    }

    if (!isAgentWorkspaceVisible.value) return;

    if (event.key === 'Meta') {
      startQuickAgentShortcutReveal(event);
      return;
    }

    if (event.metaKey) {
      resetQuickAgentShortcuts();
    }

    if (
      matchesShellShortcut('files', input) &&
      currentAgent.value
    ) {
      event.preventDefault();
      options.actions.openFileQuick();
      return;
    }

    if (matchesShellShortcut(`agent${event.key}`, input)) {
      const agentId = options.state.quickSwitchAgentIds()[Number(event.key) - 1];
      if (agentId) {
        event.preventDefault();
        options.actions.selectAgent(agentId);
      }
      return;
    }

    if (
      matchesShellShortcut('review', input) &&
      currentAgent.value
    ) {
      event.preventDefault();
      void options.actions.openGitReview();
      return;
    }

    if (
      matchesShellShortcut('browser', input) &&
      currentAgent.value
    ) {
      if (!appHostCapabilities.embeddedBrowser) return;
      event.preventDefault();
      options.actions.openRightWorkspaceTab('browser');
      return;
    }

    if (matchesShellShortcut('duplicate', input)) {
      duplicateActiveAgent(event);
      return;
    }

    if (matchesShellShortcut('restart', input)) {
      event.preventDefault();
      restartActiveAgent();
      return;
    }

    if (matchesShellShortcut('closeAgent', input)) {
      closeActiveAgent(event);
      return;
    }

    if (
      matchesShellShortcut('nextTeam', input)
    ) {
      if (cycleTeams()) {
        event.preventDefault();
      }
      return;
    }

    if (matchesShellShortcut(event.shiftKey ? 'previousAgent' : 'nextAgent', input)) {
      cycleAgents(event.shiftKey ? -1 : 1, event);
    }
  }

  function startQuickAgentShortcutReveal(event: KeyboardEvent): void {
    commandKeyHeld = true;
    if (event.repeat || quickAgentShortcutTimer || quickAgentShortcutsVisible.value) {
      return;
    }
    quickAgentShortcutTimer = setTimeout(() => {
      quickAgentShortcutTimer = null;
      if (commandKeyHeld && !showOnboardingGate.value && !isModalDialogVisible.value && isAgentWorkspaceVisible.value) {
        quickAgentShortcutsVisible.value = true;
      }
    }, quickAgentShortcutDelayMs);
  }

  function handleShellKeyup(event: KeyboardEvent): void {
    if (event.key === 'Meta' || !event.metaKey) {
      resetQuickAgentShortcuts();
    }
  }

  function resetQuickAgentShortcuts(): void {
    commandKeyHeld = false;
    quickAgentShortcutsVisible.value = false;
    if (quickAgentShortcutTimer) {
      clearTimeout(quickAgentShortcutTimer);
      quickAgentShortcutTimer = null;
    }
  }

  function handleAppCommand(command: AppCommand): void {
    // Native menu accelerators can consume the matching key event before the
    // renderer observes Meta keyup. Treat the resolved command as the end of
    // the transient Command-number reveal so the sidebar cannot stay latched.
    resetQuickAgentShortcuts();

    if (command.type === 'debug-missing-engines') {
      options.actions.setDebugMissingEngines(command.enabled);
      return;
    }
    if (command.type === 'debug-provider-upgrades') {
      options.actions.setDebugProviderUpgrades(command.enabled);
      return;
    }
    if (command.type === 'debug-review-uncommitted') {
      options.actions.setDebugReviewUncommitted(command.enabled);
      return;
    }

    if (command.type === 'appshot-failed') {
      if (!appHostCapabilities.appshots) return;
      ElMessage.error(command.message);
      return;
    }

    if (command.type === 'attach-appshot') {
      if (!appHostCapabilities.appshots) return;
      void attachAppshot(command);
      return;
    }

    if (command.type === 'open-settings') {
      options.actions.openSettings();
      return;
    }

    if (command.type === 'open-keyboard-shortcuts') {
      if (!isModalDialogVisible.value) options.actions.openKeyboardShortcuts();
      return;
    }

    if (command.type === 'open-command-palette') {
      if (!isModalDialogVisible.value && !document.activeElement?.closest('[role="dialog"][aria-modal="true"]')) options.actions.openCommandPalette();
      return;
    }

    if (command.type === 'open-whats-new') {
      options.actions.openWhatsNew();
      return;
    }

    if (command.type === 'open-agent-palette') {
      if (showOnboardingGate.value || isModalDialogVisible.value) return;
      options.actions.openAgentPalette();
      return;
    }

    if (command.type === 'save-active-prompt-draft') {
      options.actions.savePromptDraft();
      return;
    }

    if (command.type === 'open-saved-prompt-drafts') {
      options.actions.openSavedPromptDrafts();
      return;
    }

    if (command.type === 'toggle-spoken-announcements-muted') {
      options.actions.toggleSpokenAnnouncementsMuted();
      return;
    }

    if (command.type === 'open-simulator') {
      options.actions.openRightWorkspaceTab('simulator', command.agentId);
      return;
    }

    if (command.type === 'close-simulator') {
      options.actions.closeRightWorkspaceTab('simulator', command.agentId);
      return;
    }

    if (command.type === 'open-browser' && command.agentId && command.url) {
      if (!appHostCapabilities.embeddedBrowser) return;
      options.actions.openBrowser(command);
      return;
    }

    if (command.type === 'open-agent-composer') {
      const agent = command.agentId
        ? options.state.agents().find((candidate) => candidate.id === command.agentId)
        : currentAgent.value;
      if (!agent) return;
      options.actions.openAgentSurface();
      options.actions.selectAgent(agent.id);
      if (command.prompt !== undefined) {
        if (command.submit !== false) {
          options.actions.sendAgentPrompt(agent.id, command.prompt);
          return;
        }
        options.actions.updateComposerState(agent.id, {
          text: command.prompt,
          selectionStart: command.prompt.length,
          selectionEnd: command.prompt.length,
        });
      }
      void nextTick(options.actions.focusComposer);
      return;
    }

    if (command.type === 'debug-open-markdown') {
      options.actions.openAgentSurface();
      options.actions.openMarkdown({
        kind: 'markdown',
        title: translate('surface.appShell.debugMarkdown'),
        content: [
          '# Debug Markdown',
          '',
          `Opened from the ${product.name} Debug menu.`,
          '',
          '## Rendering fixtures',
          '',
          '- [x] Workspace tab',
          '- [ ] Markdown content',
          '',
          '> A deterministic document for checking Markdown presentation.',
          '',
          '```ts',
          "const source = 'Debug menu';",
          '```',
        ].join('\n'),
      });
      return;
    }

    if (command.type === 'debug-open-code-review') {
      if (!currentAgent.value) return;
      options.actions.openAgentSurface();
      options.actions.openRightWorkspaceTab('codeReview');
      return;
    }

    if (command.type === 'debug-open-visualize') {
      if (!currentAgent.value) return;
      options.actions.openAgentSurface();
      options.actions.openRightWorkspaceTab('visualize');
      return;
    }

    if (command.type === 'debug-celebrate') {
      useConfetti().celebrate({ kind: command.kind });
      return;
    }

    if (command.type === 'debug-approval-request') {
      const agent = currentAgent.value;
      if (!agent) return;
      options.actions.openAgentSurface();
      options.actions.setDebugApproval({
        agentId: agent.id,
        request: {
          id: 'debug-approval-request',
          kind: 'command',
          conversationId: `debug-${agent.id}`,
          itemId: 'debug-command-item',
          title: translate('surface.appShell.allowDebugCommand'),
          description: translate('surface.appShell.aDeterministicApprovalRequestFromTheDebugMenu'),
          command: 'npm test -- --run debug-fixture',
          cwd: agent.folder ?? undefined,
          allowedScopes: ['once', 'session'],
          canDeny: true,
        },
      });
      return;
    }

    if (command.type === 'debug-user-questions') {
      const agent = currentAgent.value;
      if (!agent) return;
      options.actions.openAgentSurface();
      options.actions.showDebugUserQuestions(agent.id);
      return;
    }

    if (command.type === 'debug-mark-unread') {
      options.actions.debugMarkUnread();
      return;
    }

    if (command.type === 'debug-image-annotation') {
      if (isModalDialogVisible.value) return;
      void options.actions.openDebugImageAnnotation(command.imageDataUrl, command.pixelRatio);
      return;
    }

    if (command.type === 'debug-operation-progress') {
      void options.actions.openDebugOperationProgress(command.kind);
      return;
    }

    if (isModalDialogVisible.value) {
      return;
    }

    if (command.type === 'quit') {
      if (!appHostCapabilities.appLifecycle) return;
      void options.actions.quit();
      return;
    }

    if (command.type === 'cycle-teams') {
      if (!isAgentWorkspaceVisible.value) {
        return;
      }
      cycleTeams();
      return;
    }

    if (command.type === 'open-review') {
      if (isAgentWorkspaceVisible.value && currentAgent.value) {
        void options.actions.openGitReview();
      }
      return;
    }

    if (command.type === 'open-browser') {
      if (!appHostCapabilities.embeddedBrowser) return;
      if (isAgentWorkspaceVisible.value && currentAgent.value) {
        options.actions.openBrowser(command);
      }
      return;
    }

    if (command.type === 'new-team') {
      options.actions.newTeam();
      return;
    }

    if (command.type === 'close-active-agent') {
      if (!isAgentWorkspaceVisible.value) {
        return;
      }
      closeActiveAgent();
      return;
    }

    if (command.type === 'compress-active-session') {
      if (!isAgentWorkspaceVisible.value || !currentAgent.value) return;
      if (options.state.canReplaceConversation?.() ?? defaultBackendCapabilities(currentAgent.value.backend).conversationReplaceWithSummary) {
        options.actions.replaceConversationWithSummary(currentAgent.value.id);
      }
      return;
    }

    if (command.type === 'compact-active-session') {
      if (!isAgentWorkspaceVisible.value || !currentAgent.value) return;
      if (currentAgent.value.status.type === 'idle' && currentAgent.value.backendSession) {
        options.actions.compactSession(currentAgent.value.id);
      }
      return;
    }

    if (command.type === 'close-active-team') {
      if (!isAgentWorkspaceVisible.value) {
        return;
      }
      void closeActiveTeam();
      return;
    }

    if (command.type === 'cycle-agents') {
      if (!isAgentWorkspaceVisible.value) {
        return;
      }
      cycleAgents(command.direction);
      return;
    }

    if (command.type === 'edit-active-agent') {
      if (!isAgentWorkspaceVisible.value) {
        return;
      }
      editActiveAgent();
      return;
    }

    if (command.type === 'duplicate-active-agent') {
      if (!isAgentWorkspaceVisible.value) {
        return;
      }
      duplicateActiveAgent();
      return;
    }

    if (command.type === 'fork-active-agent') {
      const agent = currentAgent.value;
      if (isAgentWorkspaceVisible.value && agent?.status.type === 'idle' && agent.backendSession) {
        options.actions.forkAgent(agent.id);
      }
      return;
    }
    if (command.type === 'handoff-active-agent') {
      if (isAgentWorkspaceVisible.value && currentAgent.value) options.actions.handoffAgent?.(currentAgent.value.id);
      return;
    }

    if (command.type === 'resume-active-session') {
      if (isAgentWorkspaceVisible.value && currentAgent.value) {
        options.actions.resumeSession(currentAgent.value.id);
      }
      return;
    }

    if (command.type === 'restart-active-agent') {
      if (!isAgentWorkspaceVisible.value) {
        return;
      }
      restartActiveAgent();
    }
  }

  async function attachAppshot(command: Extract<AppCommand, { type: 'attach-appshot' }>): Promise<void> {
    const agent = currentAgent.value;
    const nativeApi = getCodexNativeRendererApi();
    if (!agent || !nativeApi || !options.state.attachmentsEnabled()) {
      ElMessage.error(translate('surface.appShell.selectAnAgentThatSupportsImageAttachmentsBeforeTakingAnA'));
      return;
    }

    try {
      const [attachment] = await nativeApi.ingestAttachments([
        {
          name: appshotFileName(command.appName),
          mimeType: 'image/png',
          data: imageDataUrlArrayBuffer(command.imageDataUrl),
        },
      ]);
      if (!attachment) throw new Error(translate('surface.appShell.appshotIngestionReturnedNoAttachment'));
      options.actions.openAgentSurface();
      options.actions.updateComposerAttachments(agent.id, [...options.state.composerAttachments(), attachment]);
      await nextTick();
      options.actions.focusComposer();
    } catch {
      ElMessage.error(translate('surface.appShell.theAppshotCouldNotBeAttached'));
    }
  }

  function appshotFileName(appName?: string): string {
    const source = appName
      ?.trim()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    return `${source ? `${source}-` : ''}appshot-${Date.now()}.png`;
  }
  function duplicateActiveAgent(event?: KeyboardEvent): void {
    const agent = currentAgent.value;
    if (!agent) {
      return;
    }

    event?.preventDefault();
    options.actions.duplicateAgent(agent.id);
  }

  function closeActiveAgent(event?: KeyboardEvent): void {
    const agent = currentAgent.value;
    if (!agent) {
      return;
    }

    event?.preventDefault();
    options.actions.closeAgent(agent.id);
  }

  async function closeActiveTeam(): Promise<void> {
    const team = activeTeam.value;
    if (!team || options.state.teams().length <= 1) {
      return;
    }

    if (await confirmCloseTeam(team) === 'close') {
      options.actions.closeTeam(team.id);
    }
  }

  function restartActiveAgent(): void {
    const agent = currentAgent.value;
    if (!agent) {
      return;
    }

    options.actions.restartAgent(agent.id);
  }

  function editActiveAgent(): void {
    const agent = currentAgent.value;
    if (!agent) {
      return;
    }

    options.actions.editAgent(agent.id);
  }

  function cycleTeams(): boolean {
    const teams = options.state.teams();
    if (teams.length < 2) {
      return false;
    }

    const activeIndex = Math.max(
      teams.findIndex((team) => team.id === activeTeam.value?.id),
      0,
    );
    const nextTeam = teams[(activeIndex + 1) % teams.length];
    if (!nextTeam) {
      return false;
    }

    options.actions.selectTeam(nextTeam.id);
    return true;
  }

  function cycleAgents(direction: 1 | -1, event?: KeyboardEvent): void {
    const agents = activeTeamAgents.value;
    if (agents.length < 2) {
      return;
    }

    const activeIndex = Math.max(
      agents.findIndex((agent) => agent.id === currentAgent.value?.id),
      0,
    );
    const nextAgent = agents[(activeIndex + direction + agents.length) % agents.length];
    if (!nextAgent) {
      return;
    }

    event?.preventDefault();
    options.actions.selectAgent(nextAgent.id);
  }

  onMounted(() => {
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', handleShellShortcut);
      window.addEventListener('keyup', handleShellKeyup);
      window.addEventListener('blur', resetQuickAgentShortcuts);
    }
    unsubscribeAppCommand = appApi?.onAppCommand?.(handleAppCommand) ?? null;
  });

  onBeforeUnmount(() => {
    if (typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', handleShellShortcut);
      window.removeEventListener('keyup', handleShellKeyup);
      window.removeEventListener('blur', resetQuickAgentShortcuts);
    }
    resetQuickAgentShortcuts();
    unsubscribeAppCommand?.();
    unsubscribeAppCommand = null;
  });

  return { quickAgentShortcutsVisible, executeAppCommand: handleAppCommand };
}
