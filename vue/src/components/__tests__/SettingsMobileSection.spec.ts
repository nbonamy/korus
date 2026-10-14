import { mount, flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { CompanionControl, CompanionControlResult, CompanionStatus } from '@workspace/core/companion-protocol';
import SettingsMobileSection from '../SettingsMobileSection.vue';
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,test' } }));
function state(): CompanionStatus { return { configured: true, enabled: false, connected: false, hostId: 'host', relayOrigin: '', devices: [], pending: [] }; }
function button(wrapper: Pick<ReturnType<typeof mount>, 'findAll'>, text: string) { return wrapper.findAll('button').find((button) => button.text() === text)!; }
describe('desktop mobile access controls', () => {
  it('approves a pending phone with everything granted, sending only structured-cloneable data', async () => {
    const status = { ...state(), enabled: true, connected: true, pending: ['first', 'second'].map((id) => ({ id, peerId: id, name: `Phone ${id}`, expiresAt: Date.now() + 300_000 })) };
    // The desktop reaches the daemon through Electron IPC, which structured-clones arguments.
    const control = vi.fn(async (input: CompanionControl) => { structuredClone(input); return { status }; });
    const wrapper = mount(SettingsMobileSection, { props: { control } }); await flushPromises();
    const requests = wrapper.findAll('.settings-mobile__request');
    await button(requests[1], 'Approve device').trigger('click'); await flushPromises();
    expect(control).toHaveBeenCalledWith({ action: 'decide', pendingId: 'second', approve: true });
    await button(requests[0], 'Deny').trigger('click'); await flushPromises();
    expect(control).toHaveBeenCalledWith({ action: 'decide', pendingId: 'first', approve: false });
  });
  it('toggles access without pairing and creates an invitation only through Add device', async () => {
    const device = { peerId: 'saved-phone', name: 'My phone', createdAt: 1 };
    const status = { ...state(), devices: [device] };
    const control = vi.fn(async (input: CompanionControl): Promise<CompanionControlResult> => {
      if (input.action === 'resume') { status.enabled = true; status.connected = true; }
      if (input.action === 'disable') { status.enabled = false; status.connected = false; }
      return { status: { ...status }, ...(input.action === 'invite' ? { invitation: { code: 'K7QD-M2XP', expiresAt: Date.now() + 300_000 } } : {}) };
    });
    const wrapper = mount(SettingsMobileSection, { props: { control } }); await flushPromises();
    expect(wrapper.findAll('button')).toHaveLength(0);
    await wrapper.get('[role="switch"]').setValue(true); await flushPromises();
    expect(control).toHaveBeenLastCalledWith({ action: 'resume' });
    expect(wrapper.text()).toContain('My phone');
    expect(wrapper.find('img').exists()).toBe(false);
    await button(wrapper, 'Add device').trigger('click'); await flushPromises();
    expect(control).toHaveBeenCalledWith({ action: 'invite' });
    expect(wrapper.get('[data-testid="pairing-code"]').text()).toBe('K7QD-M2XP');
    expect(wrapper.find('img').exists()).toBe(true);
    await wrapper.get('[role="switch"]').setValue(false); await flushPromises();
    expect(control).toHaveBeenLastCalledWith({ action: 'disable' });
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('My phone');
    await wrapper.get('[role="switch"]').setValue(true); await flushPromises();
    expect(wrapper.text()).toContain('My phone');
    expect(control.mock.calls.filter(([input]) => input.action === 'invite')).toHaveLength(1);
    expect(wrapper.find('img').exists()).toBe(false);
    wrapper.unmount();
  });
  it('explains how to configure the relay instead of offering relay fields', async () => {
    const control = vi.fn(async () => ({ status: { ...state(), configured: false } }));
    const wrapper = mount(SettingsMobileSection, { props: { control } }); await flushPromises();
    expect(wrapper.text()).toContain('APP_COMPANION_RELAY_URL');
    expect(wrapper.find('input').exists()).toBe(false); expect(wrapper.find('button').exists()).toBe(false);
  });
  it('surfaces why an invitation could not be created', async () => {
    const control = vi.fn(async (input: CompanionControl): Promise<CompanionControlResult> => {
      if (input.action === 'invite') throw new Error('Relay is not connected.');
      return { status: { ...state(), enabled: true, connected: true } };
    });
    const wrapper = mount(SettingsMobileSection, { props: { control } }); await flushPromises();
    await button(wrapper, 'Add device').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Relay is not connected.');
  });
  it('lists paired phones and revokes one', async () => {
    const status = { ...state(), enabled: true, connected: true, devices: [{ peerId: 'old-phone', name: 'Old phone', createdAt: 1 }] };
    const control = vi.fn(async () => ({ status }));
    const wrapper = mount(SettingsMobileSection, { props: { control } }); await flushPromises();
    expect(wrapper.text()).toContain('Old phone');
    await button(wrapper, 'Revoke').trigger('click'); await flushPromises();
    expect(control).toHaveBeenCalledWith({ action: 'revoke', peerId: 'old-phone' });
  });
  it('shows connection/control failures and does not claim a grant was changed', async () => {
    const control = vi.fn().mockRejectedValue(new Error('offline'));
    const wrapper = mount(SettingsMobileSection, { props: { control } }); await flushPromises();
    expect(wrapper.text()).toContain('unavailable');
  });
});
