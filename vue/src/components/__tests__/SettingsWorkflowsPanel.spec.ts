import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { ElInput, ElSwitch } from 'element-plus';
import { defaultGeneralSettings } from '@workspace/core/settings';
import SettingsWorkflowsPanel from '../SettingsWorkflowsPanel.vue';

afterEach(() => vi.useRealTimers());
it('orders workflow sections and saves plan and review preferences independently', async () => {
  vi.useFakeTimers();
  const updateSettings = vi.fn().mockResolvedValue(undefined);
  const wrapper = mount(SettingsWorkflowsPanel, { props: { settings: defaultGeneralSettings, updateSettings }, global: { components: { ElInput, ElSwitch } } });
  try {
    expect(wrapper.findAll('h3').map(heading => heading.text())).toStrictEqual(['Collaboration', 'Plan mode', 'Delegation', 'Code review']);
    const toggle = wrapper.get('[role="switch"][aria-label="Use interactive plans"]');
    expect(toggle.attributes('aria-checked')).toBe('true');
    await toggle.trigger('click');
    await vi.advanceTimersByTimeAsync(600);
    await flushPromises();
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({ general: { useInteractivePlans: false } });
    await wrapper.setProps({ settings: { ...defaultGeneralSettings, useInteractivePlans: false } });
    expect(toggle.attributes('aria-checked')).toBe('false');
    const instructions = wrapper.get('textarea[aria-label="Review instructions"]');
    await instructions.setValue('Check authorization.\nKeep findings actionable.');
    await vi.advanceTimersByTimeAsync(600);
    await flushPromises();
    expect(updateSettings).toHaveBeenLastCalledWith({ general: { codeReviewInstructions: 'Check authorization.\nKeep findings actionable.' } });
    await wrapper.setProps({ settings: { ...defaultGeneralSettings, codeReviewInstructions: 'Check authorization.\nKeep findings actionable.' } });
    expect((instructions.element as HTMLTextAreaElement).value).toBe('Check authorization.\nKeep findings actionable.');
    await instructions.setValue('');
    await vi.advanceTimersByTimeAsync(600);
    await flushPromises();
    expect(updateSettings).toHaveBeenLastCalledWith({ general: { codeReviewInstructions: '' } });
  } finally { wrapper.unmount(); }
});
