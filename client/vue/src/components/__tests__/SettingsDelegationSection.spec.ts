import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { ElSegmented } from 'element-plus';
import { defaultGeneralSettings } from '@workspace/core/settings';
import SettingsDelegationSection from '../SettingsDelegationSection.vue';

afterEach(() => vi.useRealTimers());
it('saves the chosen context and reusable instructions together, including clearing them on exit', async () => {
  vi.useFakeTimers();
  const updateSettings = vi.fn().mockResolvedValue(undefined);
  const wrapper = mount(SettingsDelegationSection, { props: { settings: defaultGeneralSettings, updateSettings }, global: { components: { ElSegmented } } });
  const option = (label: string) => wrapper.findAll('label').find(item => item.text() === label)!.get('input[type="radio"]');
  expect(wrapper.findAll('label').filter(item => item.find('input[type="radio"]').exists()).map(item => item.text())).toStrictEqual(['Handoff', 'Fork']);
  expect((option('Handoff').element as HTMLInputElement).checked).toBe(true);
  expect(wrapper.get('.form-row__copy').text()).toContain('Start a fresh conversation');
  await option('Fork').setValue(true);
  expect(wrapper.get('.form-row__copy').text()).toContain('Keep the conversation');
  await wrapper.get('[aria-label="Delegation instructions"]').setValue('Keep commits local');
  await option('Handoff').setValue(true);
  expect(wrapper.get('.form-row__copy').text()).toContain('Start a fresh conversation');
  expect(wrapper.get('.form-row__copy').text()).not.toContain('Keep the conversation');
  await vi.advanceTimersByTimeAsync(600);
  expect(updateSettings).toHaveBeenCalledExactlyOnceWith({ general: { worktreeDelegationStartingContext: 'handoff', worktreeDelegationInstructions: 'Keep commits local' } });
  expect((option('Handoff').element as HTMLInputElement).checked).toBe(true);
  await wrapper.get('[aria-label="Delegation instructions"]').setValue('');
  wrapper.unmount();
  await flushPromises();
  expect(updateSettings).toHaveBeenLastCalledWith({ general: { worktreeDelegationStartingContext: 'handoff', worktreeDelegationInstructions: '' } });
});
