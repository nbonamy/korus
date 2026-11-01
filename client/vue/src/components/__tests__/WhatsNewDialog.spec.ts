import { product } from '@workspace/core/product';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import WhatsNewDialog from '../WhatsNewDialog.vue';

vi.mock('../../generated/release-notes.json', () => ({
  default: {
    schemaVersion: 2,
    currentVersion: '9.9.0',
    releases: [
      {
        version: '9.9.0',
        releasedAt: '2026-01-02',
        sourceSha256: 'current-release-fixture',
        markdown: '### Current release fixture\n\n- Stable current release copy.',
      },
      {
        version: '9.8.0',
        releasedAt: '2025-12-20',
        sourceSha256: 'previous-release-fixture',
        markdown: '### Previous release fixture\n\n- Stable previous release copy.',
      },
    ],
  },
}));

describe('WhatsNewDialog', () => {
  it('defaults to the current release, navigates release history, and closes from the header', async () => {
    const wrapper = mount(WhatsNewDialog, {
      props: { visible: true },
      global: {
        stubs: {
          ElDialog: {
            name: 'ElDialog',
            props: ['modelValue'],
            template: `
              <section v-if="modelValue" class="whats-new-dialog-test-shell">
                <slot name="header" />
                <slot />
              </section>
            `,
          },
        },
      },
    });

    expect(wrapper.text()).toContain('Version 9.9.0');
    expect(wrapper.text()).toContain(`What’s new in ${product.name}`);
    expect(wrapper.get('h3').text()).toBe('Current release fixture');
    expect(wrapper.text()).toContain('Stable current release copy');

    await wrapper.getComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', '9.8.0');
    await wrapper.vm.$nextTick();

    expect(wrapper.get('h3').text()).toBe('Previous release fixture');
    expect(wrapper.text()).toContain('Stable previous release copy');
    expect(wrapper.text()).not.toContain('Stable current release copy');

    await wrapper.get('[aria-label="Close What’s New"]').trigger('click');
    expect(wrapper.emitted('close')).toStrictEqual([[]]);
  });
});
