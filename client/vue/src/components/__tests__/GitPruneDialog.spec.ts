import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ElDialog from 'element-plus/es/components/dialog/index';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { GitPruneInventory, GitPruneResult, GitPruneTarget } from '@workspace/core/contracts';
import GitPruneDialog from '../GitPruneDialog.vue';

afterEach(() => vi.restoreAllMocks());

const target = (name: string, overrides: Partial<GitPruneTarget> = {}): GitPruneTarget => ({
  id: `local:${name}`, name, branch: name, kind: 'local', sha: 'abc', revision: `revision:${name}`,
  merged: true, usedBy: [], changedFiles: 0, ...overrides,
});
const local = target('feat/web', { worktree: '/repos/korus-web' });
const remote = target('origin/feat/web', { id: 'remote:web', branch: 'feat/web', kind: 'remote' });
const blocked = target('feat/busy', { worktree: '/repos/busy', blocked: 'inUse', usedBy: ['Ada'] });
const inventory: GitPruneInventory = { repository: 'korus', baseBranch: 'main', unavailableRemotes: [], groups: [
  { branch: 'feat/web', local, remotes: [remote] },
  { branch: 'feat/busy', local: blocked, remotes: [] },
] };

function create(props = {}) {
  return mount(GitPruneDialog, { props: {
    agentId: 'agent-1', modelValue: true, load: async () => inventory,
    prune: vi.fn(async () => ({ deleted: [], failed: [] })), ...props,
  } });
}

describe('GitPruneDialog', () => {
  it.each([
    { dirty: true, pullRequest: undefined },
    { dirty: true, pullRequest: { number: 7, url: 'https://github.com/owner/repo/pull/7', title: 'Merged work', draft: false, headSha: 'abc', state: 'merged' as const } },
    { dirty: false, pullRequest: undefined },
  ])('prioritizes uncommitted work over merged history and PR badges ($dirty)', async ({ dirty, pullRequest }) => {
    const local = target('feat/done', { worktree: '/repo/tree', merged: true, changedFiles: 2,
      uncommittedFiles: dirty ? 1 : 0, blocked: 'changes', pullRequest });
    const wrapper = create({ load: async () => ({ ...inventory, groups: [{ branch: local.branch, local, remotes: [] }] }) });
    await flushPromises();
    const state = wrapper.get('.git-prune-dialog__state');
    expect(state.text()).toBe(dirty ? 'Uncommitted changes' : 'Merged');
    expect(state.find('.git-prune-dialog__pr').exists()).toBe(false);
    if (dirty) expect(getComputedStyle(state.get('span').element).color).toBe('var(--color-error)');
    expect(wrapper.text()).toContain(dirty ? '1 uncommitted file' : 'Worktree /repo/tree');
    expect(wrapper.text()).not.toContain('uncommitted or ignored');
    if (!dirty) expect(wrapper.text()).not.toContain('uncommitted file');
    expect((wrapper.get('input[role="switch"]').element as HTMLInputElement).checked).toBe(false);
  });

  it('does not infer uncommitted changes from an inventory that only has combined file counts', async () => {
    const local = target('investigate/diffmap-integration', { worktree: '/repo/diffmap', changedFiles: 19, blocked: 'changes' });
    const wrapper = create({ load: async () => ({ ...inventory, groups: [{ branch: local.branch, local, remotes: [] }] }) });
    await flushPromises();
    const state = wrapper.get('.git-prune-dialog__state');
    expect(state.text()).toBe('Merged');
    expect(state.find('.git-prune-dialog__dirty').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('19');
  });

  it.each([
    { kind: 'success' as const, result: { deleted: [local.id, remote.id], failed: [] }, message: '2 items pruned' },
    { kind: 'warning' as const, result: { deleted: [local.id], failed: [{ id: remote.id, message: 'Remote changed' }] }, message: '1 item pruned. 1 failed.' },
    { kind: 'error' as const, result: null, message: 'Prune failed: Offline' },
  ])('reports background $kind after the closed dialog unmounts', async ({ kind, result, message }) => {
    let resolve!: (result: GitPruneResult) => void;
    let reject!: (error: Error) => void;
    const prune = vi.fn(() => new Promise<GitPruneResult>((yes, no) => { resolve = yes; reject = no; }));
    const toast = vi.spyOn(ElMessage, kind).mockImplementation(() => ({ close: vi.fn() }));
    const wrapper = create({ prune });
    await flushPromises();
    await wrapper.get('input[aria-label="Delete origin/feat/web"]').setValue(true);
    await wrapper.get('[data-action="prune"]').trigger('click');
    expect(wrapper.findAll('.app-form-dialog__footer-actions button').map(button => button.text())).toStrictEqual(['Run in background']);
    const background = wrapper.findAll('button').find(button => button.text() === 'Run in background');
    expect(background).toBeDefined();
    await background!.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toStrictEqual([[false]]);
    expect(toast).not.toHaveBeenCalled();
    wrapper.unmount(); // GitWorkflowControl removes its dialog when it closes.
    const reopened = create({ agentId: 'agent-2' });
    await flushPromises();
    if (result) resolve(result);
    else reject(new Error('Offline'));
    await flushPromises();
    expect(prune).toHaveBeenCalledExactlyOnceWith('agent-1', { confirmed: true, targets: [
      { id: local.id, revision: local.revision }, { id: remote.id, revision: remote.revision },
    ] });
    expect(toast).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(message));
    if (kind === 'warning') expect(toast).toHaveBeenCalledWith(expect.stringContaining('Remote changed'));
    expect(reopened.emitted('update:modelValue')).toBeUndefined();
    expect(reopened.get('[data-action="prune"]').attributes('disabled')).toBeUndefined();
  });

  it.each(['github', 'gitlab'] as const)('shows a native %s request status beside the remote branch', async provider => {
    const url = provider === 'gitlab' ? 'https://gitlab.com/group/sub/repo/-/merge_requests/7' : 'https://github.com/owner/repo/pull/7';
    const requestRemote = { ...remote, pullRequest: { number: 7, url, title: 'Work', draft: false, headSha: 'abc', state: 'merged' as const } };
    const wrapper = create({ load: async () => ({ ...inventory, groups: [{ branch: 'feat/web', remotes: [requestRemote] }] }) });
    await flushPromises();
    const link = wrapper.get('.git-prune-dialog__pr');
    expect(link.text()).toBe(provider === 'gitlab' ? 'MR !7 merged' : 'PR #7 merged');
    expect(link.attributes('href')).toBe(url);
  });
  it.each([
    { ...blocked, merged: false, changedFiles: 3 },
    { ...blocked, blocked: 'changes' as const, usedBy: [], changedFiles: 3 },
    { ...blocked, blocked: 'locked' as const, usedBy: [] },
  ])('lets users select a $blocked worktree and requires confirmation before force deletion', async (risky) => {
    const prune = vi.fn(async () => ({ deleted: [risky.id], failed: [] }));
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValue('confirm' as never);
    const wrapper = create({ prune, load: async () => ({ ...inventory, groups: [{ branch: risky.branch, local: risky, remotes: [] }] }) });
    await flushPromises();
    const input = wrapper.get('input[role="switch"]');
    expect(input.attributes('disabled')).toBeUndefined();
    expect((input.element as HTMLInputElement).checked).toBe(false);
    await input.setValue(true);
    await wrapper.get('[data-action="prune"]').trigger('click');
    await flushPromises();
    expect(prune).not.toHaveBeenCalled();
    expect((input.element as HTMLInputElement).checked).toBe(true);
    await wrapper.get('[data-action="prune"]').trigger('click');
    await flushPromises();
    expect(prune).toHaveBeenCalledExactlyOnceWith('agent-1', { confirmed: true, force: true, targets: [{ id: risky.id, revision: risky.revision }] });
  });
  it('explicitly selects eligible merged remotes without changing local selections or selecting blocked remotes', async () => {
    const unmerged = target('origin/wip', { kind: 'remote', merged: false });
    const unavailable = target('origin/offline', { kind: 'remote', blocked: 'unavailable' });
    const prune = vi.fn(async () => ({ deleted: [], failed: [] }));
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValue('confirm' as never);
    const wrapper = create({ prune, load: async () => ({ ...inventory, groups: [
      ...inventory.groups,
      { branch: 'wip', remotes: [unmerged] }, { branch: 'offline', remotes: [unavailable] },
    ] }) });
    await flushPromises();
    await wrapper.get('input[aria-label="Delete feat/web"]').setValue(false);
    const action = wrapper.findAll('button').find(button => button.text() === 'Select merged remote branches')!;
    expect(action).toBeDefined();
    await action.trigger('click');
    expect(wrapper.findAll('input[role="switch"]').map(input => (input.element as HTMLInputElement).checked)).toStrictEqual([false, true, false, false, false]);
    expect(prune).not.toHaveBeenCalled();
    expect(action.attributes('disabled')).toBeDefined();
    await wrapper.get('input[aria-label="Delete origin/wip"]').setValue(true);
    await wrapper.get('[data-action="prune"]').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('main'), 'Prune unmerged branches?', expect.objectContaining({
      confirmButtonText: 'Prune anyway', cancelButtonText: 'Review',
    }));
    expect(prune).not.toHaveBeenCalled();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect((wrapper.get('input[aria-label="Delete origin/wip"]').element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    await wrapper.get('[data-action="prune"]').trigger('click');
    await flushPromises();
    expect(prune).toHaveBeenCalledWith('agent-1', { confirmed: true, force: true, targets: [
      { id: remote.id, revision: remote.revision }, { id: unmerged.id, revision: unmerged.revision },
    ] });
  });

  it('locks selection while confirming and ignores approval after switching agents', async () => {
    let approve!: () => void;
    vi.spyOn(ElMessageBox, 'confirm').mockImplementation(() => new Promise(resolve => { approve = () => resolve('confirm' as never); }));
    const unmerged = target('origin/wip', { kind: 'remote', merged: false });
    const prune = vi.fn();
    const wrapper = create({ prune, load: async () => ({ ...inventory, groups: [{ branch: 'wip', remotes: [unmerged] }] }) });
    await flushPromises();
    await wrapper.get('input[role="switch"]').setValue(true);
    await wrapper.get('[data-action="prune"]').trigger('click');
    expect(prune).not.toHaveBeenCalled();
    expect(wrapper.get('input[role="switch"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-action="prune"]').attributes('disabled')).toBeDefined();
    await wrapper.setProps({ agentId: 'agent-2' });
    approve();
    await flushPromises();
    expect(prune).not.toHaveBeenCalled();
  });
  it('keeps a split header and fixed footer around the bounded scrolling body', async () => {
    const wrapper = mount(GitPruneDialog, {
      attachTo: document.body,
      props: { agentId: 'agent-1', modelValue: true, load: async () => inventory, prune: vi.fn() },
      global: { stubs: { ElDialog, teleport: false } },
    });
    await flushPromises();
    expect(getComputedStyle(wrapper.get('.app-form-dialog__header').element).gridTemplateColumns).toBe('auto minmax(0, 1fr)');
    expect(getComputedStyle(wrapper.get('.app-dialog__subtitle').element).justifySelf).toBe('end');
    const body = wrapper.get('.el-dialog__body');
    const bodyStyle = getComputedStyle(body.element);
    expect(bodyStyle.maxHeight).toBe('min(560px, calc(100dvh - 200px))');
    expect(bodyStyle.overflowY).toBe('auto');
    expect(body.element.contains(wrapper.get('[data-action="prune"]').element)).toBe(false);
    expect(getComputedStyle(wrapper.get('.el-dialog__footer').element).flexShrink).toBe('0');
  });

  it('reserves the same chevron column for local and remote status labels', async () => {
    const wrapper = create();
    await flushPromises();
    const states = wrapper.findAll('.git-prune-dialog__state');
    expect(states[0]!.find('button').exists()).toBe(true);
    expect(states[1]!.find('button').exists()).toBe(false);
    for (const state of states) {
      expect(getComputedStyle(state.element).gridTemplateColumns).toBe('auto 20px');
    }
  });

  it('preselects only eligible local bundles, preserves selection while folding, and sends explicit choices', async () => {
    const prune = vi.fn(async () => ({ deleted: [local.id, remote.id], failed: [] }));
    const wrapper = create({ prune });
    await flushPromises();
    const switches = wrapper.findAll('input[role="switch"]');
    expect(switches.map(input => [input.attributes('aria-label'), (input.element as HTMLInputElement).checked, (input.element as HTMLInputElement).disabled])).toStrictEqual([
      ['Delete feat/web', true, false], ['Delete origin/feat/web', false, false], ['Delete feat/busy', false, false],
    ]);
    expect(wrapper.text()).not.toContain('used by Ada');
    const remoteRow = wrapper.get('.git-prune-dialog__row--remote');
    expect(remoteRow.get('.git-prune-dialog__detail').text()).toBe('Remote branch');
    expect(wrapper.text()).toContain('Prune 1 item');
    await wrapper.get('button[aria-label="Collapse feat/web"]').trigger('click');
    expect(switches[1]!.isVisible()).toBe(false);
    expect(wrapper.text()).toContain('Prune 1 item');
    await wrapper.get('button[aria-label="Expand feat/web"]').trigger('click');
    await switches[1]!.setValue(true);
    expect(prune).not.toHaveBeenCalled();
    await wrapper.get('button[data-action="prune"]').trigger('click');
    await flushPromises();
    expect(prune).toHaveBeenCalledExactlyOnceWith('agent-1', { confirmed: true, targets: [
      { id: local.id, revision: local.revision }, { id: remote.id, revision: remote.revision },
    ] });
    expect(wrapper.emitted('update:modelValue')).toStrictEqual([[false]]);
  });

  it('submits nothing on Close and requires an explicit retry after inventory errors', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(inventory);
    const prune = vi.fn();
    const wrapper = create({ load, prune });
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Offline');
    expect(wrapper.get('button[data-action="prune"]').attributes('disabled')).toBeDefined();
    await wrapper.get('button[aria-label="Refresh branches"]').trigger('click');
    await flushPromises();
    const close = wrapper.findAll('button').find(button => button.text() === 'Close')!;
    expect(close.classes()).toContain('app-button--tertiary');
    await close.trigger('click');
    expect(prune).not.toHaveBeenCalled();
    expect(wrapper.emitted('update:modelValue')).toStrictEqual([[false]]);
  });

  it('retains partial-failure feedback, clears selection and reloads the inventory without repeating deletions', async () => {
    const load = vi.fn().mockResolvedValue(inventory);
    const prune = vi.fn(async () => ({ deleted: [local.id], failed: [{ id: remote.id, message: 'Remote changed' }] }));
    const wrapper = create({ load, prune });
    await flushPromises();
    await wrapper.findAll('input[role="switch"]')[1]!.setValue(true);
    await wrapper.get('button[data-action="prune"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Remote changed');
    expect(wrapper.text()).toContain('1 item deleted');
    expect(wrapper.get('button[data-action="prune"]').attributes('disabled')).toBeDefined();
    expect(load).toHaveBeenCalledTimes(2);
    expect(prune).toHaveBeenCalledTimes(1);
  });

  it('ignores a late inventory for a different agent', async () => {
    let resolveFirst!: (value: GitPruneInventory) => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; })).mockResolvedValue({ ...inventory, groups: [] });
    const wrapper = create({ load });
    await wrapper.setProps({ agentId: 'agent-2' });
    await flushPromises();
    resolveFirst(inventory);
    await flushPromises();
    expect(wrapper.findAll('input[role="switch"]')).toHaveLength(0);
    expect(wrapper.text()).toContain('No branches to prune');
  });
});
