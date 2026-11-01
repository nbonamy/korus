import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AppMenuChip from '../AppMenuChip.vue';
import type { AppMenuItem } from '../app-menu';

const items: AppMenuItem[] = [
  { id: 'recent', type: 'radio', label: 'Recent activity', checked: true },
  { id: 'name', type: 'radio', label: 'Alphabetical', checked: false },
];

describe('AppMenuChip', () => {
  it('shows the current choice, opens the shared menu and reports the selection', async () => {
    const wrapper = mount(AppMenuChip, { props: { label: 'Recent', ariaLabel: 'Sort by', items } });
    const chip = wrapper.get('.app-menu-chip');
    expect(chip.text()).toBe('Recent');
    expect(chip.attributes('aria-label')).toBe('Sort by');
    await chip.trigger('click');
    const rows = Array.from(document.body.querySelectorAll<HTMLElement>('.app-menu__item'));
    expect(rows.map((row) => row.textContent?.trim())).toEqual(['Recent activity', 'Alphabetical']);
    rows[1]!.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('select')).toStrictEqual([['name']]);
  });

  it('lets the trigger describe the current choice for assistive technology', () => {
    const wrapper = mount(AppMenuChip, { props: { label: 'Recent', ariaLabel: 'Sort by', triggerLabel: 'Sort repositories by recent activity', items } });
    expect(wrapper.get('.app-menu-chip').attributes('aria-label')).toBe('Sort repositories by recent activity');
  });
});
