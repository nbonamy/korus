import { flushPromises, mount } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';
import { ElSelect, ElOption } from 'element-plus';
import WorktreeDelegationDialog from '../WorktreeDelegationDialog.vue';

it('allows a context override and delivers task-specific instructions only after submission', async () => {
  const delegate = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const wrapper = mount(WorktreeDelegationDialog, { props: { startingContext: 'conversation', delegate }, global: { components: { ElSelect, ElOption } } });
  expect(delegate).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain('Keep the conversation');
  await wrapper.get('[aria-label="Task-specific instructions"]').setValue('  Test the retry boundary  ');
  await wrapper.get('.el-select__wrapper').trigger('click');
  await flushPromises();
  [...document.querySelectorAll<HTMLElement>('.el-select-dropdown__item')].find(item => item.textContent?.trim() === 'Handoff')!.click();
  await flushPromises();
  expect(wrapper.text()).toContain('Start a fresh conversation');
  await wrapper.get('.app-button--primary').trigger('click');
  await flushPromises();
  expect(delegate).toHaveBeenCalledExactlyOnceWith({ startingContext: 'handoff', instructions: 'Test the retry boundary' });
  expect(wrapper.get('[role="alert"]').text()).toBe('offline');
  expect(wrapper.emitted('close')).toBeUndefined();
  await wrapper.get('.app-button--primary').trigger('click');
  await flushPromises();
  expect(delegate).toHaveBeenCalledTimes(2);
  expect(wrapper.emitted('close')).toHaveLength(1);
});

it('cancels without starting a delegation', async () => {
  const delegate = vi.fn();
  const wrapper = mount(WorktreeDelegationDialog, { props: { startingContext: 'handoff', delegate } });
  await wrapper.get('.app-button--tertiary').trigger('click');
  expect(wrapper.emitted('close')).toHaveLength(1);
  expect(delegate).not.toHaveBeenCalled();
});
