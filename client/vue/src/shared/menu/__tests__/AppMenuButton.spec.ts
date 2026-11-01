import { flushPromises, mount } from '@vue/test-utils';
import { ElPopover } from 'element-plus';
import { describe, expect, it, vi } from 'vitest';
import AppMenuButton from '../AppMenuButton.vue';
import AppMenu from '../AppMenu.vue';
import type { AppMenuItem } from '../app-menu';

const items: AppMenuItem[] = [
  { id: 'a', type: 'radio', label: 'First', checked: true },
  { id: 'b', type: 'radio', label: 'Second', checked: false },
];

function mountButton(props: Record<string, unknown> = {}, native = false) {
  return mount(AppMenuButton, {
    attachTo: native ? document.body : undefined,
    global: { components: native ? { ElPopover } : {}, stubs: native ? { transition: false } : {} },
    props: { ariaLabel: 'Choices', items, ...props },
    slots: { trigger: '<template #trigger="{ attrs }"><button class="trigger" v-bind="attrs">Open</button></template>' },
  });
}

const body = () => document.body;

describe('AppMenuButton', () => {
  it('opens the shared menu from its trigger, emits the choice and closes', async () => {
    const wrapper = mountButton({ heading: 'Choose one', maxHeight: '60vh' });
    expect(body().querySelector('.app-menu')).toBeNull();
    expect(wrapper.get('.trigger').attributes('aria-haspopup')).toBe('menu');
    await wrapper.get('.trigger').trigger('click');
    expect(wrapper.get('.trigger').attributes('aria-expanded')).toBe('true');
    expect(body().textContent).toContain('Choose one');
    const menu = body().querySelector<HTMLElement>('.app-menu')!;
    expect(menu.style.maxHeight).toBe('60vh');
    expect(menu.style.overflowY).toBe('auto');
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

  // A teleported popup can leave keyboard focus in hidden content on dismissal.
  it.each(['choice', 'Escape'])('returns focus to its trigger after keyboard dismissal by %s', async dismissal => {
    const wrapper = mountButton({}, true);
    await wrapper.get('.trigger').trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.findComponent(ElPopover).emitted('after-enter')).toHaveLength(1));
    const row = wrapper.findComponent(AppMenu).get<HTMLButtonElement>('.app-menu__item').element;
    row.focus();
    expect(document.activeElement).toBe(row);
    if (dismissal === 'choice') row.click();
    else row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(document.activeElement).toBe(wrapper.get('.trigger').element));
  });
});
