import '../../../styles/base.css';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { PencilIcon, SwitchHorizontalIcon } from '../../icons/app-icons';
import AppMenu from '../AppMenu.vue';
import type { AppMenuItem } from '../app-menu';

describe('AppMenu', () => {
  it('uses compact regular-weight menu labels', () => {
    const wrapper = mount(AppMenu, {
      attachTo: document.body,
      props: { ariaLabel: 'Actions', items: [{ id: 'edit', type: 'action', label: 'Edit' }] },
    });
    try {
      expect(getComputedStyle(wrapper.get('[role="menuitem"]').element).fontSize).toBe('var(--font-size-13-5)');
      expect(getComputedStyle(wrapper.get('.app-menu__label').element).fontWeight).toBe('var(--font-weight-regular)');
    } finally { wrapper.unmount(); }
  });

  it('keeps selected diff scopes accessible without a check column', async () => {
    const items: AppMenuItem[] = [
      { id: 'branch', type: 'radio', label: 'Branch', value: '+12 -4', checked: false, icon: PencilIcon },
      { id: 'working', type: 'radio', label: 'Uncommitted', value: { addedLines: 2, removedLines: 1 }, checked: true, icon: PencilIcon },
    ];
    const wrapper = mount(AppMenu, { props: { ariaLabel: 'Diff scope', items, showSelectionCheck: false } });
    const rows = wrapper.findAll('[role="menuitemradio"]');
    expect(rows.map(row => row.attributes('aria-checked'))).toStrictEqual(['false', 'true']);
    expect(wrapper.find('.app-menu__check').exists()).toBe(false);
    expect(rows[1]!.get('.app-menu__label').text()).toBe('Uncommitted');
    expect(rows[1]!.get('.app-menu__value').text()).toBe('+2 -1');
    await rows[0]!.trigger('click');
    expect(wrapper.emitted('select')).toStrictEqual([['branch']]);
  });

  it('renders actions, separators, selected radio state, and submenu chevrons consistently', () => {
    const wrapper = mountMenu([
      {
        id: 'edit',
        type: 'action',
        label: 'Edit',
        icon: PencilIcon,
      },
      { id: 'separator', type: 'separator' },
      {
        id: 'move',
        type: 'submenu',
        label: 'Move',
        icon: SwitchHorizontalIcon,
        items: [
          {
            id: 'team-a',
            type: 'radio',
            label: 'Team A',
            description: 'Current team',
            checked: true,
          },
        ],
      },
    ]);

    expect(wrapper.findAll('[role="menuitem"]').map((item) => item.text())).toStrictEqual([
      'Edit',
      'Move',
    ]);
    expect(wrapper.find('[role="separator"]').exists()).toBe(true);
    expect(wrapper.find('.app-menu__chevron').exists()).toBe(true);
    expect(wrapper.get('[role="menuitemradio"]').attributes('aria-checked')).toBe('true');
    expect(wrapper.text()).toContain('Team A • Current team');
    expect(getComputedStyle(wrapper.get('[role="menuitem"]').element).userSelect).toBe('none');
  });

  it('emits selected item ids for root and nested items', async () => {
    const wrapper = mountMenu([
      {
        id: 'edit',
        type: 'action',
        label: 'Edit',
      },
      {
        id: 'move',
        type: 'submenu',
        label: 'Move',
        items: [
          {
            id: 'team-a',
            type: 'action',
            label: 'Team A',
          },
        ],
      },
    ]);

    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Edit')?.trigger('click');
    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Team A')?.trigger('click');

    expect(wrapper.emitted('select')).toStrictEqual([['edit'], ['team-a']]);
  });

  it('emits checkbox switch selections through the same select event', async () => {
    const wrapper = mountMenu([
      {
        id: 'plan-mode',
        type: 'checkbox',
        label: 'Plan mode',
        accessory: 'switch',
        checked: false,
      },
    ]);

    await wrapper.get('[role="menuitemcheckbox"]').trigger('click');

    expect(wrapper.emitted('select')).toStrictEqual([['plan-mode']]);
  });

  it('keeps icon-less submenu rows aligned with icon-less rows beside them', () => {
    const wrapper = mountMenu([
      { id: 'plain', type: 'radio', label: 'Plain', checked: false },
      { id: 'more', type: 'submenu', label: 'More', items: [{ id: 'one', type: 'action', label: 'One' }] },
    ]);
    const labelOffset = (row: string) => [...wrapper.get(row).element.children].findIndex(child => child.classList.contains('app-menu__copy'));
    expect(labelOffset('.app-menu__item--submenu')).toBe(labelOffset('[role="menuitemradio"]'));
  });
});

function mountMenu(items: AppMenuItem[]) {
  return mount(AppMenu, {
    props: {
      ariaLabel: 'Test menu',
      items,
    },
    global: {
      },
  });
}
