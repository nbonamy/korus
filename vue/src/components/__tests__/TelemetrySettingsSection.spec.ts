import { flushPromises, mount } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';
import { setElectronTestClient } from '../../test/client';
import TelemetrySettingsSection from '../TelemetrySettingsSection.vue';
import SettingsGeneralPanel from '../SettingsGeneralPanel.vue';
import { defaultGeneralSettings } from '@workspace/core/settings';
import type { TelemetryReport } from '@workspace/core/telemetry';
it('puts a persistent opt-in/out control in General settings and explains anonymity only when requested', async () => {
  const pending: TelemetryReport = {
    schema: 1, reportId: '00000000-0000-4000-8000-000000000001', family: 'runtime', version: '0.35.0',
    channel: 'stable', platform: 'macos', client: 'desktop',
    rows: [{ day: '2026-10-15', metric: 'turn.started', provider: 'codex', model: 'unknown', value: 1 }],
  };
  const save = vi.fn().mockResolvedValue({ choice: { enabled: false, disclosure: 2 }, active: false, blocked: null, pending: [] });
  setElectronTestClient({ getTelemetryPrivacy: vi.fn().mockResolvedValue({ choice: { enabled: true, disclosure: 2 }, active: false, blocked: 'configuration', pending: [pending] }), setTelemetryPrivacy: save });
  const wrapper = mount(SettingsGeneralPanel, { props: { settings: defaultGeneralSettings }, attachTo: document.body });
  try {
    await flushPromises();
    const section = wrapper.get('[aria-labelledby="settings-telemetry-title"]');
    expect(section.find('pre').exists()).toBe(false);
    expect(section.text()).not.toContain('00000000-0000-4000-8000-000000000001');
    expect(section.get('.form-row__copy > span').text()).toMatch(/preference is saved/i);
    expect(section.get('.form-row__copy > span').text()).toMatch(/unavailable/i);
    expect(wrapper.text()).not.toContain('Reports are anonymous');
    await wrapper.get('[aria-label="About anonymous usage statistics"]').trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('Reports are anonymous');
    expect(document.body.textContent).toContain('IP address transiently');
    await wrapper.get('[role="switch"][aria-label="Share anonymous usage statistics"]').setValue(false);
    await flushPromises();
    expect(save).toHaveBeenCalledExactlyOnceWith({ enabled: false, disclosure: 2 });
    expect(wrapper.get('[role="switch"][aria-label="Share anonymous usage statistics"]').attributes('aria-checked')).toBe('false');
    expect(section.get('.form-row__copy > span').text()).toMatch(/anonymous/i);
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
