import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PaneTransition from '../PaneTransition.vue';

// Isolate the transition because shell tests stub Vue transitions. Protect delayed
// removal, completion of expansion, and cancelling a collapse before it finishes.
const Harness = defineComponent({
  props: { open: Boolean },
  setup: props => () => h('div', [h(PaneTransition, null, {
    default: () => props.open ? h('aside', { style: { flexBasis: '260px', width: '260px', minWidth: '200px' } }, 'Pane content') : null,
  })]),
});

afterEach(() => vi.useRealTimers());

describe('PaneTransition', () => {
  it('keeps content mounted while collapsing, expands, and survives a reversed transition', async () => {
    vi.useFakeTimers();
    const wrapper = mount(Harness, { props: { open: true }, attachTo: document.body, global: { stubs: { transition: false } } });
    await wrapper.setProps({ open: false });
    expect(wrapper.get('aside').text()).toBe('Pane content');
    await vi.advanceTimersByTimeAsync(40);
    expect(wrapper.find('aside').exists()).toBe(true);
    await vi.runAllTimersAsync();
    await nextTick();
    expect(wrapper.find('aside').exists()).toBe(false);
    await wrapper.setProps({ open: true });
    await vi.runAllTimersAsync();
    expect(wrapper.get('aside').text()).toBe('Pane content');
    expect(getComputedStyle(wrapper.get('aside').element).minWidth).toBe('200px');
    await wrapper.setProps({ open: false });
    await vi.advanceTimersByTimeAsync(40);
    await wrapper.setProps({ open: true });
    await vi.runAllTimersAsync();
    expect(wrapper.findAll('aside')).toHaveLength(1);
    expect(getComputedStyle(wrapper.get('aside').element).minWidth).toBe('200px');
    expect(wrapper.get('aside').attributes('style')).toContain('min-width: 200px');
  });
});
