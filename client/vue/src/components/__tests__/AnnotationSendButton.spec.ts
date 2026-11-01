import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AnnotationSendButton from '../AnnotationSendButton.vue';

describe('AnnotationSendButton', () => {
  it('renders the shared numbered send action and emits clicks', async () => {
    const wrapper = mount(AnnotationSendButton, {
      props: { count: 3, label: 'Send 3 annotations' },
    });

    expect(wrapper.get('button').attributes('aria-label')).toBe('Send 3 annotations');
    expect(wrapper.get('button').text()).toBe('Send 3');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('click')).toStrictEqual([[]]);
  });
});
