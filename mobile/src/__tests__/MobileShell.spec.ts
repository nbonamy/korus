import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { i18n } from '@workspace/vue/i18n';
import MobileShell from '../MobileShell.vue';
import { companionMessages } from '../messages';
import { createDemoConnector } from '../demo-connector';
import { PairingError, type CompanionConnector } from '../companion-port';
import type { MobileHost } from '../mobile-host';

// Shared conversation rendering/composer behavior is owned by the SDK and Korus pane suites.
// This faithful controller consumer isolates companion navigation and connection policy.
vi.mock('@workspace/vue/components/ConversationPane.vue', () => ({ default: defineComponent({
  props: ['controller'],
  template: `<section>
    <p v-for="message in controller.state.value.identity.messages" :key="message.id">{{ message.parts[0].text }}</p>
    <textarea aria-label="Prompt" :value="controller.state.value.composer.state.text"
      @input="controller.actions.updateComposerState({text: $event.target.value, selectionStart: 0, selectionEnd: 0})" />
    <button :disabled="controller.state.value.identity.disabled"
      @click="controller.actions.submit(controller.state.value.composer.state.text)">Send</button>
  </section>`,
}) }));

enableAutoUnmount(afterEach);
i18n.global.mergeLocaleMessage('en', companionMessages);

const button = (wrapper: ReturnType<typeof mount>, label: string) => wrapper.findAll('button').find((b) => b.text() === label)!;
/** A phone with no saved pairing. */
const unpaired = () => { const connector = createDemoConnector(); Object.defineProperty(connector, 'laptops', { value: [] }); return connector; };
const mountShell = (props: { connector: CompanionConnector; host: MobileHost }) => mount(MobileShell, { props, global: { plugins: [i18n] } });

describe('mobile companion flow', () => {
  it('opens the first agent on connect and lets the phone send', async () => {
    const wrapper = mountShell({ connector: createDemoConnector(), host: { platform: 'ios', onResume: async () => () => {} } });
    await flushPromises();
    expect(wrapper.get('header').text()).toContain('Builder');
    expect(wrapper.text()).toContain('local demo conversation');
    expect(button(wrapper, 'Send').attributes('disabled')).toBeUndefined();
  });
  it('reconnects to its single saved laptop on launch, and lets the person choose between several', async () => {
    const wrapper = mountShell({ connector: createDemoConnector(), host: { platform: 'ios', onResume: async () => () => {} } });
    await flushPromises();
    expect(wrapper.get('header').text()).toContain('Builder');
    const several = createDemoConnector(); Object.defineProperty(several, 'laptops', { value: [{ id: 'demo-laptop', name: 'Laptop A' }, { id: 'other', name: 'Laptop B' }] });
    const chooser = mountShell({ connector: several, host: { platform: 'ios', onResume: async () => () => {} } });
    await flushPromises();
    expect(chooser.find('header').exists()).toBe(false);
    expect(chooser.findAll('.mobile-pairing__laptops button').map((row) => row.text())).toStrictEqual(['Laptop A', 'Laptop B']);
  });
  it('pairs as soon as the code is complete, then suspends and reconnects on native lifecycle', async () => {
    const connector = unpaired();
    connector.initialize = vi.fn(async () => {});
    connector.pair = vi.fn(async (_code, _name, pending) => { pending(); return 'demo-laptop'; });
    connector.resume = vi.fn(async () => {}); connector.suspend = vi.fn(async () => {}); connector.dispose = vi.fn(async () => {});
    let active!: (value: boolean) => void;
    const remove = vi.fn();
    const wrapper = mountShell({ connector, host: { platform: 'ios',
      onResume: async () => () => {}, onActivity: async (listener) => { active = listener; return remove; } },
    });
    await flushPromises();
    const input = wrapper.get('input[aria-label="Pairing code"]');
    await input.setValue('k7qd-m2x'); await flushPromises();
    expect(connector.pair).not.toHaveBeenCalled();
    await input.setValue('k7qdm2xp'); await flushPromises();
    expect(connector.pair).toHaveBeenCalledExactlyOnceWith('K7QDM2XP', 'iPhone', expect.any(Function));
    expect(wrapper.get('header').text()).toContain('Builder');
    active(false); await flushPromises();
    expect(connector.suspend).toHaveBeenCalledOnce(); expect(wrapper.get('.mobile-shell__banner').text()).toContain('Disconnected');
    active(true); await flushPromises(); expect(connector.resume).toHaveBeenCalledOnce(); expect(wrapper.find('.mobile-shell__banner').exists()).toBe(false);
    wrapper.unmount(); expect(remove).toHaveBeenCalledOnce(); expect(connector.dispose).toHaveBeenCalledOnce();
  });
  it('fills the code from the scanner and shows a clear reason when no laptop is showing it', async () => {
    const connector = unpaired();
    connector.pair = vi.fn(async () => { throw new PairingError('mobile.errors.noLaptop'); });
    const wrapper = mountShell({ connector, host: { platform: 'android', scanPairingCode: async () => 'k7qd-m2xp', onResume: async () => () => {} } });
    await button(wrapper, 'Scan code').trigger('click'); await flushPromises();
    expect(connector.pair).toHaveBeenCalledWith('K7QDM2XP', 'Android phone', expect.any(Function));
    expect(wrapper.get('[role="alert"]').text()).toContain('No laptop is showing this code');
    expect((wrapper.get('input[aria-label="Pairing code"]').element as HTMLInputElement).value).toBe('');
  });
  it('explains an unusable scan and a build without a relay instead of offering a dead end', async () => {
    const connector = unpaired(); connector.pair = vi.fn();
    const wrapper = mountShell({ connector, host: { platform: 'ios', scanPairingCode: async () => { throw new Error('denied'); }, onResume: async () => () => {} } });
    await button(wrapper, 'Scan code').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Pairing failed');
    expect(connector.pair).not.toHaveBeenCalled();
    const unconfigured = unpaired(); unconfigured.pair = vi.fn(); unconfigured.relayConfigured = false;
    const bare = mountShell({ connector: unconfigured, host: { platform: 'ios', onResume: async () => () => {} } });
    expect(bare.get('[role="alert"]').text()).toContain('no relay');
    expect(bare.find('input').exists()).toBe(false);
  });
  it('switches agents from the drawer, sends, and preserves its draft through offline/reconnect', async () => {
    const remove = vi.fn();
    const wrapper = mountShell({ connector: createDemoConnector(), host: { platform: 'web', onResume: async () => remove } });
    await flushPromises();
    expect(wrapper.text()).toContain('local demo conversation');
    expect(wrapper.get('.mobile-drawer').classes()).not.toContain('mobile-drawer--open');
    await wrapper.get('button[aria-label="Agents"]').trigger('click');
    expect(wrapper.get('.mobile-drawer').classes()).toContain('mobile-drawer--open');
    await wrapper.findAll('.mobile-drawer__agent').find((b) => b.text().includes('Reviewer'))!.trigger('click'); await flushPromises();
    expect(wrapper.get('header').text()).toContain('Reviewer');
    expect(wrapper.get('.mobile-drawer').classes()).not.toContain('mobile-drawer--open');
    const input = wrapper.get('textarea');
    await input.setValue('Send once');
    await button(wrapper, 'Send').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Demo prompt received');
    expect((input.element as HTMLTextAreaElement).value).toBe('');
    await input.setValue('Keep my dictated draft');
    await button(wrapper, 'Disconnect').trigger('click');
    expect(wrapper.get('.mobile-shell__banner').text()).toContain('Disconnected');
    expect(button(wrapper, 'Send').attributes('disabled')).toBeDefined();
    await wrapper.get('.mobile-shell__banner button').trigger('click');
    await flushPromises();
    expect((input.element as HTMLTextAreaElement).value).toBe('Keep my dictated draft');
    await button(wrapper, 'Forget laptop').trigger('click');
    await flushPromises();
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.text()).toContain('Laptop forgotten');
    wrapper.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('removes a late native lifecycle subscription after the shell unmounts', async () => {
    let resolve!: (stop: () => void) => void;
    const remove = vi.fn();
    const wrapper = mountShell({ connector: createDemoConnector(),
      host: { platform: 'ios', onResume: () => new Promise((r) => { resolve = r; }) },
    });
    wrapper.unmount();
    resolve(remove);
    await flushPromises();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
