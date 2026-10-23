import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AppMenuButton from '../AppMenuButton.vue';
import type { AppMenuItem } from '../app-menu';

const items: AppMenuItem[] = [
  { id: 'a', type: 'radio', label: 'First', checked: true },
  { id: 'b', type: 'radio', label: 'Second', checked: false },
];

function mountButton(props: Record<string, unknown> = {}) {
  return mount(AppMenuButton, {
    props: { ariaLabel: 'Choices', items, ...props },
    slots: { trigger: '<template #trigger="{ attrs }"><button class="trigger" v-bind="attrs">Open</button></template>' },
  });
}

const body = () => document.body;

describe('AppMenuButton', () => {
  it('opens the shared menu from its trigger, emits the choice and closes', async () => {
    const wrapper = mountButton({ heading: 'Choose one' });
    expect(body().querySelector('.app-menu')).toBeNull();
    expect(wrapper.get('.trigger').attributes('aria-haspopup')).toBe('menu');
    await wrapper.get('.trigger').trigger('click');
    expect(wrapper.get('.trigger').attributes('aria-expanded')).toBe('true');
    expect(body().textContent).toContain('Choose one');
    const rows = Array.from(body().querySelectorAll<HTMLElement>('.app-menu__item'));
    expect(rows.map((row) => row.textContent?.trim())).toEqual(['First', 'Second']);
    expect(body().querySelector('[aria-checked="true"] .app-menu__icon--check')).not.toBeNull();
    rows[1]!.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('select')).toStrictEqual([['b']]);
    expect(body().querySelector('.app-menu')).toBeNull();
  });

  it('can be opened and closed from outside through v-model:open', async () => {
    const wrapper = mountButton({ open: true });
    expect(body().querySelector('.app-menu')).not.toBeNull();
    await wrapper.setProps({ open: false });
    expect(body().querySelector('.app-menu')).toBeNull();
  });
});
