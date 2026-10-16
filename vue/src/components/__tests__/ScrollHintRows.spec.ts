import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import ScrollHintRows from '../ScrollHintRows.vue';

function metrics(element: HTMLElement, values: { clientHeight: number; scrollHeight: number; scrollTop: number }): void {
  for (const [key, value] of Object.entries(values)) Object.defineProperty(element, key, { configurable: true, value });
}

describe('ScrollHintRows', () => {
  it('reports which sides still have rows to scroll to', async () => {
    const wrapper = mount(ScrollHintRows, { slots: { default: '<p>row</p>' } });
    const scroller = wrapper.get('[data-scroll-hint-rows]');
    const last = () => wrapper.emitted('overflow')!.at(-1)![0];
    for (const [values, expected] of [
      [{ clientHeight: 100, scrollHeight: 100, scrollTop: 0 }, { up: false, down: false }],
      [{ clientHeight: 100, scrollHeight: 105, scrollTop: 0 }, { up: false, down: false }],
      [{ clientHeight: 100, scrollHeight: 105, scrollTop: 5 }, { up: false, down: false }],
      [{ clientHeight: 100, scrollHeight: 300, scrollTop: 0 }, { up: false, down: true }],
      [{ clientHeight: 100, scrollHeight: 300, scrollTop: 100 }, { up: true, down: true }],
      [{ clientHeight: 100, scrollHeight: 300, scrollTop: 200 }, { up: true, down: false }],
    ] as const) {
      metrics(scroller.element as HTMLElement, values);
      await scroller.trigger('scroll');
      expect(last()).toStrictEqual(expected);
    }
  });

  it('pages down while there is more below, then returns to the top', () => {
    const wrapper = mount(ScrollHintRows, { slots: { default: '<p>row</p>' } });
    const scroller = wrapper.get('[data-scroll-hint-rows]').element as HTMLElement;
    scroller.scrollBy = vi.fn();
    scroller.scrollTo = vi.fn();
    metrics(scroller, { clientHeight: 100, scrollHeight: 300, scrollTop: 100 });
    wrapper.vm.scrollMore();
    expect(scroller.scrollBy).toHaveBeenCalledWith({ top: 100, behavior: 'smooth' });
    metrics(scroller, { clientHeight: 100, scrollHeight: 300, scrollTop: 200 });
    wrapper.vm.scrollMore();
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('publishes the section height needed to show two rows, measured from the real rows', () => {
    let resized: () => void = () => {};
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback; } observe(): void {} disconnect(): void {} });
    const wrapper = mount(ScrollHintRows, { attachTo: document.body, slots: { default: '<p>a</p><p>b</p><p>c</p>' } });
    const rows = [...wrapper.element.querySelectorAll('p')];
    [0, 53, 106].forEach((top, index) => Object.defineProperty(rows[index], 'offsetTop', { configurable: true, value: top }));
    Object.defineProperty(wrapper.element, 'offsetTop', { configurable: true, value: 49 });
    resized();
    expect((wrapper.element.parentElement as HTMLElement).style.getPropertyValue('--section-floor')).toBe('155px');
    wrapper.unmount();
    vi.unstubAllGlobals();
  });
});
