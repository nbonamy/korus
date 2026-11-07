import { provideCodexToolCallDetails } from '@codex-app-sdk/vue';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, h, ref, shallowReactive } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { claudeBackendCapabilities } from '@workspace/core/backend-capabilities';
import { createClaudeConversationReplica } from '@workspace/core/claude-conversation-replica';
import { createAgentComposerState } from '../../agent-composer-state';
import type { AgentConversationView } from '../../app-state';
import { claudeConversationSnapshot } from '../../test/claude-conversation-fixtures';
import type { AgentConversationActions } from '../use-agent-conversation';
import AgentConversationPanel from '../AgentConversationPanel.vue';
import { backendChoicesKey } from '../backend-selection';
import { cursorBackendCapabilities } from '@workspace/core/backend-capabilities';
import { emptyCursorSnapshot, createCursorConversationReplica } from '@workspace/core/cursor-conversation-replica';

describe('AgentConversationPanel', () => {
  it('renders Cursor model/effort selection, file links and media with interrupt, confirm and continue', async () => {
    const snapshot = createInitialSnapshot();
    const agent = { ...snapshot.agents[0]!, backend: 'cursor' as const, backendDefaults: { kind: 'cursor' as const }, backendSession: undefined };
    snapshot.agents[0] = agent;
    const capabilities = { ...cursorBackendCapabilities, reasoningEffort: true };
    snapshot.backendRuntimes = [{ backend: 'cursor', status: 'running', capabilities }];
    const composer = createAgentComposerState({ getSnapshot: () => snapshot });
    composer.handleMainEvent({ type: 'models.changed', backend: 'cursor', seq: 1, occurredAt: '', payload: { models: [
      { id: 'native-plain', model: 'native-plain', displayName: 'Cursor Plain', isDefault: true },
      { id: 'native-enum', model: 'native-enum', displayName: 'Cursor Enum', defaultReasoningEffort: 'low',
        supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }, { reasoningEffort: 'extra-high', description: '' }] },
    ] } });
    const sent = vi.fn();
    const view = shallowReactive<AgentConversationView>({
      agent, codexSnapshot: null, claudeSnapshot: null, cursorSnapshot: null,
      composer: composer.configurationForAgent(agent.id),
      composerState: { text: 'Hello Cursor', selectionStart: 12, selectionEnd: 12 }, attachments: [], capabilities,
      approvals: [], sending: false, queuedPrompts: [], history: { failed: false, hydrating: false, hasOlder: false, loadingOlder: false }, answeredClientRequestIds: new Set(),
    });
    const actions: AgentConversationActions = {
      planReview: vi.fn(), clearGoal: vi.fn(), threadFlag: vi.fn(), prepare: vi.fn(), loadOlder: vi.fn(), send: vi.fn(async (id, text, options) => { sent(id, text, composer.resolvePromptOptions(id, text, options)); }), steer: vi.fn(), interrupt: vi.fn(),
      deleteTurn: vi.fn(), editTurn: vi.fn(), forkTurn: vi.fn(), retryTurn: vi.fn(), continueInterruptedTurn: vi.fn(), resolveApproval: vi.fn(), clientResponse: vi.fn(),
      selectModel: vi.fn(composer.selectModelForAgent), selectReasoningEffort: vi.fn(composer.selectReasoningEffortForAgent), selectServiceTier: vi.fn(), setPlanMode: vi.fn(), setApprovalPreset: vi.fn(), setPermissionMode: vi.fn(),
      updateComposerState: (_id, state) => { view.composerState = state; }, updateAttachments: vi.fn(), deleteQueuedPrompt: vi.fn(), updateQueuedPrompt: vi.fn(), steerQueuedPrompt: vi.fn(),
    };
    const rawDetails = ref(false);
    const openLink = vi.fn();
    const wrapper = mount({ setup() {
      provideCodexToolCallDetails(rawDetails);
      return () => h(AgentConversationPanel, { view, actions, agents: [agent], focused: true, mentionGroups: [], modelMenuItems: [], selectModelMenuItem: vi.fn(),
      savedPromptDrafts: [], savePromptDraft: vi.fn(), removePromptDraft: vi.fn(), openLink, openImage: vi.fn(), openVisualization: vi.fn(),
    });
    } }, { global: { provide: { [backendChoicesKey as symbol]: computed(() => ['codex', 'cursor']) } } });
    try {
      await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
      const permissions = wrapper.findAll('[role="menuitem"]').find(item => item.text().includes('Permissions'));
      expect(permissions).toBeDefined();
      expect(permissions!.text()).toContain('Cursor-managed');
      expect(permissions!.attributes('disabled')).toBeDefined();
      await permissions!.trigger('click');
      expect(actions.setPermissionMode).not.toHaveBeenCalled();
      expect(actions.setApprovalPreset).not.toHaveBeenCalled();
      await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
      await wrapper.get('[aria-label="Model and reasoning"]').trigger('click');
      await flushPromises();
      await wrapper.findAll('[role="menuitem"]').find(item => item.text().includes('Cursor Enum'))!.trigger('mouseenter');
      await flushPromises();
      await wrapper.findAll('[role="menuitemradio"]').find(item => item.text().trim() === 'Extra High')!.trigger('click');
      await flushPromises();
      expect(actions.selectModel).toHaveBeenCalledExactlyOnceWith(agent.id, 'native-enum');
      expect(actions.selectReasoningEffort).toHaveBeenCalledExactlyOnceWith(agent.id, 'extra-high');
      expect(wrapper.get('[aria-label="Model and reasoning"]').text()).toContain('Extra High');
      await wrapper.get('form').trigger('submit'); await flushPromises();
      expect(sent).toHaveBeenLastCalledWith(agent.id, 'Hello Cursor', { selection: { model: 'native-enum', reasoningEffort: 'extra-high' }, planMode: false });
      await wrapper.get('[aria-label="Model and reasoning"]').trigger('click');
      await flushPromises();
      await wrapper.findAll('[role="menuitemradio"]').find(item => item.text().trim() === 'Cursor Plain')!.trigger('click');
      await flushPromises();
      expect(actions.selectModel).toHaveBeenLastCalledWith(agent.id, 'native-plain');
      expect(actions.selectReasoningEffort).toHaveBeenCalledTimes(1);
      expect(wrapper.get('[aria-label="Model and reasoning"]').text()).not.toContain('Extra High');
      view.composerState = { text: 'Plain Cursor', selectionStart: 12, selectionEnd: 12 };
      await flushPromises();
      await wrapper.get('form').trigger('submit'); await flushPromises();
      expect(sent).toHaveBeenLastCalledWith(agent.id, 'Plain Cursor', { selection: { model: 'native-plain' }, planMode: false });
      const replica = createCursorConversationReplica(emptyCursorSnapshot(agent.id, 'session'));
      const identity = { agentId: agent.id, sessionId: 'session', turnId: 'turn', occurredAt: '2026-11-03T12:00:00Z' };
      replica.apply({ ...identity, type: 'turn.started', payload: { turn: { id: 'turn' } } });
      const diffBody = 'File: synthetic.txt\nBefore:\nBEFORE\nAfter:\nAFTER\n\nfile:///observed.txt\nObserved resource contents';
      const imageUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMfcAAAAASUVORK5CYII=';
      view.cursorSnapshot = replica.apply({ ...identity, type: 'message.upsert', payload: { message: { id: 'answer', agentId: agent.id, turnId: 'turn', role: 'assistant', status: 'streaming', createdAt: identity.occurredAt,
        parts: [{ type: 'text', text: 'Cursor streamed reply' },
          { type: 'tool', id: 'tool', kind: 'fileChange', title: 'Edit synthetic.txt', status: 'completed', statusText: JSON.stringify({ source: 'cursor', action: 'edit', phase: 'completed', params: { target: 'synthetic.txt' } }), body: diffBody, metadata: { cwd: '/workspace', changes: [{ path: 'synthetic.txt', kind: 'update', oldText: 'BEFORE', newText: 'AFTER' }] } },
          { type: 'media', itemId: 'cursor-tool:tool:0', media: { url: imageUrl, mimeType: 'image/png', alt: 'Image' } }] } } });
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
      await wrapper.get('button[title="Interrupt"]').trigger('click');
      expect(actions.interrupt).toHaveBeenCalledWith(agent.id);
      view.cursorSnapshot = { ...view.cursorSnapshot!, clientRequests: [{
        id: 'cursor-permission', kind: 'confirm_tool', payload: { confirmation: { integrationId: 'cursor', integrationName: 'Cursor', toolName: 'Shell', summary: 'Run tests?', argumentsPreview: 'npm test', allowAlways: false, allowConversation: false } },
      }] };
      await flushPromises();
      expect(wrapper.get('.codex-conversation-pane__footer').text()).toContain('Run tests?');
      await wrapper.get('.codex-conversation-pane__footer').findAll('button').find(button => button.text() === 'Deny')!.trigger('click');
      expect(actions.clientResponse).toHaveBeenCalledWith({ agentId: agent.id, id: 'cursor-permission', payload: { decision: 'deny' } });
      view.cursorSnapshot = { ...view.cursorSnapshot!, busy: false, activeTurnId: null, clientRequests: [],
        turns: view.cursorSnapshot!.turns.map(turn => ({ ...turn, status: 'interrupted' })) };
      await flushPromises();
      await wrapper.get('button[aria-label="Continue"]').trigger('click');
      expect(actions.continueInterruptedTurn).toHaveBeenCalledExactlyOnceWith(agent.id);
    } finally { wrapper.unmount(); }
  });
  it('toggles Goal mode in a Claude composer and submits the objective to that agent', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[1]!;
    agent.backend = 'claude'; agent.backendDefaults = { kind: 'claude' };
    const view = shallowReactive<AgentConversationView>({
      agent, codexSnapshot: null, claudeSnapshot: claudeConversationSnapshot([], { agentId: agent.id }),
      composer: createAgentComposerState({ getSnapshot: () => snapshot }).configurationForAgent(agent.id),
      composerState: { text: 'Verify the feature', selectionStart: 18, selectionEnd: 18 },
      attachments: [], capabilities: claudeBackendCapabilities, approvals: [], sending: false,
      queuedPrompts: [], history: { failed: false, hydrating: false, hasOlder: false, loadingOlder: false },
      answeredClientRequestIds: new Set(),
    });
    const actions: AgentConversationActions = {
      planReview: vi.fn(), clearGoal: vi.fn(), threadFlag: vi.fn(), prepare: vi.fn(), loadOlder: vi.fn(),
      send: vi.fn(), steer: vi.fn(), interrupt: vi.fn(), deleteTurn: vi.fn(), editTurn: vi.fn(), forkTurn: vi.fn(), retryTurn: vi.fn(),
      continueInterruptedTurn: vi.fn(), resolveApproval: vi.fn(), clientResponse: vi.fn(),
      selectModel: vi.fn(), selectReasoningEffort: vi.fn(), selectServiceTier: vi.fn(), setPlanMode: vi.fn(),
      setApprovalPreset: vi.fn(), setPermissionMode: vi.fn(),
      updateComposerState: (_id, state) => { view.composerState = state; }, updateAttachments: vi.fn(),
      deleteQueuedPrompt: vi.fn(), updateQueuedPrompt: vi.fn(), steerQueuedPrompt: vi.fn(),
    };
    const wrapper = mount(AgentConversationPanel, { props: {
      view, actions, agents: snapshot.agents, focused: true, mentionGroups: [], modelMenuItems: [], selectModelMenuItem: vi.fn(),
      savedPromptDrafts: [], savePromptDraft: vi.fn(), removePromptDraft: vi.fn(), openLink: vi.fn(), openImage: vi.fn(), openVisualization: vi.fn(),
    }, global: { provide: { [backendChoicesKey as symbol]: computed(() => ['codex', 'claude']) } } });
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
    const view = shallowReactive<AgentConversationView>({
      agent, codexSnapshot: null, claudeSnapshot: null,
      composer: createAgentComposerState({ getSnapshot: () => snapshot }).configurationForAgent(agent.id),
      composerState: { text: '', selectionStart: 0, selectionEnd: 0 },
      attachments: [], capabilities: claudeBackendCapabilities, approvals: [], sending: false,
      queuedPrompts: [], history: { failed: false, hydrating: false, hasOlder: false, loadingOlder: false },
      answeredClientRequestIds: new Set(),
    });
    const actions: AgentConversationActions = {
      planReview: vi.fn(), clearGoal: vi.fn(), threadFlag: vi.fn(), prepare: vi.fn(), loadOlder: vi.fn(),
      send: vi.fn(), steer: vi.fn(), interrupt: vi.fn(), deleteTurn: vi.fn(), editTurn: vi.fn(), forkTurn: vi.fn(), retryTurn: vi.fn(),
      continueInterruptedTurn: vi.fn(), resolveApproval: vi.fn(), clientResponse: vi.fn(),
      selectModel: vi.fn(), selectReasoningEffort: vi.fn(), selectServiceTier: vi.fn(), setPlanMode: vi.fn(),
      setApprovalPreset: vi.fn(), setPermissionMode: vi.fn(), updateComposerState: vi.fn(), updateAttachments: vi.fn(),
      deleteQueuedPrompt: vi.fn(), updateQueuedPrompt: vi.fn(), steerQueuedPrompt: vi.fn(),
    };
    const wrapper = mount(AgentConversationPanel, { props: {
      view, actions, agents: snapshot.agents, focused: true, mentionGroups: [], modelMenuItems: [], selectModelMenuItem: vi.fn(),
      savedPromptDrafts: [], savePromptDraft: vi.fn(), removePromptDraft: vi.fn(), openLink: vi.fn(), openImage: vi.fn(), openVisualization: vi.fn(),
    }, global: { provide: { [backendChoicesKey as symbol]: computed(() => ['codex', 'claude']) } } });
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
    agent.backend = 'claude'; agent.backendDefaults = { kind: 'claude' };
    const view = shallowReactive<AgentConversationView>({
      agent, codexSnapshot: null, claudeSnapshot: claudeConversationSnapshot([], { agentId: agent.id }),
      composer: createAgentComposerState({ getSnapshot: () => snapshot }).configurationForAgent(agent.id),
      composerState: { text: 'Unsent split draft', selectionStart: 5, selectionEnd: 5 },
      attachments: [], capabilities: claudeBackendCapabilities, approvals: [], sending: false,
      queuedPrompts: [], history: { failed: false, hydrating: false, hasOlder: false, loadingOlder: false },
      answeredClientRequestIds: new Set(),
    });
    const actions: AgentConversationActions = {
      planReview: vi.fn(), clearGoal: vi.fn(), threadFlag: vi.fn(), prepare: vi.fn(), loadOlder: vi.fn(),
      send: vi.fn(), steer: vi.fn(), interrupt: vi.fn(), deleteTurn: vi.fn(), editTurn: vi.fn(), forkTurn: vi.fn(), retryTurn: vi.fn(),
      continueInterruptedTurn: vi.fn(), resolveApproval: vi.fn(), clientResponse: vi.fn(),
      selectModel: vi.fn(), selectReasoningEffort: vi.fn(), selectServiceTier: vi.fn(), setPlanMode: vi.fn(),
      setApprovalPreset: vi.fn(), setPermissionMode: vi.fn(), updateComposerState: vi.fn(), updateAttachments: vi.fn(),
      deleteQueuedPrompt: vi.fn(), updateQueuedPrompt: vi.fn(), steerQueuedPrompt: vi.fn(),
    };
    const selectModelMenuItem = vi.fn();
    const wrapper = mount(AgentConversationPanel, { props: {
      view, actions, agents: snapshot.agents, focused: false, mentionGroups: [], modelMenuItems: [], selectModelMenuItem,
      savedPromptDrafts: [], savePromptDraft: vi.fn(), removePromptDraft: vi.fn(), openLink: vi.fn(), openImage: vi.fn(), openVisualization: vi.fn(),
    }, global: { provide: { [backendChoicesKey as symbol]: computed(() => ['codex', 'claude']) } } });
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
    agent.backend = 'claude';
    agent.backendDefaults = { kind: 'claude' };
    agent.status = { type: 'working' };
    agent.backendSession = { kind: 'claude', sessionId: 'session-claude', transport: 'stdio' };
    const view = shallowReactive<AgentConversationView>({
      agent, codexSnapshot: null,
      claudeSnapshot: claudeConversationSnapshot([], { agentId: agent.id, sessionId: 'session-claude', busy: true, activeTurnId: 'turn-1' }),
      composer: createAgentComposerState({ getSnapshot: () => snapshot }).configurationForAgent(agent.id),
      composerState: { text: 'Split follow-up', selectionStart: 15, selectionEnd: 15 },
      attachments: [], capabilities: claudeBackendCapabilities, approvals: [], sending: true,
      queuedPrompts: [{ id: 'queued-split', agentId: agent.id, text: 'Already queued', createdAt: '2026-10-03T00:00:00Z' }],
      history: { failed: false, hydrating: false, hasOlder: false, loadingOlder: false },
      answeredClientRequestIds: new Set(),
    });
    const actions: AgentConversationActions = {
      planReview: vi.fn(), clearGoal: vi.fn(), threadFlag: vi.fn(), prepare: vi.fn(), loadOlder: vi.fn(),
      send: vi.fn(), steer: vi.fn(), interrupt: vi.fn(), deleteTurn: vi.fn(), editTurn: vi.fn(), forkTurn: vi.fn(), retryTurn: vi.fn(),
      continueInterruptedTurn: vi.fn(), resolveApproval: vi.fn(), clientResponse: vi.fn(),
      selectModel: vi.fn(), selectReasoningEffort: vi.fn(), selectServiceTier: vi.fn(), setPlanMode: vi.fn(),
      setApprovalPreset: vi.fn(), setPermissionMode: vi.fn(),
      updateComposerState: (_id, state) => { view.composerState = state; },
      updateAttachments: (_id, attachments) => { view.attachments = attachments; },
      deleteQueuedPrompt: vi.fn(), updateQueuedPrompt: vi.fn(), steerQueuedPrompt: vi.fn(),
    };
    const wrapper = mount(AgentConversationPanel, { props: {
      view, actions, agents: snapshot.agents, focused: true, mentionGroups: [], modelMenuItems: [], selectModelMenuItem: vi.fn(),
      savedPromptDrafts: [], savePromptDraft: vi.fn(), removePromptDraft: vi.fn(), openLink: vi.fn(), openImage: vi.fn(), openVisualization: vi.fn(),
      followUpBehavior: 'steer',
    }, global: { provide: { [backendChoicesKey as symbol]: computed(() => ['codex', 'claude']) } } });
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
    agent.backend = 'claude'; agent.backendDefaults = { kind: 'claude' };
    agent.backendSession = { kind: 'claude', sessionId: 'session-claude', transport: 'stdio' };
    const replica = createClaudeConversationReplica(claudeConversationSnapshot([], { agentId: agent.id, sessionId: 'session-claude' }));
    const view = shallowReactive<AgentConversationView>({
      agent, codexSnapshot: null, claudeSnapshot: replica.getSnapshot(),
      composer: createAgentComposerState({ getSnapshot: () => snapshot }).configurationForAgent(agent.id),
      composerState: { text: 'Keep the split draft', selectionStart: 5, selectionEnd: 5 },
      attachments: [{ id: 'notes', type: 'file', reference: '/tmp/notes.txt', name: 'notes.txt', mimeType: 'text/plain', size: 10 }],
      capabilities: claudeBackendCapabilities, approvals: [], queuedPrompts: [], sending: false,
      history: { failed: false, hydrating: false, hasOlder: false, loadingOlder: false },
      answeredClientRequestIds: new Set(),
    });
    const actions: AgentConversationActions = {
      planReview: vi.fn(), clearGoal: vi.fn(), threadFlag: vi.fn(), prepare: vi.fn(), loadOlder: vi.fn(),
      send: vi.fn(), steer: vi.fn(), interrupt: vi.fn(), deleteTurn: vi.fn(), editTurn: vi.fn(), forkTurn: vi.fn(), retryTurn: vi.fn(),
      continueInterruptedTurn: vi.fn(), resolveApproval: vi.fn(), clientResponse: vi.fn(),
      selectModel: vi.fn(), selectReasoningEffort: vi.fn(), selectServiceTier: vi.fn(), setPlanMode: vi.fn(),
      setApprovalPreset: vi.fn(), setPermissionMode: vi.fn(),
      updateComposerState: (_id, state) => { view.composerState = state; },
      updateAttachments: (_id, attachments) => { view.attachments = attachments; },
      deleteQueuedPrompt: vi.fn(), updateQueuedPrompt: vi.fn(), steerQueuedPrompt: vi.fn(),
    };
    const wrapper = mount(AgentConversationPanel, { props: {
      view, actions, agents: snapshot.agents, focused: false, mentionGroups: [], modelMenuItems: [], selectModelMenuItem: vi.fn(),
      savedPromptDrafts: [], savePromptDraft: vi.fn(), removePromptDraft: vi.fn(), openLink: vi.fn(), openImage: vi.fn(), openVisualization: vi.fn(),
    }, global: { provide: { [backendChoicesKey as symbol]: computed(() => ['codex', 'claude']) } } });
    expect(wrapper.get('.chat-rich-text-editor').text()).toBe('Keep the split draft');
    view.claudeSnapshot = replica.apply({ type: 'approval.requested', backend: 'claude', agentId: agent.id, seq: 1, occurredAt: '2026-10-03T00:00:00Z', turnId: 'turn-1', payload: {
      id: 'permission', kind: 'confirm_tool', payload: { confirmation: { integrationId: 'claude', integrationName: 'Claude', toolName: 'Edit', summary: 'Edit file src/main.ts?', argumentsPreview: 'Before:\nstart(false);\n\nAfter:\nstart(true);', allowAlways: true } },
    } });
    await flushPromises();
    const footer = wrapper.get('.codex-conversation-pane__footer');
    expect(wrapper.findAll('.chat-tool-confirmation')).toHaveLength(1);
    expect(footer.text()).toContain('Edit file src/main.ts?');
    await footer.get('details > summary').trigger('click');
    expect(footer.get('.chat-tool-confirmation__details-body').text()).toBe('Before:\nstart(false);\n\nAfter:\nstart(true);');
    expect(footer.findAll('button').map(button => button.text())).toEqual(['Allow', 'Always allow', 'Deny']);
    await footer.findAll('button')[1]!.trigger('click');
    await flushPromises();
    expect(actions.clientResponse).toHaveBeenCalledExactlyOnceWith({ agentId: agent.id, id: 'permission', payload: { decision: 'always_allow' } });
    view.claudeSnapshot = replica.apply({ type: 'clientRequest.resolved', backend: 'claude', agentId: agent.id, seq: 2, occurredAt: '2026-10-03T00:00:01Z', payload: { id: 'permission' } });
    await flushPromises();
    expect(wrapper.get('.chat-rich-text-editor').text()).toBe('Keep the split draft');
    expect(view.composerState).toEqual({ text: 'Keep the split draft', selectionStart: 5, selectionEnd: 5 });
    expect(wrapper.text()).toContain('notes.txt');
    expect(wrapper.text()).toContain('Allowed tool call');
  });
});
