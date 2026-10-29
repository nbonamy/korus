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
  it('keeps the play menu to pinned commands even when there is a long run history', async () => {
    const { wrapper, api } = await setup({ getRunProfiles: vi.fn().mockResolvedValue({ ...catalog, runs: [run, { ...run, id: 'older', state: 'completed' }] }) });
    const menu = new DOMWrapper(document.body).get('[role="menu"]');
    expect(menu.findAll('[role="menuitem"]').map(item => item.get('.app-menu__label').text())).toStrictEqual(['Dev', 'Choose commands…']);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    await menuAction(wrapper, 'Dev').trigger('click'); await flushPromises();
    expect(wrapper.get('[aria-label="Command output"]').text()).toBe('ready');
    expect(api.startRunProfile).not.toHaveBeenCalled();
  });

  it('opens the source and pinned lists directly in one real dialog without preselecting or running commands', async () => {
    const { wrapper, api } = await setup({ getRunProfileActions: vi.fn().mockResolvedValue({ actions: [{ name: 'lint', command: 'npm run lint', directory: '.', source: 'package.json' }], warnings: [] }) }, {}, true);
    await button(wrapper, 'Choose commands…').trigger('click'); await flushPromises();
    expect(wrapper.findAll('[role="dialog"]')).toHaveLength(1);
    expect(wrapper.get('[aria-label="Available commands"]').text()).toContain('npm run lint');
    expect(wrapper.get('[aria-label="Pinned commands"]').text()).toContain('npm run dev');
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0);
    await button(wrapper, 'Done').trigger('click'); await flushPromises();
    expect(wrapper.find('[aria-label="Available commands"]').exists()).toBe(false);
    expect(api.startRunProfile).not.toHaveBeenCalled(); expect(api.saveRunProfile).not.toHaveBeenCalled();
  });

  it('starts the selected command directly and keeps run output and Stop together', async () => {
    const { wrapper, api } = await setup();
    api.getRunProfiles.mockResolvedValue({ ...catalog, runs: [run] });
    await menuAction(wrapper, 'Dev').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="dialog"]').text()).toContain('npm run dev');
    expect(wrapper.get('[role="dialog"]').text()).toContain('/repo/tree');
    expect(wrapper.get('[role="dialog"]').text()).toContain('Local host');
    expect(api.startRunProfile).toHaveBeenCalledExactlyOnceWith('one', { profileId: 'dev', command: 'npm run dev', cwd: '/repo/tree' });
    expect(wrapper.get('[aria-label="Command output"]').text()).toBe('ready');
    api.getRunProfiles.mockResolvedValue({ ...catalog, runs: [{ ...run, state: 'stopped' }] });
    await button(wrapper, 'Stop').trigger('click'); await flushPromises();
    expect(api.stopProfileRun).toHaveBeenCalledExactlyOnceWith('one', 'run');
    expect(wrapper.text()).toContain('stopped');
    expect(button(wrapper, 'Stop')).toBeUndefined();
    await button(wrapper, 'Close').trigger('click');
    api.getRunProfiles.mockResolvedValue({ ...catalog, profiles: [{ ...profile, command: 'npm run serve' }], runs: [{ ...run, state: 'stopped' }] });
    await wrapper.get('[aria-label="Run profiles"]').trigger('click'); await flushPromises();
    await menuAction(wrapper, 'Dev').trigger('click');
    expect(wrapper.get('[role="dialog"]').text()).toContain('npm run serve');
    expect(wrapper.find('[aria-label="Command output"]').exists()).toBe(false);

  });

  it('opens local previews and keeps remote loopback previews unavailable', async () => {
    const { wrapper } = await setup(); await menuAction(wrapper, 'Dev').trigger('click');
    await button(wrapper, 'Preview').trigger('click');
    expect(wrapper.emitted('preview')).toStrictEqual([[profile.previewUrl]]);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    wrapper.unmount();
    const remote = await setup({}, { hostLabel: 'devbox', previewAvailable: false });
    await menuAction(remote.wrapper, 'Dev').trigger('click');
    expect(button(remote.wrapper, 'Preview').attributes('disabled')).toBeDefined();
  });

  it('shows admission errors and discards late responses after switching agents without stopping owned runs', async () => {
    const { wrapper, api } = await setup({ startRunProfile: vi.fn().mockRejectedValue(new Error('Command or target changed. Review it again.')) });
    await menuAction(wrapper, 'Dev').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Command or target changed');
    await button(wrapper, 'Close').trigger('click'); wrapper.unmount();
    let resolve!: (value: RunProfileCatalog) => void;
    api.getRunProfiles.mockImplementationOnce(() => new Promise<RunProfileCatalog>(done => { resolve = done; }));
    const pending = mount(RunProfilesControl, { props: { agent, hostLabel: 'Local host', previewAvailable: true } });
    await pending.get('[aria-label="Run profiles"]').trigger('click');
    await pending.setProps({ agent: { ...agent, id: 'two' } }); resolve(catalog); await flushPromises();
    expect(pending.find('[role="dialog"]').exists()).toBe(false);
    expect(pending.find('[role="menu"]').exists()).toBe(false);
    expect(api.stopProfileRun).not.toHaveBeenCalled();
  });
});
