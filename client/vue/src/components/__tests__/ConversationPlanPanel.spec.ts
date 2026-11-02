import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { ThreadPlan } from '@workspace/core/contracts';
import ConversationPlanPanel from '../ConversationPlanPanel.vue';
import { LoaderIcon } from '../../shared/icons/app-icons';

const plan: ThreadPlan = {
  threadId: 'thread-plan',
  turnId: 'turn-plan',
  kind: 'execution',
  status: 'inProgress',
  explanation: 'Ship the focused fix',
  steps: [
    { step: 'Inspect the event flow', status: 'completed' },
    { step: 'Move plan progress into the conversation', status: 'inProgress' },
    { step: 'Run focused tests', status: 'pending' },
  ],
  markdown: '',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('ConversationPlanPanel', () => {
  it('renders the named checklist with indeterminate activity until the plan completes', async () => {
    const wrapper = mount(ConversationPlanPanel, {
      props: { plan },
    });

    expect(wrapper.get('aside').attributes('aria-label')).toBe('Task list');
    const planTitle = wrapper.get('h2');
    expect(planTitle.text()).toBe('Ship the focused fix');
    expect(planTitle.attributes('title')).toBe('Ship the focused fix');
    expect(wrapper.find('.conversation-plan__explanation').exists()).toBe(false);
    expect(wrapper.get('header').findComponent(LoaderIcon).exists()).toBe(false);
    const steps = wrapper.findAll('.conversation-plan__step');
    expect(steps).toHaveLength(3);
    expect(steps[0].classes()).toContain('conversation-plan__step--completed');
    expect(steps[1].classes()).toContain('conversation-plan__step--inProgress');
    expect(steps[1].findComponent(LoaderIcon).exists()).toBe(true);
    expect(steps[2].classes()).toContain('conversation-plan__step--pending');
    await wrapper.setProps({ plan: { ...plan, status: 'completed', steps: plan.steps.map(entry => ({ ...entry, status: 'completed' })) } });
    expect(wrapper.findComponent(LoaderIcon).exists()).toBe(false);
    expect(wrapper.findAll('.conversation-plan__step--completed')).toHaveLength(3);
  });

  it('emits close when the overlay dismiss button is pressed', async () => {
    const wrapper = mount(ConversationPlanPanel, {
      props: { plan },
    });

    await wrapper.get('[aria-label="Close task list"]').trigger('click');

    expect(wrapper.emitted('close')).toStrictEqual([[]]);
  });

  it('omits the status line when the backend provides no explanation', () => {
    const wrapper = mount(ConversationPlanPanel, {
      props: { plan: { ...plan, explanation: '  ' } },
    });

    expect(wrapper.get('h2').text()).toBe('Task list');
    expect(wrapper.find('.conversation-plan__explanation').exists()).toBe(false);
  });
});
