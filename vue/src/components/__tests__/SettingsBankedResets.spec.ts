import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAppClient } from '../../platform-api';
import { createClientApiMock } from '../../test/client-api-mock';
import SettingsBankedResets from '../SettingsBankedResets.vue';
import type { BankedResets } from '@workspace/core/contracts/banked-resets';

const credit = { resetType: 'fiveHour', status: 'available', grantedAt: 100, expiresAt: 1_900_000_000, title: '<b>Bonus</b>', description: '<script>plain text</script>' };
const ready = (availableCount: string, credits: typeof credit[] | null): BankedResets => ({ status: 'ready', summary: { availableCount, credits, detailCount: credits?.length ?? null } });
const wrappers: ReturnType<typeof mount>[] = [];
let client: ReturnType<typeof createClientApiMock>;
let api: ReturnType<typeof createClientApiMock>['api'];
function render(props = {}) { const wrapper = mount(SettingsBankedResets, { props: { eligible: true, accountKey: 'account-a', ...props } }); wrappers.push(wrapper); return wrapper; }
function refresh(wrapper: ReturnType<typeof mount>) { return wrapper.get('button').trigger('click'); }
beforeEach(() => { client = createClientApiMock(); api = client.api; configureAppClient({ api, platform: 'desktop' }); });
afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount(); vi.useRealTimers(); });

describe('banked resets settings', () => {
  it('loads on opening, preserves authoritative counts and renders bounded details as plain text', async () => {
    let resolve!: (value: BankedResets) => void;
    api.getBankedResets.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const wrapper = render();
    expect(wrapper.text()).toContain('Loading');
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    resolve(ready('18446744073709551615', [credit])); await flushPromises();
    expect(wrapper.text()).toContain('18446744073709551615');
    expect(wrapper.text()).toContain('<b>Bonus</b>');
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('b').exists()).toBe(false);
    expect(wrapper.findAll('time')[1]!.attributes('datetime')).toBe('2030-03-17T17:46:40.000Z');
    expect(wrapper.text()).toContain('Only some');
    expect(api.getBankedResets).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(wrapper.findAll('button')).toHaveLength(1);
  });

  it.each([
    [{ status: 'ready', summary: null }, 'Unknown'],
    [ready('0', []), '0 available'],
    [ready('3', null), 'Details are unavailable'],
    [ready('3', []), 'No reset details were returned'],
    [{ status: 'signedOut' }, 'Sign in'],
    [{ status: 'unsupported' }, 'unavailable'],
  ] as const)('distinguishes read states %j', async (result, text) => {
    api.getBankedResets.mockResolvedValue(result as BankedResets);
    const wrapper = render(); await flushPromises(); expect(wrapper.text()).toContain(text);
  });

  it('keeps prior details during a failed refresh and supports retry and reopening', async () => {
    api.getBankedResets.mockResolvedValueOnce(ready('1', [credit])).mockRejectedValueOnce(new Error('private account detail'))
      .mockResolvedValueOnce(ready('0', [])).mockResolvedValueOnce(ready('2', null));
    const wrapper = render(); await flushPromises(); await refresh(wrapper); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not refresh');
    expect(wrapper.text()).toContain('<b>Bonus</b>');
    expect(wrapper.text()).not.toContain('private account detail');
    await refresh(wrapper); await flushPromises(); expect(wrapper.text()).toContain('0 available');
    wrapper.unmount(); const reopened = render(); await flushPromises(); expect(reopened.text()).toContain('2 available');
  });

  it('clears account and host data immediately and ignores stale requests', async () => {
    let resolveOld!: (value: BankedResets) => void;
    api.getBankedResets.mockResolvedValueOnce(ready('1', [credit])).mockImplementationOnce(() => new Promise(r => { resolveOld = r; }))
      .mockResolvedValueOnce(ready('2', null));
    const wrapper = render(); await flushPromises(); await refresh(wrapper);
    await wrapper.setProps({ accountKey: 'account-b', remoteConnectionId: 'remote-owner' }); await flushPromises();
    resolveOld(ready('99', [credit])); await flushPromises();
    expect(wrapper.text()).toContain('2 available'); expect(wrapper.text()).not.toContain('Bonus');
    expect(api.getBankedResets).toHaveBeenLastCalledWith('remote-owner');
    await wrapper.setProps({ eligible: false }); await flushPromises();
    expect(wrapper.text()).toContain('Sign in'); expect(wrapper.text()).not.toContain('2 available');
  });

  it('retains details on sparse quota events and invalidates them across connection and account events', async () => {
    api.getBankedResets.mockResolvedValueOnce(ready('1', [credit])).mockResolvedValueOnce(ready('2', null)).mockResolvedValueOnce(ready('0', []));
    const wrapper = render(); await flushPromises();
    client.emit({ seq: 1, type: 'account.rateLimitsUpdated', backend: 'codex', occurredAt: '', payload: { rateLimits: { limitId: null, limitName: null, primary: null, secondary: null, credits: null, individualLimit: null, planType: null, rateLimitReachedType: null } } });
    await flushPromises(); expect(wrapper.text()).toContain('Bonus'); expect(api.getBankedResets).toHaveBeenCalledOnce();
    client.emit({ seq: 2, type: 'client.connectionChanged', occurredAt: '', payload: { status: 'reconnecting' } });
    await flushPromises(); expect(wrapper.text()).not.toContain('Bonus'); expect(wrapper.text()).toContain('Reconnect');
    client.emit({ seq: 3, type: 'client.connectionChanged', occurredAt: '', payload: { status: 'connected' } });
    await flushPromises(); expect(wrapper.text()).toContain('2 available');
    client.emit({ seq: 4, type: 'provider.authenticationChanged', occurredAt: '', payload: { kind: 'codex', connected: true, state: { account: { type: 'chatgpt', email: 'new@example.test', planType: 'plus' }, requiresOpenaiAuth: true, login: { status: 'idle', error: null } } } });
    await flushPromises(); expect(wrapper.text()).toContain('0 available');
  });

  it('bounds hung reads, allows retry and ignores completion after timeout or disposal', async () => {
    vi.useFakeTimers();
    let resolveOld!: (value: BankedResets) => void;
    api.getBankedResets.mockImplementationOnce(() => new Promise(r => { resolveOld = r; })).mockResolvedValueOnce(ready('0', []));
    const wrapper = render(); await vi.advanceTimersByTimeAsync(20_000);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    await refresh(wrapper); await flushPromises(); resolveOld(ready('99', [credit])); await flushPromises();
    expect(wrapper.text()).toContain('0 available'); wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
