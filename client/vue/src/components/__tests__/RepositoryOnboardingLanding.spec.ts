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

const buttonType = (wrapper: ReturnType<typeof mountLanding>, text: string) =>
  wrapper.findAllComponents({ name: 'ElButton' }).find(button => button.text() === text)?.props('type');

describe('RepositoryOnboardingLanding', () => {
  it('lists GitHub first and gives GitLab the same primary connect action', () => {
    const wrapper = mountLanding();
    expect(wrapper.findAll('.repositories-onboarding__provider').map(section => section.attributes('aria-label'))).toStrictEqual(['GitHub', 'GitLab']);
    expect(buttonType(wrapper, 'Connect GitHub')).toBe('primary');
    expect(buttonType(wrapper, 'Connect GitLab')).toBe('primary');
    expect(wrapper.get('.repositories-onboarding__continue').text()).toBe('Skip for now');
    expect(buttonType(wrapper, 'Skip for now')).not.toBe('primary');
  });

  it('explains what connecting does when no CLI is detected and drops the text once connected', () => {
    const wrapper = mountLanding({ connections: [{ provider: 'github', status: 'connected', source: 'cli', accountLabel: 'alice' }, { provider: 'gitlab', status: 'disconnected' }] });
    expect(wrapper.get('[aria-label="GitLab"]').text()).toContain('Sign in to GitLab to bring your repositories into');
    expect(wrapper.get('[aria-label="GitHub"]').text()).not.toContain('Sign in to');
  });

  it('flags a CLI connection with a warning badge and the direct-connection hint, without the username', () => {
    const wrapper = mountLanding({ connections: [
      { provider: 'github', status: 'connected', source: 'cli', accountLabel: 'alice' },
      { provider: 'gitlab', status: 'connected', source: 'api', accountLabel: 'bob' },
    ] });
    const github = wrapper.get('[aria-label="GitHub"]');
    expect(github.getComponent({ name: 'StatusPill' }).props('tone')).toBe('warning');
    expect(github.text()).toContain('Using GitHub CLI');
    expect(github.text()).not.toContain('Connected');
    expect(github.text()).toContain('detected an authenticated GitHub CLI. Connect');
    expect(github.text()).toContain('directly for faster GitHub access.');
    expect(github.text()).not.toContain('alice');
    const gitlab = wrapper.get('[aria-label="GitLab"]');
    expect(gitlab.getComponent({ name: 'StatusPill' }).props('tone')).toBe('success');
    expect(gitlab.text()).toContain('Connected');
    expect(gitlab.text()).not.toContain('bob');
    expect(gitlab.text()).not.toContain('detected an authenticated');
    expect(gitlab.text()).toContain('GitLab is connected.');
    expect(gitlab.text()).toContain('can now browse your repositories and pick up your work items.');
    expect(github.text()).not.toContain('is connected.');
  });

  it.each(['github', 'gitlab'] as const)('promotes Continue once %s is connected directly', provider => {
    const wrapper = mountLanding({ connections: [{ provider, status: 'connected', source: 'api', accountLabel: 'alice' }] });
    expect(wrapper.find(`[aria-label="Connect ${provider === 'github' ? 'GitHub' : 'GitLab'}"]`).exists()).toBe(false);
    expect(wrapper.get('.repositories-onboarding__continue').text()).toBe('Continue');
    expect(buttonType(wrapper, 'Continue')).toBe('primary');
  });

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

  it('asks for the MCP grant with GitLab but keeps GitHub a plain connection', async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountLanding({ connect });
    await wrapper.get('[aria-label="Connect GitHub"]').trigger('click');
    await wrapper.get('[aria-label="Connect GitLab"]').trigger('click');
    await flushPromises();
    expect(connect.mock.calls).toStrictEqual([['github'], ['gitlab']]);
  });

  it('shows only the provider being authorized, without Continue, until it is cancelled', async () => {
    const wrapper = mountLanding({ connections: [{ provider: 'github', status: 'connected', source: 'cli' }, { provider: 'gitlab', status: 'connecting' }], authorizations: { gitlab: pending } });
    expect(wrapper.findAll('.repositories-onboarding__provider').map(section => section.attributes('aria-label'))).toStrictEqual(['GitLab']);
    expect(wrapper.find('.repositories-onboarding__continue').exists()).toBe(false);
    expect(wrapper.find('.repositories-onboarding__hint').exists()).toBe(false);
    await wrapper.get('[aria-label="Cancel GitLab authorization"]').trigger('click');
    await flushPromises();
    expect(wrapper.props('disconnect')).toHaveBeenCalledWith('gitlab');
    await wrapper.setProps({ connections: [{ provider: 'github', status: 'connected', source: 'cli' }, { provider: 'gitlab', status: 'disconnected' }], authorizations: {} });
    expect(wrapper.findAll('.repositories-onboarding__provider')).toHaveLength(2);
    await wrapper.get('.repositories-onboarding__continue').trigger('click');
    expect(wrapper.emitted('continue')).toStrictEqual([[]]);
  });
});
