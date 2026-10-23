import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElDialog } from 'element-plus';
import type { Agent } from '@workspace/core/contracts';
import type { ProfileRun, RunProfileCatalog } from '@workspace/core/run-profiles';
import RunProfilesControl from '../RunProfilesControl.vue';
import { stubElectronTestWindow } from '../../test/client';

const agent = { id: 'one', name: 'One', folder: '/repo/tree', backend: 'codex', status: { type: 'idle' }, createdAt: '', updatedAt: '' } as Agent;
const profile = { id: 'dev', name: 'Dev', command: 'npm run dev', directory: '.', previewUrl: 'http://127.0.0.1:43210' };
const catalog: RunProfileCatalog = { repository: '/repo', worktree: '/repo/tree', profiles: [profile], targets: { dev: { cwd: '/repo/tree' } }, runs: [] };
const run: ProfileRun = { id: 'run', agentId: 'one', profileId: 'dev', command: profile.command, cwd: '/repo/tree', state: 'running', startedAt: '', output: 'ready', outputTruncated: false };
function button(wrapper: ReturnType<typeof mount>, text: string) { return [...wrapper.findAll('button'), ...new DOMWrapper(document.body).findAll('button')].find(b => b.text() === text)!; }
function menuAction(wrapper: ReturnType<typeof mount>, text: string) { return [...wrapper.findAll('[role="menuitem"]'), ...new DOMWrapper(document.body).findAll('[role="menuitem"]')].find(b => b.get('.app-menu__label').text() === text)!; }
async function setup(overrides = {}, props = {}, realDialogs = false) {
  const api = { getRunProfiles: vi.fn().mockResolvedValue(structuredClone(catalog)), getRunProfileActions: vi.fn().mockResolvedValue({ actions: [], warnings: [] }), startRunProfile: vi.fn().mockResolvedValue(run), saveRunProfile: vi.fn().mockResolvedValue(catalog), deleteRunProfile: vi.fn().mockResolvedValue(catalog), stopProfileRun: vi.fn().mockResolvedValue({ ...run, state: 'stopped' }), ...overrides };
  stubElectronTestWindow({ app: api });
  const wrapper = mount(RunProfilesControl, { props: { agent, hostLabel: 'Local host', previewAvailable: true, ...props }, global: realDialogs ? { stubs: { ElDialog, teleport: false, transition: false } } : {} });
  await wrapper.get('[aria-label="Run profiles"]').trigger('click');
  await flushPromises();
  return { wrapper, api };
}
afterEach(() => vi.useRealTimers());

describe('RunProfilesControl', () => {
  it('keeps import open through real dialog transitions and returns to configuration on Cancel', async () => {
    const { wrapper, api } = await setup({ getRunProfileActions: vi.fn().mockResolvedValue({ actions: [{ name: 'lint', command: 'npm run lint', directory: '.', source: 'package.json' }], warnings: [] }) }, {}, true);
    await button(wrapper, 'Configure…').trigger('click');
    await flushPromises();
    await button(wrapper, 'Import actions…').trigger('click');
    await flushPromises();
    await new Promise(resolve => setTimeout(resolve, 100));
    await flushPromises();
    expect(wrapper.get('[aria-label="Actions to import"]').text()).toContain('npm run lint');
    expect(api.saveRunProfile).not.toHaveBeenCalled();
    await button(wrapper, 'Cancel').trigger('click');
    await flushPromises();
    expect(button(wrapper, 'New profile').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Actions to import"]').exists()).toBe(false);
  });
  it('presents actions and Configure in the play dropdown without opening a dialog or executing', async () => {
    const { wrapper, api } = await setup();
    expect(wrapper.findComponent({ name: 'PlayerPlayIcon' }).exists()).toBe(true);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(new DOMWrapper(document.body).get('[role="menu"]').text()).toContain('Dev');
    await button(wrapper, 'Configure…').trigger('click');
    expect(wrapper.get('[role="dialog"]').text()).toContain('Run profiles');
    expect(api.startRunProfile).not.toHaveBeenCalled();
  });
  it('opens without autorun and requires the displayed command/host/target before execution', async () => {
    const { wrapper, api } = await setup();
    expect(api.startRunProfile).not.toHaveBeenCalled();
    await menuAction(wrapper, 'Dev').trigger('click');
    expect(wrapper.get('[role="dialog"]').text()).toContain('npm run dev');
    expect(wrapper.get('[role="dialog"]').text()).toContain('/repo/tree');
    expect(wrapper.get('[role="dialog"]').text()).toContain('Local host');
    expect(api.startRunProfile).not.toHaveBeenCalled();
    api.getRunProfiles.mockResolvedValue({ ...catalog, runs: [run] });
    await button(wrapper, 'Run command').trigger('click');
    await flushPromises();
    expect(api.startRunProfile).toHaveBeenCalledExactlyOnceWith('one', { profileId: 'dev', command: 'npm run dev', cwd: '/repo/tree' });
    expect(wrapper.get('[aria-label="Command output"]').text()).toBe('ready');
    api.getRunProfiles.mockResolvedValue({ ...catalog, runs: [{ ...run, state: 'stopped' }] });
    await button(wrapper, 'Stop').trigger('click');
    await flushPromises();
    expect(api.stopProfileRun).toHaveBeenCalledExactlyOnceWith('one', 'run');
    expect(wrapper.text()).toContain('stopped');
    expect(button(wrapper, 'Stop')).toBeUndefined();
  });

  it('creates, edits and deletes profiles only through explicit controls', async () => {
    const { wrapper, api } = await setup();
    await button(wrapper, 'Configure…').trigger('click');
    await button(wrapper, 'New profile').trigger('click');
    await wrapper.get('#profile-name').setValue('Lint');
    await wrapper.get('#profile-command').setValue('npm run lint');
    await wrapper.get('#run-profile-editor').trigger('submit');
    await flushPromises();
    expect(api.saveRunProfile).toHaveBeenCalledWith('one', { name: 'Lint', command: 'npm run lint', directory: '.' });
    await button(wrapper, 'Edit Dev').trigger('click');
    await wrapper.get('#profile-command').setValue('npm run start');
    await wrapper.get('#run-profile-editor').trigger('submit');
    await flushPromises();
    expect(api.saveRunProfile).toHaveBeenLastCalledWith('one', { ...profile, command: 'npm run start' });
    await button(wrapper, 'Delete Dev').trigger('click');
    await flushPromises();
    expect(api.deleteRunProfile).toHaveBeenCalledExactlyOnceWith('one', 'dev');
    expect(api.startRunProfile).not.toHaveBeenCalled();
  });

  it('opens the configured preview through the owning workspace and blocks remote localhost previews', async () => {
    const { wrapper } = await setup();
    await button(wrapper, 'Configure…').trigger('click');
    await button(wrapper, 'Preview Dev').trigger('click');
    expect(wrapper.emitted('preview')).toStrictEqual([[profile.previewUrl]]);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    const remote = await setup({}, { hostLabel: 'devbox', previewAvailable: false });
    await button(remote.wrapper, 'Configure…').trigger('click');
    expect(button(remote.wrapper, 'Preview Dev').attributes('disabled')).toBeDefined();
  });

  it('shows actionable failures and rejects stale selection responses after switching agents', async () => {
    const startRunProfile = vi.fn().mockRejectedValue(new Error('Command or target changed. Review it again.'));
    const { wrapper, api } = await setup({ startRunProfile });
    await menuAction(wrapper, 'Dev').trigger('click');
    await button(wrapper, 'Run command').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Command or target changed');
    let resolve!: (value: RunProfileCatalog) => void;
    api.getRunProfiles.mockImplementationOnce(() => new Promise<RunProfileCatalog>(done => { resolve = done; }));
    await button(wrapper, 'Cancel').trigger('click');
    await button(wrapper, 'Close').trigger('click');
    wrapper.unmount();
    const pending = mount(RunProfilesControl, { props: { agent, hostLabel: 'Local host', previewAvailable: true } });
    await pending.get('[aria-label="Run profiles"]').trigger('click');
    await pending.setProps({ agent: { ...agent, id: 'two' } });
    resolve(catalog);
    await flushPromises();
    expect(pending.find('[role="dialog"]').exists()).toBe(false);
    expect(pending.find('[role="menu"]').exists()).toBe(false);
    expect(api.stopProfileRun).not.toHaveBeenCalled();
  });
});
