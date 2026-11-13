import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import 'element-plus/theme-chalk/el-icon.css';
import ProviderInstallActions from '../ProviderInstallActions.vue';
import type { ProviderSetupCapabilities } from '@workspace/core/contracts/provider-setup';

describe('ProviderInstallActions', () => {
  it.each([{ provider: 'codex', name: 'Codex' }, { provider: 'claude', name: 'Claude Code' }] as const)('allows a controller installer for explicit $backend setup metadata', async ({ provider: backend, name }) => {
    const wrapper = mount(ProviderInstallActions, { props: { provider: backend, automated: true,
      capabilities: { homeSelection: true, skillSharing: true, installation: { managed: false, allowControllerInstall: true } },
    } });
    expect(wrapper.find('a').exists()).toBe(false);
    await wrapper.get(`button[aria-label="Install ${name}"]`).trigger('click');
    expect(wrapper.emitted('install')).toEqual([[]]);
    wrapper.unmount();
  });
  it.each([
    { provider: 'cursor' as const },
    { provider: 'antigravity' as const, command: 'curl -fsSL https://antigravity.google/cli/install.sh | bash', url: 'https://antigravity.google/docs/getting-started?tab=cli' },
    { provider: 'codex' as const, capabilities: { homeSelection: false, skillSharing: false, installation: { managed: false, instructionsUrl: 'https://cursor.com/docs/cli/installation', command: 'curl https://cursor.com/install -fsS | bash' } } },
  ])('uses external installation policy for $provider despite a legacy automated caller', async ({ provider: backend, capabilities, command = 'curl https://cursor.com/install -fsS | bash', url = 'https://cursor.com/docs/cli/installation' }: { provider: 'cursor' | 'codex' | 'antigravity'; capabilities?: ProviderSetupCapabilities; command?: string; url?: string }) => {
    const wrapper = mount(ProviderInstallActions, { props: { provider: backend, capabilities, automated: true } });
    expect(wrapper.text()).toContain(command);
    expect(wrapper.get('a').attributes('href')).toBe(url);
    await wrapper.get('button[aria-label="Check again"]').trigger('click');
    expect(wrapper.emitted('refresh')).toStrictEqual([[]]);
    expect(wrapper.emitted('install')).toBeUndefined();
    wrapper.unmount();
  });

  it('installs a managed provider in the app and shows only a spinner while preventing duplicate actions', async () => {
    const wrapper = mount(ProviderInstallActions, { props: { provider: 'antigravity', capabilities: { homeSelection: true, skillSharing: true, installation: { managed: true } } } });
    expect(wrapper.find('a').exists()).toBe(false);
    const install = wrapper.get('button[aria-label="Install Antigravity"]');
    await install.trigger('click');
    expect(wrapper.emitted('install')).toStrictEqual([[]]);
    expect(wrapper.emitted('refresh')).toBeUndefined();
    await wrapper.setProps({ busy: true });
    expect(install.attributes('aria-busy')).toBe('true');
    expect(install.attributes('disabled')).toBeDefined();
    expect(install.find('.is-loading').exists()).toBe(true);
    expect(wrapper.findAll('.el-icon')).toHaveLength(1);
    expect(wrapper.find('button[aria-label="Check again"]').exists()).toBe(false);
    expect(getComputedStyle(install.element).gap).toBe('var(--space-4)');
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
    await install.trigger('click');
    expect(wrapper.emitted('install')).toHaveLength(1);
    expect(wrapper.emitted('refresh')).toBeUndefined();
    await wrapper.setProps({ busy: false });
    expect(install.attributes('disabled')).toBeUndefined();
    expect(install.find('.is-loading').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="Check again"]').exists()).toBe(true);
  });
  it('uses a small refresh icon that rotates only while busy and prevents duplicate checks', async () => {
    const wrapper = mount(ProviderInstallActions, { props: { provider: 'codex' }, attachTo: document.body });
    // jsdom preserves custom-property references in computed spacing.
    expect(getComputedStyle(wrapper.element).gap).toBe('var(--space-4)');
    const button = wrapper.get('button[aria-label="Check again"]');
    const icon = wrapper.get('.el-icon');
    expect(getComputedStyle(icon.element).fontSize).toBe('12px');
    expect(getComputedStyle(icon.element).animation).not.toContain('rotating');
    await button.trigger('click');
    expect(wrapper.emitted('refresh')).toEqual([[]]);
    await wrapper.setProps({ busy: true });
    expect(button.attributes('aria-busy')).toBe('true');
    expect(button.attributes('disabled')).toBeDefined();
    expect(getComputedStyle(icon.element).animation).toContain('rotating');
    await button.trigger('click');
    expect(wrapper.emitted('refresh')).toHaveLength(1);
    await wrapper.setProps({ busy: false });
    expect(getComputedStyle(icon.element).animation).not.toContain('rotating');
    expect(button.attributes('disabled')).toBeUndefined();
  });
});
