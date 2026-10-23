import { flushPromises, mount } from '@vue/test-utils';
import { mountProvisioningHost } from './provisioning-host';
import { activeProvisioningOperation, backgroundProvisioningOperation } from '../provisioning-operations';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BranchCurrentWorkDialog from '../BranchCurrentWorkDialog.vue';
import type { BranchWorkInput, BranchWorkPreview } from '@workspace/core/branch-current-work';

const preview: BranchWorkPreview = { folder: '/repo', head: 'source-head', snapshotId: 'snapshot' };
const button = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll('button').find(button => button.text() === text)!;

describe('BranchCurrentWorkDialog', () => {
  afterEach(() => vi.useRealTimers());

  it('resumes a saved transfer after reload even when there are no remaining source changes', async () => {
    const input = { confirmed: true as const, requestId: 'saved', snapshotId: 'snapshot', branchName: 'feature/work' };
    const result = { state: 'recovery' as const, folder: '/worktree', branchName: 'feature/work', retainedPaths: [] };
    const transfer = vi.fn(async () => ({ ...result, state: 'completed' as const }));
    const wrapper = mount(BranchCurrentWorkDialog, { props: { modelValue: true, agentId: 'parent', load: async () => ({ ...preview, recoveries: [{ input, result }] }), transfer } });
    await flushPromises();
    await button(wrapper, 'Resume feature/work').trigger('click');
    await button(wrapper, 'Retry').trigger('click'); await flushPromises();
    expect(transfer).toHaveBeenCalledExactlyOnceWith('parent', input);
    wrapper.unmount();
  });

  it('asks only for a branch name and sends a cloneable request across native IPC', async () => {
    vi.useFakeTimers();
    const transfer = vi.fn(async (_agentId: string, input: BranchWorkInput) => { structuredClone(input); return { state: 'completed' as const, folder: '/worktree', branchName: 'feature/work', agentId: 'worker', retainedPaths: [] }; });
    const wrapper = mount(BranchCurrentWorkDialog, { props: { modelValue: true, agentId: 'parent', load: async () => preview, transfer } });
    mountProvisioningHost();
    await flushPromises();
    expect(wrapper.findAll('input')).toHaveLength(1);
    expect(wrapper.get('input[name="branch"]').attributes('aria-label')).toBe('Branch name');
    expect(wrapper.find('textarea').exists()).toBe(false);
    await wrapper.get('input[name="branch"]').setValue('feature/work');
    await button(wrapper, 'Branch').trigger('click'); await flushPromises();
    expect(transfer).toHaveBeenCalledWith('parent', { confirmed: true, requestId: expect.any(String), snapshotId: 'snapshot', branchName: 'feature/work' });
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    vi.advanceTimersByTime(1); await flushPromises();
    vi.advanceTimersByTime(600); await flushPromises();
    expect(wrapper.emitted('transferred')).toHaveLength(1);
    wrapper.unmount();
  });

  it('uses worktree progress driven by the matching backend operation and opens the ready agent', async () => {
    vi.useFakeTimers();
    let finish!: (value: { state: 'completed'; folder: string; branchName: string; agentId: string; retainedPaths: string[] }) => void;
    const pending = new Promise<Parameters<typeof finish>[0]>(resolve => { finish = resolve; });
    const transfer = vi.fn(async (_agentId: string, input: BranchWorkInput) => { structuredClone(input); return pending; });
    const wrapper = mount(BranchCurrentWorkDialog, { props: { modelValue: true, agentId: 'parent', load: async () => preview, transfer } });
    await flushPromises();
    await wrapper.get('input[name="branch"]').setValue('feature/work');
    await button(wrapper, 'Branch').trigger('click'); await flushPromises();
    expect(wrapper.find('input').exists()).toBe(false);
    const host = mountProvisioningHost();
    const rows = () => host.findAll('.staged-operation-progress li');
    expect(rows()).toHaveLength(4);
    expect(rows()[0]!.classes()).toContain('is-active');
    const input = transfer.mock.calls[0]![1];
    await wrapper.setProps({ progress: { id: 'other', agentId: 'parent', branchName: 'feature/work', phase: 'resettingSource', state: 'running' } });
    expect(rows()[0]!.classes()).toContain('is-active');
    await wrapper.setProps({ progress: { id: input.requestId, agentId: 'parent', branchName: 'feature/work', phase: 'movingChanges', state: 'running' } });
    vi.advanceTimersByTime(10_000); await flushPromises();
    expect(rows()[1]!.classes()).toContain('is-active');
    finish({ state: 'completed', folder: '/worktree', branchName: 'feature/work', agentId: 'worker', retainedPaths: [] });
    await flushPromises();
    vi.advanceTimersByTime(1); await flushPromises();
    vi.advanceTimersByTime(600); await flushPromises();
    expect(wrapper.emitted('inspect-agent')).toStrictEqual([['worker']]);
    expect(wrapper.emitted('update:modelValue')).toStrictEqual([[false]]);
    wrapper.unmount();
  });

  it('finishes a backgrounded transfer without opening the new agent', async () => {
    let finish!: (value: { state: 'completed'; folder: string; branchName: string; agentId: string; retainedPaths: string[] }) => void;
    const pending = new Promise<Parameters<typeof finish>[0]>(resolve => { finish = resolve; });
    const transfer = vi.fn(async (_agentId: string, input: BranchWorkInput) => { structuredClone(input); return pending; });
    const wrapper = mount(BranchCurrentWorkDialog, { props: { modelValue: true, agentId: 'parent', load: async () => preview, transfer } });
    await flushPromises();
    await wrapper.get('input[name="branch"]').setValue('feature/work');
    await button(wrapper, 'Branch').trigger('click'); await flushPromises();
    backgroundProvisioningOperation(transfer.mock.calls[0]![1].requestId);
    expect(activeProvisioningOperation.value).toBeNull();
    finish({ state: 'completed', folder: '/worktree', branchName: 'feature/work', agentId: 'worker', retainedPaths: [] });
    await flushPromises();
    expect(wrapper.emitted('transferred')).toHaveLength(1);
    expect(wrapper.emitted('inspect-agent')).toBeUndefined();
    expect(wrapper.emitted('update:modelValue')).toStrictEqual([[false]]);
    wrapper.unmount();
  });

  it('keeps the same frozen request on retry and exposes recovery without creating another agent', async () => {
    const transfer = vi.fn().mockResolvedValueOnce({ state: 'recovery', folder: '/worktree', branchName: 'feature/work', retainedPaths: ['tracked.ts'], detail: 'Agent persistence failed' })
      .mockResolvedValueOnce({ state: 'completed', folder: '/worktree', branchName: 'feature/work', retainedPaths: [] });
    const wrapper = mount(BranchCurrentWorkDialog, { props: { modelValue: true, agentId: 'parent', load: async () => preview, transfer } });
    await flushPromises();
    await wrapper.get('input[name="branch"]').setValue('feature/work');
    const host = mountProvisioningHost();
    await button(wrapper, 'Branch').trigger('click'); await flushPromises();
    expect(host.text()).toContain('Agent persistence failed');
    await button(host, 'Close').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('/worktree');
    await button(wrapper, 'Retry').trigger('click'); await flushPromises();
    expect(transfer.mock.calls[1]).toStrictEqual(transfer.mock.calls[0]);
    wrapper.unmount();
  });
});
