import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultGeneralSettings } from '@workspace/core/settings';
import SettingsInstructionsPanel from '../SettingsInstructionsPanel.vue';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('updates the worktree initialization policy', async () => {
  const openExternal = vi.spyOn(window, 'open').mockImplementation(() => null);
  const updateSettings = vi.fn().mockResolvedValue(undefined);
  const wrapper = mount(SettingsInstructionsPanel, { props: { settings: defaultGeneralSettings, updateSettings } });
  await flushPromises();
  const section = wrapper.findAllComponents({ name: 'FormSection' })
    .find((candidate) => candidate.text().includes('Worktrees'));
  expect(section).toBeDefined();
  const guide = section!.get('a');
  const guideUrl = 'https://github.com/nbonamy/korus/wiki/Automatic-worktree-initialization';
  expect(guide.attributes('href')).toBe(guideUrl);
  await guide.trigger('click');
  expect(openExternal).toHaveBeenCalledWith(guideUrl, '_blank', 'noopener,noreferrer');
  const row = section!.findAllComponents({ name: 'FormRow' })
    .find((candidate) => candidate.text().includes('Worktree initialization'));
  expect(row).toBeDefined();
  const select = row!.findComponent({ name: 'ElSelect' });
  expect(select.classes()).toContain('settings-instructions__worktree-select');
  expect(row!.text()).toContain("Use repository instructions when available; otherwise copy local environment files and detect setup from the project's tech stack");
  expect(select.get('.el-select__placeholder').text()).toBe('Auto-detect');
  expect(select.findAllComponents({ name: 'ElOption' }).map((option) => option.props('label'))).toStrictEqual([
    'Auto-detect',
    'Repo instructions only',
    'Disabled',
  ]);
  await select.vm.$emit('update:modelValue', 'repository');
  expect(updateSettings).toHaveBeenCalledWith({ general: { worktreeInitializationMode: 'repository' } });
});
it('keeps autosave quiet while a write is pending', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const updateSettings = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const wrapper = mount(SettingsInstructionsPanel, { props: { settings: defaultGeneralSettings, updateSettings } });
  await wrapper.get('textarea').setValue('Guidance');
  await vi.advanceTimersByTimeAsync(600);
  expect(updateSettings).toHaveBeenCalledTimes(1);
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  finish(); await flushPromises();
});
it('debounces both fields and flushes edits on exit', async () => {
  vi.useFakeTimers();
  const updateSettings = vi.fn().mockResolvedValue(undefined);
  const wrapper = mount(SettingsInstructionsPanel, { props: { settings: defaultGeneralSettings, updateSettings } });
  expect(wrapper.find('.settings-instructions__fields button').exists()).toBe(false);
  expect(wrapper.get('textarea').attributes('rows')).toBe('6');
  expect(wrapper.text()).toContain('Extra guidance for generated commit messages');
  expect(wrapper.text()).toContain('Extra guidance for generated pull request titles and descriptions');
  expect(wrapper.get('[aria-label="Commit instructions"]').attributes('placeholder')).toBe('Add commit message guidance…');
  await vi.advanceTimersByTimeAsync(700);
  expect(updateSettings).not.toHaveBeenCalled();
  await wrapper.get('[aria-label="Commit instructions"]').setValue('Lowercase');
  await vi.advanceTimersByTimeAsync(300);
  await wrapper.get('[aria-label="Pull request instructions"]').setValue('Tests');
  await vi.advanceTimersByTimeAsync(599);
  expect(updateSettings).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); await flushPromises();
  expect(updateSettings).toHaveBeenCalledExactlyOnceWith({ general: { commitMessageInstructions: 'Lowercase', pullRequestInstructions: 'Tests' } });
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  await wrapper.get('[aria-label="Commit instructions"]').setValue('');
  wrapper.unmount(); await flushPromises();
  expect(updateSettings).toHaveBeenLastCalledWith({ general: { commitMessageInstructions: '', pullRequestInstructions: 'Tests' } });
});
