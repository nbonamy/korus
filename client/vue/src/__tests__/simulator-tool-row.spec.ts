import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { CodexToolCall } from '@codex-app-sdk/vue';
import { expect, it } from 'vitest';
import { i18n } from '../i18n';
import { provideAppToolPresentation } from '../tool-presentation';

it('renders simulator activity through the real conversation tool row', () => {
  const wrapper = mount(defineComponent({
    setup() {
      provideAppToolPresentation((key, params) => i18n.global.t(key, params ?? {}));
      return () => h(CodexToolCall, { toolCall: {
        id: 'simulator-capture', function: 'mcp__korus__simulator', kind: 'mcp',
        metadata: { server: 'korus', tool: 'simulator' },
        args: { action: 'screenshot', attachmentId: 'private-attachment-id' },
        state: 'completed', done: true,
        result: { structuredContent: { screen: { width: 1206, height: 2622 } } },
      } });
    },
  }));
  expect(wrapper.text()).toContain('Captured simulator screenshot');
  expect(wrapper.text()).not.toContain('private-attachment-id');
});
