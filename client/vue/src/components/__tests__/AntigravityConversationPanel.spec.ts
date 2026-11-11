import { flushPromises, mount } from '@vue/test-utils';
import { computed, shallowReactive } from 'vue';
import type { SessionState } from '@korus-dev/multi-agent-sdk';
import { conversationFrom, runningTurn, completedTurn, sessionState, textMessage } from '../../../tests/support/conversation-fixtures';
import { expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { antigravityProviderCapabilities } from '@workspace/core/provider-capabilities';
import { createAgentComposerState } from '../../agent-composer-state';
import type { AgentConversationView } from '../../app-state';
import type { AgentConversationActions } from '../use-agent-conversation';
import { providerChoicesKey } from '../provider-selection';
import AgentConversationPanel from '../AgentConversationPanel.vue';

it('renders an Antigravity conversation, denies a tool confirmation, and keeps unsupported turn controls absent', async () => {
  const snapshot = createInitialSnapshot();
  const agent = snapshot.agents[0]!;
  agent.provider = 'antigravity'; agent.providerDefaults = { kind: 'antigravity', permissionMode: 'default' };
  agent.providerSession = { kind: 'antigravity', sessionId: 'native-session' };
  const streaming = textMessage('message', 'assistant', 'Native Antigravity response', { agentId: agent.id, turnId: 'turn', status: 'streaming' });
  const running = sessionState({ busy: true, activeTurnId: 'turn', turns: [runningTurn('turn')], messages: [streaming], requests: [{
    id: 'permission', conversationId: 'native-session', turnId: 'turn', kind: 'toolConfirmation', confirmation: {
      integrationId: 'antigravity', integrationName: 'Antigravity', toolName: 'Edit', summary: 'Edit example.ts?', argumentsPreview: 'change', allowAlways: false, allowConversation: false,
    } }] });
  const view = shallowReactive<AgentConversationView & { session: SessionState }>({
    get conversation() { return conversationFrom(this.agent, this.session); },
    agent, session: running,
    composer: createAgentComposerState({ getSnapshot: () => snapshot }).configurationForAgent(agent.id),
    composerState: { text: 'Keep my draft', selectionStart: 0, selectionEnd: 0 }, attachments: [], capabilities: antigravityProviderCapabilities,
    approvals: [], queuedPrompts: [], sending: false, history: { failed: false, hydrating: false, hasOlder: false, loadingOlder: false }, answeredClientRequestIds: new Set(),
  });
  const actions: AgentConversationActions = {
    planReview: vi.fn(), clearGoal: vi.fn(), threadFlag: vi.fn(), prepare: vi.fn(), loadOlder: vi.fn(), send: vi.fn(), steer: vi.fn(), interrupt: vi.fn(),
    deleteTurn: vi.fn(), editTurn: vi.fn(), forkTurn: vi.fn(), retryTurn: vi.fn(), continueInterruptedTurn: vi.fn(), respond: vi.fn(),
    selectModel: vi.fn(), selectReasoningEffort: vi.fn(), selectServiceTier: vi.fn(), setPlanMode: vi.fn(), setApprovalPreset: vi.fn(), setPermissionMode: vi.fn(),
    updateComposerState: vi.fn(), updateAttachments: vi.fn(), deleteQueuedPrompt: vi.fn(), updateQueuedPrompt: vi.fn(), steerQueuedPrompt: vi.fn(),
  };
  const wrapper = mount(AgentConversationPanel, { props: {
    view, actions, agents: [agent], focused: true, mentionGroups: [], modelMenuItems: [], selectModelMenuItem: vi.fn(),
    savedPromptDrafts: [], savePromptDraft: vi.fn(), removePromptDraft: vi.fn(), openLink: vi.fn(), openImage: vi.fn(), openVisualization: vi.fn(),
  }, global: { provide: { [providerChoicesKey as symbol]: computed(() => ['antigravity']) } } });
  expect(wrapper.text()).toContain('Native Antigravity response');
  const confirmation = wrapper.get('.chat-tool-confirmation');
  expect(confirmation.findAll('button').map(button => button.text())).toEqual(['Allow', 'Deny']);
  await confirmation.findAll('button').find(button => button.text() === 'Deny')!.trigger('click'); await flushPromises();
  expect(actions.respond).toHaveBeenCalledExactlyOnceWith(agent.id, { id: 'permission', outcome: { kind: 'decision', decision: 'deny' } });
  view.session = { ...running, requests: [] };
  view.session = { ...running, busy: false, activeTurnId: null, turns: [completedTurn('turn')], requests: [], messages: [{ ...streaming, status: 'complete' }] };
  await flushPromises();
  expect(wrapper.get('.chat-rich-text-editor').text()).toBe('Keep my draft');
  expect(wrapper.find('.chat-tool-confirmation').exists()).toBe(false);
  const buttons = wrapper.findAll('button').map(button => `${button.text()} ${button.attributes('aria-label') ?? ''}`).join('\n');
  expect(buttons).not.toMatch(/Retry turn|Edit message|Fork conversation|Set goal|Compact/);
  view.history = { ...view.history, failed: true };
  await flushPromises();
  expect(wrapper.text()).toContain('Native Antigravity response');
  expect(wrapper.find('.conversation-load-error').exists()).toBe(false);
  wrapper.unmount();
});
