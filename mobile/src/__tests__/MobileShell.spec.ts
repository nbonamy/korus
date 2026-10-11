import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { i18n } from '@workspace/vue/i18n';
import MobileShell from '../MobileShell.vue';
import { companionMessages } from '../messages';
import { createDemoConnector } from '../demo-connector';

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

describe('mobile companion flow', () => {
  it('explains a read-only device grant and disables sending while retaining conversation access', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    connector.connect = async (id) => ({ ...await connect(id), canSend: false });
    const wrapper = mount(MobileShell, { props: { connector, host: { platform: 'ios', onResume: async () => () => {} } }, global: { plugins: [i18n] } });
    await wrapper.get('button').trigger('click'); await flushPromises();
    await wrapper.get('nav select').setValue('demo-team'); await wrapper.findAll('nav select')[1].setValue('demo-agent'); await flushPromises();
    expect(wrapper.text()).toContain('This device has read-only access.'); expect(wrapper.text()).toContain('local demo conversation');
    expect(wrapper.findAll('button').find((button) => button.text() === 'Send')!.attributes('disabled')).toBeDefined();
  });
  it('requires explicit relay trust and desktop approval, then suspends and reconnects on native lifecycle', async () => {
    const connector = createDemoConnector();
    connector.initialize = vi.fn(async () => {});
    connector.pair = vi.fn(async (_invitation, _name, pending) => { pending('phone-identity'); return 'demo-laptop'; });
    connector.resume = vi.fn(async () => {}); connector.suspend = vi.fn(async () => {}); connector.dispose = vi.fn(async () => {});
    let active!: (value: boolean) => void;
    const remove = vi.fn();
    const wrapper = mount(MobileShell, { props: { connector, host: { platform: 'ios',
      scanInvitation: async () => JSON.stringify({ relayOrigin: 'wss://relay.example', hostId: 'pinned-laptop' }),
      onResume: async () => () => {}, onActivity: async (listener) => { active = listener; return remove; } },
    }, global: { plugins: [i18n] } });
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === 'Scan pairing code')!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('wss://relay.example');
    const pair = wrapper.findAll('button').find((button) => button.text() === 'Request pairing')!;
    expect(pair.attributes('disabled')).toBeDefined();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await pair.trigger('click'); await flushPromises();
    expect(connector.pair).toHaveBeenCalledOnce(); expect(wrapper.text()).toContain('Connected to laptop');
    active(false); await flushPromises();
    expect(connector.suspend).toHaveBeenCalledOnce(); expect(wrapper.text()).toContain('Disconnected');
    active(true); await flushPromises(); expect(connector.resume).toHaveBeenCalledOnce(); expect(wrapper.text()).toContain('Connected to laptop');
    wrapper.unmount(); expect(remove).toHaveBeenCalledOnce(); expect(connector.dispose).toHaveBeenCalledOnce();
  });
  it('selects a laptop, team and agent, sends, and preserves its draft through offline/reconnect', async () => {
    const remove = vi.fn();
    const wrapper = mount(MobileShell, { props: {
      connector: createDemoConnector(), host: { platform: 'web', onResume: async () => remove },
    }, global: { plugins: [i18n] } });
    expect(wrapper.find('textarea').exists()).toBe(false);
    await wrapper.get('button').trigger('click');
    await flushPromises();
    await wrapper.get('nav select').setValue('demo-team');
    await wrapper.findAll('nav select')[1].setValue('demo-agent');
    await flushPromises();
    expect(wrapper.text()).toContain('local demo conversation');
    const input = wrapper.get('textarea');
    await input.setValue('Send once');
    await wrapper.findAll('button').find((b) => b.text() === 'Send')!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Demo prompt received');
    expect((input.element as HTMLTextAreaElement).value).toBe('');
    await input.setValue('Keep my dictated draft');
    await wrapper.findAll('button').find((b) => b.text() === 'Disconnect')!.trigger('click');
    expect(wrapper.text()).toContain('draft preserved');
    expect(wrapper.findAll('button').find((b) => b.text() === 'Send')!.attributes('disabled')).toBeDefined();
    await wrapper.findAll('button').find((b) => b.text() === 'Reconnect')!.trigger('click');
    await flushPromises();
    expect((input.element as HTMLTextAreaElement).value).toBe('Keep my dictated draft');
    await wrapper.findAll('button').find((b) => b.text() === 'Forget laptop')!.trigger('click');
    await flushPromises();
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.text()).toContain('Laptop forgotten');
    wrapper.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('removes a late native lifecycle subscription after the shell unmounts', async () => {
    let resolve!: (stop: () => void) => void;
    const remove = vi.fn();
    const wrapper = mount(MobileShell, { props: { connector: createDemoConnector(),
      host: { platform: 'ios', onResume: () => new Promise((r) => { resolve = r; }) },
    }, global: { plugins: [i18n] } });
    wrapper.unmount();
    resolve(remove);
    await flushPromises();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
