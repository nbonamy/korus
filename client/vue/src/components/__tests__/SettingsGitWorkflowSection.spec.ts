import { flushPromises, mount } from '@vue/test-utils';
import { ElSelect, ElOption } from 'element-plus';
import { expect, it, vi } from 'vitest';
import { defaultGeneralSettings } from '@workspace/core/settings';
import SettingsGitWorkflowSection from '../SettingsGitWorkflowSection.vue';

async function choose(wrapper: ReturnType<typeof mount>, label: string, text: string) {
  const control = wrapper.get(`[aria-label="${label}"]`);
  await control.trigger('click'); await flushPromises();
  const list = document.getElementById(control.attributes('aria-controls')!);
  const option = [...list!.querySelectorAll<HTMLElement>('.el-select-dropdown__item')].find(item => item.textContent === text);
  expect(option).toBeDefined(); option!.click(); await flushPromises();
}
const global = { components: { ElSelect, ElOption } };

it('automatically saves each global strategy without overwriting the other setting', async () => {
  const updateSettings = vi.fn().mockResolvedValue(undefined);
  const wrapper = mount(SettingsGitWorkflowSection, { attachTo: document.body, global, props: { settings: defaultGeneralSettings, updateSettings } });
  await flushPromises();
  expect(wrapper.findAll('[role="combobox"]').map(control => control.attributes('aria-label'))).toStrictEqual(['Pull strategy', 'Update from base']);
  expect(wrapper.text()).toContain('Git configuration');
  expect(wrapper.find('button').exists()).toBe(false);
  await choose(wrapper, 'Pull strategy', 'Rebase');
  expect(updateSettings).toHaveBeenNthCalledWith(1, { general: { git: { pull: 'rebase' } } });
  await wrapper.setProps({ settings: { ...defaultGeneralSettings, git: { pull: 'rebase', update: 'merge' } } });
  await choose(wrapper, 'Update from base', 'Fast-forward only');
  expect(updateSettings).toHaveBeenNthCalledWith(2, { general: { git: { update: 'ff-only' } } });
  expect(updateSettings).toHaveBeenCalledTimes(2);
  wrapper.unmount();
});

it('reports a failed save and keeps displaying the persisted strategy', async () => {
  const updateSettings = vi.fn().mockRejectedValue(new Error('Unable to save settings'));
  const wrapper = mount(SettingsGitWorkflowSection, { attachTo: document.body, global, props: { settings: defaultGeneralSettings, updateSettings } });
  await choose(wrapper, 'Pull strategy', 'Rebase');
  expect(wrapper.get('[role="alert"]').text()).toContain('Unable to save settings');
  expect(wrapper.text()).toContain('Git configuration');
  wrapper.unmount();
});
