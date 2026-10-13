import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElMessageBox } from 'element-plus';
import { configureAppClient } from '../../platform-api';
import { createClientApiMock } from '../../test/client-api-mock';
import SettingsBankedResets from '../SettingsBankedResets.vue';
import type { BankedResets, BankedResetDetail } from '@workspace/core/contracts/banked-resets';

const credit = { resetType: 'fiveHour', status: 'available', grantedAt: 100, expiresAt: 1_900_000_000, title: '<b>Bonus</b>', description: '<script>plain text</script>' };
const ready = (availableCount: string, credits: BankedResetDetail[] | null): BankedResets => ({ status: 'ready', summary: { availableCount, credits, detailCount: credits?.length ?? null } });
const wrappers: ReturnType<typeof mount>[] = [];
let client: ReturnType<typeof createClientApiMock>;
let api: ReturnType<typeof createClientApiMock>['api'];
function render(props = {}) { const wrapper = mount(SettingsBankedResets, { props: { eligible: true, accountKey: 'account-a', ...props } }); wrappers.push(wrapper); return wrapper; }
function refresh(wrapper: ReturnType<typeof mount>) { return wrapper.get('button').trigger('click'); }
beforeEach(() => { client = createClientApiMock(); api = client.api; configureAppClient({ api, platform: 'desktop' }); });
afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount(); vi.useRealTimers(); vi.restoreAllMocks(); client.dispose(); });

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
    expect(wrapper.text()).not.toContain('plain text');
    expect(wrapper.text()).not.toContain('fiveHour');
    expect(wrapper.text()).not.toContain('Granted');
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('b').exists()).toBe(false);
    expect(wrapper.findAll('time')[0]!.attributes('datetime')).toBe('2030-03-17T17:46:40.000Z');
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

  it.each([
    [{ hasCredits: true, unlimited: false, balance: '62500' }, '62,500 credits remaining'],
    [{ hasCredits: true, unlimited: false, balance: '62500.0000000000' }, '62,500 credits remaining'],
    [{ hasCredits: true, unlimited: false, balance: '62500.2500000000' }, '62,500.25 credits remaining'],
    [{ hasCredits: true, unlimited: false, balance: '9007199254740993.25' }, '9,007,199,254,740,993.25 credits remaining'],
    [{ hasCredits: false, unlimited: false, balance: '0' }, '0 credits remaining'],
    [{ hasCredits: true, unlimited: true, balance: null }, 'Unlimited credits'],
    [null, 'Unknown'],
  ])('displays read-only account credits without converting the balance to a number', async (accountCredits, text) => {
    api.getBankedResets.mockResolvedValue({ status: 'ready', summary: null, accountCredits });
    const wrapper = render(); await flushPromises();
    const section = wrapper.get('[aria-labelledby="settings-codex-credits-title"]');
    expect(section.text()).toContain(text); expect(section.findAll('button')).toHaveLength(0); expect(section.findAll('input')).toHaveLength(0);
  });

  it('places credits below resets and shows Unknown during initial loading and refresh', async () => {
    let resolve!: (value: BankedResets) => void;
    api.getBankedResets.mockImplementation(() => new Promise(r => { resolve = r; }));
    const wrapper = render();
    const credits = wrapper.get('[aria-labelledby="settings-codex-credits-title"]');
    expect(wrapper.findAll('section').map(section => section.attributes('aria-labelledby'))).toStrictEqual(['settings-banked-resets-title', 'settings-codex-credits-title']);
    expect(credits.get('.form-row__copy strong').text()).toBe('Unknown');
    const state: BankedResets = { status: 'ready', summary: null, accountCredits: { hasCredits: true, unlimited: false, balance: '62500.0000000000' } };
    resolve(state); await flushPromises(); expect(credits.text()).toContain('62,500 credits remaining');
    await refresh(wrapper); expect(credits.text()).toContain('Unknown'); expect(credits.text()).not.toContain('62,500'); expect(credits.text()).not.toContain('Loading');
    resolve(state); await flushPromises(); expect(credits.text()).toContain('62,500 credits remaining');
  });

  it('requires confirmation, retains one key after an uncertain response and re-reads after idempotent success', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValue('confirm' as never);
    api.getBankedResets.mockResolvedValueOnce(ready('3', [{ ...credit, redemptionToken: 'selection' }])).mockResolvedValueOnce(ready('2', []));
    api.useBankedReset.mockRejectedValueOnce(new Error('private provider details')).mockResolvedValueOnce({ outcome: 'alreadyRedeemed' });
    const wrapper = render({ remoteConnectionId: 'owner' }); await flushPromises();
    const use = () => wrapper.findAll('button').find(button => button.text() === 'Use reset')!.trigger('click');
    await use(); await flushPromises(); expect(api.useBankedReset).not.toHaveBeenCalled();
    await use(); await flushPromises();
    expect(wrapper.text()).toContain('Could not confirm'); expect(wrapper.text()).not.toContain('private provider details');
    expect(api.getBankedResets).toHaveBeenCalledOnce();
    await use(); await flushPromises();
    const first = api.useBankedReset.mock.calls[0]!;
    expect(first).toStrictEqual([{ redemptionToken: 'selection', confirmed: true, idempotencyKey: expect.any(String) }, 'owner']);
    expect(api.useBankedReset.mock.calls[1]).toStrictEqual(first);
    expect(confirm).toHaveBeenCalledTimes(3); expect(api.getBankedResets).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('already used'); expect(wrapper.text()).toContain('2 available');
  });

  it.each([
    ['reset', 'Reset used.'], ['nothingToReset', 'no eligible usage limits'], ['noCredit', 'No banked resets'],
  ] as const)('refreshes authoritative state after %s instead of decrementing the count locally', async (outcome, text) => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    api.getBankedResets.mockResolvedValueOnce(ready('3', [{ ...credit, redemptionToken: 'selection' }])).mockResolvedValueOnce(ready('7', null));
    api.useBankedReset.mockResolvedValue({ outcome });
    const wrapper = render(); await flushPromises();
    await wrapper.findAll('button').find(button => button.text() === 'Use reset')!.trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain(text); expect(wrapper.text()).toContain('7 available'); expect(api.useBankedReset).toHaveBeenCalledOnce();
  });

  it('rejects a confirmation from a previous account or host before sending any redemption', async () => {
    let confirm!: (value: never) => void;
    vi.spyOn(ElMessageBox, 'confirm').mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
    api.getBankedResets.mockResolvedValueOnce(ready('1', [{ ...credit, redemptionToken: 'old-selection' }])).mockResolvedValueOnce(ready('2', null));
    const wrapper = render(); await flushPromises();
    await wrapper.findAll('button').find(button => button.text() === 'Use reset')!.trigger('click'); await flushPromises();
    await wrapper.setProps({ accountKey: 'account-b', remoteConnectionId: 'new-owner' }); await flushPromises();
    confirm('confirm' as never); await flushPromises();
    expect(api.useBankedReset).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('2 available');
  });

  it('bounds uncertain redemption, blocks concurrent actions, retries the same attempt and cleans up on disposal', async () => {
    vi.useFakeTimers(); vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    api.getBankedResets.mockResolvedValue(ready('1', [{ ...credit, redemptionToken: 'selection' }]));
    api.useBankedReset.mockImplementation(() => new Promise(() => {}));
    const wrapper = render(); await flushPromises();
    const use = () => wrapper.findAll('button').find(button => button.text() === 'Use reset')!.trigger('click');
    await use(); await flushPromises(); expect(wrapper.findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true);
    await vi.advanceTimersByTimeAsync(20_000); expect(wrapper.text()).toContain('Could not confirm');
    await use(); await flushPromises(); expect(api.useBankedReset.mock.calls[1]).toStrictEqual(api.useBankedReset.mock.calls[0]);
    wrapper.unmount(); await flushPromises(); expect(vi.getTimerCount()).toBe(0);
  });
});
