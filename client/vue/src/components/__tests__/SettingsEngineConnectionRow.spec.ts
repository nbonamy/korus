import { product } from '@workspace/core/product';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElMessageBox, ElSwitch } from 'element-plus';
import SettingsEngineConnectionRow from '../SettingsEngineConnectionRow.vue';

describe('SettingsEngineConnectionRow', () => {
  it('keeps an external-only installation external in the compact overflow control', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const wrapper = mount(SettingsEngineConnectionRow, { props: {
      provider: 'codex', installed: false, compact: true, overflow: true, installable: true,
      capabilities: { homeSelection: false, skillSharing: false, installation: { managed: false, instructionsUrl: 'https://example.com/install', command: 'official-install' } },
    } });
    expect(wrapper.text()).not.toContain('official-install');
    expect(wrapper.find('[aria-label="Check again"]').exists()).toBe(false);
    await wrapper.findAll('button').find(button => button.text() === 'Install')!.trigger('click');
    expect(open).toHaveBeenCalledWith('https://example.com/install', '_blank', 'noopener,noreferrer');
    expect(wrapper.emitted('install')).toBeUndefined();
    wrapper.unmount();
    open.mockRestore();
  });
  it.each([{ provider: 'antigravity', title: 'Antigravity' }, { provider: 'cursor', title: 'Cursor' }] as const)('renders a connected $title account without inventing account metadata', async ({ provider: backend, title }) => {
    const wrapper = mount(SettingsEngineConnectionRow, { props: { provider: backend, title, connected: true, enabled: true,
      authentication: { kind: backend, connected: true, state: { loggedIn: true, homePath: '/private/home' } } } });
    expect(wrapper.text()).not.toContain('/private/home');
    expect(wrapper.find('.engine-hero__account').exists()).toBe(false);
    if (backend === 'cursor') {
      await wrapper.setProps({ authentication: { kind: backend, connected: true, state: { loggedIn: true, homePath: '/private/home', account: { type: 'subscription' as const, email: 'user@example.com' } }, account: { kind: 'subscription' as const, email: 'user@example.com' } } });
      expect(wrapper.get('.engine-hero__account').text()).toBe('user@example.com');
    }
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true');
    expect(wrapper.get('[role="switch"]').attributes('aria-label')).toBe(`Enable ${title}`);
  });
  afterEach(async () => {
    ElMessageBox.close();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  });

  it.each([
    ["Error invoking remote method 'provider:enabled:set': Error: Cannot disable the last engine. Enable another one first.", 'To turn this engine off, first connect or enable another one.', `${product.name} needs an active engine`],
    ["Error invoking remote method 'provider:enabled:set': Error: transport unavailable", 'Could not update engine status. Please try again.', 'Engine status unchanged'],
  ])('shows a clean dismissible dialog for %s and keeps the engine enabled', async (error, message, title) => {
    const wrapper = mount(SettingsEngineConnectionRow, { global: { components: { ElSwitch }, stubs: { transition: false } }, props: { connected: true, enabled: true, setEnabled: vi.fn().mockRejectedValue(new Error(error)) } });
    await wrapper.get('[role="switch"]').trigger('click');
    await flushPromises();
    const dialog = new DOMWrapper(document.body).get('[role="dialog"]');
    expect(dialog.attributes('aria-label')).toBe(title);
    expect(dialog.get('.el-message-box__message').text()).toBe(message);
    expect(dialog.text()).not.toContain('Error invoking remote method');
    expect(wrapper.find('.engine-hero__error').exists()).toBe(false);
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true');
    await dialog.get('.el-message-box__btns button').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true');
  });

  it('replaces Connect with a cancellable sign-in action in the control area', async () => {
    const wrapper = mount(SettingsEngineConnectionRow, { props: { pending: true } });
    expect(wrapper.get('.engine-hero__copy strong').text()).toBe('Account');
    expect(wrapper.get('.engine-hero__status').text()).toBe('Waiting for sign-in');
    expect(wrapper.findAll('.engine-hero__summary button')).toHaveLength(1);
    const cancel = wrapper.get('.engine-hero__action button');
    expect(cancel.text()).toBe('Cancel sign-in');
    await cancel.trigger('click');
    expect(wrapper.emitted('cancel')).toEqual([[]]);
    await wrapper.setProps({ pending: false });
    expect(wrapper.get('.engine-hero__action button').text()).toBe('Connect');
  });
});
