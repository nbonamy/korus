import { product } from '@workspace/core/product';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import SettingsIntegrationsPanel from '../SettingsIntegrationsPanel.vue';

describe('SettingsIntegrationsPanel', () => {
  it('shows independent CLI accounts and offers direct GitLab login without logging out glab', async () => {
    const wrapper = mountPanel({ connections: [
      { provider: 'github', source: 'cli', status: 'connected', accountLabel: 'gh-user' },
      { provider: 'gitlab', source: 'cli', status: 'connected', accountLabel: 'gl-user' },
    ] });
    const row = wrapper.findAll('article').find(row => row.text().includes('GitLab'))!;
    expect(row.text()).toContain('Using GitLab CLI');
    expect(row.text()).toContain('gl-user');
    expect(row.find('[aria-label="Disconnect GitLab"]').exists()).toBe(false);
    await row.get('[aria-label="Connect GitLab"]').trigger('click');
    expect(wrapper.emitted('connect')).toStrictEqual([['gitlab']]);
    expect(wrapper.find('[aria-label="Connect GitHub"]').exists()).toBe(true);
    await wrapper.setProps({ connections: [{ provider: 'gitlab', source: 'cli', status: 'connecting', accountLabel: 'gl-user' }] });
    expect(wrapper.find('[aria-label="Cancel GitLab authorization"]').exists()).toBe(true);
    await wrapper.setProps({ connections: [{ provider: 'gitlab', source: 'cli', status: 'error', accountLabel: 'gl-user', detail: 'GitLab CLI authentication changed' }] });
    expect(wrapper.text()).toContain('authentication changed');
    await wrapper.get('[aria-label="Reconnect GitLab CLI"]').trigger('click');
    expect(wrapper.emitted('disconnect')).toStrictEqual([['gitlab']]);
    wrapper.unmount();
  });
  // Settings owns provider-specific actions: simultaneous codes/accounts/errors must
  // stay in their own rows while the other provider remains usable.
  it('keeps GitLab device authorization, account, errors and actions separate from GitHub', async () => {
    const wrapper = mountPanel({ connections: [{ provider: 'github', source: 'api', status: 'connected', accountLabel: 'github-user' }] });
    await wrapper.get('[aria-label="Connect GitLab"]').trigger('click');
    expect(wrapper.emitted('connect')).toStrictEqual([['gitlab']]);
    await wrapper.setProps({ connections: [
      { provider: 'github', source: 'api', status: 'connected', accountLabel: 'github-user' },
      { provider: 'gitlab', source: 'api', status: 'connecting' },
    ], authorizations: { gitlab: { provider: 'gitlab', userCode: 'GL-CODE', verificationUri: 'https://gitlab.com/oauth/device', expiresAt: '2026-12-01' } } });
    const gitlab = wrapper.findAll('.form-section').find(row => row.text().includes('GitLab'))!;
    expect(gitlab.text()).toContain('GL-CODE');
    expect(gitlab.text()).not.toContain('github-user');
    expect(wrapper.find('svg.gitlab-icon').exists()).toBe(true);
    await gitlab.findAll('button').find(button => button.text() === 'Open GitLab')!.trigger('click');
    expect(wrapper.emitted('open-authorization')).toStrictEqual([['gitlab']]);
    await wrapper.get('[aria-label="Cancel GitLab authorization"]').trigger('click');
    expect(wrapper.emitted('disconnect')).toStrictEqual([['gitlab']]);
    await wrapper.setProps({ connections: [
      { provider: 'github', status: 'connected', accountLabel: 'github-user' },
      { provider: 'gitlab', status: 'notConfigured', detail: { key: 'gitlabIntegration.setup' } },
    ] });
    expect(wrapper.text()).toContain('APP_GITLAB_CLIENT_ID');
    expect(wrapper.find('[aria-label="Disconnect GitHub"]').exists()).toBe(true);
    await wrapper.setProps({ connections: [
      { provider: 'github', status: 'connected', accountLabel: 'github-user' },
      { provider: 'gitlab', status: 'connected', accountLabel: 'gitlab-user' },
    ] });
    await wrapper.get('[aria-label="Disconnect GitLab"]').trigger('click');
    expect(wrapper.emitted('disconnect')).toStrictEqual([['gitlab'], ['gitlab']]);
    wrapper.unmount();
  });

  it('requests GitLab MCP explicitly and keeps native API and peer connections visible', async () => {
    const wrapper = mountPanel({ connections: [
      { provider: 'github', status: 'connected', accountLabel: 'github-user' },
      { provider: 'gitlab', status: 'connected', source: 'api', accountLabel: 'gitlab-user', hostedMcp: { status: 'authorizationRequired' } },
    ] });
    expect(wrapper.text()).toContain('GitLab MCP');
    await wrapper.get('[aria-label="Authorize GitLab MCP"]').trigger('click');
    expect(wrapper.emitted('connect-mcp')).toStrictEqual([['gitlab']]);
    expect(wrapper.find('[aria-label="Disconnect GitHub"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Disconnect GitLab"]').exists()).toBe(true);
    await wrapper.setProps({ connections: [{ provider: 'gitlab', status: 'connected', source: 'api', accountLabel: 'gitlab-user', hostedMcp: { status: 'restricted' } }] });
    expect(wrapper.text()).toContain('top-level group');
    expect(wrapper.find('[aria-label="Retry GitLab MCP"]').exists()).toBe(true);
    await wrapper.setProps({ connections: [{ provider: 'gitlab', status: 'connected', source: 'cli', accountLabel: 'cli-user', hostedMcp: { status: 'directRequired' } }] });
    expect(wrapper.text()).toContain('Connect directly');
    expect(wrapper.find('[aria-label="Authorize GitLab MCP"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('connects Linear using app configuration without showing or saving OAuth fields', async () => {
    const updateSettings = vi.fn();
    const wrapper = mountPanel({ updateSettings });
    expect(wrapper.find('input').exists()).toBe(false);
    await wrapper.get('[aria-label="Connect Linear"]').trigger('click');
    await flushPromises();
    expect(updateSettings).not.toHaveBeenCalled();
    expect(wrapper.emitted('connect')).toEqual([['linear']]);
  });

  it('keeps Linear authorization in one row and allows canceling and connecting again', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountPanel({ connections: [{ provider: 'github', status: 'connected', accountLabel: 'GitHub user' }], updateSettings });
    expect(wrapper.text()).toContain('Linear');
    await wrapper.get('[aria-label="Connect Linear"]').trigger('click');
    await flushPromises();
    expect(updateSettings).not.toHaveBeenCalled();
    expect(wrapper.emitted('connect')).toEqual([['linear']]);
    await wrapper.setProps({ connections: [{ provider: 'linear', status: 'connecting' }], authorization: { provider: 'linear', flow: 'browser', verificationUri: 'https://linear.app/oauth/authorize', expiresAt: '2026-10-04T00:00:00Z' } });
    expect(wrapper.findAll('article')).toHaveLength(3);
    expect(wrapper.text()).toContain('Waiting for authorization');
    expect(wrapper.find('[aria-label="Open Linear authorization"]').exists()).toBe(false);
    await wrapper.get('[aria-label="Cancel Linear authorization"]').trigger('click');
    expect(wrapper.emitted('disconnect')).toEqual([['linear']]);
    await wrapper.setProps({ connections: [{ provider: 'linear', status: 'disconnected' }], authorization: null });
    await wrapper.get('[aria-label="Connect Linear"]').trigger('click');
    expect(wrapper.emitted('connect')).toEqual([['linear'], ['linear']]);
    await wrapper.setProps({ connections: [{ provider: 'linear', status: 'connected', accountLabel: 'Alex · Example' }] });
    const linearRow = wrapper.findAll('article').find(row => row.text().includes('Linear'))!;
    expect(linearRow.text()).toContain('Signed in as Alex · Example');
    expect(linearRow.get('.settings-integrations-panel__actions').text()).toBe('ConnectedDisconnect');
    await wrapper.get('[aria-label="Disconnect Linear"]').trigger('click');
    expect(wrapper.emitted('disconnect')).toEqual([['linear'], ['linear']]);
  });

  it('renders an intro banner and matching provider logos', () => {
    const wrapper = mountPanel({
      connections: [{ provider: 'github', status: 'disconnected' }],
    });

    const title = wrapper.get('#settings-integrations-title');
    const banner = wrapper.get('.settings-intro');

    expect(title.element.compareDocumentPosition(banner.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(banner.get('svg').attributes('aria-hidden')).toBe('true');
    expect(banner.text()).toContain('Connect your work tools');
    expect(wrapper.find('svg.github-icon').exists()).toBe(true);
    expect(wrapper.find('img.github-icon').exists()).toBe(false);
    const linearLogo = wrapper.get('svg.linear-icon');
    expect(linearLogo.attributes('width')).toBe(wrapper.get('svg.github-icon').attributes('width'));
    expect(linearLogo.element.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('emits connect for disconnected GitHub', async () => {
    const wrapper = mountPanel({
      connections: [{ provider: 'github', status: 'disconnected' }],
    });

    await wrapper.findAll('button').find((button) => button.text() === 'Connect')?.trigger('click');

    expect(wrapper.emitted('connect')).toStrictEqual([['github']]);
  });

  it('uses the shared GitHub authorization steps and forwards browser open', async () => {
    const wrapper = mountPanel({
      authorization: {
        provider: 'github',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        expiresAt: '2026-06-09T12:05:00.000Z',
      },
      connections: [{
        provider: 'github',
        status: 'connecting',
        detail: 'Enter code ABCD-1234 in GitHub.',
      }],
    });

    expect(wrapper.text()).toContain('ABCD-1234');
    expect(wrapper.text()).toContain('Step 1: Copy the code');
    expect(wrapper.text()).toContain('Step 2: Open GitHub');
    expect(wrapper.text()).toContain(`GitHub will ask for the code. Paste it there, authorize ${product.name}, then come back here.`);
    expect(wrapper.text()).toContain('Step 3: Come back here');
    expect(wrapper.text()).toContain(`${product.name} will finish the connection automatically once GitHub approves it.`);
    expect(wrapper.find('[aria-label="Waiting for GitHub authorization"]').exists()).toBe(true);

    wrapper.getComponent({ name: 'WorkAuthorizationSteps' }).vm.$emit('open');
    expect(wrapper.emitted('open-authorization')).toStrictEqual([['github']]);
    expect(wrapper.emitted('complete')).toBeUndefined();
  });

  it('shows connected account state and emits disconnect', async () => {
    const wrapper = mountPanel({
      connections: [{
        provider: 'github',
        status: 'connected',
        accountLabel: 'nbonamy',
      }],
    });

    expect(wrapper.text()).toContain('Signed in as nbonamy');

    await wrapper.findAll('button').find((button) => button.text() === 'Disconnect')?.trigger('click');

    expect(wrapper.emitted('disconnect')).toStrictEqual([['github']]);
  });

  it('lets unconfigured GitHub reach the backend because backend owns configuration', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountPanel({
      connections: [{
        provider: 'github',
        status: 'notConfigured',
        detail: 'GitHub OAuth is not configured.',
      }],
      updateSettings,
    });

    const connectButton = wrapper.findAll('button').find((button) => button.text() === 'Connect');
    expect(connectButton?.attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).toContain('GitHub OAuth is not configured');

    await connectButton?.trigger('click');
    await flushPromises();

    expect(updateSettings).not.toHaveBeenCalled();
    expect(wrapper.emitted('connect')).toStrictEqual([['github']]);
  });

  it('uses a saved client ID without forcing a settings update on connect', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountPanel({
      connections: [{ provider: 'github', status: 'disconnected' }],
      providerSettings: {
        github: {
          oauthClientId: 'client-id',
        },
      },
      updateSettings,
    });

    await wrapper.findAll('button').find((button) => button.text() === 'Connect')?.trigger('click');
    await flushPromises();

    expect(updateSettings).not.toHaveBeenCalled();
    expect(wrapper.emitted('connect')).toStrictEqual([['github']]);
  });
});

function mountPanel(props: Record<string, unknown>) {
  return mount(SettingsIntegrationsPanel, {
    props: {
      connections: [],
      ...props,
    },
    global: {
      },
  });
}
