import { mount } from '@vue/test-utils';
import { computed, defineComponent, nextTick, reactive, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import CommandPalette from '../CommandPalette.vue';
import AgentContextMenu from '../AgentContextMenu.vue';
import { commandPaletteActions, type CommandPaletteAction } from '../command-palette-actions';

function setup(overrides: Partial<Parameters<typeof commandPaletteActions>[0]> = {}) {
  const snapshot = createInitialSnapshot();
  const context = reactive<Parameters<typeof commandPaletteActions>[0]>({
    settings: { appshots: true, availableBackends: ['codex', 'claude'] },
    shortcuts: { platform: 'mac', desktop: true, workspace: true, agent: true, agentCount: 2, teamCount: 2, browser: true, idleSession: true },
    agent: { ...snapshot.agents[0]!, backendSession: { kind: 'codex', threadId: 'test-thread' } },
    team: snapshot.teams[0]!, connected: true, hostConnected: true, engineConnected: true, canCreateAgent: true,
    capabilities: { ...defaultBackendCapabilities('codex') }, gitAvailable: true, gitActions: [], planAvailable: false, simulatorAvailable: true, ...overrides,
  });
  const command = vi.fn();
  const actions = { command, settings: vi.fn(), cockpit: vi.fn(), backlog: vi.fn(), automations: vi.fn(), quickChat: vi.fn(), newAgent: vi.fn(), files: vi.fn(), filesPane: vi.fn(), codeReview: vi.fn(), simulator: vi.fn(), design: vi.fn(), visualize: vi.fn(), plan: vi.fn() };
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

function sectionRows(wrapper: ReturnType<typeof mount>, title: string): string[] {
  let row = wrapper.findAll('h3').find(heading => heading.text() === title)?.element.nextElementSibling;
  const labels: string[] = [];
  while (row && row.tagName !== 'H3') {
    const label = row.querySelector('.quick-open-dialog__label');
    if (label) labels.push(label.textContent!);
    row = row.nextElementSibling;
  }
  return labels;
}

describe('CommandPalette', () => {
  it('uses the agent menu order and puts review, drafts and team actions in their own sections', async () => {
    const { wrapper } = setup();
    const menu = mount(AgentContextMenu, { props: { x: 0, y: 0 } });
    try {
      const menuLabels = Array.from(document.querySelectorAll('.agent-context-menu .app-menu__label')).map(item => item.textContent!.toLocaleLowerCase());
      expect(menuLabels).toContain('restart agent');
      expect(menuLabels).toContain('close agent');
      for (const query of ['', 'agent']) {
        await wrapper.get('input').setValue(query);
        const agentLabels = sectionRows(wrapper, 'Agent').map(label => label.toLocaleLowerCase());
        expect(agentLabels).toContain('restart agent');
        expect(agentLabels).toContain('close agent');
        expect(agentLabels.filter(label => menuLabels.includes(label))).toStrictEqual(menuLabels.filter(label => agentLabels.includes(label)));
        expect(agentLabels.at(-1)).toBe('close agent');
        expect(agentLabels).not.toContain('open code review');
        expect(agentLabels).not.toContain('saved drafts');
        expect(agentLabels).not.toContain('close team');
      }
      await wrapper.get('input').setValue('');
      expect(sectionRows(wrapper, 'Conversation')).toContain('Save draft for later');
      expect(sectionRows(wrapper, 'Conversation')).toContain('Saved drafts');
      expect(sectionRows(wrapper, 'Team')).toContain('Close team');
    } finally {
      menu.unmount(); wrapper.unmount();
    }
  });
  it('keeps artifact panes in workspace-menu order and puts file search in navigation', () => {
    const { wrapper } = setup({ planAvailable: true });
    expect(sectionRows(wrapper, 'Workspace')).toStrictEqual(['Open code review', 'Open Design', 'Open Visualize', 'Open changes', 'Open simulator', 'Open browser', 'Open files', 'Open plan']);
    expect(sectionRows(wrapper, 'Navigation')).toContain('Go to file');
    wrapper.unmount();
  });
  it('keeps contextual work ahead of the settings catalog while retaining settings search', async () => {
    const { wrapper, context } = setup();
    context.gitActions = [{ id: 'git:commit', label: 'Git: Commit', run: vi.fn() }];
    await nextTick();
    const groups = wrapper.findAll('h3').map(heading => heading.text());
    expect(groups[0]).toBe('Workspace');
    for (const group of ['Workspace', 'Agent', 'Git']) {
      expect(groups).toContain(group);
      expect(groups.indexOf(group)).toBeLessThan(groups.indexOf('Settings'));
    }
    await wrapper.get('input').setValue('settings font');
    expect(wrapper.get('button').text()).toBe('Appearance');
    expect(wrapper.get('button .quick-open-dialog__icon').attributes('aria-hidden')).toBe('true');
    wrapper.unmount();
  });
  it('opens reviews without requiring an idle agent or a review-capable connected engine', async () => {
    const { wrapper, context, actions } = setup({ engineConnected: false });
    context.agent!.status = { type: 'working' };
    context.capabilities.codeReview = false;
    await wrapper.get('input').setValue('reviews');
    expect(wrapper.get('button').text()).toBe('Open code review');
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
    expect(sectionRows(wrapper, 'Workspace')).toContain('Open code review');
    await wrapper.get('input').trigger('keydown.enter');
    expect(actions.codeReview).toHaveBeenCalledExactlyOnceWith();
    wrapper.unmount();
  });
  it('opens Design through its existing action and blocks it while the host is disconnected', async () => {
    const { wrapper, context, actions } = setup({ hostConnected: false });
    try {
      await wrapper.get('input').setValue('design');
      expect(wrapper.get('button').text()).toContain('Open Design');
      expect(wrapper.get('button').attributes('disabled')).toBeDefined();
      await wrapper.get('input').trigger('keydown.enter');
      expect(actions.design).not.toHaveBeenCalled();
      context.hostConnected = true;
      await nextTick();
      await wrapper.get('input').trigger('keydown.enter');
      expect(actions.design).toHaveBeenCalledExactlyOnceWith();
    } finally { wrapper.unmount(); }
  });
  it('exposes simulator search only on supporting hosts and blocks disconnected dispatch', async () => {
    const { wrapper, context, actions } = setup({ simulatorAvailable: false, hostConnected: false, engineConnected: false });
    await wrapper.get('input').setValue('ios emulator');
    expect(wrapper.get('[role="status"]').text()).toBe('No matching commands.');
    context.simulatorAvailable = true;
    await nextTick();
    expect(wrapper.get('button').text()).toContain('Open simulator');
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    await wrapper.get('input').trigger('keydown.enter');
    expect(actions.simulator).not.toHaveBeenCalled();
    context.hostConnected = true;
    await nextTick();
    await wrapper.get('input').trigger('keydown.enter');
    expect(actions.simulator).toHaveBeenCalledExactlyOnceWith();
    wrapper.unmount();
  });
  it('prioritizes named commands over settings aliases for action searches', async () => {
    const { wrapper, context, command } = setup();
    context.gitActions = [{ id: 'git:commit', label: 'Git: Commit', run: vi.fn() }];
    await wrapper.get('input').setValue('git commit');
    expect(wrapper.findAll('button')[0]!.text()).toBe('Git: Commit');
    await wrapper.get('input').setValue('mute');
    expect(wrapper.findAll('button')[0]!.text()).toContain('Mute or unmute');
    await wrapper.get('input').trigger('keydown.enter');
    expect(command).toHaveBeenCalledExactlyOnceWith({ type: 'toggle-spoken-announcements-muted' });
    wrapper.unmount();
  });
  it('searches settings categories and intent aliases while respecting host and provider availability', async () => {
    const { wrapper, context, actions } = setup({ settings: { appshots: false, availableBackends: [] }, connected: false });
    await wrapper.get('input').setValue('settings');
    expect(wrapper.findAll('h3').map(group => group.text())).toStrictEqual(['Settings']);
    expect(wrapper.text()).toContain('Claude Code');
    expect(wrapper.text()).not.toMatch(/Screenshots|Antigravity/);
    context.settings.appshots = true;
    context.settings.availableBackends = ['antigravity'];
    await nextTick();
    expect(wrapper.text()).toContain('Screenshots');
    expect(wrapper.text()).toContain('Antigravity');
    await wrapper.get('input').setValue('settings font');
    expect(wrapper.get('button').text()).toBe('Appearance');
    expect(wrapper.findAll('kbd')).toHaveLength(0);
    await wrapper.get('input').trigger('keydown.enter');
    expect(actions.settings).toHaveBeenCalledExactlyOnceWith('appearance');
    wrapper.unmount();
  });
  it('disables Quick Chat without a connected host or engine, then uses its existing handler', async () => {
    const { wrapper, context, actions } = setup({ hostConnected: false });
    await wrapper.get('input').setValue('quick chat');
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    await wrapper.get('input').trigger('keydown.enter');
    expect(actions.quickChat).not.toHaveBeenCalled();
    context.hostConnected = true;
    context.canCreateAgent = false;
    await nextTick();
    expect(wrapper.text()).toContain('Connect an engine');
    context.canCreateAgent = true;
    await nextTick();
    await wrapper.get('input').trigger('keydown.enter');
    expect(actions.quickChat).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
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
    expect(wrapper.text()).toContain('Open code review');
    expect(wrapper.text()).not.toContain('Fork conversation');
    expect(wrapper.text()).not.toContain('Open plan');
    context.planAvailable = true;
    await wrapper.get('input').setValue('execution');
    expect(wrapper.get('button').text()).toBe('Open plan');
    context.planAvailable = false;
    await nextTick();
    expect(wrapper.get('[role="status"]').text()).toBe('No matching commands.');
    await wrapper.get('input').setValue('');
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
    expect(wrapper.text()).not.toMatch(/Rename agent|Open files|Open simulator|Open code review|Open Design|Quit/);
    expect(wrapper.text()).toContain('New agent');
    context.shortcuts.onboarding = true;
    await nextTick();
    expect(wrapper.text()).not.toContain('New agent');
    expect(wrapper.text()).toContain('Settings');
    wrapper.unmount();
  });
});
