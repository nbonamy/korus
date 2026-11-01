import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SidebarExpandButton from '../SidebarExpandButton.vue';

describe('SidebarExpandButton', () => {
  it('exposes an accessible icon-only action that opens the sidebar', async () => {
    const wrapper = mount(SidebarExpandButton, { props: { label: 'Show sidebar' } });
    const button = wrapper.get('button');
    expect(button.attributes('aria-label')).toBe('Show sidebar');
    expect(button.attributes('title')).toBe('Show sidebar');
    expect(button.text()).toBe('');
    expect(button.get('svg').attributes('aria-hidden')).toBe('true');
    await button.trigger('click');
    expect(wrapper.emitted('click')).toStrictEqual([[]]);
  });
});
