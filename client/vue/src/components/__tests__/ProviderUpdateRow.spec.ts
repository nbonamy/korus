import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElMessageBox } from 'element-plus';
import { ref } from 'vue';
import { configureAppClient } from '../../platform-api';
import { createClientApiMock } from '../../test/client-api-mock';
import ProviderUpdateRow from '../ProviderUpdateRow.vue';
import { providerUpdatePreviewKey } from '../provider-update-preview';

afterEach(() => { configureAppClient(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('provider update controls', () => {
  it('simulates a repeatable, cancellable upgrade without sending any real update commands', async () => {
    vi.useFakeTimers();
    const { api } = createClientApiMock();
    api.getProviderUpdate.mockResolvedValue({ backend: 'claude', status: 'current', installedVersion: '9.0.0', method: 'native', canUpgrade: false, busy: false });
    configureAppClient({ platform: 'web', api });
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    const preview = ref(true);
    const wrapper = mount(ProviderUpdateRow, { props: { backend: 'claude' }, global: { provide: { [providerUpdatePreviewKey as symbol]: preview } } });
    const click = async (label: string) => { await wrapper.findAll('button').find(button => button.text() === label)!.trigger('click'); await flushPromises(); };
    try {
      await flushPromises();
      expect(wrapper.text()).toContain('1.1.0 available');
      expect(api.getProviderUpdate).not.toHaveBeenCalled();
      await click('Upgrade');
      expect(wrapper.text()).toContain('Waiting for agents');
      await click('Cancel');
      await vi.advanceTimersByTimeAsync(6_000);
      expect(wrapper.text()).toContain('1.1.0 available');
      await click('Upgrade');
      await vi.advanceTimersByTimeAsync(2_000);
      expect(wrapper.text()).toContain('Upgrading…');
      await vi.advanceTimersByTimeAsync(4_000);
      expect(wrapper.get('.provider-update__version').text()).toBe('1.1.0');
      expect(wrapper.findAll('button').find(button => button.text() === 'Up to date')!.element.disabled).toBe(true);
      await wrapper.get('button[aria-label="Check for updates"]').trigger('click'); await flushPromises();
      expect(wrapper.text()).toContain('1.1.0 available');
      await click('Upgrade');
      preview.value = false; await flushPromises();
      await vi.advanceTimersByTimeAsync(6_000);
      expect(wrapper.get('.provider-update__version').text()).toBe('9.0.0');
      expect(api.setProviderUpdate).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it('never turns a preview confirmation into a real upgrade when the toggle changes', async () => {
    const { api } = createClientApiMock();
    configureAppClient({ platform: 'web', api });
    let confirm!: () => void;
    vi.spyOn(ElMessageBox, 'confirm').mockImplementation(() => new Promise(resolve => { confirm = () => resolve('confirm' as never); }));
    const preview = ref(true);
    const wrapper = mount(ProviderUpdateRow, { props: { backend: 'codex' }, global: { provide: { [providerUpdatePreviewKey as symbol]: preview } } });
    try {
      await flushPromises();
      await wrapper.findAll('button').find(button => button.text() === 'Upgrade')!.trigger('click');
      preview.value = false;
      confirm(); await flushPromises();
      expect(api.setProviderUpdate).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it.each([
    { status: 'waiting' as const, label: 'Waiting for agents to finish' },
    { status: 'upgrading' as const, label: 'Upgrading…' },
    { status: 'error' as const, error: 'upgradeFailed' as const, label: 'Upgrade failed.' },
  ])('keeps $status feedback with the version instead of adding a third line', async ({ status, label, ...error }) => {
    const { api } = createClientApiMock();
    api.getProviderUpdate.mockResolvedValue({ backend: 'claude', status, installedVersion: '2.1.293', method: 'native', canUpgrade: false, busy: false, ...error });
    configureAppClient({ platform: 'web', api });
    const wrapper = mount(ProviderUpdateRow, { props: { backend: 'claude' } });
    try {
      await flushPromises();
      expect(wrapper.get('.provider-update__version').text()).toContain(`2.1.293 · ${label}`);
      expect(wrapper.get('.form-row__copy').element.children).toHaveLength(2);
    } finally { wrapper.unmount(); }
  });

  it('shows the versions and confirms an upgrade on the selected remote host', async () => {
    const { api } = createClientApiMock();
    api.getProviderUpdate.mockResolvedValue({ backend: 'codex', status: 'available', installedVersion: '1.0.0', latestVersion: '1.1.0', method: 'npm', canUpgrade: true, busy: false, token: 'checked' });
    api.setProviderUpdate.mockResolvedValue({ backend: 'codex', status: 'current', installedVersion: '1.1.0', method: 'npm', canUpgrade: false, busy: false });
    configureAppClient({ platform: 'web', api });
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    const wrapper = mount(ProviderUpdateRow, { props: { backend: 'codex', remoteConnectionId: 'wall-e' } });
    await flushPromises();
    expect(wrapper.text()).toContain('1.1.0 available');
    expect(wrapper.get('.provider-update__version').classes()).toContain('provider-update__available');
    expect(api.setProviderUpdate).not.toHaveBeenCalled();
    await wrapper.findAll('button').find(button => button.text() === 'Upgrade')!.trigger('click');
    await flushPromises();
    expect(api.setProviderUpdate).toHaveBeenCalledWith('codex', { action: 'upgrade', confirmed: true, token: 'checked' }, 'wall-e');
    expect(wrapper.get('.provider-update__version').text()).toBe('1.1.0');
    expect(wrapper.get('.provider-update__version').classes()).toContain('provider-update__current');
    expect(wrapper.get('.provider-update__version').classes()).not.toContain('provider-update__available');
    const current = wrapper.findAll('button').find(button => button.text() === 'Up to date')!;
    expect(current.element.disabled).toBe(true);
  });

  it('does not upgrade after cancelling confirmation and offers cancellation for queued upgrades', async () => {
    const { api } = createClientApiMock();
    const available = { backend: 'claude' as const, status: 'available' as const, method: 'native' as const, canUpgrade: true, busy: true, token: 'checked' };
    api.getProviderUpdate.mockResolvedValue(available);
    api.setProviderUpdate.mockResolvedValue({ ...available, status: 'waiting' });
    configureAppClient({ platform: 'web', api });
    const confirmation = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel');
    const wrapper = mount(ProviderUpdateRow, { props: { backend: 'claude' } });
    await flushPromises();
    const button = wrapper.findAll('button').find(item => item.text() === 'Upgrade when idle')!;
    await button.trigger('click'); await flushPromises();
    expect(api.setProviderUpdate).not.toHaveBeenCalled();
    confirmation.mockResolvedValue('confirm' as never);
    await button.trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Waiting for agents');
    api.setProviderUpdate.mockResolvedValue(available);
    await wrapper.findAll('button').find(item => item.text() === 'Cancel')!.trigger('click'); await flushPromises();
    expect(api.setProviderUpdate).toHaveBeenLastCalledWith('claude', { action: 'cancel' }, undefined);
  });

  it.each(['available', 'manual'] as const)('offers instructions rather than an upgrade for unmanaged installations (%s)', async status => {
    const { api } = createClientApiMock();
    api.getProviderUpdate.mockResolvedValue({ backend: 'claude', status, method: 'manual', canUpgrade: false, busy: false });
    configureAppClient({ platform: 'web', api });
    const wrapper = mount(ProviderUpdateRow, { props: { backend: 'claude' } });
    await flushPromises();
    expect(wrapper.get('a').attributes('href')).toContain('code.claude.com');
    expect(wrapper.findAll('button').some(button => button.text() === 'Upgrade')).toBe(false);
  });
});
