import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import FeatureGroupDialog from '../FeatureGroupDialog.vue';
import type { FeatureGroupResult } from '@workspace/core/feature-groups';
import { createInitialSnapshot } from '@workspace/core/snapshot';

const feature = { teamId: 'team', branch: 'feat1', label: 'Account settings' };
const preview = { ...feature, fingerprint: 'reviewed', agentIds: ['api', 'web'], worktrees: [
  { path: '/repos/api-feat1', branch: 'feat1', repositoryName: 'api', changedFiles: 2 },
  { path: '/repos/web-feat1', branch: 'feat1', repositoryName: 'web', changedFiles: 0 },
] };

describe('feature group confirmation', () => {
  it('lists every worktree and waits for an explicit confirmed delete, preserving failures for retry', async () => {
    const request = vi.fn().mockResolvedValue({ kind: 'preview', preview });
    const wrapper = mount(FeatureGroupDialog, { props: { feature, mode: 'delete', request } });
    await flushPromises();
    expect(wrapper.text()).toContain('/repos/api-feat1');
    expect(wrapper.text()).toContain('/repos/web-feat1');
    expect(wrapper.text()).toContain('2 uncommitted files');
    expect(request).toHaveBeenCalledExactlyOnceWith({ type: 'preview-delete', teamId: 'team', branch: 'feat1' });
    request.mockRejectedValueOnce(new Error('Worktree changed'));
    await wrapper.findAll('button').find(button => button.text() === 'Delete feature and worktrees')!.trigger('click');
    await flushPromises();
    expect(request).toHaveBeenCalledWith({ type: 'delete', teamId: 'team', branch: 'feat1', confirmed: true, fingerprint: 'reviewed' });
    expect(wrapper.text()).toContain('Worktree changed');
    expect(wrapper.emitted('close')).toBeUndefined();
    await wrapper.findAll('button').find(button => button.text() === 'Cancel')!.trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('saves an edited display label without changing the branch identity', async () => {
    const request = vi.fn<() => Promise<FeatureGroupResult>>().mockResolvedValue({ kind: 'updated', snapshot: createInitialSnapshot() });
    const wrapper = mount(FeatureGroupDialog, { props: { feature, mode: 'rename', request } });
    await wrapper.get('input').setValue('New label');
    await wrapper.findAll('button').find(button => button.text() === 'Save')!.trigger('click');
    await flushPromises();
    expect(request).toHaveBeenCalledExactlyOnceWith({ type: 'rename', teamId: 'team', branch: 'feat1', label: 'New label' });
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });
});
