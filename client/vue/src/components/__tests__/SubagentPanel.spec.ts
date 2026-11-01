import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SubagentPanel from '../SubagentPanel.vue';
import type { AgentSubagentTree, RendererMessage } from '@workspace/core/contracts';

const tree: AgentSubagentTree = {
  rootConversationId: 'thread-root',
  nodes: {
    'thread-scout': {
      conversationId: 'thread-scout',
      parentConversationId: 'thread-root',
      createdAt: '2026-06-05T00:00:01.000Z',
      status: 'running',
      agentPath: '/root/scout',
      model: 'gpt-5',
      reasoningEffort: 'high',
      updatedAt: '2026-06-05T00:00:02.000Z',
    },
  },
  operations: {
    'spawn-1': {
      id: 'spawn-1',
      lifecycle: 'started',
      kind: 'spawnAgent',
      status: 'inProgress',
      senderConversationId: 'thread-root',
      receiverConversationIds: ['thread-scout'],
      prompt: 'Inspect tests',
      occurredAt: '2026-06-05T00:00:01.000Z',
    },
  },
  activities: {
    'activity-1': {
      id: 'activity-1',
      lifecycle: 'completed',
      kind: 'interacted',
      conversationId: 'thread-scout',
      agentPath: '/root/scout',
      occurredAt: '2026-06-05T00:00:02.000Z',
    },
  },
};

const messages: RendererMessage[] = [{
  id: 'message-1',
  agentId: 'agent-dina',
  role: 'assistant',
  status: 'complete',
  parts: [{ type: 'text', text: 'Found the issue.' }],
  createdAt: '2026-06-05T00:00:02.000Z',
}];

describe('SubagentPanel', () => {
  afterEach(() => vi.useRealTimers());

  it('loads every supplied live child message without a redundant pane header', async () => {
    const firstChildMessage: RendererMessage = {
      id: 'message-first-child',
      agentId: 'agent-dina',
      role: 'assistant',
      status: 'complete',
      parts: [{ type: 'text', text: 'First child output.' }],
      createdAt: '2026-06-05T00:00:01.000Z',
    };
    const loadMessages = vi.fn().mockResolvedValue([firstChildMessage, ...messages]);
    const wrapper = mount(SubagentPanel, {
      props: { tree, conversationId: 'thread-scout', loadMessages },
      global: {
        stubs: {
          CodexMessageList: {
            props: ['messages', 'actionsDisabled', 'canDeleteTurn', 'canEditTurn', 'canRetryTurn'],
            template: '<div class="message-list-stub" :data-message-id="messages[0] && messages[0].id">{{ messages.length }} messages</div>',
          },
        },
      },
    });
    await flushPromises();

    expect(loadMessages).toHaveBeenCalledWith('thread-scout');
    expect(wrapper.find('.subagent-panel__header').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('scout');
    expect(wrapper.text()).not.toContain('Running');
    expect(wrapper.get('.message-list-stub').text()).toBe('2 messages');
    expect(wrapper.get('.message-list-stub').attributes('data-message-id')).toBe('message-first-child');
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false);
  });

  it('hides housekeeping calls but retains other child tool activity', async () => {
    const toolMessage: RendererMessage = {
      id: 'message-tool',
      agentId: 'agent-dina',
      role: 'assistant',
      status: 'complete',
      createdAt: '2026-06-05T00:00:03.000Z',
      parts: [{
        type: 'tool',
        id: 'call-set-status',
        kind: 'mcp',
        title: 'workspace.set-status',
        status: 'completed',
        input: { status: 'Reviewing changes' },
        metadata: { server: 'workspace', tool: 'set-status' },
      }, {
        type: 'tool',
        id: 'call-finish-turn',
        kind: 'mcp',
        title: 'workspace.finish_turn',
        status: 'completed',
        input: {},
        metadata: { server: 'workspace', tool: 'finish_turn' },
      }, {
        type: 'tool',
        id: 'call-report-finding',
        kind: 'mcp',
        title: 'workspace.report_finding',
        status: 'completed',
        input: { title: 'Keep this visible' },
        metadata: { server: 'workspace', tool: 'report_finding' },
      }, {
        type: 'tool',
        id: 'call-other-finish-turn',
        kind: 'mcp',
        title: 'github.finish_turn',
        status: 'completed',
        input: {},
        metadata: { server: 'github', tool: 'finish_turn' },
      }],
    };
    const wrapper = mount(SubagentPanel, {
      props: { tree, conversationId: 'thread-scout', loadMessages: vi.fn().mockResolvedValue([toolMessage]) },
    });
    await flushPromises();

    expect(wrapper.text()).not.toContain('Updated status');
    expect(wrapper.text()).not.toContain('Finished turn');
    expect(wrapper.text()).toContain('Reported finding');
    expect(wrapper.findAll('.chat-tool-call')).toHaveLength(2);
    expect(wrapper.text()).not.toContain('workspace.set-status');
  });

  it('hides transport details and recovers from a transient conversation loading error', async () => {
    const loadMessages = vi.fn()
      .mockRejectedValueOnce(new Error("Error invoking remote method 'conversation:messages:read': Error: daemon request timed out: agent/conversation/messages/get"))
      .mockResolvedValue(messages);
    const wrapper = mount(SubagentPanel, {
      props: {
        tree,
        conversationId: 'thread-scout',
        loadMessages,
      },
      global: { stubs: { CodexMessageList: true } },
    });
    await flushPromises();

    expect(wrapper.get('.subagent-panel__state--error').text()).toContain('Unable to load subagent conversation');
    expect(wrapper.text()).not.toContain('Error invoking remote method');
    expect(wrapper.text()).not.toContain('agent/conversation/messages/get');

    await wrapper.get('[data-testid="subagent-conversation-retry"]').trigger('click');
    await flushPromises();

    expect(loadMessages).toHaveBeenCalledTimes(2);
    expect(wrapper.find('.subagent-panel__state--error').exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'CodexMessageList' }).props('messages')).toStrictEqual(messages);
  });

  it('refreshes a visible running conversation until the child completes', async () => {
    vi.useFakeTimers();
    const loadMessages = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue(messages);
    const wrapper = mount(SubagentPanel, {
      props: { tree, conversationId: 'thread-scout', visible: true, loadMessages },
      global: {
        stubs: {
          CodexMessageList: {
            props: ['messages'],
            template: '<div class="message-list-stub">{{ messages.length }} messages</div>',
          },
        },
      },
    });
    await flushPromises();

    expect(loadMessages).toHaveBeenCalledTimes(1);
    expect(wrapper.get('.message-list-stub').text()).toBe('0 messages');

    await vi.advanceTimersByTimeAsync(1_500);
    await flushPromises();

    expect(loadMessages).toHaveBeenCalledTimes(2);
    expect(wrapper.get('.message-list-stub').text()).toBe('1 messages');

    await wrapper.setProps({
      tree: {
        ...tree,
        nodes: {
          ...tree.nodes,
          'thread-scout': {
            ...tree.nodes['thread-scout']!,
            status: 'completed',
            updatedAt: '2026-06-05T00:00:03.000Z',
          },
        },
      },
    });
    await flushPromises();
    expect(loadMessages).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(1_500);
    expect(loadMessages).toHaveBeenCalledTimes(3);
  });
});
