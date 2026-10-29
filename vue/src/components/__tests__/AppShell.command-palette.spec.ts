import { flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { ElMessageBox } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppApi, AppCommand, AgentGitWorkflow } from '@workspace/core/contracts';
import { createEmptySnapshot, createInitialSnapshot } from '@workspace/core/snapshot';
import { mountShell } from './app-shell-test-harness';
import { setElectronTestClient } from '../../test/client';

function openPalette() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', metaKey: true, shiftKey: true, cancelable: true }));
  return nextTick();
}
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; delete window.app; });

describe('AppShell command palette', () => {
  it('opens the relevant settings controls from intent searches and retains the selected settings page', async () => {
    const wrapper = mountShell({ stubAgentWorkspace: true });
    for (const [query, control] of [['font', '#settings-appearance-title'], ['speech', '#settings-voice-title'], ['settings delegation', '#settings-workflows-title'], ['ssh', '#settings-connections-title']]) {
      await openPalette();
      await wrapper.get('.quick-open-dialog input').setValue(query);
      await wrapper.get('.quick-open-dialog input').trigger('keydown.enter');
      await flushPromises();
      expect(wrapper.find(control!).exists()).toBe(true);
    }
    await wrapper.get('[aria-label="Cockpit"]').trigger('click');
    await openPalette();
    await wrapper.get('.quick-open-dialog input').setValue('settings');
    await wrapper.get('.quick-open-dialog input').trigger('keydown.enter');
    await flushPromises();
    expect(wrapper.find('#settings-connections-title').exists()).toBe(true);
    wrapper.unmount();
  });
  it('navigates to existing global surfaces from the palette', async () => {
    const wrapper = mountShell({ stubAgentWorkspace: true });
    for (const [query, surface] of [['cockpit', 'CockpitView'], ['backlog', 'BacklogView'], ['automations', 'AutomationsView']]) {
      await openPalette();
      await wrapper.get('.quick-open-dialog input').setValue(query);
      await wrapper.get('.quick-open-dialog input').trigger('keydown.enter');
      await flushPromises();
      expect(wrapper.findComponent({ name: surface! }).exists()).toBe(true);
    }
    wrapper.unmount();
  });
  it.each([true, false])('creates Quick Chat through the selected team handler and opens it only on success (%s)', async created => {
    const snapshot = createInitialSnapshot();
    const createQuickChat = vi.fn().mockResolvedValue(created ? snapshot.agents[0] : null);
    const wrapper = mountShell({ snapshot, createQuickChat, stubAgentWorkspace: true });
    await openPalette();
    await wrapper.get('.quick-open-dialog input').setValue('font');
    await wrapper.get('.quick-open-dialog input').trigger('keydown.enter');
    await flushPromises();
    expect(wrapper.find('#settings-appearance-title').exists()).toBe(true);
    await openPalette();
    await wrapper.get('.quick-open-dialog input').setValue('quick chat');
    await wrapper.get('.quick-open-dialog input').trigger('keydown.enter');
    await flushPromises();
    expect(createQuickChat).toHaveBeenCalledExactlyOnceWith({ teamId: snapshot.activeTeamId, selection: { ...{ backend: 'codex' } } });
    expect(wrapper.find('#settings-appearance-title').exists()).toBe(!created);
    expect(wrapper.find('.agent-workspace').exists()).toBe(created);
    wrapper.unmount();
  });
  it('opens through native commands and its own binding, guards typing, and preserves agent/file search', async () => {
    let command: (value: AppCommand) => void = () => {};
    window.app = { onAppCommand: vi.fn(listener => { command = listener; return () => {}; }) } as unknown as AppApi;
    const wrapper = mountShell({ stubAgentWorkspace: true });
    for (const tag of ['textarea', 'div']) {
      const editor = document.createElement(tag);
      if (tag === 'div') editor.setAttribute('contenteditable', 'true');
      document.body.append(editor);
      const event = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
      editor.dispatchEvent(event); await nextTick();
      expect(wrapper.findComponent({ name: 'CommandPalette' }).exists()).toBe(false);
      expect(event.defaultPrevented).toBe(false); editor.remove();
    }
    command({ type: 'open-command-palette' }); await nextTick();
    await wrapper.get('.quick-open-dialog input').setValue('settings');
    await wrapper.get('.quick-open-dialog input').trigger('keydown.enter'); await flushPromises();
    expect(wrapper.findComponent({ name: 'SettingsView' }).exists()).toBe(true);
    // Return to a team via the same native navigation command.
    command({ type: 'open-agent-composer' }); await nextTick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true })); await nextTick();
    expect(wrapper.findComponent({ name: 'AgentQuickOpen' }).exists()).toBe(true);
    await wrapper.get('.quick-open-dialog input').trigger('keydown.escape');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: true })); await nextTick();
    expect(wrapper.findComponent({ name: 'FileQuickOpen' }).exists()).toBe(true);
    await wrapper.get('.quick-open-dialog input').trigger('keydown.escape');
    await openPalette();
    expect(wrapper.findComponent({ name: 'CommandPalette' }).exists()).toBe(true);
    wrapper.unmount();
  });
  it('dispatches to the current focused agent and prevents duplicate execution', async () => {
    const snapshot = createInitialSnapshot();
    const wrapper = mountShell({ snapshot, stubAgentWorkspace: true });
    await openPalette();
    await wrapper.setProps({ activeAgent: snapshot.agents[1] });
    const search = wrapper.get('.quick-open-dialog input');
    await search.setValue('duplicate');
    search.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    search.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushPromises();
    expect(wrapper.emitted('duplicate-agent')).toStrictEqual([[snapshot.agents[1]!.id]]);
    wrapper.unmount();
  });
  it('opens the existing file explorer through the workspace menu handler', async () => {
    setElectronTestClient({ listAgentDirectory: vi.fn().mockResolvedValue({ entries: [
      { kind: 'file', name: 'sample.txt', path: 'sample.txt' },
    ], nextCursor: null }) });
    const wrapper = mountShell({ agentFiles: [{ path: 'sample.txt', name: 'sample.txt' }] });
    await openPalette();
    await wrapper.get('.quick-open-dialog input').setValue('open files');
    await wrapper.findAll('.quick-open-dialog button').find(button => button.text() === 'Open files')!.trigger('click');
    await flushPromises();
    expect(wrapper.get('.right-workspace-panel__files-pane').text()).toContain('sample.txt');
    wrapper.unmount();
  });
  it.each([
    ['ios simulator', 'Simulator', '.mobile-simulator'],
    ['reviews', 'Review', '.code-review-panel'],
  ])('opens the actual %s workspace from command search', async (query, tab, panel) => {
    const snapshot = createInitialSnapshot();
    const mobileSimulator = vi.fn().mockResolvedValue({ attachment: null, catalog: { devices: [], setup: [] } });
    setElectronTestClient({ mobileSimulator });
    const wrapper = mountShell({ snapshot });
    await flushPromises();
    await openPalette();
    await wrapper.get('.quick-open-dialog input').setValue(query!);
    await wrapper.get('.quick-open-dialog input').trigger('keydown.enter');
    await flushPromises();
    expect(wrapper.get(`[role="tab"][aria-label="${tab}"]`).attributes('aria-selected')).toBe('true');
    expect(wrapper.get(panel!).isVisible()).toBe(true);
    if (tab === 'Simulator') expect(mobileSimulator).toHaveBeenCalledWith(snapshot.agents[0]!.id, { action: 'list' });
    else expect(mobileSimulator).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('routes Git commands through the existing control and its revert confirmation', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    const workflow: AgentGitWorkflow = { repository: 'repo', folder: agent.folder!, isLinkedWorktree: false, branch: 'feature', detached: false, remote: 'origin', ahead: 1, behind: 0, stagedAddedLines: 0, stagedRemovedLines: 0, unstagedAddedLines: 1, unstagedRemovedLines: 0, untrackedAddedLines: 0, untrackedRemovedLines: 0, files: [{ path: 'a.ts', indexStatus: ' ', worktreeStatus: 'M' }], stagedFiles: [], unstagedFiles: ['a.ts'], githubConnected: true };
    snapshot.agentGitStatuses[agent.id] = { folder: agent.folder!, branch: 'feature', ahead: 1, behind: 0, changedFiles: 1, addedLines: 1, removedLines: 0, hasUntracked: false, state: 'dirty', updatedAt: '' };
    const revert = vi.fn(async () => ({ ...workflow, files: [] }));
    const wrapper = mountShell({ snapshot, getAgentGitWorkflow: async () => workflow, revertAgentGitChanges: revert });
    await flushPromises();
    await openPalette();
    await wrapper.get('.quick-open-dialog input').setValue('git pull');
    expect(wrapper.get('.quick-open-dialog button').attributes('disabled')).toBeDefined();
    await wrapper.get('.quick-open-dialog input').trigger('keydown.enter');
    expect(wrapper.findComponent({ name: 'CommandPalette' }).exists()).toBe(true);
    await wrapper.get('.quick-open-dialog input').setValue('discard');
    expect(wrapper.get('.quick-open-dialog button').text()).toBe('Git: Revert');
    await wrapper.get('.quick-open-dialog input').trigger('keydown.enter'); await flushPromises();
    expect(revert).not.toHaveBeenCalled();
    expect(wrapper.findComponent({ name: 'CommandPalette' }).exists()).toBe(false);
    const dialog = wrapper.getComponent({ name: 'GitWorkflowControl' });
    expect(dialog.text()).toContain('Revert uncommitted changes?');
    await dialog.findAll('button').find(button => button.text() === 'Revert' && button.classes().includes('app-button--primary'))!.trigger('click');
    await flushPromises();
    expect(revert).toHaveBeenCalledExactlyOnceWith(agent.id, { confirmed: true, includeUntracked: false });
    wrapper.unmount();
  });
});
