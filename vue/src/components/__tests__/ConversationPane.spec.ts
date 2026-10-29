import { product } from '@workspace/core/product';
import { flushPromises, mount } from '@vue/test-utils';
import {
  createCodexConversationPaneController,
  type CodexComposerState,
  type CodexConversationPaneController,
  type CodexMessageTextSelection,
  type CodexNativeAttachment,
  type CodexNativeRendererApi,
} from '@codex-app-sdk/vue';
import { computed, defineComponent, h, nextTick, provide, ref, shallowReactive } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent, RendererMessage, SavedPromptDraft, ThreadPlan } from '@workspace/core/contracts';
import { formatCollaborationMessageEnvelope } from '@workspace/core/collaboration-message-envelope';
import ConversationPane from '../ConversationPane.vue';
import type { ChatTextAnnotation } from '../use-chat-text-annotations';
import type { VisualizationAnnotation } from '../use-visualization-annotations';
import { backendChoicesKey, provideBackendSwitch } from '../backend-selection';
import { setElectronTestClient } from '../../test/client';
import { antigravityBackendCapabilities, claudeBackendCapabilities } from '@workspace/core/backend-capabilities';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { createAgentComposerState } from '../../agent-composer-state';
import type { AgentConversationView } from '../../app-state';
import { agentConversationState } from '../use-agent-conversation';
import { claudeConversationSnapshot } from '../../test/claude-conversation-fixtures';

const agent: Agent = {
  id: 'agent-dina',
  name: 'Dina',
  avatar: 'DI',
  folder: '~/src/id8',
  backend: 'codex',
  backendDefaults: { kind: 'codex' },
  status: { type: 'idle' },
  createdAt: '2026-06-05T00:00:00.000Z',
  updatedAt: '2026-06-05T00:00:00.000Z',
};

const messages: RendererMessage[] = [
  {
    id: 'message-user',
    agentId: agent.id,
    role: 'user',
    status: 'complete',
    turnId: 'turn-1',
    createdAt: '2026-06-05T00:00:00.000Z',
    parts: [{ type: 'text', text: 'Find the failing test.' }],
  },
  {
    id: 'message-assistant',
    agentId: agent.id,
    role: 'assistant',
    status: 'complete',
    turnId: 'turn-1',
    createdAt: '2026-06-05T00:00:01.000Z',
    parts: [{ type: 'text', text: 'Looking now.' }],
  },
];

const executionPlan: ThreadPlan = {
  threadId: 'thread-plan',
  turnId: 'turn-plan',
  kind: 'execution',
  status: 'inProgress',
  explanation: 'Current execution plan',
  steps: [{ step: 'Implement the fix', status: 'inProgress' }],
  markdown: 'Current execution plan\n- [ ] Implement the fix',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const nativeWindow = window as Window & { codexAppSdkNative?: CodexNativeRendererApi };

describe('ConversationPane', () => {
  afterEach(() => { delete nativeWindow.codexAppSdkNative; });
  it('loads consecutive older Claude pages when more history remains', async () => {
    const snapshot = createInitialSnapshot();
    const owner = { ...agent, backend: 'claude' as const, backendSession: { kind: 'claude' as const, sessionId: 'session', transport: 'stdio' as const } };
    const recent = { ...messages[1]!, id: 'recent' };
    const older = { ...messages[1]!, id: 'older', turnId: 'older-turn' };
    const view = shallowReactive<AgentConversationView>({ agent: owner, composer: createAgentComposerState({ getSnapshot: () => snapshot }).configurationForAgent(agent.id),
      composerState: { text: '', selectionStart: 0, selectionEnd: 0 }, codexSnapshot: null,
      claudeSnapshot: claudeConversationSnapshot([recent], { sessionId: 'session', historyState: { hasOlder: true, loadingOlder: false } }),
      attachments: [], capabilities: claudeBackendCapabilities, approvals: [], sending: false, queuedPrompts: [],
      history: { failed: false, hydrating: false, hasOlder: true, loadingOlder: false }, answeredClientRequestIds: new Set() });
    const loadOlderHistory = vi.fn();
    const controller = createCodexConversationPaneController({ state: agentConversationState(() => view), actions: { loadOlderHistory } });
    const wrapper = mountPane({ controller, agent: owner });
    try {
      await flushPromises();
      const viewport = wrapper.get<HTMLElement>('.codex-message-list__viewport');
      Object.defineProperty(viewport.element, 'clientHeight', { configurable: true, value: 500 });
      Object.defineProperty(viewport.element, 'scrollHeight', { configurable: true, value: 2000 });
      viewport.element.scrollTop = 0;
      await viewport.trigger('scroll');
      expect(loadOlderHistory).toHaveBeenCalledTimes(1);
      view.history = { ...view.history, loadingOlder: true };
      await nextTick();
      view.claudeSnapshot = claudeConversationSnapshot([older, recent], { sessionId: 'session', historyState: { hasOlder: true, loadingOlder: false } });
      view.history = { ...view.history, loadingOlder: false };
      await flushPromises();
      viewport.element.scrollTop = 0;
      await viewport.trigger('scroll');
      expect(loadOlderHistory).toHaveBeenCalledTimes(2);
    } finally { wrapper.unmount(); }
  });
  // App-owned skills must remain selectable when the provider has no native skill support.
  it('offers an app-owned imagegen skill in the dollar picker without submitting a prompt', async () => {
    const snapshot = createInitialSnapshot();
    const owner = { ...snapshot.agents[0]!, backend: 'antigravity' as const, backendDefaults: { kind: 'antigravity' as const } };
    const composer = createAgentComposerState({ getSnapshot: () => snapshot }).configurationForAgent(owner.id);
    composer.skills = [{ name: 'imagegen', displayName: 'Image Gen', shortDescription: 'Generate or edit images for websites, games, and more',
      path: 'korus:skill/korus-imagegen', scope: 'system', enabled: true }];
    const view = shallowReactive<AgentConversationView>({ agent: owner, composer, composerState: { text: '', selectionStart: 0, selectionEnd: 0 },
      codexSnapshot: null, claudeSnapshot: null, attachments: [], capabilities: antigravityBackendCapabilities, approvals: [], sending: false,
      queuedPrompts: [], history: { failed: false, hydrating: false, hasOlder: false, loadingOlder: false }, answeredClientRequestIds: new Set() });
    const submit = vi.fn();
    const controller = createCodexConversationPaneController({ state: agentConversationState(() => view), actions: {
      submit, updateComposerState: state => { view.composerState = state; },
    } });
    const wrapper = mountPane({ controller, agent: owner });
    try {
      const editor = wrapper.get<HTMLElement>('.chat-rich-text-editor');
      editor.element.focus();
      editor.element.textContent = '$ima';
      const range = document.createRange();
      range.selectNodeContents(editor.element); range.collapse(false);
      window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
      await editor.trigger('input');
      const option = wrapper.findAll('[role="option"]').find(item => item.text().includes('Image Gen'));
      expect(option?.exists()).toBe(true);
      expect(option!.text()).toContain('Generate or edit images for websites, games, and more');
      await option!.trigger('mousedown');
      expect(view.composerState.text).toBe('Image Gen ');
      expect(view.composerState.content).toContainEqual({ type: 'mention', kind: 'skill', id: 'korus:skill/korus-imagegen', value: 'imagegen', label: 'Image Gen' });
      expect(submit).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
  const claudeAgent = { ...agent, backend: 'claude' as const, backendSession: { kind: 'claude' as const, sessionId: 'session', transport: 'stdio' as const } };
  it.each([
    ['claude', '/repo/banner.png', '/repo/banner.png'],
    ['codex', 'file:///repo/blue%20flower.png', '/repo/blue flower.png'],
    ['claude', 'website/assets/banner.png', 'website/assets/banner.png'],
  ] as const)('loads a %s inline local image through its own agent file preview: %s', async (backend, reference, filePath) => {
    const readImagePreview = vi.fn().mockRejectedValue(new Error('Attachment reference is invalid or expired'));
    installNativeImagePreview(readImagePreview);
    const previewAgentFile = vi.fn().mockResolvedValue({ kind: 'image', path: filePath, size: 3, mimeType: 'image/png', dataUrl: 'data:image/png;base64,cG5n' });
    setElectronTestClient({ previewAgentFile });
    const owner = { ...agent, id: 'background-image-owner', backend };
    const wrapper = mountPane({ controller: controllerFor([{ ...messages[1]!, agentId: owner.id, parts: [{ type: 'text', text: `![Blue flower](<${reference}>)` }] }]), agent: owner });
    await flushPromises();
    expect(wrapper.get('img.chat-media-block__image').attributes('src')).toBe('data:image/png;base64,cG5n');
    expect(previewAgentFile).toHaveBeenCalledWith(owner.id, filePath);
  });

  it('shows the limit-reset notice above the composer and saves the auto-resume toggle', async () => {
    const setAutoResume = vi.fn().mockResolvedValue({});
    setElectronTestClient({ setAutoResume });
    const pause = { backend: 'claude' as const, conversationId: 'session', detectedAt: Date.now(), resumeAt: Date.now() + 60_000, enabled: true };
    const current = { ...agent, backend: 'claude' as const, backendSession: { kind: 'claude' as const, sessionId: 'session', transport: 'stdio' as const }, rateLimitPause: pause };
    const wrapper = mountPane({ controller: controllerFor(messages), agent: current });
    expect(wrapper.get('.codex-conversation-pane__composer-shelf [role="status"]').text()).toContain('Auto-resume');
    expect(wrapper.get('[role="switch"][aria-label="Auto-resume"]').attributes('aria-checked')).toBe('true');
    expect(wrapper.get('[role="status"]').text()).toContain('Auto-resume');
    await wrapper.get('[role="switch"][aria-label="Auto-resume"]').setValue(false); await flushPromises();
    expect(setAutoResume).toHaveBeenCalledWith(agent.id, false);
    await wrapper.setProps({ agent: { ...current, rateLimitPause: { ...pause, enabled: false } } });
    expect(wrapper.get('[role="switch"][aria-label="Auto-resume"]').attributes('aria-checked')).toBe('false');
    await wrapper.setProps({ agent: { ...current, rateLimitPause: undefined } });
    expect(wrapper.find('[aria-label="Auto-resume"]').exists()).toBe(false);
  });

  it('keeps a pending image read bound to its original agent when the pane changes', async () => {
    let release!: () => void;
    installNativeImagePreview(() => new Promise(resolve => { release = () => resolve(null); }));
    const previewAgentFile = vi.fn().mockResolvedValue({ kind: 'image', path: '/repo/banner.png', size: 3, dataUrl: 'data:image/png;base64,cG5n' });
    setElectronTestClient({ previewAgentFile });
    const wrapper = mountPane({ controller: controllerFor([{ ...messages[1]!, parts: [{ type: 'text', text: '![Banner](/repo/banner.png)' }] }]), agent: claudeAgent });
    await wrapper.setProps({ agent: { ...claudeAgent, id: 'different-agent' } });
    release();
    await flushPromises();
    expect(previewAgentFile).toHaveBeenCalledWith(claudeAgent.id, '/repo/banner.png');
    expect(previewAgentFile).not.toHaveBeenCalledWith('different-agent', expect.anything());
  });

  it('preserves native attachment previews without reading workspace files', async () => {
    installNativeImagePreview(async () => 'data:image/png;base64,cG5n');
    const previewAgentFile = vi.fn();
    setElectronTestClient({ previewAgentFile });
    const wrapper = mountPane({ controller: controllerFor([{ ...messages[0]!, parts: [{ type: 'attachment', attachment: {
      kind: 'image', name: 'Upload', path: 'codex-attachment:upload', mimeType: 'image/png',
    } }] }]), agent: claudeAgent });
    await flushPromises();
    expect(wrapper.get('img.chat-attachment-block__preview').attributes('src')).toBe('data:image/png;base64,cG5n');
    expect(previewAgentFile).not.toHaveBeenCalled();
  });

  it.each(['missing', 'text', 'tooLarge'])('does not turn a %s file preview into an image', async kind => {
    installNativeImagePreview(async () => null);
    const previewAgentFile = kind === 'missing' ? vi.fn().mockRejectedValue(new Error('File not found')) : vi.fn().mockResolvedValue({ kind, path: '/repo/banner.png', size: 3 });
    setElectronTestClient({ previewAgentFile });
    const wrapper = mountPane({ controller: controllerFor([{ ...messages[1]!, parts: [{ type: 'text', text: '![Banner](/repo/banner.png)' }] }]), agent: claudeAgent });
    await flushPromises();
    expect(previewAgentFile).toHaveBeenCalledWith(claudeAgent.id, '/repo/banner.png');
    expect(wrapper.get('img.chat-media-block__image').attributes('src')).toBeUndefined();
  });

  it('reads the full content of a cut row by itself, with nothing to click', async () => {
    const full = { ...messages[1]!, parts: [{ type: 'text' as const, text: 'The full result is visible.' }] };
    const bytes = Buffer.from(JSON.stringify(full));
    const preview = { ...messages[1]!, deferredContent: { contentId: 'content', byteLength: bytes.length } };
    const readConversationContent = vi.fn(async () => ({ data: bytes.toString('base64'), totalBytes: bytes.length, nextOffset: null }));
    const wrapper = mountPane({ controller: controllerFor([preview]), agent: claudeAgent, readConversationContent });
    await flushPromises();
    expect(readConversationContent).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).not.toContain('Load full content');
    expect(wrapper.text()).toContain('The full result is visible.');
    expect(wrapper.text()).not.toContain('Looking now.');
    wrapper.unmount();
  });
  it('leaves a very large cut row as its preview, with nothing to press', async () => {
    const preview = { ...messages[1]!, deferredContent: { contentId: 'huge', byteLength: 20 * 1024 * 1024 } };
    const readConversationContent = vi.fn();
    const wrapper = mountPane({ controller: controllerFor([preview]), agent: claudeAgent, readConversationContent });
    await flushPromises();
    expect(readConversationContent).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('Load full content');
    expect(wrapper.text()).toContain('Looking now.');
    wrapper.unmount();
  });
  it('shows a cut row as it is, without a button, where full content cannot be read', async () => {
    const preview = { ...messages[1]!, deferredContent: { contentId: 'content', byteLength: 1000 } };
    const wrapper = mountPane({ controller: controllerFor([preview]), agent: claudeAgent });
    await flushPromises();
    expect(wrapper.findAll('button').find((candidate) => candidate.text() === 'Load full content')).toBeUndefined();
    expect(wrapper.text()).toContain('Looking now.');
    wrapper.unmount();
  });
  it('renders the conversation without a delegation context banner', () => {
    const wrapper = mountPane({ controller: controllerFor(messages), agent: { ...agent, delegationContext: { requested: 'conversation', effective: 'handoff', reason: 'cross-provider' } } });
    expect(wrapper.text()).not.toContain('Started with a fresh handoff');
    expect(wrapper.text()).toContain('Find the failing test.');
  });
  it('shows only the delegated task while hiding its tracking, identity and user instructions', () => {
    const wrapper = mountPane({ controller: controllerFor([{
      ...messages[0]!,
      parts: [{ type: 'text', text: '<context>\n[Korus task task-1; attempt attempt-1]\n</context>\n\n<context>\nYour worker identity and directory.\n</context>\n\nTranslate the README into French.\n\n<context>\nSaved delegation instructions: Just say Hello. Do not work on the request.\n</context>' }],
    }]), agent });
    expect(wrapper.get('.chat-user-text').text()).toBe('Translate the README into French.');
  });
  it('allows the real conversation and composer to shrink within the workspace chat allocation', () => {
    const wrapper = mountPane({ controller: controllerFor(messages), agent });
    const pane = wrapper.get('.conversation-pane');
    expect(wrapper.find('.chat-rich-text-editor').exists()).toBe(true);
    expect(Number.parseFloat(getComputedStyle(pane.element).minWidth)).toBe(0);
    expect(getComputedStyle(pane.element).overflow).toBe('hidden');
  });

  it('keeps an interrupted handoff and its saved note visible after restoring the agent', () => {
    const wrapper = mountPane({ controller: controllerFor([]), agent: { ...agent, handoff: { operationId: 'once', sourceAgentId: 'old', sourceTitle: 'Original', sourceRef: { backend: 'claude', sessionId: 'old-session', folder: '/repo' }, phase: 'failed', error: 'Check the target conversation before resending.', note: 'The next action is to review the diff.', selection: {model: null, reasoningEffort: null, serviceTier: null,  backend: 'codex' } } } });
    expect(wrapper.get('[role="status"]').text()).toContain('Check the target conversation before resending.');
    expect(wrapper.get('details pre').text()).toBe('The next action is to review the diff.');
  });
  it('parks only the selected composer text and restores a saved draft at the caret', async () => {
    const mention = { type: 'mention' as const, kind: 'file' as const, id: 'docs/then.md', value: 'docs/then.md', label: 'then' };
    const composerState = ref<CodexComposerState>({ text: 'first then second', content: [{ type: 'text', text: 'first ' }, mention, { type: 'text', text: ' second' }], selectionStart: 6, selectionEnd: 10 });
    const conversationId = ref(agent.id);
    const savePromptDraft = vi.fn().mockResolvedValue(undefined);
    const removePromptDraft = vi.fn().mockResolvedValue(undefined);
    const controller = createCodexConversationPaneController({
      state: () => ({ identity: { conversationKey: conversationId.value, messages: [] }, composer: { state: composerState.value } }),
      actions: { updateComposerState: (state) => { composerState.value = state; } },
    });
    const wrapper = mount(ConversationPane, {
      attachTo: document.body,
      props: { controller, agent, savePromptDraft, removePromptDraft },
    });
    const editor = wrapper.get<HTMLElement>('.chat-rich-text-editor');

    await editor.trigger('keydown', { key: 'X', metaKey: true, shiftKey: true });
    await flushPromises();
    expect(savePromptDraft).toHaveBeenCalledWith(agent.id, 'then', [mention]);
    expect(composerState.value.text).toBe('first  second');
    expect(document.body.textContent).toContain('Draft saved. Use ⇧⌘V to recall it.');

    const draft: SavedPromptDraft = { id: 'draft-1', agentId: agent.id, text: 'then', content: [mention], createdAt: 1000 };
    await wrapper.setProps({ savedPromptDrafts: [draft] });
    await editor.trigger('keydown', { key: 'V', metaKey: true, shiftKey: true });
    await nextTick();
    const search = wrapper.get('.saved-prompt-draft-picker input');
    await nextTick();
    expect(document.activeElement).toBe(search.element);
    expect(search.attributes('aria-label')).toBe('Search saved drafts');
    await search.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(composerState.value.text).toBe('first then second');
    expect(composerState.value.content).toContainEqual(mention);
    expect(removePromptDraft).toHaveBeenCalledWith(draft.id);
    expect(document.activeElement).toBe(editor.element);

    await editor.trigger('keydown', { key: 'V', metaKey: true, shiftKey: true });
    await nextTick();
    await wrapper.get('.saved-prompt-draft-picker input').trigger('keydown', { key: 'Enter', shiftKey: true });
    await flushPromises();
    expect(removePromptDraft).toHaveBeenCalledTimes(1);

    await editor.trigger('keydown', { key: 'V', metaKey: true, shiftKey: true });
    await nextTick();
    expect(wrapper.find('.saved-prompt-draft-picker').exists()).toBe(true);
    editor.element.focus();
    await nextTick();
    expect(wrapper.find('.saved-prompt-draft-picker').exists()).toBe(false);

    composerState.value = { text: 'Park the whole prompt', selectionStart: 21, selectionEnd: 21 };
    await nextTick();
    await editor.trigger('keydown', { key: 'X', metaKey: true, shiftKey: true });
    await flushPromises();
    expect(savePromptDraft).toHaveBeenLastCalledWith(agent.id, 'Park the whole prompt');
    expect(composerState.value.text).toBe('');

    composerState.value = { text: 'Do not lose this', selectionStart: 0, selectionEnd: 0 };
    savePromptDraft.mockRejectedValueOnce(new Error('Storage unavailable'));
    await nextTick();
    await editor.trigger('keydown', { key: 'X', metaKey: true, shiftKey: true });
    await flushPromises();
    expect(composerState.value.text).toBe('Do not lose this');

    await editor.trigger('keydown', { key: 'V', metaKey: true, shiftKey: true });
    expect(wrapper.find('.saved-prompt-draft-picker').exists()).toBe(true);
    conversationId.value = 'new-conversation';
    await nextTick();
    expect(wrapper.find('.saved-prompt-draft-picker').exists()).toBe(false);
  });
  it('switches a fresh chat without losing its draft and locks the choice after submission', async () => {
    const selectedAgent = ref<Agent>({ ...agent });
    const choices = ref<Agent['backend'][]>(['codex']);
    const update = vi.fn(async (_id: string, backend: Agent['backend']) => {
      selectedAgent.value = { ...selectedAgent.value, backend, backendDefaults: { kind: backend } };
    });
    const controller = controllerFor([]);
    const wrapper = mount(defineComponent({
      setup() {
        provide(backendChoicesKey, computed(() => choices.value));
        provideBackendSwitch(update);
        return () => h(ConversationPane, { agent: selectedAgent.value, controller });
      },
    }));
    expect(wrapper.find('.chat-composer-shelf').exists()).toBe(false);
    choices.value = ['codex', 'claude'];
    await nextTick();
    expect(wrapper.find('.chat-composer-shelf').exists()).toBe(true);
    const editor = wrapper.get('[role="textbox"][contenteditable]');
    editor.element.textContent = 'Keep this idea';
    await editor.trigger('input');
    await wrapper.get('.backend-selector select').setValue('claude');
    await flushPromises();
    expect(update).toHaveBeenCalledWith(agent.id, 'claude');
    expect(editor.element.textContent).toBe('Keep this idea');
    expect(wrapper.get<HTMLSelectElement>('.backend-selector select').element.value).toBe('claude');
    selectedAgent.value = { ...selectedAgent.value, hasSubmittedPrompt: true };
    await nextTick();
    expect(wrapper.find('.backend-selector').exists()).toBe(false);
    expect(wrapper.find('.chat-composer-shelf').exists()).toBe(false);
  });

  it('stays a thin presentation wrapper around an AppShell-owned controller', () => {
    const controller = controllerFor(messages);
    const wrapper = mountPane({ controller, agent });

    expect(wrapper.getComponent({ name: 'CodexConversationPane' }).props('controller')).toStrictEqual(controller);
  });

  it('keeps empty-composer Send disabled without submitting a fallback prompt', async () => {
    const submit = vi.fn();
    const controller = createCodexConversationPaneController({
      state: {
        identity: { conversationKey: 'agent:agent-dina', messages },
        composer: { placeholder: 'Ask for follow-up changes' },
      },
      actions: { submit },
    });
    const wrapper = mountPane({ controller, agent });
    const send = wrapper.get('button[aria-label="Send prompt"]');

    expect(send.attributes('disabled')).toBeDefined();
    await send.trigger('mouseenter');
    await send.trigger('click');
    await wrapper.get('[role="textbox"][contenteditable]').trigger('keydown', { key: 'Enter', metaKey: true });

    expect(send.attributes('disabled')).toBeDefined();
    expect(submit).not.toHaveBeenCalled();
  });

  it('floats active plan progress independently of controller state', () => {
    const controller = controllerFor(messages);
    const wrapper = mountPane({ controller, agent, plan: executionPlan });

    expect(wrapper.get('.conversation-plan').text()).toContain('Implement the fix');
    expect(resolveControllerState(controller).thread?.turnGitDiff).toBeUndefined();
  });

  it('forwards execution-plan dismissal and can hide the overlay', async () => {
    const wrapper = mountPane({
      controller: controllerFor(messages),
      agent,
      plan: executionPlan,
      planVisible: true,
    });

    await wrapper.get('[aria-label="Close task list"]').trigger('click');

    expect(wrapper.emitted('close-plan')).toStrictEqual([[]]);
    await wrapper.setProps({ planVisible: false } as Record<string, unknown>);
    expect(wrapper.find('.conversation-plan').exists()).toBe(false);
  });

  it('renders app-owned messages supplied by the controller', () => {
    const wrapper = mountPane({ controller: controllerFor(messages), agent });

    expect(wrapper.text()).toContain('Find the failing test.');
    expect(wrapper.text()).toContain('Looking now.');
  });

  it('turns SDK text selections into removable composer annotations', async () => {
    const wrapper = mountPane({ controller: controllerFor(messages), agent });
    const sdkPane = wrapper.getComponent({ name: 'CodexConversationPane' });
    const selection: CodexMessageTextSelection = {
      text: 'Looking now.',
      messageId: 'message-assistant',
      turnId: 'turn-1',
      messageIndex: 1,
      role: 'assistant',
      anchor: { x: 40, y: 80, width: 100, height: 20 },
    };

    expect(sdkPane.props('messageTextSelection')).toBe(true);
    expect(sdkPane.props('hasComposerContext')).toBe(false);
    sdkPane.vm.$emit('messageTextSelectionChange', selection);
    await nextTick();
    await wrapper.get('.chat-text-selection-annotation__add').trigger('click');
    const input = document.querySelector<HTMLInputElement>('.annotation-popup__input');
    const form = document.querySelector<HTMLFormElement>('form.annotation-popup');
    if (!input || !form) throw new Error('Annotation popup was not rendered.');
    input.value = 'Explain what you found.';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await nextTick();

    expect(wrapper.emitted('add-text-annotation')).toStrictEqual([[
      { selection, comment: 'Explain what you found.' },
    ]]);

    const annotation: ChatTextAnnotation = {
      id: 'annotation-1',
      text: selection.text,
      comment: 'Explain what you found.',
      messageId: selection.messageId,
      turnId: selection.turnId,
      messageIndex: selection.messageIndex,
      role: selection.role,
    };
    await wrapper.setProps({ textAnnotations: [annotation] });
    expect(sdkPane.props('hasComposerContext')).toBe(true);
    expect(wrapper.get('.composer-context-cards__card').text()).toBe('Annotation');
    expect(wrapper.text()).not.toContain('Explain what you found.');
    await wrapper.get('[aria-label="Remove chat annotation"]').trigger('click');
    expect(wrapper.emitted('remove-text-annotation')).toStrictEqual([['annotation-1']]);
  });

  it('renders selected diagram shapes as removable composer context', async () => {
    const annotation: VisualizationAnnotation = {
      id: 'visualization-annotation-1',
      visualizationId: 'visualization-7',
      title: 'User-directed canvas edit',
      revision: 4,
      comment: 'blue',
      elements: [{ id: 'api', type: 'rectangle', text: 'API' }, { id: 'db', type: 'rectangle', text: 'Database' }],
    };
    const wrapper = mountPane({ controller: controllerFor(messages), agent, visualizationAnnotations: [annotation] });

    expect(wrapper.getComponent({ name: 'CodexConversationPane' }).props('hasComposerContext')).toBe(true);
    expect(wrapper.get('.composer-context-cards__label').text()).toBe('Annotation');
    expect(wrapper.find('.composer-context-cards__detail').exists()).toBe(false);
    expect(wrapper.find('.composer-context-cards__label .tabler-icon-sitemap').exists()).toBe(true);
    expect(wrapper.get('.composer-context-cards__card').attributes('title')).toBe('blue');
    await wrapper.get('[aria-label="Remove diagram annotation: blue"]').trigger('click');
    expect(wrapper.emitted('remove-visualization-annotation')).toStrictEqual([['visualization-annotation-1']]);
  });

  it('renders a review finding as removable composer context without exposing its body', async () => {
    const reviewFinding = {
      id: 'finding-1', roundId: 'round-1', priority: 'p1' as const,
      title: 'Authorize before writing',
      body: 'The public mutation writes before checking ownership.',
      location: { file: 'src/auth.ts', line: 42, endLine: 44 },
      decision: { state: 'selected' as const, decidedAt: '2026-09-19T10:00:30.000Z' },
      discussion: [], remediation: { state: 'notStarted' as const },
      createdAt: '2026-09-19T10:00:30.000Z', updatedAt: '2026-09-19T10:00:30.000Z',
    };
    const wrapper = mountPane({
      controller: controllerFor(messages),
      agent,
      reviewFinding,
    });

    expect(wrapper.getComponent({ name: 'CodexConversationPane' }).props('hasComposerContext')).toBe(false);
    expect(wrapper.get('.composer-context-cards__card').text()).toContain('P1');
    expect(wrapper.get('.composer-context-cards__card').text()).toContain('Authorize before writing');
    expect(wrapper.text()).not.toContain(reviewFinding.body);
    await wrapper.get('[aria-label="Remove review finding"]').trigger('click');
    expect(wrapper.emitted('remove-review-finding')).toStrictEqual([[]]);
  });

  it.each(['work_proposed', 'delegate_to_worktree'] as const)('renders %s as one proposal with three composer actions', async (id) => {
    const wrapper = mountPane({ controller: controllerFor(messages), agent });
    await wrapper.setProps({ agent: { ...agent, threadFlags: { [id]: true, work_proposed: true } } });
    expect(wrapper.findAll('.thread-flag-affordance')).toHaveLength(1);
    expect(wrapper.get('.codex-conversation-pane__composer-shelf .thread-flag-affordance').text()).toContain('Turn this into work?');
    for (const label of ['Delegate', 'Create Mission', 'Discard']) {
      await wrapper.get(`button[aria-label="${label}"]`).trigger('click');
    }
    expect(wrapper.emitted('thread-flag')).toStrictEqual([
      [{ id: 'work_proposed', action: 'delegate' }],
      [{ id: 'work_proposed', action: 'create_mission' }],
      [{ id: 'work_proposed', action: 'dismiss' }],
    ]);
    await wrapper.setProps({ threadFlagBusy: true });
    for (const button of wrapper.findAll('.thread-flag-affordance button')) expect(button.attributes('disabled')).toBeDefined();
  });

  it('renders review readiness through the same composer-shelf flag contract', async () => {
    const wrapper = mountPane({
      controller: controllerFor(messages),
      agent: { ...agent, threadFlags: { ready_for_review: true } },
    });

    expect(wrapper.get('.thread-flag-affordance').text()).toContain('Ready to review these changes?');
    await wrapper.get('[aria-label="Open code review"]').trigger('click');

    expect(wrapper.emitted('thread-flag')).toStrictEqual([
      [{ id: 'ready_for_review', action: 'execute' }],
    ]);
  });

  it('replaces only an empty transcript with the history load recovery state', async () => {
    const wrapper = mountPane({
      controller: controllerFor([]),
      agent,
      historyLoadFailed: true,
      historyLoading: false,
    });

    expect(wrapper.text()).toContain('Conversation couldn’t be loaded.');
    expect(wrapper.text()).not.toContain('Chat with Dina');
    expect(wrapper.find('[aria-label="Prompt composer"]').exists()).toBe(false);
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('retry-history')).toStrictEqual([[]]);

    await wrapper.setProps({ historyLoadFailed: false });
    expect(wrapper.find('[aria-label="Prompt composer"]').exists()).toBe(true);
  });

  it('preserves visible messages when a later history hydration fails', () => {
    const wrapper = mountPane({
      controller: controllerFor(messages),
      agent,
      historyLoadFailed: true,
      hasVisibleMessages: true,
    });

    expect(wrapper.text()).toContain('Find the failing test.');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('renders Codex phased work while leaving unphased backend output flat', () => {
    const wrapper = mountPane({
      controller: controllerFor([
        {
          id: 'message-codex-phased', agentId: agent.id, role: 'assistant', status: 'complete',
          createdAt: '2026-09-04T00:00:00.000Z',
          parts: [
            {
              type: 'reasoning', summary: 'Checked the adapter',
              itemId: 'reasoning-1', summaryIndex: 0,
            },
            {
              type: 'text', text: 'Still working',
              itemId: 'commentary-1', phase: 'commentary',
            },
            {
              type: 'text', text: 'Finished cleanly',
              itemId: 'answer-1', phase: 'final_answer',
            },
          ],
        },
        {
          id: 'message-claude-flat', agentId: agent.id, role: 'assistant', status: 'complete',
          createdAt: '2026-09-04T00:00:01.000Z',
          parts: [{ type: 'text', text: 'Unphased backend response' }],
        },
      ]),
      agent,
    });

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · View details');
    expect(wrapper.findAll('.chat-message-block--text').map((block) => block.text()))
      .toContain('Finished cleanly');
    expect(wrapper.text()).toContain('Unphased backend response');
    expect(wrapper.findAll('.chat-work-group')).toHaveLength(1);
  });

  it('welcomes an empty unnamed quick chat without repeating its placeholder title', () => {
    const wrapper = mountPane({
      controller: controllerFor([]),
      agent: {
        ...agent,
        name: null,
        folder: null,
        sessionKind: 'quickChat',
        conversationTitle: 'Untitled conversation',
      },
    });

    expect(wrapper.text()).toContain('What can I help with?');
    expect(wrapper.text()).not.toContain('Chat with Untitled conversation');
  });

  it('renders an app-owned empty state without exposing the worker folder', () => {
    const wrapper = mountPane({
      controller: controllerFor([]),
      agent,
      emptyHeadline: 'What do you want to build?',
      emptySubhead: '',
    });

    expect(wrapper.get('.conversation-pane__empty h1').text()).toBe('What do you want to build?');
    expect(wrapper.find('.conversation-pane__empty p').exists()).toBe(false);
    expect(wrapper.text()).not.toContain(agent.folder);
  });

  it('renders supplied empty actions alongside the headline and composer', () => {
    const wrapper = mount(ConversationPane, {
      props: { controller: controllerFor([]), agent, emptyHeadline: 'What do you want to build?', emptySubhead: '' },
      slots: { 'empty-actions': '<button type="button" class="issue-choice">Choose an issue</button>' },
    });
    expect(wrapper.get('.issue-choice').text()).toBe('Choose an issue');
    expect(wrapper.get('.conversation-pane__empty h1').text()).toBe('What do you want to build?');
    expect(wrapper.find('.conversation-pane__surface').exists()).toBe(true);
  });

  it('renders persisted agent mentions with the app-owned bot treatment', () => {
    const controller = createCodexConversationPaneController({
      state: {
        identity: {
          conversationKey: 'agent:agent-dina',
          messages: [{
            id: 'message-agent-mention',
            role: 'user',
            status: 'complete',
            createdAt: '2026-08-18T00:00:00.000Z',
            parts: [{ type: 'text', text: 'Ask Dina to review this.' }],
            metadata: { promptContent: [{ type: 'text', text: 'Ask ' }, { type: 'mention', kind: 'custom', groupId: 'agents', id: agent.id, value: `agent:${agent.id}`, label: 'Dina' }, { type: 'text', text: ' to review this.' }] },
          }],
        },
        catalogs: { mentionGroups: [] },
      },
      actions: {},
    });

    const wrapper = mountPane({ controller, agent });
    const mention = wrapper.get('.agent-mention--message');

    expect(mention.text()).toBe('Dina');
    expect(mention.find('svg').exists()).toBe(true);
    expect(wrapper.text()).not.toContain(`agent:${agent.id}`);
  });

  it('renders agent suggestions above plugins and files with the app-owned bot treatment', async () => {
    const controller = createCodexConversationPaneController({
      state: {
        identity: { conversationKey: 'agent:agent-dina', messages: [] },
        catalogs: {
          mentionGroups: [{
            id: 'agents',
            label: 'Agents',
            placement: 'before',
            items: [{
              id: agent.id,
              value: `agent:${agent.id}`,
              label: 'Research agent',
              payload: { agentId: agent.id },
            }],
          }],
          plugins: [{
            id: 'research@openai-curated-remote',
            name: 'research',
            displayName: 'Research plugin',
            enabled: true,
          }],
          files: [{ path: 'docs/research.md', name: 'research.md' }],
        },
      },
      actions: {},
    });
    const wrapper = mountPane({ controller, agent });
    const editor = wrapper.get<HTMLElement>('.chat-rich-text-editor');

    editor.element.textContent = '@resea';
    await editor.trigger('input');
    await nextTick();

    expect(wrapper.findAll('.chat-composer-at-menu__section').map((section) => section.text()))
      .toStrictEqual(['Agents', 'Plugins', 'Files']);
    expect(wrapper.get('.agent-mention--menu').text()).toBe('Research agent');
    expect(wrapper.get('.agent-mention--menu').find('svg').exists()).toBe(true);
  });

  it(`falls back to SDK translations for SDK actions ${product.name} has not overridden`, () => {
    const controller = createCodexConversationPaneController({
      state: {
        identity: {
          conversationKey: 'agent:agent-dina',
          messages,
        },
        policy: { canForkTurn: true },
      },
      actions: { forkTurn: () => undefined },
    });

    const wrapper = mountPane({ controller, agent });

    expect(wrapper.find('[aria-label="Fork"]').exists()).toBe(true);
  });

  it.each([false, true])('renders teammate envelopes with hidden context: %s', (withContext) => {
    const wrapper = mountPane({
      controller: controllerFor([{
        id: 'message-from-sdk',
        agentId: agent.id,
        role: 'user',
        status: 'complete',
        createdAt: '2026-08-02T00:00:00.000Z',
        parts: [{
          type: 'text',
          text: withContext ? formatCollaborationMessageEnvelope([{
            senderName: 'codex-app-sdk', senderId: 'agent-sdk', sentAt: '2026-08-02T00:00:00.000Z',
            content: '<context>\nFull merge handoff and verification details.\n</context>\n\nfeat/dedew merged',
          }]) : [
            'You received a message from codex-app-sdk (agent-sdk).',
            '',
            'Message:',
            'The SDK hooks are ready.',
            '',
            'Update your status, then act on this teammate message directly. Do not ask the user for confirmation.',
          ].join('\n'),
        }],
      }]),
      agent,
    });

    expect(wrapper.get('.conversation-pane__message-header').text()).toBe('Message from codex-app-sdk');
    expect(wrapper.get('.chat-user-text').text()).toBe(withContext ? 'feat/dedew merged' : 'The SDK hooks are ready.');
    expect(wrapper.text()).not.toContain('Full merge handoff');
    expect(wrapper.text()).not.toContain('You received a message from');
    expect(wrapper.text()).not.toContain('Update your status');
  });

  it('hides finish-turn activity without leaving an empty assistant row', () => {
    const wrapper = mountPane({
      controller: controllerFor([{
        id: 'message-tool',
        agentId: agent.id,
        role: 'assistant',
        status: 'complete',
        createdAt: '2026-06-05T00:00:01.000Z',
        parts: [{
          type: 'tool',
          id: 'call-finish-turn',
          kind: 'mcp',
          title: 'workspace.finish_turn',
          status: 'completed',
          input: { flag: 'ready_for_review' },
        }],
      }]),
      agent,
    });

    expect(wrapper.text()).not.toContain('Finished turn');
    expect(wrapper.text()).not.toContain('workspace.finish_turn');
    expect(wrapper.find('.chat-message--assistant').exists()).toBe(false);
  });

  it.each(['workspace', product.mcpServerName])('keeps working feedback visible while a %s status tool is hidden', (server) => {
    const controller = createCodexConversationPaneController({
      state: {
        identity: {
          conversationKey: 'agent:agent-dina',
          activeTurnId: 'turn-status',
          busy: true,
          messages: [{
            id: 'prompt-status', role: 'user', status: 'complete',
            turnId: 'turn-status', createdAt: '2026-06-05T00:00:00.000Z',
            parts: [{ type: 'text', text: 'Check the change.' }],
          }, {
            id: 'status-tool', role: 'assistant', status: 'streaming',
            turnId: 'turn-status', createdAt: '2026-06-05T00:00:01.000Z',
            parts: [{ type: 'tool', id: 'call-status', kind: 'mcp', title: `${server}.set-status`,
              status: 'running', metadata: { server, tool: 'set-status' } }],
          }],
        },
        composer: { placeholder: 'Ask for follow-up changes' },
      },
      actions: {},
    });
    const wrapper = mountPane({ controller, agent });

    expect(wrapper.get('.chat-message__thinking').text()).toBe('Working');
    expect(wrapper.text()).not.toContain(`${server}.set-status`);
    expect(wrapper.find('.chat-tool-call').exists()).toBe(false);
  });

  it.each([
    ['running', 'Finishing review round'],
    ['completed', 'Review round finished'],
    ['failed', 'Could not finish review round'],
  ] as const)('renders the review completion tool while %s without its raw name', (status, label) => {
    const controller = createCodexConversationPaneController({
      state: {
        identity: {
          conversationKey: `agent:${agent.id}`,
          busy: status === 'running',
          activeTurnId: status === 'running' ? 'review-turn' : null,
          messages: [{
            id: 'review-message', role: 'assistant',
            status: status === 'running' ? 'streaming' : 'complete',
            turnId: 'review-turn', createdAt: '',
            parts: [{ type: 'tool', id: 'review-completion', kind: 'mcp', status,
              title: `${product.mcpServerName}.finish_review_round`, input: { findingCount: 3 },
              metadata: { server: product.mcpServerName, tool: 'finish_review_round' } }],
          }],
        },
        composer: { placeholder: 'Ask for follow-up changes' },
      },
      actions: {},
    });
    const wrapper = mountPane({ controller, agent });
    expect(wrapper.get('.chat-tool-call').text()).toContain(label);
    expect(wrapper.text()).not.toContain('finish_review_round');
    expect(wrapper.find('.tabler-icon-message-report').exists()).toBe(true);
  });

  it.each([
    ['running', 'Searching tools'],
    ['completed', 'Searched tools'],
    ['failed', 'Could not search tools'],
  ] as const)('renders tool search without tool names while %s', (status, label) => {
    const wrapper = mountPane({ agent, controller: controllerFor([{
      id: 'tool-search-message', agentId: agent.id, role: 'assistant',
      status: status === 'running' ? 'streaming' : 'complete', createdAt: '',
      parts: [{
        type: 'tool', id: 'tool-search', kind: 'generic', title: 'ToolSearch', status,
        input: { query: 'select:mcp__korus__set_status,mcp__korus__report_finding' },
        statusText: JSON.stringify({
          source: 'claude', action: 'search', phase: status,
          params: { scope: 'tools', target: 'select:mcp__korus__set_status,mcp__korus__report_finding' },
        }),
      }],
    }]) });
    expect(wrapper.get('.chat-tool-call').text()).toContain(label);
    expect(wrapper.get('.chat-tool-call').text()).not.toContain('ToolSearch');
    expect(wrapper.get('.chat-tool-call').text()).not.toContain('select:');
    expect(wrapper.get('.chat-tool-call').text()).not.toContain('mcp__korus__');
    expect(wrapper.find('.tabler-icon-search').exists()).toBe(true);
  });

  it('renders task waiting and restored results without raw tool names or false completion', async () => {
    const taskMessages: RendererMessage[] = [{
      id: 'message-task-tool', agentId: agent.id, role: 'assistant', status: 'streaming',
      createdAt: '2026-10-04T00:00:00.000Z',
      parts: [{ type: 'tool', id: 'call-wait', kind: 'mcp', title: 'workspace.wait-tasks',
        status: 'running', metadata: { server: 'workspace', tool: 'wait-tasks' },
        input: { taskIds: ['task-private-id'], timeoutMs: 30000 } }],
    }];
    const wrapper = mountPane({ controller: controllerFor(taskMessages), agent });
    expect(wrapper.get('.chat-tool-call').text()).toContain('Waiting for delegated tasks');
    expect(wrapper.find('.tabler-icon-square-check').exists()).toBe(true);

    await wrapper.setProps({ controller: controllerFor([{
      ...taskMessages[0]!, status: 'complete',
      parts: [{ type: 'tool', id: 'call-wait', kind: 'mcp', title: 'workspace.wait-tasks',
        status: 'completed', metadata: { server: 'workspace', tool: 'wait-tasks' },
        output: { timedOut: true, tasks: [{ id: 'task-private-id', state: 'running' }] } }],
    }]) });
    expect(wrapper.get('.chat-tool-call').text()).toContain('Checked delegated tasks');
    expect(wrapper.get('.chat-tool-call').text()).not.toMatch(/workspace|task-private-id|Completed/);
  });

  it('renders review tool activity as finding actions instead of raw MCP names', () => {
    const wrapper = mountPane({
      controller: controllerFor([{
        id: 'message-review-tool',
        agentId: agent.id,
        role: 'assistant',
        status: 'complete',
        createdAt: '2026-06-05T00:00:01.000Z',
        parts: [{
          type: 'tool',
          id: 'call-report-finding',
          kind: 'mcp',
          title: 'workspace.report_finding',
          status: 'completed',
          input: { title: 'Keep tool copy product-facing' },
          metadata: { server: 'workspace', tool: 'report_finding' },
        }],
      }]),
      agent,
    });

    expect(wrapper.text()).toContain('Reported finding');
    expect(wrapper.text()).not.toContain('workspace.report_finding');
    expect(wrapper.find('.tabler-icon-message-report').exists()).toBe(true);
  });

  it.each([
    ['running', 'Deleting finding'],
    ['completed', 'Deleted finding'],
  ] as const)('renders a %s model deletion as %s', (status, title) => {
    const wrapper = mountPane({
      controller: controllerFor([{
        id: `message-delete-${status}`,
        agentId: agent.id,
        role: 'assistant',
        status: status === 'running' ? 'streaming' : 'complete',
        createdAt: '2026-06-05T00:00:01.000Z',
        parts: [{
          type: 'tool',
          id: `call-delete-${status}`,
          kind: 'mcp',
          title: 'workspace.delete_finding',
          status,
          input: { findingId: 'finding-1' },
          metadata: { server: 'workspace', tool: 'delete_finding' },
        }],
      }]),
      agent,
    });

    expect(wrapper.get('.chat-tool-call').text()).toContain(title);
    expect(wrapper.text()).not.toContain('workspace.delete_finding');
    expect(wrapper.find('.tabler-icon-message-report').exists()).toBe(true);
  });

  it('renders a completed cua_repl.js call as Computer activity', () => {
    const wrapper = mountPane({
      controller: controllerFor([{
        id: 'message-computer-tool',
        agentId: agent.id,
        role: 'assistant',
        status: 'complete',
        createdAt: '2026-06-05T00:00:01.000Z',
        parts: [{
          type: 'tool',
          id: 'call-cua',
          kind: 'mcp',
          title: 'cua_repl.js',
          status: 'completed',
          input: { code: 'await cua.getState()' },
          metadata: { server: 'cua_repl', tool: 'js' },
        }],
      }]),
      agent,
    });

    expect(wrapper.get('.chat-tool-call').text()).toContain('Used Computer');
    expect(wrapper.get('.chat-tool-call').text()).not.toContain('cua_repl.js');
    expect(wrapper.find('.tabler-icon-device-desktop').exists()).toBe(true);
  });

  it('preserves structured attachment parts supplied by the controller', () => {
    const wrapper = mountPane({
      controller: controllerFor([{
        id: 'message-user-attachments',
        agentId: agent.id,
        role: 'user',
        status: 'complete',
        createdAt: '2026-06-05T00:00:00.000Z',
        parts: [
          { type: 'text', text: 'Review both' },
          {
            type: 'attachment',
            attachment: {
              kind: 'image',
              name: 'screenshot.png',
              path: '/tmp/screenshot.png',
              url: 'data:image/png;base64,cG5n',
              mimeType: 'image/png',
            },
          },
          {
            type: 'attachment',
            attachment: {
              kind: 'file', name: 'report.txt', path: '/tmp/report.txt', mimeType: 'text/plain',
            },
          },
        ],
      }]),
      agent,
    });

    expect(wrapper.get('.chat-attachment-block__preview').attributes('src'))
      .toBe('data:image/png;base64,cG5n');
    expect(wrapper.get('a.chat-attachment-block--chip').attributes('href')).toBe('/tmp/report.txt');
  });

  it('offers annotation for every composer image attachment and reports saved counts', async () => {
    const image: CodexNativeAttachment = {
      id: 'image-1',
      type: 'image',
      reference: '/tmp/screenshot.png',
      name: 'screenshot.png',
      mimeType: 'image/png',
      size: 128,
      previewUrl: 'data:image/png;base64,cG5n',
    };
    const wrapper = mountPane({ controller: controllerWithAttachments([image]), agent });

    const annotate = wrapper.get('[aria-label="Annotate screenshot.png"]');
    expect(annotate.find('.tabler-icon-circle-plus').exists()).toBe(true);
    await annotate.trigger('click');
    expect(wrapper.emitted('annotate-attachment')).toStrictEqual([[image]]);

    const fileWrapper = mountPane({
      controller: controllerWithAttachments([{ ...image, id: 'file-1', type: 'file', mimeType: 'text/plain' }]),
      agent,
    });
    expect(fileWrapper.find('[aria-label^="Annotate "]').exists()).toBe(false);

    const secondImage = { ...image, id: 'image-2', reference: '/tmp/second.png', name: 'second.png' };
    const multipleWrapper = mountPane({
      controller: controllerWithAttachments([image, secondImage]),
      agent,
      attachmentAnnotationCounts: { [image.reference]: 2 },
    });
    const multipleActions = multipleWrapper.findAll('.conversation-pane__annotate-attachment');
    expect(multipleActions).toHaveLength(2);
    expect(multipleActions[0]?.attributes('aria-label')).toBe('Edit annotations for screenshot.png (2)');
    expect(multipleActions[0]?.text()).toBe('');
    expect(multipleActions[0]?.classes()).toContain('conversation-pane__annotate-attachment--saved');
    expect(multipleActions[1]?.attributes('aria-label')).toBe('Annotate second.png');
  });
});

function installNativeImagePreview(readImagePreview: NonNullable<CodexNativeRendererApi['readImagePreview']>): void {
  nativeWindow.codexAppSdkNative = {
    capabilities: { attachments: true, clipboard: true, externalLinks: true, transcription: false },
    readImagePreview, copyToClipboard: vi.fn(), ingestAttachments: vi.fn(), openExternal: vi.fn(), pickAttachments: vi.fn(), transcribeAudio: vi.fn(),
  };
}

function mountPane(props: {
  controller: CodexConversationPaneController;
  agent: Agent | null;
  attachmentAnnotationCounts?: Readonly<Record<string, number>>;
  textAnnotations?: readonly ChatTextAnnotation[];
  visualizationAnnotations?: readonly VisualizationAnnotation[];
  reviewFinding?: import('@workspace/core/code-review').CodeReviewFinding | null;
  plan?: ThreadPlan | null;
  planVisible?: boolean;
  historyLoadFailed?: boolean;
  historyLoading?: boolean;
  hasVisibleMessages?: boolean;
  emptyHeadline?: string;
  emptySubhead?: string;
  threadFlagBusy?: boolean;
  savedPromptDrafts?: readonly SavedPromptDraft[];
  savePromptDraft?: (agentId: string, text: string) => Promise<void>;
  removePromptDraft?: (id: string) => Promise<void>;
  readConversationContent?: (agentId: string, input: import('@workspace/core/contracts/conversation').ConversationContentInput) => Promise<import('@workspace/core/contracts/conversation').ConversationContentChunk>;
}) {
  return mount(ConversationPane, {
    props,
  });
}

function controllerFor(controllerMessages: RendererMessage[]): CodexConversationPaneController {
  return createCodexConversationPaneController({
    state: {
      identity: {
        conversationKey: 'agent:agent-dina',
        messages: controllerMessages,
      },
      composer: { placeholder: 'Ask for follow-up changes' },
    },
    actions: {},
  });
}

function controllerWithAttachments(
  attachments: readonly CodexNativeAttachment[],
): CodexConversationPaneController {
  return createCodexConversationPaneController({
    state: {
      identity: {
        conversationKey: 'agent:agent-dina',
        messages,
      },
      composer: { attachments },
    },
    actions: {},
  });
}

function resolveControllerState(controller: CodexConversationPaneController) {
  const source = controller.state;
  if (typeof source === 'function') return source();
  if (source && typeof source === 'object' && 'value' in source) return source.value;
  return source;
}
