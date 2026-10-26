import { flushPromises, mount } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';
import RepositoryDeleteDialog from '../RepositoryDeleteDialog.vue';

it.each(['nbonamy/korus-test', 'local-project'])('requires the exact confirmation name %s and retains failures for retry', async name => {
  const preview = { repositoryPath: '/src/project', confirmationName: name, paths: ['/src/project', '/src/project-topic'], agents: [{ id: 'agent', name: 'Builder' }], fingerprint: 'version-1' };
  const remove = vi.fn().mockRejectedValueOnce(new Error('Folder is busy')).mockResolvedValue(undefined);
  const wrapper = mount(RepositoryDeleteDialog, { props: { agentId: 'agent', loadPreview: vi.fn().mockResolvedValue(preview), removeRepository: remove } });
  await flushPromises();
  expect(wrapper.text()).toContain('permanently');
  expect(wrapper.text()).not.toContain('/src/project-topic');
  const button = wrapper.get('button.app-button--danger');
  expect(button.attributes('disabled')).toBeDefined();
  await wrapper.get('input').setValue('wrong'); await button.trigger('click'); expect(remove).not.toHaveBeenCalled();
  await wrapper.get('input').setValue(name); await button.trigger('click'); await flushPromises();
  expect(remove).toHaveBeenCalledExactlyOnceWith('agent', { confirmation: name, fingerprint: 'version-1' });
  expect(wrapper.get('[role="alert"]').text()).toContain('Folder is busy');
  expect(wrapper.emitted('close')).toBeUndefined();
  await button.trigger('click'); await flushPromises();
  expect(wrapper.emitted('close')).toStrictEqual([[]]);
  wrapper.unmount();
});
