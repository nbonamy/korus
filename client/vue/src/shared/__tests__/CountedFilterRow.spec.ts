import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import CountedFilterRow from '../CountedFilterRow.vue';

describe('CountedFilterRow', () => {
  it('supports exclusive clicks, modifier toggles, clearing, and clearing a selected zero-count option', async () => {
    const wrapper = mount(CountedFilterRow, { props: {
      modelValue: [] as string[], label: 'Types', allLabel: 'All', total: 3,
      options: [{ value: 'code', label: 'Code', count: 2 }, { value: 'tests', label: 'Tests', count: 1 }, { value: 'docs', label: 'Docs', count: 0 }],
      'onUpdate:modelValue': (value: string[]) => { void wrapper.setProps({ modelValue: value }); },
    } });
    const click = (name: string, event = {}) => wrapper.get(`button[aria-label="${name}"]`).trigger('click', event);
    expect(wrapper.get('[aria-label="Docs · 0"]').attributes('disabled')).toBeDefined();
    await click('Code · 2');
    await click('Tests · 1', { metaKey: true });
    expect(wrapper.props('modelValue')).toEqual(['code', 'tests']);
    await click('Code · 2', { ctrlKey: true });
    expect(wrapper.props('modelValue')).toEqual(['tests']);
    await click('Tests · 1', { metaKey: true });
    expect(wrapper.props('modelValue')).toEqual([]);
    await click('Code · 2');
    await click('Tests · 1');
    expect(wrapper.props('modelValue')).toEqual(['tests']);
    await click('All · 3', { ctrlKey: true });
    expect(wrapper.props('modelValue')).toEqual([]);
    await wrapper.setProps({ modelValue: ['docs'] });
    await click('Docs · 0', { metaKey: true });
    expect(wrapper.props('modelValue')).toEqual([]);
  });
});
