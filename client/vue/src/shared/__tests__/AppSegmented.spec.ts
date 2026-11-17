import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { describe, expect, it } from 'vitest';
import AppSegmented from '../AppSegmented.vue';

const Icon = defineComponent({ render: () => h('svg', { class: 'test-icon' }) });
const options = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System', disabled: true },
];

describe('AppSegmented', () => {
  it('renders its options, selects the model value and names the group', () => {
    const wrapper = mount(AppSegmented, { props: { modelValue: 'dark', options, label: 'Appearance' } });
    expect(wrapper.findAll('.el-segmented__item').map(item => item.text())).toStrictEqual(['Light', 'Dark', 'System']);
    expect(wrapper.get('.el-segmented__item.is-selected').text()).toBe('Dark');
    expect(wrapper.find('[aria-label="Appearance"]').exists()).toBe(true);
  });

  it('reports the chosen value and ignores a disabled option', async () => {
    const wrapper = mount(AppSegmented, { props: { modelValue: 'light', options, label: 'Appearance' } });
    await wrapper.findAll('.el-segmented__item')[1]!.get('input').setValue(true);
    expect(wrapper.emitted('update:modelValue')).toStrictEqual([['dark']]);
    expect(wrapper.findAll('.el-segmented__item')[2]!.classes()).toContain('is-disabled');
  });

  it('shows nothing selected without a value, keeping numeric values numeric', async () => {
    const wrapper = mount(AppSegmented, { props: { modelValue: null, options: [{ value: 7, label: '7d' }, { value: 30, label: '30d' }], label: 'Range' } });
    expect(wrapper.find('.el-segmented__item.is-selected').exists()).toBe(false);
    await wrapper.findAll('.el-segmented__item')[1]!.get('input').setValue(true);
    expect(wrapper.emitted('update:modelValue')).toStrictEqual([[30]]);
  });

  it('draws an option icon or colour marker beside its label, and plain text otherwise', () => {
    const wrapper = mount(AppSegmented, { props: { modelValue: 'a', label: 'Kinds', options: [
      { value: 'a', label: 'With icon', icon: Icon },
      { value: 'b', label: 'With colour', color: 'rgb(1, 2, 3)' },
      { value: 'c', label: 'Plain' },
    ] } });
    const items = wrapper.findAll('.el-segmented__item');
    expect(items[0]!.find('.test-icon').exists()).toBe(true);
    expect(items[1]!.get('i').attributes('style')).toContain('rgb(1, 2, 3)');
    expect(items[2]!.find('.app-segmented__option').exists()).toBe(false);
  });

  it.each([['default', []], ['small', ['app-segmented--small']], ['compact', ['app-segmented--compact']]] as const)('applies the %s size', (size, expected) => {
    const wrapper = mount(AppSegmented, { props: { modelValue: 'light', options, label: 'Appearance', size } });
    expect(wrapper.classes()).toContain('app-segmented');
    for (const name of ['app-segmented--small', 'app-segmented--compact']) expect(wrapper.classes().includes(name)).toBe((expected as readonly string[]).includes(name));
  });

  it('passes a class on to the control itself', () => {
    const wrapper = mount(AppSegmented, { props: { modelValue: 'light', options, label: 'Appearance' }, attrs: { class: 'caller-class' } });
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['el-segmented', 'app-segmented', 'caller-class']));
  });
});
