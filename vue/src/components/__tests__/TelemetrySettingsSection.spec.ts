import { flushPromises, mount } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';
import { setElectronTestClient } from '../../test/client';
import TelemetrySettingsSection from '../TelemetrySettingsSection.vue';
import SettingsGeneralPanel from '../SettingsGeneralPanel.vue';
import { defaultGeneralSettings } from '@workspace/core/settings';
it('puts a persistent opt-in/out control in General settings and explains anonymity only when requested', async () => {
  const save = vi.fn().mockResolvedValue({ choice: { enabled: false, disclosure: 2 }, active: false, blocked: null, pending: [] });
  setElectronTestClient({ getTelemetryPrivacy: vi.fn().mockResolvedValue({ choice: { enabled: true, disclosure: 2 }, active: false, blocked: 'rollout', pending: [] }), setTelemetryPrivacy: save });
  const wrapper = mount(SettingsGeneralPanel, { props: { settings: defaultGeneralSettings }, attachTo: document.body });
  try {
    await flushPromises();
    expect(wrapper.text()).toContain('Uploads are disabled');
    expect(wrapper.text()).not.toContain('Reports are anonymous');
    await wrapper.get('[aria-label="About anonymous usage statistics"]').trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('Reports are anonymous');
    expect(document.body.textContent).toContain('IP address transiently');
    await wrapper.get('[role="switch"][aria-label="Share anonymous usage statistics"]').setValue(false);
    await flushPromises();
    expect(save).toHaveBeenCalledExactlyOnceWith({ enabled: false, disclosure: 2 });
    expect(wrapper.get('pre').text()).toBe('[]');
  } finally { wrapper.unmount(); }
});
it('shows failed preference reads and saves without claiming reporting became active', async () => {
  const get = vi.fn().mockRejectedValueOnce(new Error('read failed')).mockResolvedValue({ choice: null, active: false, blocked: 'disclosure', pending: [] });
  const save = vi.fn().mockRejectedValue(new Error('write failed'));
  setElectronTestClient({ getTelemetryPrivacy: get, setTelemetryPrivacy: save });
  let wrapper = mount(TelemetrySettingsSection);
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  expect(wrapper.get('[role="switch"]').attributes('disabled')).toBeDefined();
  wrapper.unmount();
  wrapper = mount(TelemetrySettingsSection);
  await flushPromises();
  await wrapper.get('[role="switch"]').setValue(true);
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('false');
  wrapper.unmount();
});
