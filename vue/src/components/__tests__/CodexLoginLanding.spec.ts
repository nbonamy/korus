import { product } from '@workspace/core/product';
import { mount } from '@vue/test-utils';
import { ElButton } from 'element-plus';
import { describe, expect, it, vi } from 'vitest';
import CodexLoginLanding from '../CodexLoginLanding.vue';

function mountLanding(props: InstanceType<typeof CodexLoginLanding>['$props'] = {}) {
  return mount(CodexLoginLanding, {
    props,
    attachTo: document.body,
    global: { components: { ElButton } },
  });
}

describe('CodexLoginLanding', () => {
  it('hides unreleased setup and ignores stale connection state when continuing', () => {
    const wrapper = mountLanding({ providerSetup: [], antigravityConnected: true });
    expect(wrapper.text()).not.toContain('Antigravity');
    expect(wrapper.get('.codex-login__continue').attributes('disabled')).toBeDefined();
  });
  it('offers native Antigravity sign-in and can continue with it as the only connected engine', async () => {
    const wrapper = mountLanding({ antigravityConnected: false, providerSetup: [
      { backend: 'antigravity', installed: true, isolated: true, shareSkills: false, homePath: '/app/acp', locked: false },
    ] });
    await wrapper.findAll('button').find(button => button.text() === 'Connect Antigravity')!.trigger('click');
    expect(wrapper.emitted('connect-antigravity')).toEqual([[]]);
    await wrapper.setProps({ antigravityPending: true });
    await wrapper.findAll('button').find(button => button.text() === 'Cancel sign-in')!.trigger('click');
    expect(wrapper.emitted('cancel-antigravity')).toEqual([[]]);
    await wrapper.setProps({ antigravityPending: false, antigravityConnected: true });
    expect(wrapper.get('.codex-login__continue').attributes('disabled')).toBeUndefined();
    await wrapper.get('.codex-login__continue').trigger('click');
    expect(wrapper.emitted('continue')).toEqual([[]]);
  });
  it('offers official Install links for missing CLIs and rechecks without starting login', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const wrapper = mountLanding({ providerSetup: (['codex', 'claude', 'antigravity'] as const).map(backend => ({
      backend, installed: false, isolated: true, shareSkills: true, homePath: '/home', locked: false,
    })) });
    expect(wrapper.findAll('a').map(link => [link.text(), link.attributes('href')])).toEqual([
      ['Install', 'https://learn.chatgpt.com/docs/codex/cli#getting-started'],
      ['Install', 'https://code.claude.com/docs/en/quickstart#step-1-install-claude-code'],
    ]);
    expect(wrapper.findAll('.codex-login__provider .el-button').every(button => button.attributes('disabled') !== undefined)).toBe(true);
    for (const link of wrapper.findAll('a')) {
      await link.trigger('click');
      expect(open).toHaveBeenLastCalledWith(link.attributes('href'), '_blank', 'noopener,noreferrer');
    }
    const refresh = wrapper.get('button[aria-label="Check again"]');
    expect(refresh.text()).toBe('');
    expect(refresh.find('[aria-hidden="true"] svg').exists()).toBe(true);
    expect(refresh.attributes('title')).toBe('Check again');
    await refresh.trigger('click');
    expect(wrapper.emitted('refresh-provider')).toEqual([['codex']]);
    expect(wrapper.emitted('login')).toBeUndefined();
    expect(wrapper.emitted('connect-claude')).toBeUndefined();
    await wrapper.findAll('button[aria-label="Check again"]')[2]!.trigger('click');
    expect(wrapper.emitted('refresh-provider')).toEqual([['codex'], ['antigravity']]);
    expect(wrapper.emitted('connect-antigravity')).toBeUndefined();
    await wrapper.setProps({ updatingProvider: 'codex' });
    expect(wrapper.findAll('.provider-install-actions .is-loading')).toHaveLength(1);
    expect(wrapper.findAll('.provider-install-actions')[0]!.find('.is-loading').exists()).toBe(true);
    expect(wrapper.find('.codex-login__checking').exists()).toBe(false);
    expect(wrapper.findAll('.provider-install-actions button').every(button => button.attributes('disabled') !== undefined)).toBe(true);
    await wrapper.setProps({ updatingProvider: null });
    expect(wrapper.find('.provider-install-actions .is-loading').exists()).toBe(false);
    wrapper.unmount();
    open.mockRestore();
  });
  it('offers independent customization and does not treat CLI detection as a connection', async () => {
    const wrapper = mountLanding({ providerSetup: [
      { backend: 'codex', installed: true, isolated: true, shareSkills: true, homePath: '/app/codex-home', locked: false },
      { backend: 'claude', installed: false, isolated: true, shareSkills: true, homePath: '/app/claude-home', locked: false },
    ] });
    const providers = wrapper.findAll('.codex-login__provider');
    expect(providers[0]!.text()).toContain('Detected');
    expect(providers[1]!.text()).not.toContain('Detected');
    expect(providers[1]!.text()).not.toContain('Customize');
    expect(wrapper.get('.codex-login__continue').attributes('disabled')).toBeDefined();
    const actionStyle = (element: Element) => {
      const style = getComputedStyle(element);
      return ['color', 'font-size', 'font-weight', 'line-height', 'padding', 'text-decoration'].map(property => style.getPropertyValue(property));
    };
    const customize = providers[0]!.get('.codex-login__detection button');
    expect(actionStyle(providers[1]!.get('a').element)).toEqual(actionStyle(customize.element));
    expect(actionStyle(providers[1]!.get('.provider-install-actions button').element)).toEqual(actionStyle(customize.element));
    expect(getComputedStyle(providers[1]!.get('a').element).textDecoration).toBe('none');
    await wrapper.setProps({ providerSetup: wrapper.props('providerSetup')!.map(setup => ({ ...setup, installed: true })) });
    await providers[1]!.get('.codex-login__detection button').trigger('click');
    expect(wrapper.emitted('customize')).toStrictEqual([['claude']]);
    await wrapper.setProps({ codexConnected: true, claudeConnected: true, antigravityConnected: true });
    for (const provider of providers) {
      expect(provider.get('.codex-login__detection span').text()).toBe('Connected');
      expect(provider.text()).not.toContain('Detected');
    }
    await wrapper.setProps({ codexConnected: false });
    expect(providers[0]!.get('.codex-login__detection span').text()).toBe('Detected');
  });
  it('starts ChatGPT sign in from the actionable onboarding screen', async () => {
    const wrapper = mountLanding();

    expect(wrapper.classes()).toContain('codex-login--sign-in');
    expect(wrapper.get('h1').text()).toContain(`${product.name},`);
    expect(wrapper.get('h1').text()).toContain('a home for your coding agents.');
    expect(wrapper.get('h1').find('br').exists()).toBe(true);
    expect(wrapper.get('.codex-login__mark img').attributes('alt')).toBe(`${product.name}`);
    expect(wrapper.get('.codex-login__continue').attributes('disabled')).toBeDefined();
    await wrapper.get('.codex-login__providers .el-button').trigger('click');
    expect(wrapper.emitted('login')).toStrictEqual([[]]);
  });

  it('renders initial authentication discovery as passive standalone progress', () => {
    const wrapper = mountLanding({ variant: 'connecting' });

    expect(wrapper.classes()).toContain('codex-login--connecting');
    expect(wrapper.get('h1').text()).toBe('Getting your workspace ready.');
    expect(wrapper.get('[role="progressbar"]').attributes('aria-label')).toBe('Checking your connections…');
    expect(wrapper.get('[role="status"]').text()).toBe('Checking your connections…');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('shows pending sign-in and errors on the actionable screen', () => {
    const wrapper = mountLanding({ loading: true, error: 'Login failed' });

    expect(wrapper.get('[role="alert"]').text()).toBe('Login failed');
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
  });

  it.each([
    { backend: 'codex', index: 0, pending: { updatingProvider: 'codex' as const } },
    { backend: 'claude', index: 1, pending: { updatingProvider: 'claude' as const } },
    { backend: 'claude', index: 1, pending: { claudeLoading: true } },
  ])('keeps $backend checking feedback below the button for $pending', async ({ backend, index, pending }) => {
    const wrapper = mountLanding({ providerSetup: (['codex', 'claude'] as const).map(backend => ({
      backend, installed: true, isolated: true, shareSkills: true, homePath: '/home', locked: false,
    })) });
    const provider = wrapper.findAll('.codex-login__provider')[index]!;
    expect(provider.get('.codex-login__detection button').text()).toBe('Customize');

    await wrapper.setProps(pending);

    const button = provider.get('.el-button');
    expect.soft(button.classes()).not.toContain('is-loading');
    expect(button.attributes('disabled')).toBeDefined();
    const status = provider.get('.codex-login__detection');
    expect.soft(status.find('button').exists()).toBe(false);
    expect(status.get('[role="status"]').attributes('aria-busy')).toBe('true');
    expect(status.get('[role="status"]').text()).toBe('Checking…');
    expect(status.find('.codex-login__spinner').exists()).toBe(true);

    await wrapper.setProps({ updatingProvider: null, claudeLoading: false });

    expect(status.find('[aria-busy="true"]').exists()).toBe(false);
    await status.get('button').trigger('click');
    expect(wrapper.emitted('customize')).toStrictEqual([[backend]]);
  });

  it('offers cancellation while Codex sign-in is pending without hiding Claude', async () => {
    const wrapper = mountLanding({ cancellable: false, providerSetup: [
      { backend: 'codex', installed: true, isolated: true, shareSkills: true, homePath: '/app/codex-home', locked: false },
    ] });

    expect(wrapper.find('.codex-login__cancel').exists()).toBe(false);

    await wrapper.setProps({ cancellable: true, loading: true });

    expect(wrapper.text()).toContain('Connect Claude Code');
    const codexStatus = wrapper.get('.codex-login__provider .codex-login__detection');
    const cancel = codexStatus.get('.codex-login__cancel');
    expect(cancel.find('.codex-login__spinner').exists()).toBe(true);
    expect(wrapper.get('.codex-login__providers .el-button').classes()).not.toContain('is-loading');
    expect(codexStatus.text()).not.toContain('Detected');
    expect(codexStatus.text()).not.toContain('Customize');
    await cancel.trigger('click');
    expect(wrapper.emitted('cancel')).toStrictEqual([[]]);
    await wrapper.setProps({ cancellable: false });
    expect(codexStatus.text()).toContain('Detected');
    expect(codexStatus.text()).toContain('Customize');
  });

  it.each([
    { codexConnected: true, claudeConnected: false },
    { codexConnected: false, claudeConnected: true },
    { codexConnected: true, claudeConnected: true },
  ])('allows explicit continuation with connected providers %j', async (props) => {
    const wrapper = mountLanding(props);
    expect(wrapper.get('.codex-login__continue').attributes('disabled')).toBeUndefined();
    expect(wrapper.emitted('continue')).toBeUndefined();
    await wrapper.get('.codex-login__continue').trigger('click');
    expect(wrapper.emitted('continue')).toStrictEqual([[]]);
  });
});
