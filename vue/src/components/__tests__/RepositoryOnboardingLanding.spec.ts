import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import RepositoryOnboardingLanding from '../RepositoryOnboardingLanding.vue';

// Failure modes not covered by shell routing: resuming a pending grant starts a
// duplicate login; failed cancellation advances anyway; a slow provider blocks its peer.
const pending = { provider: 'gitlab' as const, userCode: 'GL-CODE', verificationUri: 'https://gitlab.com/oauth/device', expiresAt: '2099-01-01' };
function mountLanding(props: Partial<InstanceType<typeof RepositoryOnboardingLanding>['$props']> = {}) {
  return mount(RepositoryOnboardingLanding, { props: {
    connections: [], authorizations: {}, connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined), openAuthorization: vi.fn().mockResolvedValue(undefined), ...props,
  } });
}

describe('RepositoryOnboardingLanding', () => {
  it('resumes a pending grant once on remount, without starting a login for other providers', async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountLanding({ connections: [{ provider: 'gitlab', status: 'connecting' }], connect });
    await flushPromises();
    expect(connect.mock.calls).toStrictEqual([['gitlab']]);
    await wrapper.setProps({ authorizations: { gitlab: pending } });
    expect(wrapper.text()).toContain('GL-CODE');
    expect(connect).toHaveBeenCalledTimes(1);
    const open = wrapper.getComponent({ name: 'WorkAuthorizationSteps' });
    open.vm.$emit('open');
    await flushPromises();
    expect(wrapper.props('openAuthorization')).toHaveBeenCalledWith('gitlab');
  });

  it('leaves a slow GitHub login cancellable and GitLab usable, showing only the failed provider error', async () => {
    let finish!: () => void;
    const connect = vi.fn().mockImplementation(provider => provider === 'github' ? new Promise<void>(resolve => { finish = resolve; }) : Promise.reject(new Error('GitLab unavailable')));
    const wrapper = mountLanding({ connect });
    await wrapper.get('[aria-label="Connect GitHub"]').trigger('click');
    await wrapper.get('[aria-label="Connect GitLab"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[aria-label="GitLab"] [role="alert"]').text()).toContain('GitLab unavailable');
    expect(wrapper.find('[aria-label="GitHub"] [role="alert"]').exists()).toBe(false);
    finish();
    await flushPromises();
    connect.mockResolvedValue(undefined);
    await wrapper.get('[aria-label="Connect GitLab"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('shows a background polling failure at the affected provider and retries the pending grant', async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountLanding({ connections: [{ provider: 'gitlab', status: 'connecting' }, { provider: 'github', status: 'connected', accountLabel: 'alice' }], authorizations: { gitlab: pending }, authorizationErrors: { gitlab: 'GitLab is temporarily unreachable' }, connect });
    expect(wrapper.get('[aria-label="GitLab"] [role="alert"]').text()).toContain('temporarily unreachable');
    expect(wrapper.find('[aria-label="GitHub"] [role="alert"]').exists()).toBe(false);
    await wrapper.get('[aria-label="Retry GitLab authorization"]').trigger('click');
    await flushPromises();
    expect(connect.mock.calls).toStrictEqual([['gitlab']]);
    await wrapper.setProps({ authorizationErrors: {} });
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('GL-CODE');
  });

  it('cancels pending grants before Continue and stays on the step if cancellation fails', async () => {
    const disconnect = vi.fn().mockRejectedValueOnce(new Error('Cancellation unavailable')).mockResolvedValue(undefined);
    const wrapper = mountLanding({ connections: [{ provider: 'gitlab', status: 'connecting' }, { provider: 'github', status: 'connected', source: 'cli', accountLabel: 'alice' }], authorizations: { gitlab: pending }, disconnect });
    await wrapper.get('.repositories-onboarding__continue').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('continue')).toBeUndefined();
    expect(wrapper.get('[aria-label="GitLab"] [role="alert"]').text()).toContain('Cancellation unavailable');
    expect(wrapper.get('[aria-label="GitHub"]').text()).toContain('alice');
    await wrapper.get('.repositories-onboarding__continue').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('continue')).toStrictEqual([[]]);
    expect(disconnect.mock.calls).toStrictEqual([['gitlab'], ['gitlab']]);
  });
});
