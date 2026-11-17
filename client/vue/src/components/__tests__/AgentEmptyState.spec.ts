import { product } from '@workspace/core/product';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AgentEmptyState from '../AgentEmptyState.vue';

describe('AgentEmptyState', () => {
  it('shows the canonical new-agent sources inline and forwards each selection', async () => {
    const wrapper = mount(AgentEmptyState, {
      global: {
        },
    });

    expect(wrapper.text()).toContain(`Welcome to ${product.name}`);
    expect(wrapper.text()).toContain('New agent from…');
    expect(wrapper.get('[role="menu"]').attributes('aria-label')).toBe('New agent from…');
    expect(wrapper.get('.agent-empty-state__mark img').attributes('alt')).toBe(`${product.name}`);
    expect(wrapper.find('.agent-sidebar__new').exists()).toBe(false);

    const actions = wrapper.findAll('[role="menuitem"]');
    expect(actions.map((action) => action.text())).toStrictEqual([
      'New project…',
      'Existing folder or repository…',
      'GitHub repository…',
      'GitLab repository…',
      'Repository URL…',
      'Join with invite…',
    ]);

    for (const action of actions) await action.trigger('click');

    expect(wrapper.emitted('start-work')).toStrictEqual([['new'], ['local'], ['github'], ['gitlab'], ['url'], ['invite']]);
  });
});
