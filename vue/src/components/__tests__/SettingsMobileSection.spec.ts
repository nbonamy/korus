import { mount, flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { CompanionControl, CompanionControlResult, CompanionStatus } from '@workspace/core/companion-protocol';
import SettingsMobileSection from '../SettingsMobileSection.vue';
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,test' } }));
function state(): CompanionStatus { return { enabled: false, connected: false, hostId: 'host', relayOrigin: '', devices: [], pending: [] }; }
const teams = [{ id: 'team', name: 'Allowed team', agentIds: [] }];
function button(wrapper: ReturnType<typeof mount>, text: string) { return wrapper.findAll('button').find((button) => button.text() === text)!; }
describe('desktop mobile access controls', () => {
  it('keeps read/send approval choices separate for concurrent pairing requests', async () => {
    const status = { ...state(), enabled: true, connected: true, pending: ['first', 'second'].map((id) => ({ id, peerId: id, name: id, expiresAt: Date.now() + 300_000 })) };
    const control = vi.fn(async () => ({ status }));
    const wrapper = mount(SettingsMobileSection, { props: { control, teams } }); await flushPromises();
    const devices = wrapper.findAll('article');
    await devices[0].findAll('input')[0].setValue(true); await devices[0].findAll('input')[1].setValue(true);
    expect(devices[1].findAll('button')[0].attributes('disabled')).toBeDefined();
    await devices[1].findAll('input')[0].setValue(true); await devices[1].findAll('button')[0].trigger('click'); await flushPromises();
    expect(control).toHaveBeenCalledWith({ action: 'decide', pendingId: 'second', approve: true, teamIds: ['team'], canSend: false });
  });
  it('requires explicit custom relay trust before enabling, and displays a short-lived pairing QR', async () => {
    const status = state();
    const control = vi.fn(async (input: CompanionControl): Promise<CompanionControlResult> => {
      if (input.action === 'enable') { status.enabled = true; status.connected = true; }
      return { status: { ...status }, ...(input.action === 'invite' ? { invitation: { v: 1 as const, relayOrigin: 'wss://relay.example', relayPeerId: 'relay', hostId: 'host', hostPublicKey: 'public', inviteId: 'invite', inviteSecret: 'short-lived', expiresAt: Date.now() + 300_000 } } : {}) };
    });
    const wrapper = mount(SettingsMobileSection, { props: { control, teams } }); await flushPromises();
    expect(button(wrapper, 'Enable mobile access').attributes('disabled')).toBeDefined();
    const fields = wrapper.findAll('input:not([type="checkbox"])');
    await fields[0].setValue('wss://relay.example'); await fields[1].setValue('relay-peer');
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await button(wrapper, 'Enable mobile access').trigger('click'); await flushPromises();
    expect(control).toHaveBeenCalledWith({ action: 'enable', relayOrigin: 'wss://relay.example', relayPeerId: 'relay-peer' });
    await button(wrapper, 'Pair phone').trigger('click'); await flushPromises();
    expect(wrapper.get('img').attributes('alt')).toBe('Phone pairing invitation');
    await button(wrapper, 'Disable mobile access').trigger('click'); await flushPromises();
    expect(wrapper.find('img').exists()).toBe(false); expect(control).toHaveBeenCalledWith({ action: 'disable' });
  });
  it('requires a team scope, defaults to read only, and sends explicit approval/revocation', async () => {
    const status = { ...state(), enabled: true, connected: true,
      pending: [{ id: 'pending', peerId: 'phone-key', name: 'My phone', expiresAt: Date.now() + 300_000 }],
      devices: [{ peerId: 'old-phone', name: 'Old phone', teamIds: ['team'], canSend: true, createdAt: 1 }] };
    const control = vi.fn(async () => ({ status }));
    const wrapper = mount(SettingsMobileSection, { props: { control, teams } }); await flushPromises();
    expect(wrapper.text()).toContain('phone-key'); expect(button(wrapper, 'Approve device').attributes('disabled')).toBeDefined();
    await wrapper.findAll('input[type="checkbox"]')[0].setValue(true);
    await button(wrapper, 'Approve device').trigger('click'); await flushPromises();
    expect(control).toHaveBeenCalledWith({ action: 'decide', pendingId: 'pending', approve: true, teamIds: ['team'], canSend: false });
    await button(wrapper, 'Revoke').trigger('click'); await flushPromises();
    expect(control).toHaveBeenCalledWith({ action: 'revoke', peerId: 'old-phone' });
  });
  it('shows connection/control failures and does not claim a grant was changed', async () => {
    const control = vi.fn().mockRejectedValue(new Error('offline'));
    const wrapper = mount(SettingsMobileSection, { props: { control, teams } }); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('unavailable');
  });
});
