import { provideToolCallDetails } from '@korus-dev/agent-ui-sdk';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, h, ref, shallowReactive } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '@workspace/core/contracts';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { claudeProviderCapabilities } from '@workspace/core/provider-capabilities';
import type { AgentRequest, SessionState } from '@korus-dev/multi-agent-sdk';
import { createAgentComposerState } from '../../agent-composer-state';
import { conversationFrom, runningTurn, sessionState } from '../../../tests/support/conversation-fixtures';
import type { AgentConversationView } from '../../app-state';
import type { AgentConversationActions } from '../use-agent-conversation';
import AgentConversationPanel from '../AgentConversationPanel.vue';
import { providerChoicesKey, provideProviderSwitch } from '../provider-selection';
import { cursorProviderCapabilities } from '@workspace/core/provider-capabilities';

type SessionView = AgentConversationView & { session: SessionState | null };
const toolConfirmation = (id: string, confirmation: Extract<AgentRequest, { kind: 'toolConfirmation' }>['confirmation']): AgentRequest =>
  ({ id, conversationId: 'session', turnId: 'turn', kind: 'toolConfirmation', confirmation });

describe('AgentConversationPanel', () => {
  it('lets a fresh conversation switch harness from the model picker, then keeps the one it runs', async () => {
    const snapshot = createInitialSnapshot();
    const agent = { ...snapshot.agents[0]!, provider: 'codex' as const, providerDefaults: { kind: 'codex' as const }, providerSession: undefined };
    snapshot.agents[0] = agent;
    const composer = createAgentComposerState({ getSnapshot: () => snapshot });
    const view = shallowReactive<SessionView>({
      get conversation() { return conversationFrom(this.agent, this.session); },
      agent, session: null, composer: composer.configurationForAgent(agent.id),
      composerState: { text: '', selectionStart: 0, selectionEnd: 0 }, attachments: [], capabilities: cursorProviderCapabilities,
      approvals: [], sending: false, queuedPrompts: [], history: { failed: false, hydrating: false, hasOlder: false, loadingOlder: false }, answeredClientRequestIds: new Set(),
    });
    const actions = { prepare: vi.fn(), updateComposerState: vi.fn(), updateAttachments: vi.fn() } as unknown as AgentConversationActions;
    const update = vi.fn(async (_id: string, provider: Agent['provider']) => { view.agent = { ...view.agent, provider }; });
    const wrapper = mount({ setup() {
      provideProviderSwitch(update);
      return () => h(AgentConversationPanel, { view, actions, agents: [agent], focused: true, mentionGroups: [],
        savedPromptDrafts: [], savePromptDraft: vi.fn(), removePromptDraft: vi.fn(), openLink: vi.fn(), openImage: vi.fn(), openVisualization: vi.fn() });
    } }, { attachTo: document.body, global: { provide: { [providerChoicesKey as symbol]: computed(() => ['codex', 'claude', 'cursor']) } } });
    try {
      const picker = () => wrapper.get('[aria-label="Coding agent and model"]');
      const tab = (label: string) => wrapper.get(`[role="tab"][aria-label="${label}"]`);
      await picker().trigger('click');
      expect(wrapper.findAll('[role="tab"]')).toHaveLength(3);
      await tab('Cursor').trigger('click');
      await flushPromises();
      expect(update).toHaveBeenCalledExactlyOnceWith(agent.id, 'cursor');
      expect(tab('Cursor').attributes('aria-selected')).toBe('true');

      view.session = sessionState({ messages: [{ id: 'hello', agentId: agent.id, turnId: 'turn', role: 'user', status: 'complete', createdAt: '2026-11-11T00:00:00.000Z', parts: [{ type: 'text', text: 'Hi' }] }] });
      await flushPromises();
      await picker().trigger('click');
      expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
    } finally { wrapper.unmount(); }
  });

  it('renders Cursor model/effort selection, file links and media with interrupt, confirm and continue', async () => {
    const snapshot = createInitialSnapshot();
    const agent = { ...snapshot.agents[0]!, provider: 'cursor' as const, providerDefaults: { kind: 'cursor' as const }, providerSession: undefined };
    snapshot.agents[0] = agent;
    const capabilities = { ...cursorProviderCapabilities, reasoningEffort: true };
    snapshot.providerRuntimes = [{ provider: 'cursor', status: 'running', capabilities }];
    const composer = createAgentComposerState({ getSnapshot: () => snapshot });
    composer.handleMainEvent({ type: 'models.changed', provider: 'cursor', seq: 1, occurredAt: '', payload: { models: [
      { id: 'native-plain', model: 'native-plain', displayName: 'Cursor Plain', isDefault: true },
      { id: 'native-enum', model: 'native-enum', displayName: 'Cursor Enum', defaultReasoningEffort: 'low',
        supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }, { reasoningEffort: 'extra-high', description: '' }] },
    ] } });
    const sent = vi.fn();
    const view = shallowReactive<SessionView>({
      get conversation() { return conversationFrom(this.agent, this.session); },
      agent, session: null,
      composer: composer.configurationForAgent(agent.id),
      composerState: { text: 'Hello Cursor', selectionStart: 12, selectionEnd: 12 }, attachments: [], capabilities,
      approvals: [], sending: false, queuedPrompts: [], history: { failed: false, hydrating: false, hasOlder: false, loadingOlder: false }, answeredClientRequestIds: new Set(),
    });
    const actions: AgentConversationActions = {
      planReview: vi.fn(), clearGoal: vi.fn(), threadFlag: vi.fn(), prepare: vi.fn(), loadOlder: vi.fn(), send: vi.fn(async (id, text, options) => { sent(id, text, composer.resolvePromptOptions(id, text, options)); }), steer: vi.fn(), interrupt: vi.fn(),
      deleteTurn: vi.fn(), editTurn: vi.fn(), forkTurn: vi.fn(), retryTurn: vi.fn(), continueInterruptedTurn: vi.fn(), respond: vi.fn(),
      selectModel: vi.fn(composer.selectModelForAgent), selectReasoningEffort: vi.fn(composer.selectReasoningEffortForAgent), selectServiceTier: vi.fn(), setPlanMode: vi.fn(), setPermissionMode: vi.fn(async (_id, mode) => { view.agent = { ...view.agent, providerDefaults: { kind: 'cursor', permission: mode } }; }),
      updateComposerState: (_id, state) => { view.composerState = state; }, updateAttachments: vi.fn(), deleteQueuedPrompt: vi.fn(), updateQueuedPrompt: vi.fn(), steerQueuedPrompt: vi.fn(),
    };
    const rawDetails = ref(false);
    const openLink = vi.fn();
    const wrapper = mount({ setup() {
      provideToolCallDetails(rawDetails);
      return () => h(AgentConversationPanel, { view, actions, agents: [agent], focused: true, mentionGroups: [],
      savedPromptDrafts: [], savePromptDraft: vi.fn(), removePromptDraft: vi.fn(), openLink, openImage: vi.fn(), openVisualization: vi.fn(),
    });
    } }, { global: { provide: { [providerChoicesKey as symbol]: computed(() => ['codex', 'cursor']) } } });
    try {
      await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
      const permissions = wrapper.findAll('[role="menuitem"]').find(item => item.text().includes('Permissions'));
      expect(permissions).toBeDefined();
      await permissions!.trigger('mouseenter');
      const choices = wrapper.findAll('[role="menuitemradio"]');
      expect(choices.map(choice => choice.text())).toEqual([expect.stringContaining('Ask for approval'), expect.stringContaining('Full access')]);
      expect(choices[0]!.attributes('aria-checked')).toBe('true');
      await choices[1]!.trigger('click');
      expect(actions.setPermissionMode).toHaveBeenCalledExactlyOnceWith(agent.id, 'full-access');
      await flushPromises();
      await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
      await wrapper.findAll('[role="menuitem"]').find(item => item.text().includes('Permissions'))!.trigger('mouseenter');
      const updatedChoices = wrapper.findAll('[role="menuitemradio"]');
      expect(updatedChoices.map(choice => choice.attributes('aria-checked'))).toEqual(['false', 'true']);
      await updatedChoices[0]!.trigger('click');
      await flushPromises();
      expect(actions.setPermissionMode).toHaveBeenLastCalledWith(agent.id, 'default');
      await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
      await wrapper.findAll('[role="menuitem"]').find(item => item.text().includes('Permissions'))!.trigger('mouseenter');
      expect(wrapper.findAll('[role="menuitemradio"]').map(choice => choice.attributes('aria-checked'))).toEqual(['true', 'false']);
      await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
      await wrapper.get('[aria-label="Coding agent and model"]').trigger('click');
      await flushPromises();
      await wrapper.findAll('[role="menuitem"]').find(item => item.text().includes('Cursor Enum'))!.trigger('mouseenter');
      await flushPromises();
      await wrapper.findAll('[role="menuitemradio"]').find(item => item.text().trim() === 'extra-high')!.trigger('click');
      await flushPromises();
      expect(actions.selectModel).toHaveBeenCalledExactlyOnceWith(agent.id, 'native-enum');
      expect(actions.selectReasoningEffort).toHaveBeenCalledExactlyOnceWith(agent.id, 'extra-high');
      expect(wrapper.get('[aria-label="Coding agent and model"]').text()).toContain('extra-high');
      await wrapper.get('form').trigger('submit'); await flushPromises();
      expect(sent).toHaveBeenLastCalledWith(agent.id, 'Hello Cursor', { selection: { model: 'native-enum', reasoningEffort: 'extra-high' }, planMode: false });
      await wrapper.get('[aria-label="Coding agent and model"]').trigger('click');
      await flushPromises();
      await wrapper.findAll('[role="menuitemradio"]').find(item => item.text().trim() === 'Cursor Plain')!.trigger('click');
      await flushPromises();
      expect(actions.selectModel).toHaveBeenLastCalledWith(agent.id, 'native-plain');
      expect(actions.selectReasoningEffort).toHaveBeenCalledTimes(1);
      expect(wrapper.get('[aria-label="Coding agent and model"]').text()).not.toContain('extra-high');
      view.composerState = { text: 'Plain Cursor', selectionStart: 12, selectionEnd: 12 };
      await flushPromises();
      await wrapper.get('form').trigger('submit'); await flushPromises();
      expect(sent).toHaveBeenLastCalledWith(agent.id, 'Plain Cursor', { selection: { model: 'native-plain' }, planMode: false });
      const identity = { occurredAt: '2026-11-03T12:00:00Z' };
      const diffBody = 'File: synthetic.txt\nBefore:\nBEFORE\nAfter:\nAFTER\n\nfile:///observed.txt\nObserved resource contents';
      const imageUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMfcAAAAASUVORK5CYII=';
      view.session = sessionState({ busy: true, activeTurnId: 'turn', turns: [runningTurn('turn')], messages: [{ id: 'answer', agentId: agent.id, turnId: 'turn', role: 'assistant', status: 'streaming', createdAt: identity.occurredAt,
        parts: [{ type: 'text', text: 'Cursor streamed reply' },
          { type: 'tool', id: 'tool', kind: 'fileChange', title: 'Edit synthetic.txt', status: 'completed', statusText: JSON.stringify({ source: 'cursor', action: 'edit', phase: 'completed', params: { target: 'synthetic.txt' } }), body: diffBody, metadata: { cwd: '/workspace', changes: [{ path: 'synthetic.txt', kind: 'update', oldText: 'BEFORE', newText: 'AFTER' }] } },
          { type: 'media', itemId: 'cursor-tool:tool:0', media: { url: imageUrl, mimeType: 'image/png', alt: 'Image' } }] }] });
      view.composerState = { text: '', selectionStart: 0, selectionEnd: 0 };
      await flushPromises();
      expect(wrapper.text()).toContain('Cursor streamed reply');
      const fileLink = wrapper.get('a.chat-tool-call__title-target--link');
      expect(fileLink.text()).toBe('synthetic.txt');
      expect(fileLink.attributes('href')).toBe('/workspace/synthetic.txt');
      await fileLink.trigger('click');
      expect(openLink).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'file', path: '/workspace/synthetic.txt', action: 'edit' }));
      expect(wrapper.get('.chat-media-block img').attributes()).toMatchObject({ src: imageUrl, alt: 'Image' });
      expect(wrapper.find('.chat-tool-call__details-toggle').exists()).toBe(false);
      rawDetails.value = true;
      await flushPromises();
      await wrapper.get('.chat-tool-call__details-toggle').trigger('click');
      await flushPromises();
      expect(wrapper.findAll('.chat-tool-call__body pre').at(-1)!.text()).toBe(diffBody);
      rawDetails.value = false;
      view.session = {...view.session!, messages:[...view.session!.messages,{id:'coordination',agentId:agent.id,turnId:'turn',role:'assistant',status:'complete',createdAt:identity.occurredAt,
        parts:[{type:'reasoning',itemId:'thought-1',summaryIndex:0,summary:'Checking status first. Then launching System Settings with a lengthy explanation of each planned tool call.'},
          ...['set-status','send-message','finish_turn'].map(tool=>({type:'tool' as const,id:tool,kind:'mcp',title:`korus: ${tool}`,status:'completed' as const,input:{to:'other-agent'},output:{recipientName:'Other Agent'},metadata:{server:'korus',tool}}))]},
        {id:'thought-only',agentId:agent.id,turnId:'turn',role:'assistant',status:'streaming',createdAt:identity.occurredAt,
          parts:[{type:'reasoning',itemId:'thought-2',summaryIndex:0,summary:'More internal explanation without a tool or assistant message yet.'}]}]};
      await flushPromises();
      for (const header of wrapper.findAll('button.chat-tool-group__header')) await header.trigger('click');
      expect(wrapper.text()).toContain('Sent message to Other Agent');
      expect(wrapper.text()).toContain('Cursor streamed reply');
      expect(wrapper.text()).not.toContain('Checking status first.');
      expect(wrapper.text()).not.toContain('More internal explanation');
      expect(view.conversation!.messages.some(message => message.id === 'thought-only')).toBe(false);
      expect(view.session!.messages.find(message => message.id === 'coordination')!.parts[0]).toMatchObject({type:'reasoning',summary:expect.stringContaining('Checking status first.')});
      expect(view.session!.messages.find(message => message.id === 'thought-only')!.parts).toHaveLength(1);
      expect(wrapper.text()).not.toContain('korus: set-status');
      expect(wrapper.text()).not.toContain('korus: finish_turn');

      await wrapper.get('button[title="Interrupt"]').trigger('click');
      expect(actions.interrupt).toHaveBeenCalledWith(agent.id);
      view.agent = { ...view.agent, providerSession: { kind: 'cursor', conversationId: 'session' }, planReview: { id: 'review', conversationId: 'old-session', turnId: 'turn', requestId: 'sidebar-plan', markdown: '# Translation', status: 'pending' } };
      view.session = { ...view.session!, requests: [toolConfirmation('sidebar-plan',
        { integrationId: 'native-provider', integrationName: 'Provider', toolName: 'native_plan_request', summary: 'Review Cursor plan', argumentsPreview: '# Translation', allowAlways: false })] };
      await flushPromises();
      expect(wrapper.get('.agent-ui-conversation-pane__footer').text()).toContain('Review Cursor plan');
      view.agent = { ...view.agent, planReview: { ...view.agent.planReview!, conversationId: 'session' } };
      await flushPromises();
      expect(wrapper.find('.chat-tool-confirmation').exists()).toBe(false);
      view.session = { ...view.session!, requests: [toolConfirmation('cursor-permission',
        { integrationId: 'cursor', integrationName: 'Cursor', toolName: 'Shell', summary: 'Run tests?', argumentsPreview: 'npm test', allowAlways: false, allowConversation: false })] };
      await flushPromises();
      expect(wrapper.get('.agent-ui-conversation-pane__footer').text()).toContain('Run tests?');
      await wrapper.get('.agent-ui-conversation-pane__footer').findAll('button').find(button => button.text() === 'Deny')!.trigger('click');
      expect(actions.respond).toHaveBeenCalledWith(agent.id, { id: 'cursor-permission', outcome: { kind: 'decision', decision: 'deny' } });
      view.session = { ...view.session!, busy: false, activeTurnId: null, requests: [],
        turns: view.session!.turns.map(turn => ({ ...turn, status: 'interrupted' as const })) };
      await flushPromises();
      await wrapper.get('button[aria-label="Continue"]').trigger('click');
      expect(actions.continueInterruptedTurn).toHaveBeenCalledExactlyOnceWith(agent.id);
    } finally { wrapper.unmount(); }
  });
  it('toggles Goal mode in a Claude composer and submits the objective to that agent', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[1]!;
    agent.provider = 'claude'; agent.providerDefaults = { kind: 'claude' };
    const view = shallowReactive<SessionView>({
      get conversation() { return conversationFrom(this.agent, this.session); },
      agent, session: sessionState(),
      composer: createAgentComposerState({ getSnapshot: () => snapshot }).configurationForAgent(agent.id),
      composerState: { text: 'Verify the feature', selectionStart: 18, selectionEnd: 18 },
      attachments: [], capabilities: claudeProviderCapabilities, approvals: [], sending: false,
      queuedPrompts: [], history: { failed: false, hydrating: false, hasOlder: false, loadingOlder: false },
      answeredClientRequestIds: new Set(),
    });
    const actions: AgentConversationActions = {
      planReview: vi.fn(), clearGoal: vi.fn(), threadFlag: vi.fn(), prepare: vi.fn(), loadOlder: vi.fn(),
      send: vi.fn(), steer: vi.fn(), interrupt: vi.fn(), deleteTurn: vi.fn(), editTurn: vi.fn(), forkTurn: vi.fn(), retryTurn: vi.fn(),
      continueInterruptedTurn: vi.fn(), respond: vi.fn(),
      selectModel: vi.fn(), selectReasoningEffort: vi.fn(), selectServiceTier: vi.fn(), setPlanMode: vi.fn(),
      setPermissionMode: vi.fn(),
      updateComposerState: (_id, state) => { view.composerState = state; }, updateAttachments: vi.fn(),
      deleteQueuedPrompt: vi.fn(), updateQueuedPrompt: vi.fn(), steerQueuedPrompt: vi.fn(),
    };
    const wrapper = mount(AgentConversationPanel, { props: {
      view, actions, agents: snapshot.agents, focused: true, mentionGroups: [],
      savedPromptDrafts: [], savePromptDraft: vi.fn(), removePromptDraft: vi.fn(), openLink: vi.fn(), openImage: vi.fn(), openVisualization: vi.fn(),
    }, global: { provide: { [providerChoicesKey as symbol]: computed(() => ['codex', 'claude']) } } });
    try {
      await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
      const goal = wrapper.findAll('[role="menuitemcheckbox"]').find(item => item.text() === 'Goal mode');
      expect(goal).toBeDefined();
      await goal!.trigger('click');
      expect(wrapper.find('[aria-label="Remove Goal command"]').exists()).toBe(true);
      expect(wrapper.get('.chat-rich-text-editor').text()).toBe('Verify the feature');
      expect(actions.send).not.toHaveBeenCalled();
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(actions.send).toHaveBeenCalledExactlyOnceWith(agent.id, '/goal Verify the feature', undefined);
    } finally { wrapper.unmount(); }
  });

  it('keeps default hints inert and accepts only the active agent suggestion into its draft', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    const view = shallowReactive<SessionView>({
      get conversation() { return conversationFrom(this.agent, this.session); },
      agent, session: null,
      composer: createAgentComposerState({ getSnapshot: () => snapshot }).configurationForAgent(agent.id),
      composerState: { text: '', selectionStart: 0, selectionEnd: 0 },
      attachments: [], capabilities: claudeProviderCapabilities, approvals: [], sending: false,
      queuedPrompts: [], history: { failed: false, hydrating: false, hasOlder: false, loadingOlder: false },
      answeredClientRequestIds: new Set(),
    });
    const actions: AgentConversationActions = {
      planReview: vi.fn(), clearGoal: vi.fn(), threadFlag: vi.fn(), prepare: vi.fn(), loadOlder: vi.fn(),
      send: vi.fn(), steer: vi.fn(), interrupt: vi.fn(), deleteTurn: vi.fn(), editTurn: vi.fn(), forkTurn: vi.fn(), retryTurn: vi.fn(),
      continueInterruptedTurn: vi.fn(), respond: vi.fn(),
      selectModel: vi.fn(), selectReasoningEffort: vi.fn(), selectServiceTier: vi.fn(), setPlanMode: vi.fn(),
      setPermissionMode: vi.fn(), updateComposerState: vi.fn(), updateAttachments: vi.fn(),
      deleteQueuedPrompt: vi.fn(), updateQueuedPrompt: vi.fn(), steerQueuedPrompt: vi.fn(),
    };
    const wrapper = mount(AgentConversationPanel, { props: {
      view, actions, agents: snapshot.agents, focused: true, mentionGroups: [],
      savedPromptDrafts: [], savePromptDraft: vi.fn(), removePromptDraft: vi.fn(), openLink: vi.fn(), openImage: vi.fn(), openVisualization: vi.fn(),
    }, global: { provide: { [providerChoicesKey as symbol]: computed(() => ['codex', 'claude']) } } });
    const editor = () => wrapper.get('.chat-rich-text-editor');
    const defaultPlaceholder = editor().attributes('data-placeholder');
    for (const key of ['Tab', 'ArrowRight', ' ', 'Enter']) {
      await editor().trigger('keydown', { key });
      expect(editor().text()).toBe('');
    }
    expect(actions.updateComposerState).not.toHaveBeenCalled();
    expect(actions.send).not.toHaveBeenCalled();
    view.agent = { ...agent, suggestedPrompt: 'Add keyboard navigation' };
    await flushPromises();
    expect(editor().attributes('data-placeholder')).toBe('Add keyboard navigation');
    expect(editor().text()).toBe('');
    view.composerState = { text: 'My own follow-up', selectionStart: 16, selectionEnd: 16 };
    view.agent = { ...agent, suggestedPrompt: 'Run the tests' };
    await flushPromises();
    expect(editor().text()).toBe('My own follow-up');
    expect(actions.updateComposerState).not.toHaveBeenCalled();
    expect(actions.send).not.toHaveBeenCalled();
    view.agent = snapshot.agents[1]!;
    view.composerState = { text: '', selectionStart: 0, selectionEnd: 0 };
    await flushPromises();
    expect(editor().attributes('data-placeholder')).toBe(defaultPlaceholder);
    await editor().trigger('keydown', { key: 'Tab' });
    expect(editor().text()).toBe('');
    view.agent = { ...view.agent, suggestedPrompt: 'Run the tests' };
    await flushPromises();
    await editor().trigger('keydown', { key: 'Enter' });
    expect(editor().text()).toBe('Run the tests');
    expect(actions.updateComposerState).toHaveBeenLastCalledWith(view.agent.id, expect.objectContaining({ text: 'Run the tests' }));
    expect(actions.send).not.toHaveBeenCalled();
    await editor().trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(actions.send).toHaveBeenCalledWith(view.agent.id, 'Run the tests', undefined);
    wrapper.unmount();
  });

  it('routes composer commands from an unfocused split pane without submitting its draft', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[1]!;
    agent.provider = 'claude'; agent.providerDefaults = { kind: 'claude' };
    const view = shallowReactive<SessionView>({
      get conversation() { return conversationFrom(this.agent, this.session); },
      agent, session: sessionState(),
      composer: createAgentComposerState({ getSnapshot: () => snapshot }).configurationForAgent(agent.id),
      composerState: { text: 'Unsent split draft', selectionStart: 5, selectionEnd: 5 },
      attachments: [], capabilities: claudeProviderCapabilities, approvals: [], sending: false,
      queuedPrompts: [], history: { failed: false, hydrating: false, hasOlder: false, loadingOlder: false },
      answeredClientRequestIds: new Set(),
    });
    const actions: AgentConversationActions = {
      planReview: vi.fn(), clearGoal: vi.fn(), threadFlag: vi.fn(), prepare: vi.fn(), loadOlder: vi.fn(),
      send: vi.fn(), steer: vi.fn(), interrupt: vi.fn(), deleteTurn: vi.fn(), editTurn: vi.fn(), forkTurn: vi.fn(), retryTurn: vi.fn(),
      continueInterruptedTurn: vi.fn(), respond: vi.fn(),
      selectModel: vi.fn(), selectReasoningEffort: vi.fn(), selectServiceTier: vi.fn(), setPlanMode: vi.fn(),
      setPermissionMode: vi.fn(), updateComposerState: vi.fn(), updateAttachments: vi.fn(),
      deleteQueuedPrompt: vi.fn(), updateQueuedPrompt: vi.fn(), steerQueuedPrompt: vi.fn(),
    };
    const selectModelMenuItem = vi.fn();
    const wrapper = mount(AgentConversationPanel, { props: {
      view, actions, agents: snapshot.agents, focused: false, mentionGroups: [],
      savedPromptDrafts: [], savePromptDraft: vi.fn(), removePromptDraft: vi.fn(), openLink: vi.fn(), openImage: vi.fn(), openVisualization: vi.fn(),
    }, global: { provide: { [providerChoicesKey as symbol]: computed(() => ['codex', 'claude']) } } });
    for (const label of ['Design', 'Visualize', 'Delegate', 'Review', 'Mission']) {
      await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
      await wrapper.findAll('[role="menuitem"]').find(item => item.text() === label)!.trigger('click');
    }
    expect(wrapper.emitted('composer-command')).toStrictEqual([
      [agent.id, 'design'], [agent.id, 'visualize'], [agent.id, 'delegate'], [agent.id, 'review'], [agent.id, 'mission'],
    ]);
    view.agent = { ...agent, threadFlags: { work_proposed: true } };
    await flushPromises();
    for (const [label, action] of [['Continue', 'implement'], ['Worktree', 'delegate'], ['Mission', 'create_mission'], ['Discard', 'dismiss']] as const) {
      await wrapper.get(`button[aria-label="${label}"]`).trigger('click');
      await flushPromises();
      expect(actions.threadFlag).toHaveBeenLastCalledWith(agent.id, { id: 'work_proposed', action });
    }
    expect(wrapper.emitted('composer-command')).toHaveLength(5);
    expect(selectModelMenuItem).not.toHaveBeenCalled();
    expect(actions.send).not.toHaveBeenCalled();
    expect(actions.updateComposerState).not.toHaveBeenCalled();
    expect(wrapper.get('.chat-rich-text-editor').text()).toBe('Unsent split draft');
  });

  it('applies the follow-up preference in a split pane and routes both actions to its own agent', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[1]!;
    agent.provider = 'claude';
    agent.providerDefaults = { kind: 'claude' };
    agent.status = { type: 'working' };
    agent.providerSession = { kind: 'claude', conversationId: 'session-claude', transport: 'stdio' };
    const view = shallowReactive<SessionView>({
      get conversation() { return conversationFrom(this.agent, this.session); },
      agent, session: sessionState({ busy: true, activeTurnId: 'turn-1' }),
      composer: createAgentComposerState({ getSnapshot: () => snapshot }).configurationForAgent(agent.id),
      composerState: { text: 'Split follow-up', selectionStart: 15, selectionEnd: 15 },
      attachments: [], capabilities: claudeProviderCapabilities, approvals: [], sending: true,
      queuedPrompts: [{ id: 'queued-split', agentId: agent.id, text: 'Already queued', createdAt: '2026-10-03T00:00:00Z' }],
      history: { failed: false, hydrating: false, hasOlder: false, loadingOlder: false },
      answeredClientRequestIds: new Set(),
    });
    const actions: AgentConversationActions = {
      planReview: vi.fn(), clearGoal: vi.fn(), threadFlag: vi.fn(), prepare: vi.fn(), loadOlder: vi.fn(),
      send: vi.fn(), steer: vi.fn(), interrupt: vi.fn(), deleteTurn: vi.fn(), editTurn: vi.fn(), forkTurn: vi.fn(), retryTurn: vi.fn(),
      continueInterruptedTurn: vi.fn(), respond: vi.fn(),
      selectModel: vi.fn(), selectReasoningEffort: vi.fn(), selectServiceTier: vi.fn(), setPlanMode: vi.fn(),
      setPermissionMode: vi.fn(),
      updateComposerState: (_id, state) => { view.composerState = state; },
      updateAttachments: (_id, attachments) => { view.attachments = attachments; },
      deleteQueuedPrompt: vi.fn(), updateQueuedPrompt: vi.fn(), steerQueuedPrompt: vi.fn(),
    };
    const wrapper = mount(AgentConversationPanel, { props: {
      view, actions, agents: snapshot.agents, focused: true, mentionGroups: [],
      savedPromptDrafts: [], savePromptDraft: vi.fn(), removePromptDraft: vi.fn(), openLink: vi.fn(), openImage: vi.fn(), openVisualization: vi.fn(),
      followUpBehavior: 'steer',
    }, global: { provide: { [providerChoicesKey as symbol]: computed(() => ['codex', 'claude']) } } });
    expect(wrapper.get<HTMLButtonElement>('[aria-label="Steer queued prompt now"]').element.disabled).toBe(false);
    await wrapper.get('.chat-rich-text-editor').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(actions.steer).toHaveBeenCalledExactlyOnceWith(agent.id, 'Split follow-up', undefined);
    expect(actions.send).not.toHaveBeenCalled();
    view.composerState = { text: 'Queue this instead', selectionStart: 18, selectionEnd: 18 };
    await flushPromises();
    await wrapper.get('.chat-rich-text-editor').trigger('keydown', { key: 'Enter', metaKey: true });
    await flushPromises();
    expect(actions.send).toHaveBeenCalledExactlyOnceWith(agent.id, 'Queue this instead', undefined);
    await wrapper.get('[aria-label="Steer queued prompt now"]').trigger('click');
    expect(actions.steerQueuedPrompt).toHaveBeenCalledWith(agent.id, 'queued-split', undefined);
  });

  it('routes an unfocused Claude pane’s composer approval to its own agent and restores its draft and attachment', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.provider = 'claude'; agent.providerDefaults = { kind: 'claude' };
    agent.providerSession = { kind: 'claude', conversationId: 'session-claude', transport: 'stdio' };
    const view = shallowReactive<SessionView>({
      get conversation() { return conversationFrom(this.agent, this.session); },
      agent, session: sessionState(),
      composer: createAgentComposerState({ getSnapshot: () => snapshot }).configurationForAgent(agent.id),
      composerState: { text: 'Keep the split draft', selectionStart: 5, selectionEnd: 5 },
      attachments: [{ id: 'notes', type: 'file', reference: '/tmp/notes.txt', name: 'notes.txt', mimeType: 'text/plain', size: 10 }],
      capabilities: claudeProviderCapabilities, approvals: [], queuedPrompts: [], sending: false,
      history: { failed: false, hydrating: false, hasOlder: false, loadingOlder: false },
      answeredClientRequestIds: new Set(),
    });
    const actions: AgentConversationActions = {
      planReview: vi.fn(), clearGoal: vi.fn(), threadFlag: vi.fn(), prepare: vi.fn(), loadOlder: vi.fn(),
      send: vi.fn(), steer: vi.fn(), interrupt: vi.fn(), deleteTurn: vi.fn(), editTurn: vi.fn(), forkTurn: vi.fn(), retryTurn: vi.fn(),
      continueInterruptedTurn: vi.fn(), respond: vi.fn(),
      selectModel: vi.fn(), selectReasoningEffort: vi.fn(), selectServiceTier: vi.fn(), setPlanMode: vi.fn(),
      setPermissionMode: vi.fn(),
      updateComposerState: (_id, state) => { view.composerState = state; },
      updateAttachments: (_id, attachments) => { view.attachments = attachments; },
      deleteQueuedPrompt: vi.fn(), updateQueuedPrompt: vi.fn(), steerQueuedPrompt: vi.fn(),
    };
    const wrapper = mount(AgentConversationPanel, { props: {
      view, actions, agents: snapshot.agents, focused: false, mentionGroups: [],
      savedPromptDrafts: [], savePromptDraft: vi.fn(), removePromptDraft: vi.fn(), openLink: vi.fn(), openImage: vi.fn(), openVisualization: vi.fn(),
    }, global: { provide: { [providerChoicesKey as symbol]: computed(() => ['codex', 'claude']) } } });
    expect(wrapper.get('.chat-rich-text-editor').text()).toBe('Keep the split draft');
    const confirmation = { integrationId: 'claude', integrationName: 'Claude', toolName: 'Edit', summary: 'Edit file src/main.ts?', argumentsPreview: 'Before:\nstart(false);\n\nAfter:\nstart(true);', allowAlways: true };
    // Claude records the tool call it asks about in the transcript.
    const asking = sessionState({ answeredClientRequestIds: [], messages: [{
      id: 'assistant-turn-1', agentId: agent.id, role: 'assistant', status: 'streaming', turnId: 'turn-1', createdAt: '2026-10-03T00:00:00Z',
      parts: [{ type: 'tool', id: 'approval-permission', kind: 'mcp', title: 'claude.Edit', status: 'running',
        statusText: JSON.stringify({ source: 'mcp', action: 'run', phase: 'running', params: { requestId: 'permission', tool: 'claude.Edit',
          confirmationSummary: confirmation.summary, argumentsPreview: confirmation.argumentsPreview, allowConversation: false, allowAlways: true } }),
        input: confirmation.argumentsPreview, metadata: { confirmationRequestId: 'permission', server: 'claude', tool: 'Edit' } }],
    }] });
    view.session = { ...asking, requests: [{ id: 'permission', conversationId: 'session-claude', turnId: 'turn-1', itemId: 'approval-permission', kind: 'toolConfirmation', confirmation }] };
    await flushPromises();
    const footer = wrapper.get('.agent-ui-conversation-pane__footer');
    expect(wrapper.findAll('.chat-tool-confirmation')).toHaveLength(1);
    expect(footer.text()).toContain('Edit file src/main.ts?');
    await footer.get('details > summary').trigger('click');
    expect(footer.get('.chat-tool-confirmation__details-body').text()).toBe('Before:\nstart(false);\n\nAfter:\nstart(true);');
    expect(footer.findAll('button').map(button => button.text())).toEqual(['Allow', 'Always allow', 'Deny']);
    await footer.findAll('button')[1]!.trigger('click');
    await flushPromises();
    expect(actions.respond).toHaveBeenCalledExactlyOnceWith(agent.id, { id: 'permission', outcome: { kind: 'decision', decision: 'always_allow' } });
    view.session = { ...asking, answeredClientRequestIds: ['permission'] };
    await flushPromises();
    expect(wrapper.get('.chat-rich-text-editor').text()).toBe('Keep the split draft');
    expect(view.composerState).toEqual({ text: 'Keep the split draft', selectionStart: 5, selectionEnd: 5 });
    expect(wrapper.text()).toContain('notes.txt');
    expect(wrapper.text()).toContain('Allowed tool call');
  });
});
