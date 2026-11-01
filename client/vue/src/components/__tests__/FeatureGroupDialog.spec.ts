import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElMessage } from 'element-plus';
import FeatureGroupDialog from '../FeatureGroupDialog.vue';
import type { FeatureGroupResult } from '@workspace/core/feature-groups';
import { createInitialSnapshot } from '@workspace/core/snapshot';

const feature = { teamId: 'team', branch: 'feat1', label: 'Account settings' };
const preview = { ...feature, fingerprint: 'reviewed', agentIds: ['api', 'web'], worktrees: [
  { path: '/repos/api-feat1', branch: 'feat1', repositoryName: 'api', changedFiles: 2 },
  { path: '/repos/web-feat1', branch: 'feat1', repositoryName: 'web', changedFiles: 0 },
] };

describe('feature group confirmation', () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([
    { outcome: 'success' as const, dismissal: 'background button' },
    { outcome: 'error' as const, dismissal: 'background button' },
    { outcome: 'error' as const, dismissal: 'navigation' },
  ])('reports deletion $outcome after $dismissal without affecting a newly opened dialog', async ({ outcome, dismissal }) => {
    let resolve!: (result: FeatureGroupResult) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<FeatureGroupResult>((yes, no) => { resolve = yes; reject = no; });
    const request = vi.fn().mockResolvedValueOnce({ kind: 'preview', preview }).mockReturnValueOnce(pending);
    const toast = vi.spyOn(ElMessage, outcome).mockImplementation(() => ({ close: vi.fn() }));
    const wrapper = mount(FeatureGroupDialog, { props: { feature, mode: 'delete', request } });
    await flushPromises();
    expect(wrapper.findAll('button').some(button => button.text() === 'Run in background')).toBe(false);
    await wrapper.findAll('button').find(button => button.text() === 'Delete feature and worktrees')!.trigger('click');
    expect(wrapper.findAll('.app-form-dialog__footer-actions button').map(button => button.text())).toStrictEqual(['Run in background']);
    expect(request).toHaveBeenLastCalledWith({ type: 'delete', teamId: 'team', branch: 'feat1', confirmed: true, fingerprint: 'reviewed' });
    if (dismissal === 'background button') {
      await wrapper.findAll('button').find(button => button.text() === 'Run in background')!.trigger('click');
      expect(wrapper.emitted('close')).toHaveLength(1);
    }
    expect(toast).not.toHaveBeenCalled();
    wrapper.unmount();
    const reopened = mount(FeatureGroupDialog, { props: { feature: { ...feature, label: 'Another feature' }, mode: 'rename', request } });
    if (outcome === 'success') resolve({ kind: 'updated', snapshot: createInitialSnapshot() });
    else reject(new Error('Offline'));
    await flushPromises();
    expect(toast).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('Account settings'));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining(outcome === 'success' ? '2 worktrees' : 'Offline'));
    expect(request).toHaveBeenCalledTimes(2);
    expect(reopened.emitted('close')).toBeUndefined();
    expect(reopened.get('input').attributes('disabled')).toBeUndefined();
    reopened.unmount();
  });

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

  it.each(['New label', ''])('selects the current label and saves %j, allowing a cleared label to restore the default', async value => {
    const request = vi.fn<() => Promise<FeatureGroupResult>>().mockResolvedValue({ kind: 'updated', snapshot: createInitialSnapshot() });
    const wrapper = mount(FeatureGroupDialog, { attachTo: document.body, props: { feature, mode: 'rename', request } });
    await flushPromises();
    const input = wrapper.get('input');
    expect(input.element.selectionStart).toBe(0);
    expect(input.element.selectionEnd).toBe(feature.label.length);
    if (value) await input.setValue(value);
    else await wrapper.get('button[aria-label="Clear text"]').trigger('click');
    await wrapper.findAll('button').find(button => button.text() === 'Save')!.trigger('click');
    await flushPromises();
    expect(request).toHaveBeenCalledExactlyOnceWith({ type: 'rename', teamId: 'team', branch: 'feat1', label: value });
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });
});
