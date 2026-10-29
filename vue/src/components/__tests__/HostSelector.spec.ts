import { flushPromises, mount } from '@vue/test-utils';
import { ElOption, ElSelect } from 'element-plus';
import { defineComponent, h, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import type { RemoteConnection } from '@workspace/core/contracts';
import HostSelector from '../HostSelector.vue';

const hosts: RemoteConnection[] = [
  { id: 'wall-e', kind: 'ssh', name: 'wall-e', host: 'wall-e', status: 'ready', createdAt: '', updatedAt: '' },
  { id: 'devbox', kind: 'ssh', name: 'Devbox', host: 'devbox', status: 'ready', createdAt: '', updatedAt: '' },
];

// The shared picker can lose the selected icon, omit row icons, expose the local
// option in a remote-only flow, accept a disabled host, or drop compact sizing.
describe('HostSelector', () => {
  it('shows host icons in the selected value and dropdown while switching locations', async () => {
    const value = ref('local');
    const Harness = defineComponent({ setup: () => () => h(HostSelector, {
      modelValue: value.value, 'onUpdate:modelValue': (next: string) => { value.value = next; }, hosts, showThisComputer: true,
    }) });
    const wrapper = mount(Harness, { attachTo: document.body, global: { components: { ElSelect, ElOption } } });
    const input = wrapper.get('[aria-label="Host"]');
    expect(wrapper.find('.tabler-icon-device-imac').exists()).toBe(true);
    await input.trigger('click'); await flushPromises();
    const list = document.getElementById(input.attributes('aria-controls')!)!;
    const rows = [...list.querySelectorAll<HTMLElement>('.el-select-dropdown__item')];
    expect(rows.map(row => row.textContent?.trim())).toStrictEqual(['This computer', 'wall-e', 'Devbox']);
    expect(rows[0]!.querySelector('.tabler-icon-device-imac')).not.toBeNull();
    expect(rows[1]!.querySelector('.tabler-icon-world')).not.toBeNull();
    expect(rows[2]!.querySelector('.tabler-icon-world')).not.toBeNull();
    rows[1]!.click(); await flushPromises();
    expect(value.value).toBe('wall-e');
    expect(wrapper.find('.tabler-icon-world').exists()).toBe(true);
    wrapper.unmount();
  });

  it('supports a small remote-only selector and prevents choosing an unavailable host', async () => {
    const value = ref('wall-e');
    const Harness = defineComponent({ setup: () => () => h(HostSelector, {
      modelValue: value.value, 'onUpdate:modelValue': (next: string) => { value.value = next; },
      hosts, showThisComputer: false, size: 'small', disabledHostIds: ['devbox'],
    }) });
    const wrapper = mount(Harness, { attachTo: document.body, global: { components: { ElSelect, ElOption } } });
    const input = wrapper.get('[aria-label="Host"]');
    expect(wrapper.find('.el-select--small').exists()).toBe(true);
    expect(wrapper.find('.tabler-icon-world').exists()).toBe(true);
    await input.trigger('click'); await flushPromises();
    const list = document.getElementById(input.attributes('aria-controls')!)!;
    const rows = [...list.querySelectorAll<HTMLElement>('.el-select-dropdown__item')];
    expect(rows.map(row => row.textContent?.trim())).toStrictEqual(['wall-e', 'Devbox']);
    expect(rows[1]!.classList.contains('is-disabled')).toBe(true);
    rows[1]!.click(); await flushPromises();
    expect(value.value).toBe('wall-e');
    wrapper.unmount();
  });
});
