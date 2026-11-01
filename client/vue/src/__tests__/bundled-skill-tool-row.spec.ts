import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { CodexToolCall } from '@codex-app-sdk/vue';
import { expect, it, vi } from 'vitest';
import { i18n } from '../i18n';
import { provideAppToolPresentation } from '../tool-presentation';

it('renders a loaded bundled skill through the real conversation tool row', () => {
  const warnings = vi.spyOn(console, 'warn');
  const wrapper = mount(defineComponent({
    setup() {
      provideAppToolPresentation((key, params) => i18n.global.t(key, params ?? {}));
      return () => h(CodexToolCall, { toolCall: {
        id: 'skill-call', function: 'mcp__korus__read_skill', kind: 'mcp',
        metadata: { server: 'korus', tool: 'read-skill' }, args: { name: 'korus-inline-html' },
        state: 'completed', done: true, result: { name: 'korus-inline-html', loaded: true },
      } });
    },
  }));
  try {
    expect(wrapper.text()).toContain('Loaded skill korus-inline-html');
    expect(wrapper.find('svg').exists()).toBe(true);
    expect(warnings).not.toHaveBeenCalled();
  } finally { wrapper.unmount(); warnings.mockRestore(); }
});
