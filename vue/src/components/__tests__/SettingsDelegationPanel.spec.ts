import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { ElSelect, ElOption } from 'element-plus';
import { defaultGeneralSettings } from '@workspace/core/settings';
import SettingsDelegationPanel from '../SettingsDelegationPanel.vue';

afterEach(() => vi.useRealTimers());
it('saves the chosen context and reusable instructions together, including clearing them on exit', async () => {
  vi.useFakeTimers();
  const updateSettings = vi.fn().mockResolvedValue(undefined);
  const wrapper = mount(SettingsDelegationPanel, { props: { settings: defaultGeneralSettings, updateSettings }, global: { components: { ElSelect, ElOption } } });
  await wrapper.get('[aria-label="Delegation instructions"]').setValue('Keep commits local');
  await wrapper.get('.el-select__wrapper').trigger('click');
  await flushPromises();
  const handoff = [...document.querySelectorAll<HTMLElement>('.el-select-dropdown__item')].find(item => item.textContent?.includes('Start with a handoff'))!;
  handoff.click();
  await vi.advanceTimersByTimeAsync(600);
  expect(updateSettings).toHaveBeenCalledExactlyOnceWith({ general: { worktreeDelegationStartingContext: 'handoff', worktreeDelegationInstructions: 'Keep commits local' } });
  await wrapper.get('[aria-label="Delegation instructions"]').setValue('');
  wrapper.unmount();
  await flushPromises();
  expect(updateSettings).toHaveBeenLastCalledWith({ general: { worktreeDelegationStartingContext: 'handoff', worktreeDelegationInstructions: '' } });
});
