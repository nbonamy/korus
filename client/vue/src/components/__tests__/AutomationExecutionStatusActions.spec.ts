import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AutomationExecutionStatusActions from '../AutomationExecutionStatusActions.vue';

describe('AutomationExecutionStatusActions', () => {
  it('renders status text and emits row actions', async () => {
    const wrapper = mount(AutomationExecutionStatusActions, {
      props: {
        status: 'completed',
        statusLabel: 'Completed',
        ticket: 'github:nbonamy/agent-workspace#12',
      },
    });

    expect(wrapper.text()).toContain('Completed');

    await wrapper.get('[aria-label="View conversation for github:nbonamy/agent-workspace#12"]').trigger('click');
    await wrapper.get('[aria-label="Delete execution for github:nbonamy/agent-workspace#12"]').trigger('click');

    expect(wrapper.emitted('view-conversation')).toHaveLength(1);
    expect(wrapper.emitted('delete-execution')).toHaveLength(1);
  });
});
