import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import NewAgentButton from '../NewAgentButton.vue';

describe('NewAgentButton', () => {
  it('renders one new-agent action and emits it when clicked', async () => {
    const wrapper = mountButton();

    expect(wrapper.get('.agent-sidebar__new').text()).toContain('New Agent');
    expect(wrapper.findAll('button')).toHaveLength(1);

    await wrapper.get('.agent-sidebar__new').trigger('click');
    expect(wrapper.emitted('new-agent')).toStrictEqual([[]]);
  });

  it('keeps tile, tone, and compact presentation variants', () => {
    const wrapper = mountButton({
      label: 'Add Agent',
      presentation: 'tile',
      size: 'small',
      tone: 'muted',
    });

    expect(wrapper.classes()).toEqual(expect.arrayContaining([
      'new-agent-button--muted',
      'new-agent-button--small',
      'new-agent-button--tile',
    ]));
    expect(wrapper.get('.agent-sidebar__new').text()).toContain('Add Agent');
    expect(wrapper.find('.new-agent-button__detached-icon').exists()).toBe(true);
  });
});

function mountButton(props: {
  label?: string;
  presentation?: 'default' | 'tile';
  size?: 'regular' | 'small';
  tone?: 'primary' | 'muted' | 'ghost';
} = {}) {
  return mount(NewAgentButton, {
    props,
  });
}
