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

  it('moves on instead of opening when the action continues in a worktree dialog', () => {
    const button = (wrapper: ReturnType<typeof mountDialog>) => wrapper.findAll('.app-button').at(-1)!.text();
    expect(button(mountDialog({ 'wall-e': { state: 'cloned', path: '/x' } }, { action: 'new-worktree' }))).toBe('Next');
    expect(button(mountDialog({ 'wall-e': { state: 'missing' } }, { action: 'new-worktree' }))).toBe('Clone and continue');
    expect(button(mountDialog({ 'wall-e': { state: 'cloned', path: '/x' } }))).toBe('Open');
    expect(button(mountDialog({ 'wall-e': { state: 'missing' } }))).toBe('Clone and open');
  });

  it('shows one progress screen during the first lookup, without a footer', () => {
    const wrapper = mountDialog({ 'wall-e': { state: 'checking' } });
    expect(wrapper.get('.git-operation-feedback').text()).toContain('Looking for korus');
    expect(wrapper.text()).toContain('On wall-e');
    expect(wrapper.find('.el-select').exists()).toBe(false);
    expect(wrapper.find('.remote-target-dialog--progress').exists()).toBe(true);
  });

  it('keeps the select while another machine is being checked', () => {
    const wrapper = mountDialog({ 'wall-e': { state: 'missing' }, devbox: { state: 'checking' } }, { selectedId: 'devbox' });
    expect(wrapper.find('.git-operation-feedback').exists()).toBe(false);
    expect(wrapper.text()).toContain('Checking…');
  });

  it('lists the machines once an answer is in', () => {
    const wrapper = mountDialog({ 'wall-e': { state: 'missing', cloneTo: '/home/me/src' } }, { canConfirm: true });
    expect(wrapper.find('.git-operation-feedback').exists()).toBe(false);
    expect(wrapper.find('.remote-target-dialog--progress').exists()).toBe(false);
    expect(wrapper.find('.el-select').exists()).toBe(true);
    expect(wrapper.findAll('.el-select .tabler-icon-world')).toHaveLength(2);
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(0);
    expect(wrapper.text()).toContain('Will be cloned from its origin first, into /home/me/src');
    expect(wrapper.text()).toContain('Clone and open');
  });

  it('disables hosts that cannot supply the repository', () => {
    const wrapper = mountDialog({ 'wall-e': { state: 'cloned', path: '/x' }, devbox: { state: 'noOrigin' } });
    const options = wrapper.findAll('option');
    expect(options.map(option => option.text())).toStrictEqual(['wall-e', 'devbox']);
    expect(options[0]!.attributes('disabled')).toBeUndefined();
    expect(options[1]!.attributes('disabled')).toBeDefined();
  });

  it('shows the clone as progress on the chosen machine', () => {
    const wrapper = mountDialog({ 'wall-e': { state: 'missing' }, devbox: { state: 'cloned', path: '/srv/korus' } }, { busy: true });
    expect(wrapper.get('.git-operation-feedback').text()).toContain('Cloning korus');
    expect(wrapper.text()).toContain('On wall-e');
  });
});
