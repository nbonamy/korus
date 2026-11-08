import { flushPromises, mount } from '@vue/test-utils';
import { computed } from 'vue';
import type { ComputerUseLockHold } from '@workspace/core/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamRailLockControl from '../TeamRailLockControl.vue';
import { computerUseLockKey, nextMorning } from '../computer-use-lock';

const clock = (timestamp: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp);

function mountControl(visible: boolean, hold: ComputerUseLockHold = false) {
  const setHold = vi.fn().mockResolvedValue(undefined);
  const wrapper = mount(TeamRailLockControl, {
    attachTo: document.body,
    global: { provide: { [computerUseLockKey as symbol]: { state: computed(() => ({ visible, hold })), setHold } } },
  });
  return { wrapper, setHold };
}

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('rail lock control', () => {
  it('is absent unless Computer Use is on and set to On demand, and without a provider', () => {
    expect(mountControl(false).wrapper.find('button').exists()).toBe(false);
    expect(mount(TeamRailLockControl).find('button').exists()).toBe(false);
  });

  it('offers one hour, the next morning or until turned off, and stores each as a hold', async () => {
    vi.setSystemTime(new Date(2026, 10, 4, 21, 30));
    const { wrapper, setHold } = mountControl(true);
    const trigger = wrapper.get('button[aria-label="Disable screen lock"]');
    const choose = async (label: string) => {
      await trigger.trigger('click');
      await flushPromises();
      const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(entry => entry.textContent?.trim() === label);
      expect(item, label).toBeDefined();
      item!.click();
      await flushPromises();
    };
    const morning = new Date(2026, 10, 5, 9, 0).getTime();
    await trigger.trigger('click');
    await flushPromises();
    const hourItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(entry => entry.textContent?.trim() === 'For 1 hour');
    expect(hourItem!.querySelector('svg')!.getAttribute('class')).toContain('tabler-icon-clock-hour-10'); // it ends at 22:30
    await trigger.trigger('click');
    await flushPromises();
    await choose('For 1 hour');
    expect(setHold).toHaveBeenLastCalledWith({ until: new Date(2026, 10, 4, 22, 30).getTime() });
    await choose(`Until ${clock(morning)}`);
    expect(setHold).toHaveBeenLastCalledWith({ until: morning });
    await choose('Until I turn it off');
    expect(setHold).toHaveBeenLastCalledWith({ until: null });
    wrapper.unmount();
  });

  it('shows an open lock with the end time while a hold lasts, and turns protection back on at once when clicked', async () => {
    vi.setSystemTime(new Date(2026, 10, 4, 21, 30));
    const until = new Date(2026, 10, 5, 9, 0).getTime();
    const { wrapper, setHold } = mountControl(true, { until });
    const button = wrapper.get('button');
    expect(button.attributes('aria-label')).toBe(`Screen lock disabled until ${clock(until)}`);
    await button.trigger('click');
    expect(setHold).toHaveBeenCalledExactlyOnceWith(false);
    wrapper.unmount();
    const manual = mountControl(true, { until: null });
    expect(manual.wrapper.get('button').attributes('aria-label')).toBe('Screen lock disabled until you turn it back on');
    manual.wrapper.unmount();
  });

  it('treats an expired hold as inactive', () => {
    vi.setSystemTime(new Date(2026, 10, 4, 21, 30));
    const { wrapper } = mountControl(true, { until: Date.now() - 1000 });
    expect(wrapper.find('button[aria-label="Disable screen lock"]').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe('next morning', () => {
  it.each([
    [new Date(2026, 10, 4, 21, 30), new Date(2026, 10, 5, 9, 0)],
    [new Date(2026, 10, 4, 8, 30), new Date(2026, 10, 5, 9, 0)],
    [new Date(2026, 10, 4, 2, 0), new Date(2026, 10, 4, 9, 0)],
    [new Date(2026, 11, 31, 23, 59), new Date(2027, 0, 1, 9, 0)],
  ])('from %s is %s', (now, expected) => {
    expect(nextMorning(now)).toBe(expected.getTime());
  });
});
