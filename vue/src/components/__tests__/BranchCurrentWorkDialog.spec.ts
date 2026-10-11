import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import BranchCurrentWorkDialog from '../BranchCurrentWorkDialog.vue';
import type { BranchWorkPreview } from '@workspace/core/branch-current-work';

const preview: BranchWorkPreview = { folder: '/repo', head: 'source-head', snapshotId: 'snapshot', files: [
  { path: 'tracked.ts', indexStatus: 'M', worktreeStatus: 'M', sensitive: false },
  { path: 'new.ts', indexStatus: '?', worktreeStatus: '?', sensitive: false },
  { path: '.env', indexStatus: '?', worktreeStatus: '?', sensitive: true },
] };
const button = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll('button').find(button => button.text() === text)!;

describe('BranchCurrentWorkDialog', () => {
  it('resumes a saved transfer after reload even when there are no remaining source changes', async () => {
    const input = { confirmed: true as const, requestId: 'saved', snapshotId: 'snapshot', branchName: 'feature/work', paths: ['tracked.ts'], message: 'feat: work', prompt: 'Finish' };
    const result = { state: 'recovery' as const, folder: '/worktree', branchName: 'feature/work', retainedPaths: [] };
    const transfer = vi.fn(async () => ({ ...result, state: 'completed' as const }));
    const wrapper = mount(BranchCurrentWorkDialog, { props: { modelValue: true, agentId: 'parent', load: async () => ({ ...preview, files: [], recoveries: [{ input, result }] }), transfer } });
    await flushPromises();
    await button(wrapper, 'Resume feature/work').trigger('click');
    await button(wrapper, 'Retry').trigger('click'); await flushPromises();
    expect(transfer).toHaveBeenCalledExactlyOnceWith('parent', input);
    wrapper.unmount();
  });

  it('shows every candidate, defaults to safe tracked files, and submits an explicit selection and handoff', async () => {
    const transfer = vi.fn(async () => ({ state: 'completed' as const, folder: '/worktree', branchName: 'feature/work', agentId: 'worker', retainedPaths: [] }));
    const wrapper = mount(BranchCurrentWorkDialog, { props: { modelValue: true, agentId: 'parent', load: async () => preview, transfer } });
    await flushPromises();
    const boxes = wrapper.findAll('input[type="checkbox"]');
    expect(boxes.map(box => (box.element as HTMLInputElement).checked)).toStrictEqual([true, false, false]);
    expect(wrapper.text()).toContain('.env');
    await wrapper.get('input[name="branch"]').setValue('feature/work');
    await wrapper.get('input[name="message"]').setValue('feat: work');
    await wrapper.get('textarea[name="prompt"]').setValue('Finish the feature');
    await boxes[1]!.setValue(true);
    await button(wrapper, 'Branch').trigger('click'); await flushPromises();
    expect(transfer).toHaveBeenCalledWith('parent', { confirmed: true, requestId: expect.any(String), snapshotId: 'snapshot', branchName: 'feature/work', message: 'feat: work', prompt: 'Finish the feature', paths: ['tracked.ts', 'new.ts'] });
    expect(wrapper.text()).toContain('/worktree');
    expect(wrapper.emitted('transferred')).toHaveLength(1);
    wrapper.unmount();
  });

  it('keeps the same frozen request on retry and exposes recovery without clearing the selection', async () => {
    const transfer = vi.fn().mockResolvedValueOnce({ state: 'recovery', folder: '/worktree', branchName: 'feature/work', commit: 'commit', retainedPaths: ['tracked.ts'], detail: 'Agent persistence failed' })
      .mockResolvedValueOnce({ state: 'completed', folder: '/worktree', branchName: 'feature/work', retainedPaths: [] });
    const wrapper = mount(BranchCurrentWorkDialog, { props: { modelValue: true, agentId: 'parent', load: async () => preview, transfer } });
    await flushPromises();
    await wrapper.get('input[name="branch"]').setValue('feature/work');
    await wrapper.get('input[name="message"]').setValue('feat: work');
    await wrapper.get('textarea[name="prompt"]').setValue('Finish the feature');
    await button(wrapper, 'Branch').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Agent persistence failed');
    expect(wrapper.text()).toContain('/worktree');
    await button(wrapper, 'Retry').trigger('click'); await flushPromises();
    expect(transfer.mock.calls[1]).toStrictEqual(transfer.mock.calls[0]);
    wrapper.unmount();
  });
});
