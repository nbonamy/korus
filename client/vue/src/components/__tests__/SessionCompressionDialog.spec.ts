import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SessionCompressionDialog from '../SessionCompressionDialog.vue';

describe('SessionCompressionDialog', () => {
  it('explains the user-visible loss and remembers warning dismissal only on confirmation', async () => {
    const wrapper = mountDialog();

    expect(wrapper.text()).toContain('Compress session?');
    expect(wrapper.text()).toContain('lose access to the detailed history');
    expect(wrapper.text()).toContain('Archived sessions');

    wrapper.findComponent({ name: 'ElCheckbox' }).vm.$emit('update:modelValue', true);
    await wrapper.vm.$nextTick();
    await wrapper.get('.app-button--primary').trigger('click');

    expect(wrapper.emitted('confirm')).toStrictEqual([[true]]);
  });

  it('shows stable progress without exposing implementation details', () => {
    const wrapper = mountDialog({ busy: true });

    expect(wrapper.text()).toContain('Summarizing session…');
    expect(wrapper.text()).toContain('Extracting key decisions, completed work, and next steps');
    expect(wrapper.text()).not.toContain('thread');
    expect(wrapper.find('.app-dialog__footer').exists()).toBe(false);
  });
});

function mountDialog(props: { busy?: boolean; error?: string | null } = {}) {
  return mount(SessionCompressionDialog, {
    props: { visible: true, ...props },
    global: {
      stubs: {
        ElDialog: {
          props: ['modelValue'],
          template: `
            <section v-if="modelValue">
              <slot name="header" />
              <slot />
              <slot name="footer" />
            </section>
          `,
        },
      },
    },
  });
}
