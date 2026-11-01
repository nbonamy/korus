import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ConversationLoadError from '../ConversationLoadError.vue';

describe('ConversationLoadError', () => {
  it('presents a quiet alert and emits retry once', async () => {
    const wrapper = mount(ConversationLoadError, {
      props: { loading: false },
    });

    expect(wrapper.get('[role="alert"]').text()).toContain('Conversation couldn’t be loaded.');
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'Make sure this conversation isn’t open in ChatGPT, then try again. If it still won’t load, restart the agent.',
    );
    expect(wrapper.get('[data-testid="conversation-load-error-illustration"]').attributes('aria-hidden')).toBe('true');
    const retry = wrapper.get('button');
    expect(retry.text()).toBe('Retry');
    expect(retry.attributes('disabled')).toBeUndefined();

    await retry.trigger('click');
    expect(wrapper.emitted('retry')).toStrictEqual([[]]);
  });

  it('disables retry while history is loading', () => {
    const wrapper = mount(ConversationLoadError, {
      props: { loading: true },
    });

    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
  });
});
