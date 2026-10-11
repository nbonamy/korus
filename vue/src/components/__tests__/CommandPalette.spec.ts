import { mount } from '@vue/test-utils';
import { computed, defineComponent, nextTick, reactive, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import CommandPalette from '../CommandPalette.vue';
import { commandPaletteActions, type CommandPaletteAction } from '../command-palette-actions';

function setup(overrides: Partial<Parameters<typeof commandPaletteActions>[0]> = {}) {
  const snapshot = createInitialSnapshot();
  const context = reactive<Parameters<typeof commandPaletteActions>[0]>({
    shortcuts: { platform: 'mac', desktop: true, workspace: true, agent: true, agentCount: 2, teamCount: 2, browser: true, idleSession: true },
    agent: { ...snapshot.agents[0]!, backendSession: { kind: 'codex', threadId: 'test-thread' } },
    team: snapshot.teams[0]!, connected: true, hostConnected: true, engineConnected: true, canCreateAgent: true,
    capabilities: { ...defaultBackendCapabilities('codex') }, gitAvailable: true, gitActions: [], ...overrides,
  });
  const command = vi.fn();
  const actions = { command, newAgent: vi.fn(), files: vi.fn(), filesPane: vi.fn(), codeReview: vi.fn(), visualize: vi.fn(), plan: vi.fn() };
  const wrapper = mount(defineComponent({
    components: { CommandPalette },
    setup() {
      const visible = ref(true);
      const items = computed(() => commandPaletteActions(context, actions));
      return { visible, items, execute: (action: CommandPaletteAction) => action.run() };
    },
    template: '<CommandPalette v-if="visible" :actions="items" @execute="execute" @close="visible = false" />',
  }), { attachTo: document.body });
  return { wrapper, context, actions, command };
}
afterEach(() => { document.body.innerHTML = ''; });

describe('CommandPalette', () => {
  it('distinguishes an empty action context from a search with no results', async () => {
    const wrapper = mount(CommandPalette, { props: { actions: [] } });
    expect(wrapper.get('[role="status"]').text()).toBe('No commands available in this context.');
    await wrapper.get('input').setValue('search');
    expect(wrapper.get('[role="status"]').text()).toBe('No matching commands.');
    wrapper.unmount();
  });
  it('searches aliases and keys, executes once, and restores the invoking focus', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger); trigger.focus();
    const { wrapper, actions } = setup();
    await nextTick();
    const input = wrapper.get('input');
    expect(document.activeElement).toBe(input.element);
    await input.setValue('repository tree');
    expect(wrapper.findAll('button').map(item => item.text())).toStrictEqual(['Open files']);
    await input.setValue('unknown command');
    expect(wrapper.get('[role="status"]').text()).toBe('No matching commands.');
    await input.setValue('');
    expect(wrapper.findAll('button').length).toBeGreaterThan(15);
    await input.setValue('diagram');
    input.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await nextTick();
    expect(actions.visualize).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger);
    wrapper.unmount(); trigger.remove();
  });
  it.each(['mac', 'other'] as const)('shows actual %s shortcut hints and dispatches existing commands', async platform => {
    const { wrapper, command, context } = setup();
    context.shortcuts.platform = platform;
    await wrapper.get('input').setValue('duplicate');
    expect(wrapper.findAll('kbd').map(key => key.text())).toStrictEqual([platform === 'mac' ? '⌘' : 'Ctrl', 'D']);
    await wrapper.get('input').setValue(platform === 'mac' ? 'cmd+d' : 'ctrl+d');
    expect(wrapper.findAll('button')).toHaveLength(1);
    await wrapper.get('input').trigger('keydown.enter');
    expect(command).toHaveBeenCalledExactlyOnceWith({ type: 'duplicate-active-agent' });
    wrapper.unmount();
  });
  it('updates availability while open for host, busy agent, repository and provider changes', async () => {
    const { wrapper, context, actions, command } = setup();
    await wrapper.get('input').setValue('compact');
    context.agent!.status = { type: 'working' };
    await nextTick();
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Agent is busy');
    await wrapper.get('input').trigger('keydown.enter');
    expect(command).not.toHaveBeenCalled();
    context.hostConnected = false;
    await wrapper.get('input').setValue('repository tree');
    expect(wrapper.text()).toContain('Host disconnected');
    await wrapper.get('input').trigger('keydown.enter');
    expect(actions.filesPane).not.toHaveBeenCalled();
    context.hostConnected = true;
    context.capabilities.codeReview = false;
    context.capabilities.conversationFork = false;
    await wrapper.get('input').setValue('');
    expect(wrapper.text()).not.toContain('Open code review');
    expect(wrapper.text()).not.toContain('Fork conversation');
    context.agent!.folder = null;
    await nextTick();
    expect(wrapper.text()).not.toContain('Open files');
    expect(wrapper.text()).not.toContain('Go to file');
    await wrapper.get('input').setValue('settings');
    await wrapper.get('input').trigger('keydown.enter');
    expect(command).toHaveBeenCalledExactlyOnceWith({ type: 'open-settings' });
    wrapper.unmount();
  });
  it('hides workspace actions without an active agent and keeps only actual web hints', async () => {
    const { wrapper, context } = setup();
    context.shortcuts.desktop = false;
    context.shortcuts.platform = 'other';
    await wrapper.get('input').setValue('edit agent');
    expect(wrapper.findAll('kbd')).toHaveLength(0);
    context.agent = null;
    await wrapper.get('input').setValue('');
    expect(wrapper.text()).not.toMatch(/Edit agent|Open files|Quit/);
    expect(wrapper.text()).toContain('New agent');
    context.shortcuts.onboarding = true;
    await nextTick();
    expect(wrapper.text()).not.toContain('New agent');
    expect(wrapper.text()).toContain('Settings');
    wrapper.unmount();
  });
});
