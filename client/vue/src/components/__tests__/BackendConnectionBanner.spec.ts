import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import BackendConnectionBanner from '../BackendConnectionBanner.vue';

describe('BackendConnectionBanner', () => {
  it('stays hidden while daemon is connected', () => {
    const wrapper = mount(BackendConnectionBanner, {
      props: { connectionState: { status: 'connected' } },
    });

    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });

  it('shows reconnecting state and detail', () => {
    const wrapper = mount(BackendConnectionBanner, {
      props: {
        connectionState: { status: 'reconnecting', detail: 'socket closed' },
      },
    });

    expect(wrapper.get('[role="status"]').text()).toContain('Agents keep working in the background.');
    expect(wrapper.get('[role="status"]').text()).toContain('socket closed');
  });
});
