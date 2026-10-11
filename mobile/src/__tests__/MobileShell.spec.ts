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
