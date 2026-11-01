import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import SubagentControl from '../SubagentControl.vue';
import type { AgentSubagentTree } from '@workspace/core/contracts';

const tree: AgentSubagentTree = {
  rootConversationId: 'thread-root',
  nodes: {
    'thread-root': {
      conversationId: 'thread-root',
      parentConversationId: 'thread-scout',
      createdAt: '2026-06-05T00:00:04.000Z',
      status: 'running',
      agentPath: '/root',
      updatedAt: '2026-06-05T00:00:04.000Z',
    },
    'thread-auditor': {
      conversationId: 'thread-auditor',
      parentConversationId: 'thread-root',
      createdAt: '2026-06-05T00:00:03.000Z',
      status: 'interrupted',
      agentPath: '/root/auditor',
      updatedAt: '2026-06-05T00:00:03.000Z',
    },
    'thread-scout': {
      conversationId: 'thread-scout',
      parentConversationId: 'thread-root',
      createdAt: '2026-06-05T00:00:01.000Z',
      status: 'running',
      agentPath: '/root/scout',
      agentNickname: 'Harvey',
      updatedAt: '2026-06-05T00:00:01.000Z',
    },
    'thread-reviewer': {
      conversationId: 'thread-reviewer',
      parentConversationId: 'thread-scout',
      createdAt: '2026-06-05T00:00:02.000Z',
      status: 'completed',
      agentPath: '/root/scout/reviewer',
      updatedAt: '2026-06-05T00:00:02.000Z',
    },
  },
  operations: {},
  activities: {},
};

describe('SubagentControl', () => {
  afterEach(() => vi.useRealTimers());

  it('counts only active agents in the icon-only badge and opens the full hierarchical menu', async () => {
    const wrapper = mount(SubagentControl, { props: { tree } });
    const trigger = wrapper.get('[aria-label="Subagents (1 active)"]');

    expect(trigger.text()).toBe('1');
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    await trigger.trigger('click');

    expect(wrapper.get('.subagent-control__menu-header').text()).toBe('Subagents3 total');
    expect(wrapper.get('[role="menu"]').text()).not.toContain('Active ·');
    expect(wrapper.get('[role="menu"]').text()).not.toContain('Done ·');
    expect(wrapper.findAll('.subagent-control__name').map((name) => name.text())).toStrictEqual([
      'Harvey',
      'auditor',
      'reviewer',
    ]);
    expect(wrapper.get('[role="menu"]').text()).not.toContain('root');
    expect(wrapper.get('[role="menu"]').text()).not.toContain('Running');
    expect(wrapper.get('[role="menu"]').text()).not.toContain('Completed');
    expect(wrapper.get('[role="menu"]').text()).not.toContain('Interrupted');
    expect(wrapper.get('[role="menu"]').text()).not.toContain('Working');
    expect(wrapper.findAll('[role="menuitem"]')[2].attributes('style')).toContain('--subagent-depth: 1');
    expect(wrapper.findAll('[role="menuitem"]')[0].attributes('style')).toContain('--subagent-depth: 0');
    expect(wrapper.findAll('[role="menuitem"]')[1].attributes('style')).toContain('--subagent-depth: 0');
  });

  it('emits the selected conversation and closes the menu', async () => {
    const wrapper = mount(SubagentControl, {
      props: { tree, selectedConversationId: 'thread-reviewer' },
    });
    await wrapper.get('[aria-label="Subagents (1 active)"]').trigger('click');
    const rows = wrapper.findAll('[role="menuitem"]');

    expect(rows[2].classes()).toContain('subagent-control__row--selected');
    await rows[0].trigger('click');

    expect(wrapper.emitted('select')).toStrictEqual([['thread-scout']]);
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('keeps the history button without a badge when no subagent is active', async () => {
    const completedTree: AgentSubagentTree = {
      ...tree,
      nodes: Object.fromEntries(Object.entries(tree.nodes).map(([id, node]) => [id, { ...node, status: 'completed' as const }])),
    };
    const wrapper = mount(SubagentControl, { props: { tree: completedTree } });
    const trigger = wrapper.get('[aria-label="Subagents"]');

    expect(wrapper.find('.subagent-control__count').exists()).toBe(false);
    await trigger.trigger('click');

    expect(wrapper.findAll('[role="menuitem"]')).toHaveLength(3);
    expect(wrapper.get('.subagent-control__menu-header').text()).toBe('Subagents3 total');
    expect(wrapper.get('[role="menu"]').text()).not.toContain('Done ·');
  });

  it('shows live elapsed time for active agents and relative activity for finished agents', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-05T00:02:01.000Z'));
    const wrapper = mount(SubagentControl, { props: { tree } });

    await wrapper.get('[aria-label="Subagents (1 active)"]').trigger('click');
    expect(wrapper.findAll('.subagent-control__time').map((time) => time.text())).toStrictEqual([
      '2m 0s',
      '1m ago',
      '1m ago',
    ]);

    vi.advanceTimersByTime(1_000);
    await nextTick();
    expect(wrapper.findAll('.subagent-control__time')[0].text()).toBe('2m 1s');
    wrapper.unmount();
  });
});
