import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import RemoteFolderPickerDialog from '../RemoteFolderPickerDialog.vue';

describe('RemoteFolderPickerDialog', () => {
  it('uses shared footer variants and selects the loaded folder', async () => {
    const listSourceFolders = vi.fn().mockResolvedValue({
      path: '/srv/repos',
      parentPath: '/srv',
      entries: [],
    });
    const wrapper = mount(RemoteFolderPickerDialog, {
      props: {
        initialPath: '/srv/repos',
        listSourceFolders,
        remoteConnectionId: 'connection-1',
        visible: false,
      },
      global: {
        stubs: {
          ElDialog: {
            props: ['modelValue'],
            template: '<section v-if="modelValue" class="remote-folder-picker-dialog"><slot /><slot name="footer" /></section>',
          },
        },
      },
    });
    await wrapper.setProps({ visible: true });
    await flushPromises();

    expect(wrapper.findAll('.app-dialog__footer .app-button').map((button) => button.classes())).toStrictEqual([
      ['app-button', 'app-button--tertiary'],
      ['app-button', 'app-button--primary'],
    ]);
    expect(listSourceFolders).toHaveBeenCalledWith({
      path: '/srv/repos',
      remoteConnectionId: 'connection-1',
    });

    await wrapper.get('input').setValue('/srv/other');
    listSourceFolders.mockResolvedValue({ path: '/srv/other', parentPath: '/srv', entries: [] });
    await wrapper.findAll('button').find(button => button.text() === 'Open path')!.trigger('click');
    await flushPromises();
    expect(listSourceFolders).toHaveBeenLastCalledWith({ path: '/srv/other', remoteConnectionId: 'connection-1' });
    expect(wrapper.emitted('select')).toBeUndefined();

    await wrapper.get('input').setValue('/srv/repos');
    listSourceFolders.mockResolvedValue({ path: '/srv/repos', parentPath: '/srv', entries: [] });
    await wrapper.get('input').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(listSourceFolders).toHaveBeenLastCalledWith({ path: '/srv/repos', remoteConnectionId: 'connection-1' });

    await wrapper.get('.app-button--primary').trigger('click');
    expect(wrapper.emitted('select')).toStrictEqual([['/srv/repos']]);
    expect(wrapper.emitted('close')).toStrictEqual([[]]);
  });
});
