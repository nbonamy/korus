import { ref } from 'vue';
import { createCodexConversationPaneController, type CodexConversationPaneActions, type CodexConversationPaneState, type CodexRendererSendMessageOptions, type CodexComposerMenuItem } from '@codex-app-sdk/vue';
import type { AppGeneralSettings, BackendApprovalDecision, BackendApprovalScope, ClientRequestResponse, ReasoningEffort, RendererSendPromptOptions, ApprovalPreset } from '@workspace/core/contracts';
import type { ThreadFlagResponse } from '@workspace/core/thread-flags';
import { approvalPresetFromDefaults } from '@workspace/core/approval-presets';
import { defaultBackendCommands } from '@workspace/core/backend-commands';
import type { AgentConversationView } from '../app-state';
import { translate } from '../i18n';
import { localizedText } from '../i18n/errors';
import { useImageAnnotation } from './use-image-annotation';
import { useChatTextAnnotations } from './use-chat-text-annotations';
import { useVisualizationAnnotations } from './use-visualization-annotations';
import { useCodeAnnotations } from './use-code-annotations';
import { claudePaneClientRequests } from './claude-pane-client-requests';
import { antigravityPaneClientRequests } from './antigravity-pane-client-requests';
import { conversationCommandMenuItems } from './conversation-command-menu';

export type AgentConversationActions = {
  planReview: (agentId: string, resolution: 'accept' | 'revise' | 'cancel', feedback?: string) => void | Promise<void>;
  clearGoal: (agentId: string) => void | Promise<void>;
  threadFlag: (agentId: string, response: ThreadFlagResponse) => void | Promise<void>;
  prepare: (agentId: string) => void | Promise<void>;
  loadOlder: (agentId: string) => void | Promise<void>;
  loadTurn?: (agentId: string, turnId: string) => Promise<void>;
  send: (agentId: string, prompt: string, options?: RendererSendPromptOptions) => void | Promise<void>;
  steer: (agentId: string, prompt: string, options?: RendererSendPromptOptions) => void | Promise<void>;
  interrupt: (agentId: string) => void | Promise<void>;
  deleteTurn: (agentId: string, turnId: string) => void | Promise<void>;
  editTurn: (agentId: string, payload: { content: string; turnId: string; options?: Pick<RendererSendPromptOptions, 'content'> }) => void | Promise<void>;
  forkTurn: (agentId: string, turnId: string) => void | Promise<void>;
  retryTurn: (agentId: string, turnId: string) => void | Promise<void>;
  continueInterruptedTurn: (agentId: string) => void | Promise<void>;
  resolveApproval: (agentId: string, approvalId: string, decision: BackendApprovalDecision, scope: BackendApprovalScope) => void | Promise<void>;
  clientResponse: (response: ClientRequestResponse) => void | Promise<void>;
  selectModel: (agentId: string, modelId: string) => void;
  selectReasoningEffort: (agentId: string, effort: ReasoningEffort) => void;
  selectServiceTier: (agentId: string, tier: string | null) => void;
  setPlanMode: (agentId: string, enabled: boolean) => void;
  setApprovalPreset: (agentId: string, preset: ApprovalPreset) => void | Promise<void>;
  setPermissionMode: (agentId: string, mode: string) => void | Promise<void>;
  updateComposerState: (agentId: string, state: AgentConversationView['composerState']) => void;
  updateAttachments: (agentId: string, attachments: AgentConversationView['attachments']) => void;
  deleteQueuedPrompt: (agentId: string, promptId: string) => void | Promise<void>;
  updateQueuedPrompt: (agentId: string, promptId: string, prompt: string, options?: Pick<RendererSendPromptOptions, 'content'>) => void | Promise<void>;
  steerQueuedPrompt: (agentId: string, promptId: string, prompt?: string, options?: Pick<RendererSendPromptOptions, 'content'>) => void | Promise<void>;
};


export function agentConversationState(view: () => AgentConversationView, extensions: {
  followUpBehavior?: () => AppGeneralSettings['followUpBehavior'];
  mentionGroups?: () => NonNullable<CodexConversationPaneState['catalogs']>['mentionGroups'];
  modelMenuItems?: () => CodexComposerMenuItem[];
} = {}): CodexConversationPaneState {
  const provider = () => view().codexSnapshot ?? view().claudeSnapshot ?? view().antigravitySnapshot;
  const approvalPreset = () => {
    const allowed = view().capabilities.approvalPresets ?? [];
    const stored = approvalPresetFromDefaults(view().agent.backendDefaults);
    return view().capabilities.approvals ? (allowed.includes(stored) ? stored : allowed[0] ?? null) : null;
  };
  return {
    identity: {
      get conversationKey() { const agent = view().agent; const session = agent.backendSession; return session?.kind === 'codex' ? `codex:${session.threadId}` : session ? `${session.kind}:${session.sessionId}` : `agent:${agent.id}`; },
      get activeTurnId() { return provider()?.activeTurnId ?? null; },
      get turns() { return provider()?.turns; },
      get messages() { return (provider()?.messages ?? []); },
      get busy() { return provider()?.busy ?? view().sending; },
      get disabled() { return view().history.failed && (provider()?.messages ?? []).length === 0; },
      get error() { return provider()?.error ?? null; },
    },
    history: {
      get hasOlder() { return provider()?.historyState?.hasOlder ?? view().history.hasOlder; },
      get loading() { return Boolean(view().agent.backendSession) && !(provider()?.messages.length) && (provider()?.historyLoading ?? view().history.hydrating); },
      get loadingOlder() { return Boolean(provider()?.historyState?.loadingOlder || view().history.loadingOlder); },
    },
    thread: {
      get approvals() { return view().codexSnapshot?.approvals ?? view().approvals; },
      get clientRequests() {
        const antigravity = view().antigravitySnapshot;
        if (antigravity) return antigravityPaneClientRequests(antigravity);
        return view().codexSnapshot?.clientRequests ?? claudePaneClientRequests(view().claudeSnapshot);
      },
      get answeredClientRequestIds() { return new Set(provider()?.answeredClientRequestIds ?? view().answeredClientRequestIds); },
      get goal() { return view().codexSnapshot?.goal ?? view().agent.goal ?? null; },
      get queuedPrompts() { return view().queuedPrompts; },
      get contextUsage() { return provider()?.contextUsage ?? view().agent.contextUsage ?? null; },
    },
    composer: {
      get followUpBehavior() { return extensions.followUpBehavior?.() ?? 'queue'; },
      get state() { return view().composerState; },
      get attachments() { return view().attachments; },
      get placeholder() { return view().agent.suggestedPrompt || translate('surface.appShell.askForFollowUpChanges'); },
      get approvalPreset() { return approvalPreset(); },
      get leadingMenuItems() { return [...permissionMenuItems(view()), ...conversationCommandMenuItems()]; },
      get modelMenuItems() { return extensions.modelMenuItems?.(); },
      get planMode() { return view().composer.planMode; },
      get selectedModelId() { return view().composer.selectedModelId; },
      get selectedReasoningEffort() { return view().composer.selectedReasoningEffort; },
      get selectedServiceTier() { return view().composer.selectedServiceTier; },
    },
    catalogs: {
      get files() { return view().composer.files; },
      get models() { return view().composer.models; },
      get mentionGroups() { return extensions.mentionGroups?.(); },
      get commands() { return defaultBackendCommands(view().agent.backend); },
      get plugins() { return view().composer.plugins; },
      get skills() { return view().composer.skills; },
      get modelCatalogStatus() { return view().composer.modelStatus; },
      get skillCatalogStatus() { return view().composer.skillStatus; },
    },
    get capabilities() {
      const capabilities = view().capabilities;
      return {
        models: capabilities.models, skills: capabilities.skills || view().composer.skills.some(skill => skill.enabled), reasoningEffort: capabilities.reasoningEffort,
        serviceTier: capabilities.serviceTier, planMode: capabilities.planMode !== 'unsupported',
        goals: capabilities.goals, steerPrompt: capabilities.steerPrompt, interrupt: capabilities.interrupt,
        history: capabilities.history, deleteTurn: capabilities.deleteTurn, editTurn: capabilities.editTurn,
        retryTurn: capabilities.retryTurn, approvals: capabilities.approvals,
        approvalPresets: capabilities.approvalPresets ?? [],
      };
    },
    policy: {
      get attachEnabled() { return view().capabilities.attachments; },
      get canDeleteTurn() { return view().capabilities.deleteTurn; },
      get canEditTurn() { return view().capabilities.editTurn; },
      get canForkTurn() { return view().capabilities.conversationFork; },
      get canRetryTurn() { return view().capabilities.retryTurn; },
    },
  };

}

export function useAgentConversation(options: {
  agentId: () => string | undefined;
  state: CodexConversationPaneState;
  actions: AgentConversationActions;
  openLink: NonNullable<CodexConversationPaneActions['openLink']>;
  openImage: NonNullable<CodexConversationPaneActions['openImage']>;
  openVisualization: NonNullable<CodexConversationPaneActions['openVisualization']>;
  overrides?: CodexConversationPaneActions;
  beforeSubmit?: () => Promise<void>;
  onMenuSelect?: NonNullable<CodexConversationPaneActions['menuSelect']>;
  onThreadFlag?: (agentId: string, response: ThreadFlagResponse) => void;
  debugFallbackImageSource: string;
  notifyError: (message: string) => void;
}) {
  const agentId = () => options.agentId() ?? '';
  const imageAnnotation = useImageAnnotation({
    composerAttachments: () => options.state.composer?.attachments ?? [],
    composerState: () => options.state.composer?.state ?? { text: '', selectionStart: 0, selectionEnd: 0 },
    currentAgentId: options.agentId,
    debugFallbackImageSource: options.debugFallbackImageSource,
    notifyError: options.notifyError,
    updateComposerAttachments: options.actions.updateAttachments,
    updateComposerState: options.actions.updateComposerState,
  });
  const chatTextAnnotation = useChatTextAnnotations({ currentAgentId: options.agentId });
  const visualizationAnnotation = useVisualizationAnnotations({ currentAgentId: options.agentId });
  const codeAnnotation = useCodeAnnotations({ currentAgentId: options.agentId });
  const threadFlagBusy = ref(false);
  async function respondToThreadFlag(response: ThreadFlagResponse): Promise<void> {
    if (threadFlagBusy.value || !options.agentId()) return;
    const id = agentId();
    threadFlagBusy.value = true;
    try {
      await options.actions.threadFlag(id, response);
      options.onThreadFlag?.(id, response);
    } catch (error) {
      options.notifyError(error instanceof Error ? error.message : String(error));
    } finally {
      threadFlagBusy.value = false;
    }
  }
  async function forward(prompt: string, sendOptions: CodexRendererSendMessageOptions | undefined, send: AgentConversationActions['send']): Promise<void> {
    const id = agentId();
    if (!id) return;
    const capturedImages = imageAnnotation.capture();
    await options.beforeSubmit?.();
    await visualizationAnnotation.forward(prompt, sendOptions, (text, visualOptions) =>
      codeAnnotation.forward(text, visualOptions, (codeText, codeOptions) =>
        chatTextAnnotation.forward(codeText, codeOptions, (annotatedText, textOptions) =>
          imageAnnotation.forward(annotatedText, textOptions, (finalText, finalOptions) => send(id, finalText, finalOptions), capturedImages))));
  }
  const actions: CodexConversationPaneActions = {
    clearGoal: () => options.actions.clearGoal(agentId()),
    openLink: options.openLink,
    openImage: options.openImage,
    openVisualization: options.openVisualization,
    menuSelect: (item) => {
      const payload = item.payload as { kind?: string; mode?: string } | undefined;
      if (payload?.kind === 'permission-mode' && payload.mode) return options.actions.setPermissionMode(agentId(), payload.mode);
      return options.onMenuSelect?.(item);
    },
    cancel: () => options.actions.interrupt(agentId()),
    interrupt: () => options.actions.interrupt(agentId()),
    continueInterruptedTurn: () => options.actions.continueInterruptedTurn(agentId()),
    clientResponse: (response) => options.actions.clientResponse({ ...response, agentId: agentId() }),
    deleteTurn: (turnId) => options.actions.deleteTurn(agentId(), turnId),
    editTurn: (payload) => options.actions.editTurn(agentId(), payload),
    forkTurn: (turnId) => options.actions.forkTurn(agentId(), turnId),
    retryTurn: (turnId) => options.actions.retryTurn(agentId(), turnId),
    resolveApproval: (id, decision, scope) => options.actions.resolveApproval(agentId(), id, decision, scope),
    sendFollowUp: (prompt) => forward(prompt, undefined, options.actions.send),
    submit: (prompt, sendOptions) => forward(prompt, sendOptions, options.actions.send),
    steer: (prompt, sendOptions) => forward(prompt, sendOptions, options.actions.steer),
    loadOlderHistory: () => options.actions.loadOlder(agentId()),
    loadTurnHistory: (turnId) => options.actions.loadTurn?.(agentId(), turnId),
    deleteQueuedPrompt: (promptId) => options.actions.deleteQueuedPrompt(agentId(), promptId),
    updateQueuedPrompt: (promptId, prompt, contentOptions) => contentOptions ? options.actions.updateQueuedPrompt(agentId(), promptId, prompt, contentOptions) : options.actions.updateQueuedPrompt(agentId(), promptId, prompt),
    steerQueuedPrompt: (promptId, prompt, contentOptions) => contentOptions ? options.actions.steerQueuedPrompt(agentId(), promptId, prompt, contentOptions) : options.actions.steerQueuedPrompt(agentId(), promptId, prompt),
    updateAttachments: (attachments) => { imageAnnotation.prune(agentId(), attachments); options.actions.updateAttachments(agentId(), attachments); },
    updateComposerState: (composerState) => options.actions.updateComposerState(agentId(), composerState),
    updateSettings: (settings) => {
      const id = agentId();
      if (settings.modelId !== undefined) options.actions.selectModel(id, settings.modelId);
      if (settings.reasoningEffort !== undefined) options.actions.selectReasoningEffort(id, settings.reasoningEffort);
      if (settings.serviceTier !== undefined) options.actions.selectServiceTier(id, settings.serviceTier);
      if (settings.planMode !== undefined) options.actions.setPlanMode(id, settings.planMode);
      if (settings.approvalPreset !== undefined) return options.actions.setApprovalPreset(id, settings.approvalPreset);
    },
    ...options.overrides,
  };
  const controller = createCodexConversationPaneController({ state: options.state, actions });
  return { controller, imageAnnotation, chatTextAnnotation, visualizationAnnotation, codeAnnotation, threadFlagBusy, respondToThreadFlag };
}

function permissionMenuItems(view: AgentConversationView): CodexComposerMenuItem[] {
  const modes = view.capabilities.permissionModes ?? [];
  if (!modes.length) return [];
  const defaults = view.agent.backendDefaults;
  const selected = defaults && 'permissionMode' in defaults ? defaults.permissionMode : undefined;
  return [{ id: 'backend-permissions', type: 'submenu', label: translate('surface.appShell.permissions'),
    items: modes.map(mode => ({ id: `permission:${mode.id}`, type: 'radio', label: localizedText(mode.label, translate) ?? mode.id, checked: selected === mode.id,
      payload: { kind: 'permission-mode', mode: mode.id } })),
  }];
}
