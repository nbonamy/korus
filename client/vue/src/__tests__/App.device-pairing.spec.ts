import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { ElMenu, ElMenuItem, ElMenuItemGroup, ElMessageBox, ElSwitch } from 'element-plus';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import App from '../App.vue';
import { installBackendFixture } from '../test/backend-fixture';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('routes Settings Connections device pairing through the real app chain to the backend', async () => {
  const { api, emitAppCommand } = installBackendFixture(createInitialSnapshot());
  const session = {
    pairingCode: 'test-pairing-payload', manualPairingCode: 'TEST-CODE',
    environmentId: 'test-environment', expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  api.getRemoteControlStatus.mockResolvedValue({ status: 'disabled', allowRemoteControl: true });
  api.enableRemoteControl.mockResolvedValue({ status: 'connected', environmentId: session.environmentId });
  api.disableRemoteControl.mockResolvedValue({ status: 'disabled' });
  api.startDevicePairing.mockResolvedValue(session);
  api.checkDevicePairing.mockResolvedValue(true);
  api.listPairedDevices.mockResolvedValueOnce([]).mockResolvedValue([{ clientId: 'test-client', displayName: 'Test relay client' }]);
  api.revokePairedDevice.mockResolvedValue(undefined);
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);

  const wrapper = mount(App, { attachTo: document.body, global: { components: { ElMenu, ElMenuItem, ElMenuItemGroup, ElSwitch } } });
  await flushPromises();
  emitAppCommand({ type: 'open-settings' });
  await flushPromises();
  await wrapper.findAll('.settings-sidebar [role="menuitem"]').find(item => item.text() === 'Connections')!.trigger('click');
  await flushPromises();

  const toggle = wrapper.get('[role="switch"][aria-label="Allow connections"]');
  expect(toggle.attributes('aria-checked')).toBe('false');
  await toggle.trigger('click');
  await flushPromises();
  expect(api.enableRemoteControl).toHaveBeenCalledExactlyOnceWith();
  expect(api.getRemoteControlStatus).toHaveBeenCalledExactlyOnceWith();
  expect(toggle.attributes('aria-checked')).toBe('true');
  expect(api.listPairedDevices).toHaveBeenCalledWith('test-environment');

  vi.useFakeTimers();
  await wrapper.findAll('.settings-device-pairing button').find(button => button.text() === 'Add device')!.trigger('click');
  await flushPromises();
  expect(api.startDevicePairing).toHaveBeenCalledExactlyOnceWith();
  expect(wrapper.get('.settings-device-pairing__code').text()).toContain('TEST-CODE');
  await vi.advanceTimersByTimeAsync(2_000);
  await flushPromises();
  expect(api.checkDevicePairing).toHaveBeenCalledExactlyOnceWith(session);
  expect(wrapper.find('.settings-device-pairing__code').exists()).toBe(false);
  expect(wrapper.get('.settings-device-pairing__device-list').text()).toContain('Test relay client');

  await wrapper.findAll('.settings-device-pairing button').find(button => button.text() === 'Revoke')!.trigger('click');
  await flushPromises();
  expect(api.revokePairedDevice).toHaveBeenCalledExactlyOnceWith('test-environment', 'test-client');
  expect(wrapper.find('.settings-device-pairing__device-list').exists()).toBe(false);
  await toggle.trigger('click');
  await flushPromises();
  expect(api.disableRemoteControl).toHaveBeenCalledExactlyOnceWith();
  expect(toggle.attributes('aria-checked')).toBe('false');
  wrapper.unmount();
});
