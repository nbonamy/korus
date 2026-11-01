import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { ElPopover } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SplitLayoutControl from '../SplitLayoutControl.vue';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SplitLayoutControl', () => {
  it('opens a visible layout menu and closes it after selecting a layout', async () => {
    const wrapper = mount(SplitLayoutControl, {
      attachTo: document.body,
      props: { modelValue: 'single' },
      global: { components: { ElPopover } },
    });
    await wrapper.get('button').trigger('click');
    await flushPromises();
    const option = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
      .find((item) => item.textContent?.includes('Vertical Split'));
    expect(option).toBeDefined();
    const row = new DOMWrapper(option!);
    await vi.waitFor(() => expect(row.isVisible()).toBe(true));
    await row.trigger('click');
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')).toStrictEqual([['2-vertical']]);
    await vi.waitFor(() => expect(row.isVisible()).toBe(false));
  });
});
