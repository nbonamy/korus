import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { CodexToolCall } from '@codex-app-sdk/vue';
import { expect, it } from 'vitest';
import { i18n } from '../i18n';
import { provideAppToolPresentation } from '../tool-presentation';

it.each([
  ['publish-html-plan', 'running', 'Publishing interactive plan'],
  ['publish-html-plan', 'completed', 'Published interactive plan'],
  ['publish-html-plan', 'error', 'Could not publish interactive plan'],
  ['read-html-plan', 'running', 'Reading interactive plan'],
  ['read-html-plan', 'completed', 'Read interactive plan'],
  ['read-html-plan', 'error', 'Could not read interactive plan'],
] as const)('renders %s activity while %s through the conversation tool row', (tool, state, title) => {
  const wrapper = mount(defineComponent({
    setup() {
      provideAppToolPresentation((key, params) => i18n.global.t(key, params ?? {}));
      return () => h(CodexToolCall, { toolCall: {
        id: 'plan-call', function: `mcp__korus__${tool.replaceAll('-', '_')}`, kind: 'mcp',
        metadata: { server: 'korus', tool }, args: {},
        state, done: state !== 'running', result: undefined,
      } });
    },
  }));
  try {
    expect(wrapper.text()).toContain(title);
    expect(wrapper.text()).not.toContain(`korus.${tool}`);
    expect(wrapper.find('svg').exists()).toBe(true);
  } finally { wrapper.unmount(); }
});
