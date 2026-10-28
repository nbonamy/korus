import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';
import { ElInput, ElSelect, ElOption, ElOptionGroup, ElSwitch, ElButton, ElPopover, ElMessageBox } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { Automation, CreateAutomationInput, RemoteConnection, UpdateAutomationInput } from '@workspace/core/contracts';
import AutomationsView from '../AutomationsView.vue';

const snapshot = createInitialSnapshot();
function automation(overrides: Partial<Automation> = {}): Automation {
  return { id: 'auto', name: 'Morning', enabled: true, prompt: 'Check tasks', target: { kind: 'newQuickChat', teamId: 'team-app', selection: { backend: 'codex', model: null, reasoningEffort: null, serviceTier: null } },
    schedule: { intervalMinutes: 60 }, executionLog: [], createdAt: '', updatedAt: '', ...overrides };
}
const remote: RemoteConnection = { id: 'remote', kind: 'ssh', name: 'devbox', host: 'devbox', status: 'ready',
  transport: { type: 'ssh-stdio', command: 'ssh', args: [] }, createdAt: '', updatedAt: '' };
function view(overrides: Partial<InstanceType<typeof AutomationsView>['$props']> = {}) {
  return mount(AutomationsView, { attachTo: document.body,
    props: { agents: snapshot.agents, teams: snapshot.teams, automations: [], ...overrides },
    global: { components: { ElInput, ElSelect, ElOption, ElOptionGroup, ElSwitch, ElButton, ElPopover } } });
}
async function choose(wrapper: ReturnType<typeof view>, label: string, option: string) {
  const control = wrapper.get(`[aria-label="${label}"]`);
  await control.trigger('click'); await flushPromises();
  const list = document.getElementById(control.attributes('aria-controls')!);
  [...list!.querySelectorAll<HTMLElement>('.el-select-dropdown__item')].find(row => row.textContent === option)!.click();
  await flushPromises();
}
async function menu(wrapper: ReturnType<typeof view>, action: string) {
  await wrapper.get('[aria-label="Morning actions"]').trigger('click');
  await flushPromises();
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === action)!.click();
  await flushPromises();
}
afterEach(() => { vi.restoreAllMocks(); });
describe('AutomationsView', () => {
  it('creates and edits scheduled prompts through the real editor', async () => {
    const warnings = vi.spyOn(console, 'warn');
    // Electron IPC rejects reactive proxies, including nested schedule values.
    const createAutomation = vi.fn(async (input: CreateAutomationInput) => { structuredClone(input); });
    const updateAutomation = vi.fn(async (input: UpdateAutomationInput) => { structuredClone(input); });
    const wrapper = view({ createAutomation, updateAutomation });
    expect(wrapper.findAll('h1, h2, h3').filter(heading => heading.text() === 'Automations')).toHaveLength(1);
    expect(wrapper.get('header h1').text()).toBe('Automations');
    expect(getComputedStyle(wrapper.get('.automations-view__content').element).paddingTop).toBe('var(--space-12)');
    expect(getComputedStyle(wrapper.get('.automations-view__panel').element).maxWidth).toBe('920px');
    expect(getComputedStyle(wrapper.get('.automations-view__panel').element).width).toBe('100%');
    expect(getComputedStyle(wrapper.get('.automations-view__content').element).paddingInline).toBe('var(--space-12)');
    await wrapper.get('.automation-welcome__button').trigger('click');
    expect(getComputedStyle(wrapper.get('.automations-view__panel').element).maxWidth).toBe('720px');
    await wrapper.get('textarea').setValue('Check tasks');
    await flushPromises();
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(createAutomation).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Check tasks', target: { kind: 'newQuickChat', teamId: 'team-app', selection: { backend: 'codex', model: null, reasoningEffort: null, serviceTier: null } } }));
    expect(wrapper.findAll('[role="alert"]').map(alert => alert.text())).toStrictEqual([]);
    expect(wrapper.find('form').exists()).toBe(false);
    await wrapper.setProps({ automations: [automation()] });
    await menu(wrapper, 'Edit');
    await wrapper.get('textarea').setValue('Summarize tasks');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(updateAutomation).toHaveBeenCalledWith(expect.objectContaining({ id: 'auto', prompt: 'Summarize tasks' }));
    expect(wrapper.find('form').exists()).toBe(false);
    expect(getComputedStyle(wrapper.get('.automations-view__panel').element).maxWidth).toBe('920px');
    expect(warnings).not.toHaveBeenCalled();
  });

  it('routes remote creation and runs only to the selected host without requiring a work provider', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.providerConnections = [{ backend: 'claude', installed: true, connected: true, checking: false }];
    remoteSnapshot.automations = [automation({ target: { kind: 'newQuickChat', teamId: 'team-app', selection: { backend: 'claude', model: null, reasoningEffort: null, serviceTier: null } } })];
    const createAutomation = vi.fn().mockResolvedValue(remoteSnapshot);
    const runAutomation = vi.fn().mockResolvedValue(remoteSnapshot);
    const wrapper = view({ remoteConnections: [remote], getAutomationSnapshot: async () => remoteSnapshot, createAutomation, runAutomation });
    await choose(wrapper, 'Automation location', 'devbox');
    await wrapper.get('[aria-label="Run Morning"]').trigger('click'); await flushPromises();
    expect(runAutomation).toHaveBeenCalledWith('auto', { kind: 'remote', remoteConnectionId: 'remote' });
    await wrapper.findAll('button').find(button => button.text() === 'New Automation')!.trigger('click');
    await wrapper.get('textarea').setValue('Remote check');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(createAutomation).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Remote check', target: { kind: 'newQuickChat', teamId: 'team-app', selection: { backend: 'claude', model: null, reasoningEffort: null, serviceTier: null } } }), { kind: 'remote', remoteConnectionId: 'remote' });
  });

  it('retains the editor on save failure and shows remote failures without replacing local data', async () => {
    const wrapper = view({ createAutomation: async () => { throw new Error('Save failed'); }, remoteConnections: [remote],
      getAutomationSnapshot: async () => { throw new Error('Host offline'); } });
    await wrapper.get('.automation-welcome__button').trigger('click');
    await wrapper.get('textarea').setValue('Check'); await flushPromises();
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('Save failed');
    await wrapper.findAll('button').find(button => button.text() === 'Cancel')!.trigger('click');
    await choose(wrapper, 'Automation location', 'devbox');
    expect(wrapper.text()).toContain('Host offline');
    await wrapper.setProps({ remoteConnections: [] }); await flushPromises();
    expect(wrapper.find('.automation-welcome').exists()).toBe(true);
  });

  it('ignores late remote responses after switching back to local', async () => {
    let resolve!: (snapshot: ReturnType<typeof createInitialSnapshot>) => void;
    const wrapper = view({ remoteConnections: [remote], getAutomationSnapshot: () => new Promise(done => { resolve = done; }) });
    await choose(wrapper, 'Automation location', 'devbox');
    await choose(wrapper, 'Automation location', 'Local');
    const response = createInitialSnapshot();
    response.automations = [automation({ name: 'Remote only' })]; resolve(response); await flushPromises();
    expect(wrapper.text()).not.toContain('Remote only');
  });

  it('requires confirmation for deletion and keeps data when cancelled', async () => {
    const deleteAutomation = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel');
    const wrapper = view({ automations: [automation()], deleteAutomation });
    await menu(wrapper, 'Delete');
    expect(deleteAutomation).not.toHaveBeenCalled();
    confirm.mockResolvedValueOnce('confirm' as never);
    await menu(wrapper, 'Delete');
    expect(deleteAutomation).toHaveBeenCalledWith('auto');
  });

  it('shows run state and history, opens a folderless Claude conversation, and protects active runs from deletion', async () => {
    const readConversationMessages = vi.fn().mockResolvedValue([]);
    const deleteAutomationExecution = vi.fn().mockResolvedValue(undefined);
    const clearAutomationHistory = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    const wrapper = view({ automations: [automation({ executionLog: [
      { id: 'active', automationId: 'auto', status: 'awaitingInput', startedAt: '2026-10-06T12:00:00Z', agentId: 'quick', agentName: 'Quick Chat' },
      { id: 'done', automationId: 'auto', status: 'completed', startedAt: '2026-10-06T11:00:00Z', completedAt: '2026-10-06T11:01:00Z',
        agentId: 'quick', agentName: 'Quick Chat', conversationRef: { backend: 'claude', sessionId: 'session', folder: null } },
      { id: 'failed', automationId: 'auto', status: 'failed', startedAt: '2026-10-06T10:00:00Z', error: 'Login required' },
    ] })], readConversationMessages, deleteAutomationExecution, clearAutomationHistory });
    expect(wrapper.get('[aria-label="Run Morning"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[aria-label="View logs for Morning"]').trigger('click');
    expect(wrapper.text()).toContain('Needs input');
    expect(wrapper.text()).toContain('Login required');
    expect(wrapper.get('[aria-label="Delete execution for active"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[aria-label="View conversation for done"]').trigger('click'); await flushPromises();
    expect(readConversationMessages).toHaveBeenCalledWith({ backend: 'claude', sessionId: 'session', folder: null }, 'quick');
    expect(wrapper.get('.automation-execution-conversation-overlay').text()).toContain('Quick Chat');
    expect(wrapper.get('.automation-execution-conversation-overlay').text()).not.toContain('done');
    await wrapper.get('[aria-label="Close conversation preview"]').trigger('click');
    await wrapper.get('[aria-label="Delete execution for done"]').trigger('click'); await flushPromises();
    expect(deleteAutomationExecution).toHaveBeenCalledWith('auto', 'done');
    await wrapper.findAll('button').find(button => button.text() === 'Clear')!.trigger('click'); await flushPromises();
    expect(clearAutomationHistory).toHaveBeenCalledWith('auto');
  });

  it('switches an automation on and off from the list without an execution count column', async () => {
    // The app store hands out reactive proxies, which cannot cross the IPC boundary (structured clone).
    const updateAutomation = vi.fn(async (input: unknown) => { structuredClone(input); });
    const wrapper = view({ updateAutomation, automations: reactive([automation({ executionLog: [
      { id: 'one', automationId: 'auto', status: 'completed', startedAt: '2026-10-06T10:00:00Z' },
      { id: 'two', automationId: 'auto', status: 'completed', startedAt: '2026-10-06T11:00:00Z' },
    ] })]) });
    expect(wrapper.text()).not.toMatch(/Executions|2 executions/);
    const toggle = wrapper.get<HTMLInputElement>('[aria-label="Enable Morning"]');
    expect(toggle.element.checked).toBe(true);
    await toggle.trigger('click'); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(updateAutomation).toHaveBeenCalledWith({ id: 'auto', name: 'Morning', enabled: false, prompt: 'Check tasks',
      target: { kind: 'newQuickChat', teamId: 'team-app', selection: { backend: 'codex', model: null, reasoningEffort: null, serviceTier: null } }, schedule: { intervalMinutes: 60 } });
    await wrapper.setProps({ automations: [automation({ enabled: false })] });
    await wrapper.get('[aria-label="Enable Morning"]').trigger('click'); await flushPromises();
    expect(updateAutomation).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'auto', enabled: true }));
  });

  it('reports a failed switch and warns instead of re-enabling an automation whose chat was removed', async () => {
    const updateAutomation = vi.fn().mockRejectedValueOnce(new Error('Save failed')).mockResolvedValue(undefined);
    const gone = { kind: 'agent' as const, agentId: 'removed' };
    const wrapper = view({ updateAutomation, automations: [automation({ enabled: false, target: gone })] });
    expect(wrapper.text()).toContain('Target unavailable');
    await wrapper.get('[aria-label="Enable Morning"]').trigger('click'); await flushPromises();
    expect(updateAutomation).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toBe('This chat no longer exists. Edit the automation to choose another.');
    await wrapper.setProps({ automations: [automation({ target: gone })] });
    await wrapper.get('[aria-label="Enable Morning"]').trigger('click'); await flushPromises();
    expect(updateAutomation).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, target: gone }));
    expect(wrapper.get('[role="alert"]').text()).toBe('Save failed');
  });
});
