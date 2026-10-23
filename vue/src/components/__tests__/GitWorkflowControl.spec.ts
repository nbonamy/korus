import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { mountProvisioningHost } from './provisioning-host';
import { ElMessage } from 'element-plus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import GitWorkflowControl from '../GitWorkflowControl.vue';
import CommandPalette from '../CommandPalette.vue';
import type { CommandPaletteAction } from '../command-palette-actions';
import type { Agent, AgentGitStatus, AgentGitWorkflow, MainToRendererEvent } from '@workspace/core/contracts';
import type { BranchWorkInput } from '@workspace/core/branch-current-work';
import { encodeAppErrorDescriptor } from '@workspace/core/app-error';
import { stubElectronTestWindow } from '../../test/client';
import '../../styles/base.css';

const agent = { id: 'agent-1', name: 'Dina', avatar: 'DI', folder: '/repo/worktree', backend: 'codex', backendDefaults: { kind: 'codex' }, status: { type: 'idle' }, createdAt: '', updatedAt: '' } as Agent;
const status: AgentGitStatus = { folder: agent.folder!, branch: 'feature/demo', ahead: 2, behind: 0, changedFiles: 2, addedLines: 4, removedLines: 1, hasUntracked: false, state: 'dirty', updatedAt: '' };
const workflow: AgentGitWorkflow = { repository: 'owner/repo', folder: agent.folder!, isLinkedWorktree: true, baseBranch: 'main', branch: 'feature/demo', detached: false, remote: 'origin', remoteUrl: 'git@github.com:owner/repo.git', upstream: 'origin/feature/demo', ahead: 2, behind: 0, stagedAddedLines: 4, stagedRemovedLines: 1, unstagedAddedLines: 2, unstagedRemovedLines: 0, untrackedAddedLines: 3, untrackedRemovedLines: 0, files: [{ path: 'a.ts', indexStatus: ' ', worktreeStatus: 'M' }, { path: 'new.ts', indexStatus: '?', worktreeStatus: '?' }], stagedFiles: [], unstagedFiles: ['a.ts', 'new.ts'], githubConnected: true };
// The menu opens in a popper attached to the body.
const bodyAll = (selector: string) => Array.from(document.body.querySelectorAll(selector)).map((element) => new DOMWrapper(element));
function mountControl(overrides: Partial<Record<string, unknown>> = {}) {
  return mount(GitWorkflowControl, { props: { agent, gitStatus: status, getWorkflow: async () => workflow, ...overrides } });
}

describe('GitWorkflowControl', () => {
  it('lets a merge without an originator report to a selected repository peer only after opting in', async () => {
    const mergeBranch = vi.fn(async () => workflow);
    const recipients = [{ id: 'recipient', name: 'Main' }];
    const wrapper = mountControl({ mergeBranch, reportBackAgents: recipients });
    await flushPromises();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find(item => item.text().includes('Merge'))!.trigger('click');
    await flushPromises();
    const toggle = wrapper.get<HTMLInputElement>('[role="switch"][aria-label="Report to another agent"]');
    expect(toggle.element.checked).toBe(false);
    expect(wrapper.find('[aria-label="Report recipient"]').exists()).toBe(false);
    await toggle.setValue(true);
    expect(submitButton(wrapper, 'Merge').attributes('disabled')).toBeDefined();
    await wrapper.get('[aria-label="Report recipient"] select').setValue('recipient');
    expect(submitButton(wrapper, 'Merge').attributes('disabled')).toBeUndefined();
    await wrapper.setProps({ reportBackAgents: [] });
    expect(submitButton(wrapper, 'Merge').attributes('disabled')).toBeDefined();
    expect(toggle.element.disabled).toBe(false);
    await toggle.setValue(false);
    expect(submitButton(wrapper, 'Merge').attributes('disabled')).toBeUndefined();
    await wrapper.setProps({ reportBackAgents: recipients });
    await toggle.setValue(true);
    await wrapper.get('[aria-label="Report recipient"] select').setValue('recipient');
    await submitButton(wrapper, 'Merge').trigger('click');
    await flushPromises();
    expect(mergeBranch).toHaveBeenCalledExactlyOnceWith(agent.id, {
      strategy: 'merge', deleteBranch: true, deleteWorktree: true,
      reportBack: true, reportBackAgentId: 'recipient', confirmed: true,
    });
  });

  beforeEach(() => window.localStorage.removeItem('app:mergeCleanup'));
  afterEach(() => window.localStorage.removeItem('app:mergeCleanup'));
  afterEach(() => vi.useRealTimers());
  it('opens Branch from the actual command palette and submits through its confirmation dialog', async () => {
    const previewBranchCurrentWork = vi.fn(async () => ({ folder: '/repo', head: 'head', snapshotId: 'snapshot' }));
    const branchCurrentWork = vi.fn(async () => ({ state: 'completed' as const, folder: '/new-worktree', branchName: 'fix', retainedPaths: [] }));
    stubElectronTestWindow({ app: { previewBranchCurrentWork, branchCurrentWork } });
    const wrapper = mountControl();
    await flushPromises();
    const actions = (wrapper.vm as unknown as { getCommandActions(): CommandPaletteAction[] }).getCommandActions();
    const palette = mount(CommandPalette, { props: { actions }, attrs: { onExecute: (action: CommandPaletteAction) => action.run() } });
    try {
      await palette.get('input').setValue('Branch');
      const row = palette.findAll('button').find(button => button.text().includes('Branch'))!;
      expect(row.element.disabled).toBe(false);
      await row.trigger('click');
      await flushPromises();
      expect(previewBranchCurrentWork).toHaveBeenCalledExactlyOnceWith(agent.id);
      expect(branchCurrentWork).not.toHaveBeenCalled();
      await wrapper.get('[role="dialog"] input[name="branch"]').setValue('fix');
      await submitButton(wrapper, 'Branch').trigger('click');
      await flushPromises();
      expect(branchCurrentWork).toHaveBeenCalledExactlyOnceWith(agent.id, { confirmed: true, requestId: expect.any(String), snapshotId: 'snapshot', branchName: 'fix' });
    } finally { palette.unmount(); wrapper.unmount(); }
  });

  it('opens the branch transfer dialog through the Git menu without starting a transfer', async () => {
    const previewBranchCurrentWork = vi.fn(async () => ({ folder: '/repo', head: 'head', snapshotId: 'snapshot' }));
    const branchCurrentWork = vi.fn();
    stubElectronTestWindow({ app: { previewBranchCurrentWork, branchCurrentWork } });
    const wrapper = mountControl(); await flushPromises();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find(item => item.text() === 'Branch')!.trigger('click'); await flushPromises();
    expect(wrapper.find('[role="dialog"] input[name="branch"]').exists()).toBe(true);
    expect(previewBranchCurrentWork).toHaveBeenCalledExactlyOnceWith(agent.id);
    expect(branchCurrentWork).not.toHaveBeenCalled(); wrapper.unmount();
  });
  it('opens the new agent through shell navigation after worktree progress completes', async () => {
    vi.useFakeTimers();
    const previewBranchCurrentWork = vi.fn(async () => ({ folder: '/repo', head: 'head', snapshotId: 'snapshot' }));
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const branchCurrentWork = vi.fn(async (_agentId: string, _input: BranchWorkInput) => { await pending; return { state: 'completed' as const, folder: '/worktree', branchName: 'feature', agentId: 'worker', retainedPaths: [] }; });
    let publish!: (event: MainToRendererEvent) => void;
    stubElectronTestWindow({ app: { previewBranchCurrentWork, branchCurrentWork, onEvent: listener => { publish = listener; return () => undefined; } } });
    const wrapper = mountControl(); await flushPromises();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find(item => item.text() === 'Branch')!.trigger('click'); await flushPromises();
    await wrapper.get('input[name="branch"]').setValue('feature');
    await submitButton(wrapper, 'Branch').trigger('click'); await flushPromises();
    publish({ type: 'git.branchWorkProgress', agentId: agent.id, occurredAt: '', seq: 1, payload: { id: branchCurrentWork.mock.calls[0]![1].requestId, agentId: agent.id, branchName: 'feature', state: 'running', phase: 'creatingAgent' } });
    await flushPromises();
    const host = mountProvisioningHost();
    expect(host.findAll('.staged-operation-progress li')[2]!.classes()).toContain('is-active');
    finish(); await flushPromises();
    vi.advanceTimersByTime(1); await flushPromises();
    vi.advanceTimersByTime(600); await flushPromises();
    expect(wrapper.emitted('inspect-agent')).toStrictEqual([['worker']]); wrapper.unmount();
  });
  it('opens repository pruning from the final menu section without deleting anything', async () => {
    const getAgentGitPrune = vi.fn(async () => ({ repository: 'repo', baseBranch: 'main', groups: [], unavailableRemotes: [] }));
    const pruneAgentGit = vi.fn();
    stubElectronTestWindow({ app: { getAgentGitPrune, pruneAgentGit } });
    const wrapper = mountControl();
    await flushPromises();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').at(-1)!.trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="dialog"]').text()).toContain('No branches to prune');
    expect(getAgentGitPrune).toHaveBeenCalledExactlyOnceWith(agent.id);
    expect(pruneAgentGit).not.toHaveBeenCalled();
  });
  it.each([true, false])('requires confirmation before reverting, with unversioned files=%s', async (includeUntracked) => {
    const revertChanges = vi.fn(async () => ({ ...workflow, files: [] }));
    const wrapper = mountControl({ revertChanges });
    await flushPromises();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    const first = bodyAll('[role="menuitem"]').find(item => item.text() === 'Revert')!;
    expect(first.text()).toBe('Revert');
    expect(first.find('svg.tabler-icon-arrow-back-up').exists()).toBe(true);
    await first.trigger('click');
    expect(revertChanges).not.toHaveBeenCalled();
    expect(wrapper.get('input[type="checkbox"]').element).toHaveProperty('checked', false);
    await submitButton(wrapper, 'Cancel').trigger('click');
    expect(revertChanges).not.toHaveBeenCalled();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find(item => item.text() === 'Revert')!.trigger('click');
    await wrapper.get('input[type="checkbox"]').setValue(includeUntracked);
    await submitButton(wrapper, 'Revert').trigger('click');
    await flushPromises();
    expect(revertChanges).toHaveBeenCalledExactlyOnceWith(agent.id, { confirmed: true, includeUntracked });
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps failed reverts visible and cancels confirmation when the agent changes', async () => {
    const revertChanges = vi.fn().mockRejectedValue(new Error('Repository is locked'));
    const wrapper = mountControl({ revertChanges });
    await flushPromises();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find(item => item.text() === 'Revert')!.trigger('click');
    await submitButton(wrapper, 'Revert').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="dialog"]').text()).toContain('Repository is locked');
    await wrapper.setProps({ agent: { ...agent, id: 'agent-2' } });
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(revertChanges).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows the two delivery outcomes as direct labeled actions', async () => {
    const merge = mountControl({ presentation: 'delivery', mergeBranch: vi.fn() });
    await flushPromises();
    expect(merge.findAll('.git-workflow-control__delivery-action')[0]?.attributes('disabled')).toBeUndefined();
    const actions = merge.findAll('.git-workflow-control__delivery-action');
    expect(actions.map(action => action.text())).toStrictEqual(['Merge', 'Create PR']);
    expect(actions.every(action => action.find('svg').exists())).toBe(true);
    expect(actions.every(action => action.classes().includes('app-button--neutral'))).toBe(true);
    expect(actions.map(action => {
      return [getComputedStyle(action.element).color, getComputedStyle(action.get('svg').element).color];
    })).toStrictEqual([
      ['var(--color-text)', 'var(--color-text)'],
      ['var(--color-text)', 'var(--color-text)'],
    ]);
    expect(merge.find('.git-workflow-control__trigger').exists()).toBe(false);

    await actions[0]!.trigger('click');
    await flushPromises();
    expect(merge.find('[role="dialog"]').exists()).toBe(true);
    expect(merge.find('[role="radiogroup"]').exists()).toBe(true);

    const pullRequest = mountControl({ presentation: 'delivery' });
    await flushPromises();
    expect(pullRequest.findAll('.git-workflow-control__delivery-action')[1]?.attributes('disabled')).toBeUndefined();
    await pullRequest.findAll('.git-workflow-control__delivery-action')[1]!.trigger('click');
    expect(pullRequest.find('.git-workflow-control__pull-request-form').exists()).toBe(true);
  });

  it('opens the commit dialog as the first enabled action', async () => {
    const commitChanges = vi.fn(async () => workflow);
    const wrapper = mountControl({ commitChanges });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__primary').trigger('click');
    expect(wrapper.find('[role="dialog"]').attributes('aria-labelledby')).toBeDefined();
    expect(wrapper.text()).toContain('Commit and push');
    expect(wrapper.findAll('.app-dialog__footer .app-button:not(.app-button--tertiary)').every((button) => button.attributes('disabled') !== undefined)).toBe(true);
    expect(wrapper.findAll('.app-dialog__footer .app-button--tertiary').map((button) => button.text())).toStrictEqual(['Cancel']);
    expect(submitButton(wrapper, 'Commit').classes()).toContain('app-button--secondary');
    expect(submitButton(wrapper, 'Commit and push').classes()).toContain('app-button--primary');
    expect(wrapper.findAll('.git-workflow-control__scope-row')).toHaveLength(3);
    expect(wrapper.findAll('.git-workflow-control__stats')[0]?.text()).toContain('+4');
    expect(wrapper.findAll('.git-workflow-control__stats')[0]?.text()).toContain('−1');
    expect(wrapper.findAll('.git-workflow-control__stats')[1]?.text()).toContain('+2');
    expect(wrapper.findAll('.git-workflow-control__stats')[2]?.text()).toContain('+3');
    expect(wrapper.findAll('.git-workflow-control__stats')[2]?.text()).toContain('−0');
    expect(wrapper.findAllComponents({ name: 'ElSwitch' })[0]?.props('modelValue')).toBe(true);
    expect(wrapper.findAllComponents({ name: 'ElSwitch' })[1]?.props('modelValue')).toBe(false);
    expect(wrapper.findAll('.git-workflow-control__stats')[2]?.classes()).toContain('git-workflow-control__stats--muted');
    await wrapper.findAllComponents({ name: 'ElSwitch' })[0]!.setValue(false);
    expect(wrapper.findAll('.git-workflow-control__stats')[1]?.classes()).toContain('git-workflow-control__stats--muted');
    await wrapper.findAllComponents({ name: 'ElSwitch' })[1]!.setValue(true);
    expect(wrapper.findAll('.git-workflow-control__stats')[2]?.classes()).not.toContain('git-workflow-control__stats--muted');
  });

  it('keeps commit enabled from the header status while workflow details refresh', async () => {
    const pendingWorkflow = deferred<AgentGitWorkflow>();
    const wrapper = mountControl({ getWorkflow: () => pendingWorkflow.promise });
    await wrapper.get('.git-workflow-control__trigger').trigger('click');

    const commit = bodyAll('[role="menuitem"]').find((item) => item.text().includes('Commit'));
    expect(commit?.attributes('disabled')).toBeUndefined();

    pendingWorkflow.resolve(workflow);
    await flushPromises();
  });

  it('shows commit progress and passive success before closing automatically', async () => {
    const pendingCommit = deferred<AgentGitWorkflow>();
    const commitChanges = vi.fn(() => pendingCommit.promise);
    const wrapper = mountControl({ commitChanges });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__primary').trigger('click');
    await wrapper.get('textarea').setValue('test: commit selected changes');
    await submitButton(wrapper, 'Commit').trigger('click');

    expect(wrapper.text()).toContain('Creating commit');
    expect(wrapper.text()).toContain('test: commit selected changes');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

    vi.useFakeTimers();
    pendingCommit.resolve({ ...workflow, files: [], stagedFiles: [], unstagedFiles: [] });
    await flushPromises();

    expect(wrapper.text()).toContain('Commit created');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(1499);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('generates an editable commit message from the selected scopes', async () => {
    const pendingGeneration = deferred<{ kind: 'commit'; message: string }>();
    const generateMessage = vi.fn(() => pendingGeneration.promise);
    const wrapper = mountControl({ generateMessage });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__primary').trigger('click');
    await wrapper.findAllComponents({ name: 'ElSwitch' })[0]!.setValue(false);
    await wrapper.findAllComponents({ name: 'ElSwitch' })[1]!.setValue(true);
    const generate = wrapper.get('[aria-label="Generate commit message with Codex"]');
    await generate.trigger('click');

    expect(generateMessage).toHaveBeenCalledWith('agent-1', {
      kind: 'commit',
      includeUnstaged: false,
      includeUntracked: true,
    });
    expect(wrapper.text()).toContain('Generating…');

    pendingGeneration.resolve({ kind: 'commit', message: 'feat: improve Git drafts' });
    await flushPromises();
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('feat: improve Git drafts');
    await wrapper.get('textarea').setValue('feat: edit the generated draft');
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('feat: edit the generated draft');
  });

  it('retries only the push when commit and push partially fails', async () => {
    const commitChanges = vi.fn(async () => ({ ...workflow, files: [], stagedFiles: [], unstagedFiles: [], ahead: 3 }));
    const pushBranch = vi.fn()
      .mockRejectedValueOnce(new Error('Remote rejected the push.'))
      .mockResolvedValueOnce({ ...workflow, files: [], stagedFiles: [], unstagedFiles: [], ahead: 0 });
    const wrapper = mountControl({ commitChanges, pushBranch });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__primary').trigger('click');
    await wrapper.get('textarea').setValue('test: commit before push');
    await submitButton(wrapper, 'Commit and push').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Commit created, but push failed');
    expect(wrapper.text()).toContain('Remote rejected the push.');
    expect(commitChanges).toHaveBeenCalledTimes(1);
    expect(pushBranch).toHaveBeenCalledTimes(1);

    await submitButton(wrapper, 'Retry push').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Committed and pushed');
    expect(commitChanges).toHaveBeenCalledTimes(1);
    expect(pushBranch).toHaveBeenCalledTimes(2);
  });

  it('confirms a push before showing progress and passive success', async () => {
    const pendingPush = deferred<AgentGitWorkflow>();
    const pushBranch = vi.fn(() => pendingPush.promise);
    const wrapper = mountControl({ pushBranch });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Push'))?.trigger('click');

    expect(wrapper.text()).toContain('Push changes');
    expect(wrapper.find('.git-workflow-control__dialog-header .git-workflow-control__branch').text()).toBe('owner/repo · feature/demo');
    expect(wrapper.find('.git-workflow-control__push-count').text()).toBe('2 commits');
    expect(wrapper.find('.git-workflow-control__push-destination').text()).toBe('origin/feature/demo');
    expect(wrapper.find('.git-workflow-control__push-arrow').exists()).toBe(true);
    expect(wrapper.text()).toContain('Uncommitted changes stay in this worktree and will not be pushed.');
    expect(pushBranch).not.toHaveBeenCalled();

    await submitButton(wrapper, 'Push').trigger('click');
    expect(wrapper.text()).toContain('Pushing 2 commits');
    expect(pushBranch).toHaveBeenCalledWith('agent-1', { confirmed: true });

    vi.useFakeTimers();
    pendingPush.resolve({ ...workflow, files: [], stagedFiles: [], unstagedFiles: [], ahead: 0 });
    await flushPromises();

    expect(wrapper.text()).toContain('Push complete');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('keeps a failed push open and retries from the same dialog', async () => {
    const pushBranch = vi.fn()
      .mockRejectedValueOnce(new Error('Remote rejected the push.'))
      .mockResolvedValueOnce({ ...workflow, files: [], stagedFiles: [], unstagedFiles: [], ahead: 0 });
    const wrapper = mountControl({ pushBranch });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Push'))?.trigger('click');
    await submitButton(wrapper, 'Push').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Push failed');
    expect(wrapper.text()).toContain('Remote rejected the push.');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

    await submitButton(wrapper, 'Retry').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Push complete');
    expect(pushBranch).toHaveBeenCalledTimes(2);
  });

  it('disables the untracked scope when the worktree has no untracked files', async () => {
    const cleanWorkflow = { ...workflow, files: workflow.files.filter((file) => file.indexStatus !== '?'), untrackedAddedLines: 0, untrackedRemovedLines: 0 };
    const wrapper = mountControl({ getWorkflow: async () => cleanWorkflow });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__primary').trigger('click');

    const switches = wrapper.findAllComponents({ name: 'ElSwitch' });
    expect(switches[1]?.props('disabled')).toBe(true);
    expect(wrapper.text()).toContain('No untracked files');
  });

  it.each([true, false])('groups local, sync, and integration actions with dividers (update available: %s)', async (updateAvailable) => {
    const wrapper = mountControl(updateAvailable ? { updateFromBase: vi.fn() } : {});
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__trigger')).toBeTruthy();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    expect(bodyAll('[role="menuitem"], [role="separator"]').map((item) =>
      item.attributes('role') === 'separator' ? '---' : item.text(),
    )).toStrictEqual([
      'Git log',
      '---',
      'Revert',
      'Commit',
      'Branch',
      '---',
      'Pull',
      'Push',
      ...(updateAvailable ? ['Update from main'] : []),
      '---',
      'Merge',
      'Create PR',
      '---',
      'Prune',
    ]);
    expect(document.body.querySelector('.app-menu__description') !== null).toBe(false);
  });

  it('pulls the tracked branch and shows the agent conflict handoff', async () => {
    const pullBranch = vi.fn().mockResolvedValue({ workflow, upstream: 'origin/feature/demo', branch: 'feature/demo', conflicts: ['a.ts'] });
    const wrapper = mountControl({ pullBranch, getWorkflow: async () => ({ ...workflow, files: [] }) });
    await flushPromises();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find(item => item.text() === 'Pull')!.trigger('click');
    await flushPromises();
    expect(pullBranch).toHaveBeenCalledExactlyOnceWith(agent.id, { confirmed: true });
    expect(wrapper.text()).toContain('Agent resolving conflicts');
    expect(wrapper.text()).toContain('origin/feature/demo');
  });

  it('disables pull without an upstream and asks before pulling dirty work', async () => {
    const pullBranch = vi.fn().mockResolvedValue({ workflow, upstream: 'origin/feature/demo', branch: 'feature/demo', conflicts: [] });
    const unavailable = mountControl({ pullBranch, getWorkflow: async () => ({ ...workflow, upstream: undefined }) });
    await flushPromises();
    await unavailable.get('.git-workflow-control__trigger').trigger('click');
    expect(bodyAll('[role="menuitem"]').find(item => item.text() === 'Pull')!.attributes('disabled')).toBeDefined();
    unavailable.unmount();
    const wrapper = mountControl({ pullBranch });
    await flushPromises();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find(item => item.text() === 'Pull')!.trigger('click');
    expect(pullBranch).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Commit your changes first');
    await submitButton(wrapper, 'Update anyway').trigger('click');
    await flushPromises();
    expect(pullBranch).toHaveBeenCalledExactlyOnceWith(agent.id, { confirmed: true, allowDirty: true });
  });

  it('offers updating a linked worktree from its base branch and recommends committing dirty work first', async () => {
    const updateFromBase = vi.fn();
    const wrapper = mountControl({ updateFromBase, commitChanges: vi.fn() });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__trigger')).toBeTruthy();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Update from main'))?.trigger('click');

    expect(wrapper.text()).toContain('Commit your changes first');
    expect(wrapper.text()).toContain('Updating from main with uncommitted changes can cause conflicts.');
    expect(updateFromBase).not.toHaveBeenCalled();

    await submitButton(wrapper, 'Commit first').trigger('click');
    expect(wrapper.text()).toContain('Commit changes');
    expect(updateFromBase).not.toHaveBeenCalled();
  });

  it('can continue a dirty update and hands detected conflicts to the agent', async () => {
    const updateFromBase = vi.fn().mockResolvedValue({
      workflow,
      baseBranch: 'main',
      branch: 'feature/demo',
      conflicts: ['src/app.ts'],
    });
    const wrapper = mountControl({ updateFromBase });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__trigger')).toBeTruthy();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Update from main'))?.trigger('click');
    await submitButton(wrapper, 'Update anyway').trigger('click');
    await flushPromises();

    expect(updateFromBase).toHaveBeenCalledWith('agent-1', { confirmed: true, allowDirty: true });
    expect(wrapper.text()).toContain('Agent resolving conflicts');
    expect(wrapper.text()).toContain('The agent has been asked to resolve 1 conflict from main.');
  });

  it('runs a clean update immediately in the Git progress dialog', async () => {
    const cleanWorkflow = { ...workflow, files: [], stagedFiles: [], unstagedFiles: [] };
    const pendingUpdate = deferred<{ workflow: AgentGitWorkflow; baseBranch: string; branch: string; conflicts: string[] }>();
    const updateFromBase = vi.fn(() => pendingUpdate.promise);
    const wrapper = mountControl({ getWorkflow: async () => cleanWorkflow, updateFromBase });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__trigger')).toBeTruthy();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Update from main'))?.trigger('click');

    expect(updateFromBase).toHaveBeenCalledWith('agent-1', { confirmed: true });
    expect(wrapper.text()).toContain('Updating from main');

    vi.useFakeTimers();
    pendingUpdate.resolve({ workflow: cleanWorkflow, baseBranch: 'main', branch: 'feature/demo', conflicts: [] });
    await flushPromises();
    expect(wrapper.text()).toContain('Branch updated');
    await vi.advanceTimersByTimeAsync(1500);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('requires a stale branch update before reopening the normal merge confirmation', async () => {
    vi.useFakeTimers();
    const staleWorkflow = {
      ...workflow,
      baseUpdateRequired: true,
      files: [],
      stagedFiles: [],
      unstagedFiles: [],
    };
    const currentWorkflow = { ...staleWorkflow, baseUpdateRequired: false };
    const getWorkflow = vi.fn(async () => staleWorkflow).mockResolvedValueOnce(currentWorkflow);
    const updateFromBase = vi.fn(async () => ({
      workflow: currentWorkflow,
      baseBranch: 'main',
      branch: 'feature/demo',
      conflicts: [],
    }));
    const mergeBranch = vi.fn(async () => currentWorkflow);
    const wrapper = mountControl({ getWorkflow, updateFromBase, mergeBranch });
    await vi.runAllTimersAsync();
    await flushPromises();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Merge'))?.trigger('click');
    await flushPromises();

    expect(getWorkflow).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('Update required');
    expect(wrapper.text()).toContain('main has new commits. Update this branch before merging.');
    expect(updateFromBase).not.toHaveBeenCalled();
    expect(mergeBranch).not.toHaveBeenCalled();

    await submitButton(wrapper, 'Update from main').trigger('click');
    await flushPromises();
    expect(updateFromBase).toHaveBeenCalledWith('agent-1', { confirmed: true });
    expect(wrapper.text()).toContain('Branch updated');

    getWorkflow.mockResolvedValue(currentWorkflow);
    await vi.advanceTimersByTimeAsync(1500);
    expect(wrapper.text()).toContain('Merge branch');
    expect(wrapper.text()).toContain('Preserve every commit in a merge commit.');
    expect(mergeBranch).not.toHaveBeenCalled();
  });

  it('checks again at confirmation when the base advances while the merge dialog is open', async () => {
    const currentWorkflow = { ...workflow, files: [], baseUpdateRequired: false };
    const getWorkflow = vi.fn().mockResolvedValue(currentWorkflow);
    const mergeBranch = vi.fn();
    const updateFromBase = vi.fn();
    const wrapper = mountControl({ presentation: 'delivery', getWorkflow, mergeBranch, updateFromBase });
    await flushPromises();
    await wrapper.findAll('button').find(button => button.text() === 'Merge')!.trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(true);

    getWorkflow.mockResolvedValue({ ...currentWorkflow, baseUpdateRequired: true });
    await submitButton(wrapper, 'Merge').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Update required');
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false);
    expect(mergeBranch).not.toHaveBeenCalled();
    expect(updateFromBase).not.toHaveBeenCalled();
  });

  it('requires committing changes in the target worktree before showing merge options', async () => {
    const mergeBranch = vi.fn(async () => workflow);
    const wrapper = mountControl({
      getWorkflow: async () => ({ ...workflow, baseWorktreeDirty: true }),
      mergeBranch,
    });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__trigger')).toBeTruthy();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Merge'))?.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Commit changes in main first');
    expect(wrapper.text()).toContain('The main worktree has uncommitted changes. Commit them before merging feature/demo.');
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false);
    expect(mergeBranch).not.toHaveBeenCalled();
  });

  it('does not merge using cached workflow details when the preflight refresh fails', async () => {
    const getWorkflow = vi.fn().mockResolvedValue(workflow);
    const mergeBranch = vi.fn();
    const notifyError = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({ close: vi.fn() }));
    const wrapper = mountControl({ presentation: 'delivery', getWorkflow, mergeBranch });
    await flushPromises();
    getWorkflow.mockRejectedValue(new Error('Cannot read repository status'));
    await wrapper.findAll('button').find(button => button.text() === 'Merge')!.trigger('click');
    await flushPromises();
    expect(notifyError).toHaveBeenCalledWith('Cannot read repository status');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(mergeBranch).not.toHaveBeenCalled();
  });

  it('does not offer updating from a base branch outside a linked worktree', async () => {
    const wrapper = mountControl({
      getWorkflow: async () => ({ ...workflow, isLinkedWorktree: false, baseBranch: undefined }),
      updateFromBase: vi.fn(),
    });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__trigger')).toBeTruthy();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');

    expect(bodyAll('[role="menuitem"]').some((item) => item.text().includes('Update from'))).toBe(false);
  });

  it('reloads action availability when the selected agent changes', async () => {
    const secondAgent = { ...agent, id: 'agent-2', folder: '/repo/other' };
    const secondWorkflow = { ...workflow, folder: secondAgent.folder, files: [], unstagedFiles: [], ahead: 3 };
    const getWorkflow = vi.fn(async (agentId: string) => agentId === agent.id ? workflow : secondWorkflow);
    const wrapper = mountControl({ getWorkflow });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.setProps({ agent: secondAgent });
    await flushPromises();
    expect(getWorkflow).toHaveBeenLastCalledWith('agent-2');
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    const labels = bodyAll('.app-menu__label').map((item) => item.text());
    expect(labels).toContain('Push');
  });

  it('uses the header git status as a push fallback while workflow data refreshes', async () => {
    const staleWorkflow = { ...workflow, ahead: undefined } as unknown as AgentGitWorkflow;
    const wrapper = mountControl({ getWorkflow: async () => staleWorkflow });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    const push = bodyAll('[role="menuitem"]').find((item) => item.text().includes('Push'));
    expect(push?.attributes('disabled')).toBeUndefined();
  });

  it('does not offer merge for the integration branch', async () => {
    const wrapper = mountControl({ getWorkflow: async () => ({ ...workflow, branch: 'main' }) });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    const merge = bodyAll('[role="menuitem"]').find((item) => item.text().includes('Merge'));
    expect(merge?.attributes('disabled')).toBeDefined();
  });

  it('uses distinct icon-led strategy choices and secondary switch controls in the merge dialog', async () => {
    const mergeBranch = vi.fn(async () => workflow);
    const wrapper = mountControl({ mergeBranch });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Merge'))?.trigger('click');
    await flushPromises();

    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(true);
    const choices = wrapper.findAll('.git-workflow-control__merge-strategy label');
    expect(choices).toHaveLength(2);
    expect(choices[0]?.text()).toContain('Preserve every commit in a merge commit.');
    expect(choices[1]?.text()).toContain('Combine all changes into a single commit.');
    expect(wrapper.findAll('.git-workflow-control__merge-icon')).toHaveLength(2);
    expect(choices[0]?.classes()).toContain('git-workflow-control__merge-option--selected');
    expect(wrapper.findAll('.git-workflow-control__merge-cleanup')).toHaveLength(2);
    expect(wrapper.findAll('.git-workflow-control__merge-cleanup')[1]?.text()).toBe('Delete local and origin branches');
    const cleanup = wrapper.findAll<HTMLInputElement>('.git-workflow-control__merge-cleanup input[role="switch"]');
    expect(cleanup.map(control => control.element.checked)).toStrictEqual([true, true]);
    await cleanup[0]!.setValue(false);
    expect(cleanup[1]!.element.checked).toBe(false);
    expect(cleanup[1]!.element.disabled).toBe(true);
    await cleanup[0]!.setValue(true);
    expect(cleanup[1]!.element.disabled).toBe(false);
    await cleanup[1]!.setValue(true);
    await choices[1]?.find('input').setValue(true);
    expect(choices[1]?.classes()).toContain('git-workflow-control__merge-option--selected');
    const message = wrapper.get<HTMLTextAreaElement>('.git-workflow-control__merge-message');
    expect(message.element.value).toBe('');
    expect(message.attributes('placeholder')).toBe('Squash commit message…');
    expect(submitButton(wrapper, 'Merge').attributes('disabled')).toBeDefined();
    expect(submitButton(wrapper, 'Merge and push').attributes('disabled')).toBeDefined();
    await message.setValue('feat: combine demo work');
    await submitButton(wrapper, 'Merge').trigger('click');
    await flushPromises();
    expect(mergeBranch).toHaveBeenCalledWith('agent-1', {
      strategy: 'squash',
      commitMessage: 'feat: combine demo work',
      deleteBranch: true,
      deleteWorktree: true,
      confirmed: true,
    });
  });

  it('remembers cleanup choices across dialog and agent recreation without primary checkouts overwriting them', async () => {
    const openMerge = async (wrapper: ReturnType<typeof mountControl>) => {
      await flushPromises();
      await wrapper.get('.git-workflow-control__trigger').trigger('click');
      await bodyAll('[role="menuitem"]').find(item => item.text() === 'Merge')!.trigger('click');
      await flushPromises();
    };
    const first = mountControl({ mergeBranch: vi.fn() });
    await openMerge(first);
    await first.findAll<HTMLInputElement>('.git-workflow-control__merge-cleanup input[role="switch"]')[1]!.setValue(false);
    await submitButton(first, 'Cancel').trigger('click');
    first.unmount();

    const primary = mountControl({ getWorkflow: async () => ({ ...workflow, isLinkedWorktree: false }), mergeBranch: vi.fn() });
    await openMerge(primary);
    expect(primary.find('.git-workflow-control__merge-cleanup').exists()).toBe(false);
    primary.unmount();

    const mergeBranch = vi.fn(async () => workflow);
    const next = mountControl({ agent: { ...agent, id: 'next-agent' }, mergeBranch });
    await openMerge(next);
    const cleanup = next.findAll<HTMLInputElement>('.git-workflow-control__merge-cleanup input[role="switch"]');
    expect(cleanup.map(control => control.element.checked)).toStrictEqual([true, false]);
    await cleanup[0]!.setValue(false);
    await submitButton(next, 'Cancel').trigger('click');
    await openMerge(next);
    expect(next.findAll<HTMLInputElement>('.git-workflow-control__merge-cleanup input[role="switch"]').map(control => control.element.checked)).toStrictEqual([false, false]);
    await submitButton(next, 'Merge').trigger('click');
    await flushPromises();
    expect(mergeBranch).toHaveBeenCalledExactlyOnceWith('next-agent', { strategy: 'merge', deleteBranch: false, deleteWorktree: false, confirmed: true });
    next.unmount();
  });

  it('omits worktree cleanup when the agent uses the primary checkout', async () => {
    const primaryWorkflow = { ...workflow, isLinkedWorktree: false };
    const wrapper = mountControl({
      getWorkflow: async () => primaryWorkflow,
      mergeBranch: async () => primaryWorkflow,
    });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Merge'))?.trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('Delete worktree after merging');
    expect(wrapper.text()).not.toContain('Delete local and origin branches');
    expect(wrapper.findAll('.git-workflow-control__merge-cleanup')).toHaveLength(0);
  });

  it.each(['getItem', 'setItem'] as const)('keeps merging usable when preference %s fails', async method => {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new Error('Storage unavailable'); });
    const mergeBranch = vi.fn(async () => workflow);
    const wrapper = mountControl({ mergeBranch });
    await flushPromises();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find(item => item.text() === 'Merge')!.trigger('click');
    await flushPromises();
    const cleanup = wrapper.findAll<HTMLInputElement>('.git-workflow-control__merge-cleanup input[role="switch"]');
    expect(cleanup.map(control => control.element.checked)).toStrictEqual([true, true]);
    await cleanup[0]!.setValue(false);
    await submitButton(wrapper, 'Merge').trigger('click');
    await flushPromises();
    expect(mergeBranch).toHaveBeenCalledExactlyOnceWith(agent.id, { strategy: 'merge', deleteBranch: false, deleteWorktree: false, confirmed: true });
    wrapper.unmount();
  });

  it('shows merge progress and passive success before closing automatically', async () => {
    const pendingMerge = deferred<AgentGitWorkflow>();
    const mergeBranch = vi.fn(() => pendingMerge.promise);
    const wrapper = mountControl({ mergeBranch });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Merge'))?.trigger('click');
    await flushPromises();
    await submitButton(wrapper, 'Merge').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Merging feature/demo');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

    vi.useFakeTimers();
    pendingMerge.resolve({ ...workflow, folder: '/repo', branch: 'main', isLinkedWorktree: false });
    await flushPromises();

    expect(wrapper.text()).toContain('Merge complete');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(1499);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it.each([
    { warning: { type: 'worktreeFolderRetained' as const, folder: '/repo-feature' }, title: 'Worktree folder remains', detail: '/repo-feature' },
    { warning: { type: 'branchRetained' as const, branch: 'feature/demo' }, title: 'Merge complete — cleanup incomplete', detail: 'feature/demo' },
    { warning: { type: 'branchRetained' as const, branch: 'feature/demo', folder: '/repo-feature' }, title: 'Merge complete — cleanup incomplete', detail: '/repo-feature' },
  ])('shows a non-blocking $warning.type warning after a successful merge', async ({ warning, title, detail }) => {
    const mergeBranch = vi.fn(async () => ({
      ...workflow,
      folder: '/repo',
      branch: 'main',
      isLinkedWorktree: false,
      warning,
    }));
    const wrapper = mountControl({ mergeBranch });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Merge'))?.trigger('click');
    await flushPromises();
    await wrapper.get<HTMLInputElement>('.git-workflow-control__merge-cleanup input[role="switch"]').setValue(true);
    await submitButton(wrapper, 'Merge').trigger('click');
    await flushPromises();

    expect(wrapper.get('.git-operation-feedback--warning').text()).toContain(title);
    expect(wrapper.text()).toContain(detail);
    expect(wrapper.text()).not.toContain('Merge failed');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(wrapper.findAll('button').some((button) => button.text() === 'Close')).toBe(true);
  });

  it('merges and pushes the resulting base branch before showing passive success', async () => {
    const baseWorkflow = { ...workflow, folder: '/repo', branch: 'main', isLinkedWorktree: false, ahead: 3 };
    const pendingPush = deferred<AgentGitWorkflow>();
    const mergeBranch = vi.fn(async () => baseWorkflow);
    const pushBranch = vi.fn(() => pendingPush.promise);
    const wrapper = mountControl({ mergeBranch, pushBranch });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Merge'))?.trigger('click');
    await flushPromises();
    for (const toggle of wrapper.findAll<HTMLInputElement>('.git-workflow-control__merge-cleanup input[role="switch"]')) await toggle.setValue(true);
    await submitButton(wrapper, 'Merge and push').trigger('click');
    await flushPromises();

    expect(mergeBranch).toHaveBeenCalledWith('agent-1', {
      strategy: 'merge', deleteBranch: true, deleteWorktree: true, pushAfter: true, confirmed: true,
    });
    expect(pushBranch).toHaveBeenCalledWith('agent-1', {
      confirmed: true, target: 'mergeTarget', closeAgentAfterPush: true,
    });
    expect(wrapper.text()).toContain('Pushing merged branch');

    vi.useFakeTimers();
    pendingPush.resolve({ ...baseWorkflow, ahead: 0 });
    await flushPromises();

    expect(wrapper.text()).toContain('Merged and pushed');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('retries only the target push when merge and push partially fails', async () => {
    const baseWorkflow = { ...workflow, folder: '/repo', branch: 'main', isLinkedWorktree: false, ahead: 3 };
    const mergeBranch = vi.fn(async () => baseWorkflow);
    const pushBranch = vi.fn()
      .mockRejectedValueOnce(new Error('Remote rejected the base branch.'))
      .mockResolvedValueOnce({ ...baseWorkflow, ahead: 0 });
    const wrapper = mountControl({ mergeBranch, pushBranch });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Merge'))?.trigger('click');
    await flushPromises();
    await wrapper.get<HTMLInputElement>('.git-workflow-control__merge-cleanup input[role="switch"]').setValue(true);
    await submitButton(wrapper, 'Merge and push').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Merge complete, but push failed');
    expect(wrapper.text()).toContain('Remote rejected the base branch.');
    expect(mergeBranch).toHaveBeenCalledTimes(1);
    expect(pushBranch).toHaveBeenCalledTimes(1);

    await submitButton(wrapper, 'Retry push').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Merged and pushed');
    expect(mergeBranch).toHaveBeenCalledTimes(1);
    expect(pushBranch).toHaveBeenCalledTimes(2);
    expect(pushBranch).toHaveBeenNthCalledWith(1, 'agent-1', {
      confirmed: true, target: 'mergeTarget', closeAgentAfterPush: true,
    });
    expect(pushBranch).toHaveBeenNthCalledWith(2, 'agent-1', {
      confirmed: true, target: 'mergeTarget', closeAgentAfterPush: true,
    });
  });

  it('keeps a failed merge open with its error and a retry action', async () => {
    const mergeBranch = vi.fn().mockRejectedValue(new Error('The linked worktree could not be removed.'));
    const wrapper = mountControl({ mergeBranch });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Merge'))?.trigger('click');
    await flushPromises();
    await submitButton(wrapper, 'Merge').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Merge failed');
    expect(wrapper.text()).toContain('The linked worktree could not be removed.');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(submitButton(wrapper, 'Retry').exists()).toBe(true);
  });

  it('requires a feature branch for a PR even when main has uncommitted changes', async () => {
    const dirtyMain = { ...workflow, branch: 'main' };
    const mainWrapper = mountControl({ getWorkflow: async () => dirtyMain });
    await flushPromises();
    expect(mainWrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await mainWrapper.get('.git-workflow-control__trigger').trigger('click');
    const mainPr = bodyAll('[role="menuitem"]').find((item) => item.text().includes('Create PR'));
    expect(mainPr?.attributes('disabled')).toBeDefined();
    mainWrapper.unmount();

    const featureWrapper = mountControl({ getWorkflow: async () => ({ ...workflow, branch: 'feature/clean', files: [], unstagedFiles: [] }) });
    await flushPromises();
    expect(featureWrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await featureWrapper.get('.git-workflow-control__trigger').trigger('click');
    const featurePr = bodyAll('[role="menuitem"]').find((item) => item.text().includes('Create PR'));
    expect(featurePr?.attributes('disabled')).toBeUndefined();
  });

  it('opens pull request fields in one writing surface', async () => {
    const wrapper = mountControl({
      getWorkflow: async () => ({ ...workflow, branch: 'feature/dialog' }),
    });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Create PR'))?.trigger('click');

    const writingSurface = wrapper.get('.git-workflow-control__pull-request-form');
    expect(writingSurface.get('input').attributes('placeholder')).toBe('Title');
    expect((writingSurface.get('input').element as HTMLInputElement).value).toBe('');
    expect(writingSurface.get('textarea').attributes('placeholder')).toBe('Describe the change (optional)');
  });

  it('warns when pull request or merge actions would leave uncommitted changes behind', async () => {
    const pullRequest = mountControl();
    await flushPromises();
    expect(pullRequest.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await pullRequest.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Create PR'))?.trigger('click');
    expect(pullRequest.get('.git-workflow-control__uncommitted-warning').text()).toBe(
      'Uncommitted changes will not be included in this pull request.',
    );

    const merge = mountControl({ mergeBranch: vi.fn() });
    await flushPromises();
    expect(merge.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await merge.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Merge'))?.trigger('click');
    await flushPromises();
    expect(merge.get('.git-workflow-control__uncommitted-warning').text()).toBe(
      'Uncommitted changes will not be included in this merge.',
    );

    const cleanPullRequest = mountControl({
      getWorkflow: async () => ({ ...workflow, files: [], stagedFiles: [], unstagedFiles: [] }),
    });
    await flushPromises();
    expect(cleanPullRequest.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await cleanPullRequest.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Create PR'))?.trigger('click');
    expect(cleanPullRequest.find('.git-workflow-control__uncommitted-warning').exists()).toBe(false);
  });

  it('offers report-back by default for delegated pull requests and merges', async () => {
    const createdPullRequest = { number: 42, title: 'Complete delegated work', url: 'https://github.com/owner/repo/pull/42', draft: false, headSha: 'a'.repeat(40), state: 'open' as const };
    const createPullRequest = vi.fn(async () => ({ ...workflow, existingPullRequest: createdPullRequest }));
    const pullRequest = mountControl({ createPullRequest, reportBackAgentName: 'main' });
    await flushPromises();
    expect(pullRequest.get('.git-workflow-control__trigger')).toBeTruthy();
    await pullRequest.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Create PR'))?.trigger('click');

    expect(pullRequest.text()).toContain('Report to main agent');
    expect(pullRequest.text()).not.toContain('Ask this agent for a summary');
    expect(pullRequest.findComponent({ name: 'ElSwitch' }).props('modelValue')).toBe(true);
    await pullRequest.get('.git-workflow-control__pull-request-form input').setValue('Complete delegated work');
    await submitButton(pullRequest, 'Create PR').trigger('click');
    await flushPromises();
    expect(createPullRequest).toHaveBeenCalledWith('agent-1', {
      title: 'Complete delegated work', body: '', reportBack: true, confirmed: true,
    });
    expect(pullRequest.emitted('delivery-complete')).toStrictEqual([[{ kind: 'pullRequest', number: 42, url: createdPullRequest.url }]]);

    const mergeBranch = vi.fn(async () => workflow);
    const merge = mountControl({ mergeBranch, reportBackAgentName: 'main' });
    await flushPromises();
    expect(merge.get('.git-workflow-control__trigger')).toBeTruthy();
    await merge.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Merge'))?.trigger('click');
    await flushPromises();

    expect(merge.text()).toContain('Report to main agent');
    expect(merge.text()).not.toContain('Ask this agent for a summary');
    expect(merge.findAllComponents({ name: 'ElSwitch' })[0]?.props('modelValue')).toBe(true);
    await submitButton(merge, 'Merge').trigger('click');
    await flushPromises();
    expect(mergeBranch).toHaveBeenCalledWith('agent-1', {
      strategy: 'merge', deleteBranch: true, deleteWorktree: true, reportBack: true, confirmed: true,
    });
    expect(merge.emitted('delivery-complete')).toStrictEqual([[{ kind: 'merge' }]]);
  });

  it('lets pull request and merge operations finish in the background', async () => {
    const notifySuccess = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never);
    const notifyError = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never);
    const pendingPullRequest = deferred<AgentGitWorkflow>();
    const pullRequest = mountControl({
      createPullRequest: () => pendingPullRequest.promise,
      reportBackAgentName: 'main',
    });
    await flushPromises();
    expect(pullRequest.get('.git-workflow-control__trigger')).toBeTruthy();
    await pullRequest.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Create PR'))?.trigger('click');
    await pullRequest.get('.git-workflow-control__pull-request-form input').setValue('Background report');
    await submitButton(pullRequest, 'Create PR').trigger('click');

    const pullRequestBackgroundButton = submitButton(pullRequest, 'Run in background');
    expect(pullRequestBackgroundButton.isVisible()).toBe(true);
    await pullRequestBackgroundButton.trigger('click');
    expect(pullRequest.find('[role="dialog"]').exists()).toBe(false);
    expect(pullRequest.get('.git-workflow-control__trigger').attributes('disabled')).toBeDefined();
    pendingPullRequest.resolve(workflow);
    await flushPromises();
    expect(notifySuccess).toHaveBeenCalledWith('Pull request created');
    expect(pullRequest.get('.git-workflow-control__trigger').attributes('disabled')).toBeUndefined();

    const pendingMerge = deferred<AgentGitWorkflow>();
    const merge = mountControl({ mergeBranch: () => pendingMerge.promise, reportBackAgentName: 'main' });
    await flushPromises();
    expect(merge.get('.git-workflow-control__trigger')).toBeTruthy();
    await merge.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Merge'))?.trigger('click');
    await flushPromises();
    await submitButton(merge, 'Merge').trigger('click');
    await flushPromises();
    const mergeBackgroundButton = submitButton(merge, 'Run in background');
    expect(mergeBackgroundButton.isVisible()).toBe(true);
    await mergeBackgroundButton.trigger('click');
    pendingMerge.reject(new Error('merge conflict'));
    await flushPromises();

    expect(notifyError).toHaveBeenCalledWith('Merge failed: merge conflict');
  });

  it('shows handoff preparation before Git delivery begins', async () => {
    let listener: ((event: MainToRendererEvent) => void) | undefined;
    stubElectronTestWindow({
      app: {
        onEvent: vi.fn((nextListener) => {
          listener = nextListener;
          return () => undefined;
        }),
      },
    });
    const pendingPullRequest = deferred<AgentGitWorkflow>();
    const wrapper = mountControl({
      createPullRequest: () => pendingPullRequest.promise,
      reportBackAgentName: 'main',
    });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__trigger')).toBeTruthy();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Create PR'))?.trigger('click');
    await wrapper.get('.git-workflow-control__pull-request-form input').setValue('Handoff progress');
    await submitButton(wrapper, 'Create PR').trigger('click');

    expect(wrapper.text()).toContain('Building handoff report');
    expect(wrapper.text()).toContain('Waiting for the worker’s final summary.');
    listener?.({
      seq: 1,
      agentId: agent.id,
      type: 'git.operationProgress',
      payload: { operation: 'pullRequest', phase: 'delivery' },
      occurredAt: '2026-09-03T00:00:00.000Z',
    });
    await flushPromises();
    expect(wrapper.text()).toContain('Creating pull request');

    pendingPullRequest.resolve(workflow);
    await flushPromises();

    const pendingMerge = deferred<AgentGitWorkflow>();
    const merge = mountControl({
      mergeBranch: () => pendingMerge.promise,
      reportBackAgentName: 'main',
    });
    await flushPromises();
    expect(merge.get('.git-workflow-control__trigger')).toBeTruthy();
    await merge.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Merge'))?.trigger('click');
    await flushPromises();
    await submitButton(merge, 'Merge').trigger('click');
    await flushPromises();

    expect(merge.text()).toContain('Building handoff report');
    expect(merge.text()).toContain('Waiting for the worker’s final summary.');
    expect(merge.text()).not.toContain('Merging changes');
    listener?.({
      seq: 2,
      agentId: agent.id,
      type: 'git.operationProgress',
      payload: { operation: 'merge', phase: 'delivery' },
      occurredAt: '2026-09-03T00:00:01.000Z',
    });
    await flushPromises();
    expect(merge.text()).toContain('Merging feature/demo');

    pendingMerge.resolve(workflow);
    await flushPromises();
  });

  it('previews pull request and merge progress without running Git operations', async () => {
    vi.useFakeTimers();
    const createPullRequest = vi.fn();
    const mergeBranch = vi.fn();
    const wrapper = mountControl({ createPullRequest, mergeBranch });
    const control = wrapper.vm as unknown as {
      showDebugOperationProgress(operation: 'pullRequest' | 'merge'): Promise<void>;
    };

    await control.showDebugOperationProgress('pullRequest');
    await nextTick();
    expect(wrapper.text()).toContain('Building handoff report');
    expect(wrapper.text()).toContain('Waiting for the worker’s final summary.');
    expect(submitButton(wrapper, 'Run in background').isVisible()).toBe(true);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(wrapper.text()).toContain('Creating pull request');

    await control.showDebugOperationProgress('merge');
    await nextTick();
    expect(wrapper.text()).toContain('Building handoff report');
    expect(wrapper.text()).toContain('Waiting for the worker’s final summary.');
    expect(submitButton(wrapper, 'Run in background').isVisible()).toBe(true);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(wrapper.text()).toContain('Merging feature/demo');
    expect(createPullRequest).not.toHaveBeenCalled();
    expect(mergeBranch).not.toHaveBeenCalled();
  });

  it('generates an editable pull request title and body together', async () => {
    const generateMessage = vi.fn().mockResolvedValue({
      kind: 'pullRequest',
      title: 'Improve Git drafts',
      body: '## Summary\n- Add ephemeral generation',
    });
    const wrapper = mountControl({ generateMessage });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Create PR'))?.trigger('click');
    await wrapper.get('[aria-label="Generate pull request draft with Codex"]').trigger('click');
    await flushPromises();

    expect(generateMessage).toHaveBeenCalledWith('agent-1', { kind: 'pullRequest' });
    expect((wrapper.get('.git-workflow-control__pull-request-form input').element as HTMLInputElement).value).toBe('Improve Git drafts');
    expect((wrapper.get('.git-workflow-control__pull-request-form textarea').element as HTMLTextAreaElement).value).toContain('ephemeral generation');
  });

  it('explains that pull request generation requires committed branch changes', async () => {
    const descriptor = encodeAppErrorDescriptor({
      kind: 'appError',
      code: 'git.pullRequestChangesRequired',
    }, 'This branch has no committed changes to include.');
    const generateMessage = vi.fn().mockRejectedValue(new Error(
      `Error invoking remote method 'agent:git-workflow:message:generate': Error: ${descriptor}`,
    ));
    const wrapper = mountControl({ generateMessage });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Create PR'))?.trigger('click');
    await wrapper.get('[aria-label="Generate pull request draft with Codex"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('.git-workflow-control__generation-error').text()).toBe(
      'This branch has no committed changes. Commit your work before creating a pull request.',
    );
    expect(wrapper.text()).not.toContain('Error invoking remote method');
  });

  it('blocks pull request creation with the same commit-first guidance', async () => {
    const descriptor = encodeAppErrorDescriptor({
      kind: 'appError',
      code: 'git.pullRequestChangesRequired',
    }, 'This branch has no committed changes to include.');
    const createPullRequest = vi.fn().mockRejectedValue(new Error(
      `Error invoking remote method 'agent:git-workflow:pull-request:create': Error: ${descriptor}`,
    ));
    const wrapper = mountControl({ createPullRequest });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Create PR'))?.trigger('click');
    await wrapper.get('.git-workflow-control__pull-request-form input').setValue('Fix issue 7');
    await submitButton(wrapper, 'Create PR').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain(
      'This branch has no committed changes. Commit your work before creating a pull request.',
    );
    expect(wrapper.text()).not.toContain('Error invoking remote method');
  });

  it('does not offer Codex draft generation for Claude agents', async () => {
    const wrapper = mountControl({
      agent: { ...agent, backend: 'claude', backendDefaults: { kind: 'claude' } },
      generateMessage: vi.fn(),
    });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__primary').trigger('click');
    expect(wrapper.find('.git-workflow-control__generate').exists()).toBe(false);
  });

  it('shows pull request progress and passive success before closing automatically', async () => {
    const pendingPullRequest = deferred<AgentGitWorkflow>();
    const createPullRequest = vi.fn(() => pendingPullRequest.promise);
    const wrapper = mountControl({ createPullRequest });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Create PR'))?.trigger('click');
    await wrapper.get('.git-workflow-control__pull-request-form input').setValue('Improve Git workflow');
    await submitButton(wrapper, 'Create PR').trigger('click');

    expect(wrapper.text()).toContain('Creating pull request');
    expect(wrapper.text()).toContain('Improve Git workflow');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

    vi.useFakeTimers();
    pendingPullRequest.resolve(workflow);
    await flushPromises();

    expect(wrapper.text()).toContain('Pull request created');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(1499);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('keeps a failed pull request open and retries from the same dialog', async () => {
    const createPullRequest = vi.fn()
      .mockRejectedValueOnce(new Error('GitHub API rate limit exceeded.'))
      .mockResolvedValueOnce(workflow);
    const wrapper = mountControl({ createPullRequest });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find((item) => item.text().includes('Create PR'))?.trigger('click');
    await wrapper.get('.git-workflow-control__pull-request-form input').setValue('Improve Git workflow');
    await submitButton(wrapper, 'Create PR').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Pull request failed');
    expect(wrapper.text()).toContain('GitHub API rate limit exceeded.');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

    await submitButton(wrapper, 'Retry').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Pull request created');
    expect(createPullRequest).toHaveBeenCalledTimes(2);
  });

  it('does not reload workflow state when the menu opens', async () => {
    const getWorkflow = vi.fn(async () => workflow);
    const wrapper = mountControl({ getWorkflow });
    await flushPromises();
    expect(wrapper.get('.git-workflow-control__primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await flushPromises();

    expect(getWorkflow).toHaveBeenCalledOnce();
  });

  it('reloads workflow state once when git status changes', async () => {
    const getWorkflow = vi.fn(async () => workflow);
    const wrapper = mountControl({ getWorkflow });
    await flushPromises();
    expect(getWorkflow).toHaveBeenCalledOnce();

    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    expect(wrapper.get('.git-workflow-control__trigger').attributes('aria-expanded')).toBe('true');

    await wrapper.setProps({ gitStatus: { ...status, updatedAt: '2026-08-11T20:00:00.000Z' } });
    await flushPromises();

    expect(wrapper.get('.git-workflow-control__trigger').attributes('aria-expanded')).toBe('true');
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
    expect(getWorkflow).toHaveBeenCalledTimes(2);
  });

  it('coalesces a git status update with an in-flight active-agent workflow load', async () => {
    const pendingWorkflow = deferred<AgentGitWorkflow>();
    const getWorkflow = vi.fn(() => pendingWorkflow.promise);
    const wrapper = mountControl({ getWorkflow });
    await flushPromises();
    expect(getWorkflow).toHaveBeenCalledOnce();

    await wrapper.setProps({ gitStatus: { ...status, updatedAt: '2026-08-11T20:00:00.000Z' } });
    await flushPromises();

    expect(getWorkflow).toHaveBeenCalledOnce();
    pendingWorkflow.resolve(workflow);
    await flushPromises();
  });

  it('keeps the last known action availability when the menu opens', async () => {
    const getWorkflow = vi.fn().mockResolvedValueOnce(workflow);
    const wrapper = mountControl({ getWorkflow });
    await flushPromises();
    expect(getWorkflow).toHaveBeenCalledOnce();
    await flushPromises();

    await wrapper.get('.git-workflow-control__trigger').trigger('click');

    const push = bodyAll('[role="menuitem"]').find((item) => item.text().includes('Push'));
    const createPr = bodyAll('[role="menuitem"]').find((item) => item.text().includes('Create PR'));
    expect(push?.attributes('disabled')).toBeUndefined();
    expect(createPr?.attributes('disabled')).toBeUndefined();
    expect(getWorkflow).toHaveBeenCalledOnce();
  });
});

function submitButton(wrapper: ReturnType<typeof mountControl>, label: string) {
  const button = wrapper.findAll('.app-dialog__footer .app-button').find((candidate) => candidate.text() === label);
  if (!button) throw new Error(`Submit button not found: ${label}`);
  return button;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
