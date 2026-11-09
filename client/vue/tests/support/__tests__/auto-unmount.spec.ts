import { mount } from '@vue/test-utils';
import { defineComponent, h, onUnmounted } from 'vue';
import { afterAll, expect, it, vi } from 'vitest';

const disposed = vi.fn();
afterAll(() => { expect(disposed).toHaveBeenCalledExactlyOnceWith(); });

it('disposes mounted component resources through the shared afterEach cleanup', () => {
  const wrapper = mount(defineComponent({
    setup() {
      onUnmounted(disposed);
      return () => h('span', 'Mounted');
    },
  }));
  expect(wrapper.text()).toBe('Mounted');
  // Intentionally leave this mounted: shared setup must dispose it before afterAll.
});
