import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import RunProfileImport from '../RunProfileImport.vue';
import { stubElectronTestWindow } from '../../test/client';

const actions = [
  { name: 'dev', command: 'npm run dev', directory: 'app', source: 'app/package.json' },
  { name: 'check', command: 'make -f Makefile check', directory: 'app', source: 'app/Makefile' },
];
const button = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll('button').find(button => button.text() === text)!;
function setup(profiles = [] as Array<{ id: string; name: string; command: string; directory: string }>) {
  const api = { getRunProfileActions: vi.fn().mockResolvedValue({ actions, warnings: [] }), saveRunProfile: vi.fn().mockResolvedValue({}) };
  stubElectronTestWindow({ app: api });
  return { api, wrapper: mount(RunProfileImport, { props: { agentId: 'one', profiles } }) };
}

describe('RunProfileImport', () => {
  it('shows source and command before explicitly importing only the selected actions', async () => {
    const { api, wrapper } = setup();
    await flushPromises();
    expect(api.saveRunProfile).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('app/package.json');
    expect(wrapper.text()).toContain('npm run dev');
    await wrapper.findAll('input[type="checkbox"]')[1].setValue(false);
    await button(wrapper, 'Import 1 actions').trigger('click');
    await flushPromises();
    expect(api.saveRunProfile).toHaveBeenCalledExactlyOnceWith('one', { name: 'dev', command: 'npm run dev', directory: 'app' });
    expect(wrapper.emitted('done')).toStrictEqual([[]]);
  });

  it('avoids duplicate imports and rescans the chosen directory without saving on Cancel', async () => {
    const { api, wrapper } = setup([{ id: 'existing', ...actions[0] }]);
    await flushPromises();
    expect(wrapper.findAll('input[type="checkbox"]')[0].attributes('disabled')).toBeDefined();
    await wrapper.get('#import-directory').setValue('packages/web');
    expect(button(wrapper, 'Import 0 actions').attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.getRunProfileActions).toHaveBeenLastCalledWith('one', 'packages/web');
    await button(wrapper, 'Cancel').trigger('click');
    expect(wrapper.emitted('cancel')).toStrictEqual([[]]);
    expect(api.saveRunProfile).not.toHaveBeenCalled();
  });

  it('reports a partial import failure and retries only actions that were not already saved', async () => {
    const { api, wrapper } = setup();
    api.saveRunProfile.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Owning host unavailable'));
    await flushPromises();
    await button(wrapper, 'Import 2 actions').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Owning host unavailable');
    await button(wrapper, 'Import 1 actions').trigger('click');
    await flushPromises();
    expect(api.saveRunProfile.mock.calls.map(([, input]) => input.command)).toStrictEqual(['npm run dev', 'make -f Makefile check', 'make -f Makefile check']);
    expect(wrapper.emitted('done')).toStrictEqual([[]]);
  });
});
