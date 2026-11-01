import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AppContextMenu from '../AppContextMenu.vue';

describe('AppContextMenu', () => {
  it('teleports the menu and delegates selection and dismissal', async () => {
    const wrapper = mount(AppContextMenu, {
      props: {
        ariaLabel: 'Tab actions',
        items: [{ id: 'copy-path', type: 'action', label: 'Copy path' }],
        x: 40,
        y: 60,
      },
    });

    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    const menu = document.body.querySelector('[aria-label="Tab actions"]');
    expect(menu?.textContent).toContain('Copy path');
    (menu?.querySelector('[role="menuitem"]') as HTMLElement).click();
    expect(wrapper.emitted('select')).toStrictEqual([['copy-path']]);
    expect(wrapper.emitted('close')).toBeUndefined();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
