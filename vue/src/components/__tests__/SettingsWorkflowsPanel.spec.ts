import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { ElSwitch } from 'element-plus';
import { defaultGeneralSettings } from '@workspace/core/settings';
import SettingsWorkflowsPanel from '../SettingsWorkflowsPanel.vue';

afterEach(() => vi.useRealTimers());
it('puts Plan mode first, defaults interactive plans on, and persists the toggle without changing delegation', async () => {
  vi.useFakeTimers();
  const updateSettings = vi.fn().mockResolvedValue(undefined);
  const wrapper = mount(SettingsWorkflowsPanel, { props: { settings: defaultGeneralSettings, updateSettings }, global: { components: { ElSwitch } } });
  try {
    expect(wrapper.findAll('h3').map(heading => heading.text())).toStrictEqual(['Plan mode', 'Delegation']);
    const toggle = wrapper.get('[role="switch"][aria-label="Use interactive plans"]');
    expect(toggle.attributes('aria-checked')).toBe('true');
    await toggle.trigger('click');
    await vi.advanceTimersByTimeAsync(600);
    await flushPromises();
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({ general: { useInteractivePlans: false } });
    await wrapper.setProps({ settings: { ...defaultGeneralSettings, useInteractivePlans: false } });
    expect(toggle.attributes('aria-checked')).toBe('false');
  } finally { wrapper.unmount(); }
});
