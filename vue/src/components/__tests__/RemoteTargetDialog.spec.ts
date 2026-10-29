import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { RemoteConnection } from '@workspace/core/contracts';
import RemoteTargetDialog from '../RemoteTargetDialog.vue';
import type { RemoteCheckout } from '../use-remote-target';

const connection = (id: string): RemoteConnection => ({ id, kind: 'ssh', name: id, host: id, status: 'ready', createdAt: '', updatedAt: '' });

function mountDialog(checkouts: Record<string, RemoteCheckout>, overrides: Record<string, unknown> = {}) {
  return mount(RemoteTargetDialog, {
    props: { visible: true, repositoryName: 'korus', action: 'main', connections: [connection('wall-e'), connection('devbox')], checkouts, canConfirm: false, busy: false, error: null, selectedId: 'wall-e', ...overrides },
    global: { stubs: { ElDialog: { props: ['modelValue'], template: '<section v-if="modelValue"><slot name="header" /><slot /><slot name="footer" /></section>' }, BackendModelSelector: true } },
  });
}

describe('RemoteTargetDialog', () => {
  it('names what it opens and where instead of asking an open question', () => {
    expect(mountDialog({ 'wall-e': { state: 'cloned', path: '/x' } }).text()).toContain('Open korus on a remote machine');
    expect(mountDialog({ 'wall-e': { state: 'cloned', path: '/x' } }, { action: 'new-worktree' }).text()).toContain('New korus worktree on a remote machine');
  });

  it('shows one progress screen while the machines are being checked, without a footer', () => {
    const wrapper = mountDialog({ 'wall-e': { state: 'checking' }, devbox: { state: 'checking' } });
    expect(wrapper.get('.git-operation-feedback').text()).toContain('Looking for korus');
    expect(wrapper.text()).toContain('On wall-e, devbox');
    expect(wrapper.find('.el-select').exists()).toBe(false);
    expect(wrapper.find('.remote-target-dialog--progress').exists()).toBe(true);
  });

  it('lists the machines once any answer is in', () => {
    const wrapper = mountDialog({ 'wall-e': { state: 'missing', cloneTo: '/home/me/src' }, devbox: { state: 'checking' } }, { canConfirm: true });
    expect(wrapper.find('.git-operation-feedback').exists()).toBe(false);
    expect(wrapper.find('.remote-target-dialog--progress').exists()).toBe(false);
    expect(wrapper.find('.el-select').exists()).toBe(true);
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(0);
    expect(wrapper.text()).toContain('Will be cloned from its origin first, into /home/me/src');
    expect(wrapper.text()).toContain('Clone and open');
  });

  it('shows the clone as progress on the chosen machine', () => {
    const wrapper = mountDialog({ 'wall-e': { state: 'missing' }, devbox: { state: 'cloned', path: '/srv/korus' } }, { busy: true });
    expect(wrapper.get('.git-operation-feedback').text()).toContain('Cloning korus');
    expect(wrapper.text()).toContain('On wall-e');
  });
});
