import { flushPromises, mount } from '@vue/test-utils';
import { computed, shallowReactive } from 'vue';
import { expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { antigravityBackendCapabilities } from '@workspace/core/backend-capabilities';
import { createAntigravityConversationReplica, emptyAntigravitySnapshot } from '@workspace/core/antigravity-conversation-replica';
import { createAgentComposerState } from '../../agent-composer-state';
import type { AgentConversationView } from '../../app-state';
import type { AgentConversationActions } from '../use-agent-conversation';
import { backendChoicesKey } from '../backend-selection';
import AgentConversationPanel from '../AgentConversationPanel.vue';

it('renders the Antigravity replica, denies a native approval, and keeps unsupported turn controls absent', async () => {
  const snapshot = createInitialSnapshot();
  const agent = snapshot.agents[0]!;
  agent.backend = 'antigravity'; agent.backendDefaults = { kind: 'antigravity', permissionMode: 'default' };
  agent.backendSession = { kind: 'antigravity', sessionId: 'native-session' };
  const replica = createAntigravityConversationReplica(emptyAntigravitySnapshot(agent.id, 'native-session'));
  const identity = { agentId: agent.id, sessionId: 'native-session', turnId: 'turn', occurredAt: '2026-10-06T10:00:00Z' };
  replica.apply({ ...identity, type: 'turn.started', payload: { turn: { id: 'turn' } } });
  replica.apply({ ...identity, type: 'message.upsert', payload: { message: { id: 'message', agentId: agent.id, turnId: 'turn', role: 'assistant', status: 'streaming', createdAt: identity.occurredAt, parts: [{ type: 'text', text: 'Native Antigravity response' }] } } });
  replica.apply({ ...identity, type: 'request.created', payload: { request: { id: 'permission', kind: 'confirm_tool', payload: { confirmation: {
    integrationId: 'antigravity', integrationName: 'Antigravity', toolName: 'Edit', summary: 'Edit example.ts?', argumentsPreview: 'change', allowAlways: false, allowConversation: false,
  } } } } });
  const view = shallowReactive<AgentConversationView>({
    agent, codexSnapshot: null, claudeSnapshot: null, antigravitySnapshot: replica.getSnapshot(),
    composer: createAgentComposerState({ getSnapshot: () => snapshot }).configurationForAgent(agent.id),
    composerState: { text: 'Keep my draft', selectionStart: 0, selectionEnd: 0 }, attachments: [], capabilities: antigravityBackendCapabilities,
    approvals: [], queuedPrompts: [], sending: false, history: { failed: false, hydrating: false, hasOlder: false, loadingOlder: false }, answeredClientRequestIds: new Set(),
  });
  const actions: AgentConversationActions = {
    planReview: vi.fn(), clearGoal: vi.fn(), threadFlag: vi.fn(), prepare: vi.fn(), loadOlder: vi.fn(), send: vi.fn(), steer: vi.fn(), interrupt: vi.fn(),
    deleteTurn: vi.fn(), editTurn: vi.fn(), forkTurn: vi.fn(), retryTurn: vi.fn(), continueInterruptedTurn: vi.fn(), resolveApproval: vi.fn(), clientResponse: vi.fn(),
    selectModel: vi.fn(), selectReasoningEffort: vi.fn(), selectServiceTier: vi.fn(), setPlanMode: vi.fn(), setApprovalPreset: vi.fn(), setPermissionMode: vi.fn(),
    updateComposerState: vi.fn(), updateAttachments: vi.fn(), deleteQueuedPrompt: vi.fn(), updateQueuedPrompt: vi.fn(), steerQueuedPrompt: vi.fn(),
  };
  const wrapper = mount(AgentConversationPanel, { props: {
    view, actions, agents: [agent], focused: true, mentionGroups: [], modelMenuItems: [], selectModelMenuItem: vi.fn(),
    savedPromptDrafts: [], savePromptDraft: vi.fn(), removePromptDraft: vi.fn(), openLink: vi.fn(), openImage: vi.fn(), openVisualization: vi.fn(),
  }, global: { provide: { [backendChoicesKey as symbol]: computed(() => ['antigravity']) } } });
  expect(wrapper.text()).toContain('Native Antigravity response');
  const confirmation = wrapper.get('.chat-tool-confirmation');
  expect(confirmation.findAll('button').map(button => button.text())).toEqual(['Allow', 'Deny']);
  await confirmation.findAll('button').find(button => button.text() === 'Deny')!.trigger('click'); await flushPromises();
  expect(actions.clientResponse).toHaveBeenCalledExactlyOnceWith({ agentId: agent.id, id: 'permission', payload: { decision: 'deny' } });
  view.antigravitySnapshot = replica.apply({ ...identity, type: 'request.resolved', payload: { id: 'permission', outcome: { kind: 'decision', decision: 'deny' } } });
  view.antigravitySnapshot = replica.apply({ ...identity, type: 'turn.completed', payload: { turn: { id: 'turn', status: 'completed' } } });
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
