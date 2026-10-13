import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { ShortcutContext } from '@workspace/core/keyboard-shortcuts';
import KeyboardShortcutsDialog from '../KeyboardShortcutsDialog.vue';

const context: ShortcutContext = { platform: 'mac', desktop: true, workspace: true, agent: true, agentCount: 2, teamCount: 2, browser: true, idleSession: true };
function mountDialog(overrides: Partial<ShortcutContext> = {}) {
  return mount(KeyboardShortcutsDialog, { attachTo: document.body, props: { context: { ...context, ...overrides } } });
}
describe('KeyboardShortcutsDialog', () => {
  it('searches actions and platform key labels and clears back to grouped results', async () => {
    const wrapper = mountDialog();
    await flushPromises();
    const search = wrapper.get('input');
    expect(document.activeElement).toBe(search.element);
    expect(wrapper.findAll('h3')).toHaveLength(3);
    await search.setValue('duplicate');
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(1);
    expect(wrapper.get('[role="listitem"]').text()).toContain('Duplicate agent');
    expect(wrapper.get('[role="listitem"] .quick-open-dialog__icon').attributes('aria-hidden')).toBe('true');
    expect(wrapper.findAll('kbd').map(key => key.text())).toStrictEqual(['⌘', 'D']);
    await search.setValue('cmd+d');
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(1);
    expect(wrapper.get('[role="listitem"]').text()).toContain('Duplicate agent');
    await search.setValue('cmd shift');
    expect(wrapper.text()).toContain('Compact session');
    expect(wrapper.text()).not.toContain('Duplicate agent');
    await search.setValue('no such action');
    expect(wrapper.get('[role="status"]').text()).toContain('No matching');
    await search.setValue('');
    expect(wrapper.findAll('h3')).toHaveLength(3);
    wrapper.unmount();
  });
  it('shows Control menu keys on other platforms and hides unavailable actions', async () => {
    const wrapper = mountDialog({ platform: 'other', browser: false, idleSession: false, agentCount: 1, teamCount: 1 });
    await flushPromises();
    await wrapper.get('input').setValue('ctrl+d');
    expect(wrapper.findAll('kbd').map(key => key.text())).toStrictEqual(['Ctrl', 'D']);
    await wrapper.get('input').setValue('');
    expect(wrapper.text()).not.toMatch(/Open browser|Compact session|Next team|Next agent|Go to agent 2/);
    wrapper.unmount();
  });
  it('requests close on Escape and returns focus to the invoking control', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.get('input').trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('close')).toStrictEqual([[]]);
    wrapper.unmount();
    await flushPromises();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
  it('keeps desktop-only bindings out of the web reference', async () => {
    const wrapper = mountDialog({ desktop: false, workspace: false, agent: false });
    await flushPromises();
    expect(wrapper.text()).not.toMatch(/New team|Settings|Quit|Edit agent/);
    expect(wrapper.text()).toContain('Keyboard shortcuts');
    wrapper.unmount();
  });
});
