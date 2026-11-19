import { mount } from '@vue/test-utils';
import { ElMenu, ElMenuItem, ElMenuItemGroup } from 'element-plus';
import { nextTick } from 'vue';
import { expect, it, vi } from 'vitest';
import { configureAppClient } from '../../platform-api';
import SettingsSidebar from '../SettingsSidebar.vue';

function mountSidebar() {
  configureAppClient();
  return mount(SettingsSidebar, {
    attachTo: document.body,
    props: { activeTab: 'general', availableProviders: ['codex', 'claude'] },
    global: { components: { ElMenu, ElMenuItem, ElMenuItemGroup } },
  });
}

it('debounces search across labels and translated help and selects the first visible match', async () => {
  vi.useFakeTimers();
  try {
    const sidebar = mountSidebar();
    const input = sidebar.get('input[role="searchbox"]');
    const labels = () => sidebar.findAll('[role="menuitem"]').map(item => item.text());
    const selection = () => sidebar.emitted('select')?.at(-1);
    const type = async (value: string) => {
      await input.setValue(value);
      vi.advanceTimersByTime(180);
      await nextTick();
    };

    await input.setValue('Workflows');
    vi.advanceTimersByTime(100);
    await input.setValue('Git');
    vi.advanceTimersByTime(100);
    expect(selection()).toBeUndefined();
    vi.advanceTimersByTime(80);
    await nextTick();
    expect(labels()[0]).toBe('Git');
    expect(selection()).toStrictEqual(['git']);

    await type('otherwise copy local environment files');
    expect(labels()[0]).toBe('Git');
    await type('MONOSPACE text size');
    expect(labels()).toStrictEqual(['Appearance']);
    expect(selection()).toStrictEqual(['appearance']);

    await type('API key');
    expect(labels()[0]).toBe('Dictation');
    expect(selection()).toStrictEqual(['dictation']);
    await sidebar.findAll('[role="menuitem"]').find(item => item.text() === 'Codex')!.trigger('click');
    expect(selection()).toStrictEqual(['codex']);
    await type('official extension updates');
    expect(sidebar.get('[role="status"]').text()).toBe('No matching settings');
    expect(selection()).toStrictEqual(['codex']);

    await sidebar.get('button[aria-label="Clear search"]').trigger('click');
    expect(labels()[0]).toBe('General');
    expect(input.element).toHaveProperty('value', '');
    expect(document.activeElement).toBe(input.element);
  } finally {
    vi.useRealTimers();
  }
});

it('moves selection through visible destinations and clamps at either end', async () => {
  const sidebar = mountSidebar();
  const items = sidebar.findAll<HTMLElement>('[role="menuitem"]');
  const labels = items.map(item => item.text());
  expect(labels).not.toContain('Browser');
  expect(labels).not.toContain('Cursor');
  expect(labels).not.toContain('Antigravity');
  for (const { element } of items) element.scrollIntoView = vi.fn();

  const first = items[0]!;
  const last = items.at(-1)!;
  await first.trigger('keydown', { key: 'ArrowUp' });
  expect(sidebar.emitted('select')?.at(-1)).toStrictEqual(['general']);
  await first.trigger('keydown', { key: 'ArrowDown' });
  expect(sidebar.emitted('select')?.at(-1)).toStrictEqual(['usage']);
  expect(document.activeElement).toBe(items[1]!.element);

  const codex = items.find(item => item.text() === 'Codex')!;
  const following = items[items.indexOf(codex) + 1]!;
  await codex.trigger('keydown', { key: 'ArrowDown' });
  expect(document.activeElement).toBe(following.element);
  await last.trigger('keydown', { key: 'ArrowDown' });
  expect(sidebar.emitted('select')?.at(-1)).toStrictEqual(['connections']);
  expect(document.activeElement).toBe(last.element);
});
