import { flushPromises, mount } from '@vue/test-utils';
import { ElMessageBox, ElSelect } from 'element-plus';
import { afterEach, expect, it, vi } from 'vitest';
import SettingsPersonalizationPanel from '../SettingsPersonalizationPanel.vue';
afterEach(() => vi.useRealTimers());
function render() {
  const api = { readEngineInstructions: vi.fn().mockImplementation(async engine => ({ text: engine + ' rules', path: '/' + engine })), saveEngineInstructions: vi.fn().mockResolvedValue(undefined) };
  return { api, wrapper: mount(SettingsPersonalizationPanel, { props: { api } }) };
}
it('autosaves and flushes the original engine before switching', async () => {
  vi.useFakeTimers();
  const { api, wrapper } = render(); await flushPromises();
  await vi.advanceTimersByTimeAsync(700);
  expect(api.saveEngineInstructions).not.toHaveBeenCalled();
  expect(wrapper.find('.settings-personalization__path').text()).toBe('/codex');
  expect(wrapper.findAll('button').map(b => b.text())).toEqual(['Save to all']);
  await wrapper.get('textarea').setValue('Codex edit');
  wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 'claude'); await flushPromises();
  expect(api.saveEngineInstructions).toHaveBeenCalledExactlyOnceWith({ engine: 'codex', text: 'Codex edit' });
  expect(api.readEngineInstructions).toHaveBeenLastCalledWith('claude');
  expect(wrapper.find('.settings-personalization__path').text()).toBe('/claude');
  await wrapper.get('textarea').setValue('Claude edit');
  await vi.advanceTimersByTimeAsync(600); await flushPromises();
  expect(api.saveEngineInstructions).toHaveBeenLastCalledWith({ engine: 'claude', text: 'Claude edit' });
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
});
it('keeps autosave quiet while a write is pending', async () => {
  vi.useFakeTimers();
  const { api, wrapper } = render(); await flushPromises();
  let finish!: () => void;
  api.saveEngineInstructions.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  await wrapper.get('textarea').setValue('Guidance');
  await vi.advanceTimersByTimeAsync(600);
  expect(api.saveEngineInstructions).toHaveBeenCalledTimes(1);
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  finish(); await flushPromises();
});
it('requires confirmation for replacement and preserves autosave ordering', async () => {
  vi.useFakeTimers();
  const { api, wrapper } = render(); await flushPromises();
  const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValue('confirm' as never);
  await wrapper.get('textarea').setValue('Shared');
  await wrapper.get('button').trigger('click'); await flushPromises();
  expect(api.saveEngineInstructions).not.toHaveBeenCalled();
  await wrapper.get('button').trigger('click'); await flushPromises();
  expect(confirm).toHaveBeenCalledWith('This will replace developer instructions for all agents. Do you want to continue?', 'Save to all', expect.objectContaining({ confirmButtonText: 'Replace' }));
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  expect(api.saveEngineInstructions.mock.calls).toEqual([
    [{ engine: 'codex', text: 'Shared' }],
    [{ engine: 'codex', text: 'Shared', all: true, confirmed: true }],
  ]);
});
it('keeps the current engine and unsaved edits after a failed write', async () => {
  vi.useFakeTimers();
  const { api, wrapper } = render(); await flushPromises();
  api.saveEngineInstructions.mockRejectedValue(new Error('Read only'));
  await wrapper.get('textarea').setValue('Unsaved');
  wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 'claude'); await flushPromises();
  expect(api.readEngineInstructions).toHaveBeenCalledTimes(1);
  expect(wrapper.get('[role="alert"]').text()).toBe('Read only');
  expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Unsaved');
});
