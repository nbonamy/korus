import { product } from '@workspace/core/product';
/**
 * @vitest-environment jsdom
 */
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import UpdateAvailableBadge from '../UpdateAvailableBadge.vue';

describe('UpdateAvailableBadge', () => {
  it.each(['disabled', 'idle', 'checking', 'error'] as const)(
    'stays hidden while the update state is %s',
    (state) => {
      const wrapper = mount(UpdateAvailableBadge, {
        props: { status: { state } },
      });

      expect(wrapper.find('button').exists()).toBe(false);
      expect(wrapper.find('[role="status"]').exists()).toBe(false);
    },
  );

  it('shows download progress as a blue status badge', () => {
    const wrapper = mount(UpdateAvailableBadge, {
      props: { status: { state: 'downloading' } },
    });

    const badge = wrapper.get('[role="status"]');
    expect(badge.text()).toBe('Downloading…');
    expect(badge.classes()).toContain('update-status-badge--busy');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('shows downloaded updates and emits install', async () => {
    const wrapper = mount(UpdateAvailableBadge, {
      props: { status: { state: 'downloaded', version: '0.4.0' } },
    });

    const button = wrapper.get('button');
    expect(button.text()).toBe('Update available');
    expect(button.attributes('title')).toBe(`Update 0.4.0 available. Restart ${product.name} to install.`);

    await button.trigger('click');

    expect(wrapper.emitted('install')).toHaveLength(1);
  });
});
