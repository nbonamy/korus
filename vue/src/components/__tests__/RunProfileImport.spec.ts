import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { RunProfile, RunProfileCatalog, RunProfileInput } from '@workspace/core/run-profiles';
import RunProfileImport from '../RunProfileImport.vue';
import { stubElectronTestWindow } from '../../test/client';

const actions = [
  { name: 'dev', command: 'npm run dev', directory: 'app', source: 'app/package.json' },
  { name: 'check', command: 'make -f Makefile check', directory: 'app', source: 'app/Makefile' },
];
const button = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll('button').find(button => button.text() === text)!;
function setup(profiles: RunProfile[] = []) {
  let saved = [...profiles];
  const catalog = (): RunProfileCatalog => ({ repository: '/repo', worktree: '/repo/app', profiles: [...saved], targets: {}, runs: [] });
  const api = {
    getRunProfileActions: vi.fn().mockResolvedValue({ actions, warnings: [] }),
    saveRunProfile: vi.fn(async (_id: string, input: RunProfileInput) => { const profile = { ...input, id: input.id ?? `p-${saved.length}` }; saved = [...saved.filter(p => p.id !== profile.id), profile]; return catalog(); }),
    deleteRunProfile: vi.fn(async (_id: string, profileId: string) => { saved = saved.filter(p => p.id !== profileId); return catalog(); }),
  };
  stubElectronTestWindow({ app: api });
  const wrapper = mount(RunProfileImport, { props: { agentId: 'one', profiles, onChange: (value: RunProfileCatalog) => void wrapper.setProps({ profiles: value.profiles }) } });
  return { api, wrapper };
}

describe('repository command picker', () => {
  it('searches by command or source and moves commands with a click in either list', async () => {
    const { api, wrapper } = setup();
    await flushPromises();
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0);
    expect(api.saveRunProfile).not.toHaveBeenCalled();
    await wrapper.get('[aria-label="Search commands"]').setValue('package.json');
    expect(wrapper.get('[aria-label="Pin dev"]').text().match(/dev/g)).toHaveLength(1);
    expect(wrapper.get('[aria-label="Available commands"]').text()).toContain('npm run dev');
    expect(wrapper.get('[aria-label="Available commands"]').text()).not.toContain('make -f');
    await wrapper.get('[aria-label="Pin dev"]').trigger('click'); await flushPromises();
    expect(api.saveRunProfile).toHaveBeenCalledExactlyOnceWith('one', { name: 'dev', command: 'npm run dev', directory: 'app' });
    expect(wrapper.get('[aria-label="Pinned commands"]').text()).toContain('dev');
    expect(wrapper.get('[aria-label="Available commands"]').text()).not.toContain('npm run dev');
    await wrapper.get('[aria-label="Remove dev"]').trigger('click'); await flushPromises();
    expect(api.deleteRunProfile).toHaveBeenCalledExactlyOnceWith('one', 'p-0');
    expect(wrapper.get('[aria-label="Available commands"]').text()).toContain('npm run dev');
  });

  it('combines source files by default and filters them independently in the current project', async () => {
    const { api, wrapper } = setup(); await flushPromises();
    expect(api.getRunProfileActions).toHaveBeenCalledExactlyOnceWith('one', '.');
    const select = wrapper.get('[aria-label="Source files"]').get('select');
    expect(select.find('option:checked').text()).toBe('All files');
    expect(wrapper.get('[aria-label="Available commands"]').findAll('button')).toHaveLength(2);
    await select.setValue('app/Makefile');
    expect(wrapper.get('[aria-label="Available commands"]').text()).not.toContain('npm run dev');
    expect(wrapper.get('[aria-label="Available commands"]').text()).toContain('make -f Makefile check');
    await select.setValue('app/package.json');
    expect(wrapper.get('[aria-label="Available commands"]').text()).toContain('npm run dev');
    expect(wrapper.get('[aria-label="Available commands"]').text()).not.toContain('make -f');
    expect(wrapper.text()).not.toContain('Change directory');
    await button(wrapper, 'Done').trigger('click');
    expect(wrapper.emitted('done')).toStrictEqual([[]]);
    expect(api.saveRunProfile).not.toHaveBeenCalled();
  });

  it('keeps successful additions pinned after a failure and retries only the clicked command', async () => {
    const { api, wrapper } = setup();
    api.saveRunProfile.mockImplementationOnce(api.saveRunProfile.getMockImplementation()!).mockRejectedValueOnce(new Error('Owning host unavailable'));
    await flushPromises();
    await wrapper.get('[aria-label="Pin dev"]').trigger('click'); await flushPromises();
    await wrapper.get('[aria-label="Pin check"]').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Owning host unavailable');
    expect(wrapper.get('[aria-label="Pinned commands"]').text()).toContain('dev');
    await wrapper.get('[aria-label="Pin check"]').trigger('click'); await flushPromises();
    expect(api.saveRunProfile.mock.calls.map(([, input]) => input.command)).toStrictEqual(['npm run dev', 'make -f Makefile check', 'make -f Makefile check']);
    expect(wrapper.get('[aria-label="Pinned commands"]').text()).toContain('dev');
    expect(wrapper.get('[aria-label="Pinned commands"]').text()).toContain('check');
  });
  it('keeps custom creation and editing secondary to repository selection', async () => {
    const { api, wrapper } = setup(); await flushPromises();
    await button(wrapper, 'Custom command').trigger('click');
    await wrapper.get('#profile-name').setValue('Check locally');
    await wrapper.get('#profile-command').setValue('node check.cjs');
    await wrapper.get('#profile-directory').setValue('');
    await wrapper.get('form.command-picker__editor').trigger('submit'); await flushPromises();
    expect(api.saveRunProfile).toHaveBeenLastCalledWith('one', { name: 'Check locally', command: 'node check.cjs', directory: '.' });
    await wrapper.get('[aria-label="Edit Check locally"]').trigger('click');
    await wrapper.get('#profile-command').setValue('node verify.cjs');
    await wrapper.get('form.command-picker__editor').trigger('submit'); await flushPromises();
    expect(api.saveRunProfile).toHaveBeenLastCalledWith('one', { id: 'p-0', name: 'Check locally', command: 'node verify.cjs', directory: '.' });
    expect(wrapper.get('[aria-label="Pinned commands"]').text()).toContain('node verify.cjs');
  });

});
