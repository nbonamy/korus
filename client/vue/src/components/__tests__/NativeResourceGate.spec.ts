import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import NativeResourceGate from '../NativeResourceGate.vue';
import { setElectronTestClient } from '../../../tests/support/client';
import { windowState } from '../../window-state';
import type { AppApi } from '@workspace/core/contracts';

const View = defineComponent({ template: '<div class="view">native view</div>' });

async function mountGate(overrides: Partial<AppApi> = {}, owners: Array<{ resource: 'browser'; agentId: string; windowId: number }> = []) {
  let changeOwners: (entries: typeof owners) => void = () => undefined;
  const api = {
    getWindowContext: vi.fn().mockResolvedValue({ windowId: 1, viewState: null, nativeOwners: owners, composerDrafts: {} }),
    onNativeOwnersChanged: vi.fn((listener: typeof changeOwners) => { changeOwners = listener; return () => undefined; }),
    onComposerDraftChanged: vi.fn(() => () => undefined),
    claimNativeResource: vi.fn().mockResolvedValue(true),
    releaseNativeResource: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } satisfies Partial<AppApi>;
  setElectronTestClient(api);
  await windowState.start({ api: () => window.app, agentExists: () => true, showAgent: vi.fn(), teamExists: () => true, showTeam: vi.fn(), applyDraft: vi.fn() });
  const wrapper = mount(NativeResourceGate, { props: { resource: 'browser', agentId: 'agent-1' }, slots: { default: View } });
  await flushPromises();
  return { api, wrapper, changeOwners: async (entries: typeof owners) => { changeOwners(entries); await flushPromises(); } };
}

afterEach(() => windowState.stop());

describe('NativeResourceGate', () => {
  it('mounts the view and claims it for this window', async () => {
    const { api, wrapper } = await mountGate();
    expect(wrapper.find('.view').exists()).toBe(true);
    expect(api.claimNativeResource).toHaveBeenCalledWith('browser', 'agent-1', false);
  });

  it('releases the claim when the view goes away', async () => {
    const { api, wrapper } = await mountGate();
    wrapper.unmount();
    expect(api.releaseNativeResource).toHaveBeenCalledWith('browser', 'agent-1');
  });

  it('releases a pending claim if its gate unmounts before the reply', async () => {
    let complete!: (result: boolean) => void;
    const { api, wrapper } = await mountGate({
      claimNativeResource: vi.fn(() => new Promise<boolean>(resolve => { complete = resolve; })),
    });
    wrapper.unmount();
    expect(api.releaseNativeResource).not.toHaveBeenCalled();
    complete(true);
    await flushPromises();
    expect(api.releaseNativeResource).toHaveBeenCalledExactlyOnceWith('browser', 'agent-1');
  });

  it('offers to move the view here instead of mounting it a second time', async () => {
    const { api, wrapper, changeOwners } = await mountGate(
      { claimNativeResource: vi.fn().mockResolvedValue(false) },
      [{ resource: 'browser', agentId: 'agent-1', windowId: 2 }],
    );
    expect(wrapper.find('.view').exists()).toBe(false);
    expect(wrapper.text()).toContain('open in another window');

    vi.mocked(api.claimNativeResource).mockImplementation(async () => {
      // Main announces the new owner before the claim response reaches this window.
      await changeOwners([{ resource: 'browser', agentId: 'agent-1', windowId: 1 }]);
      return true;
    });
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(api.claimNativeResource).toHaveBeenLastCalledWith('browser', 'agent-1', true);
    expect(wrapper.find('.view').exists()).toBe(true);
    expect(api.claimNativeResource).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    expect(api.releaseNativeResource).toHaveBeenCalledExactlyOnceWith('browser', 'agent-1');
  });

  it('hands the view over when another window takes it, and reclaims it once that window lets go', async () => {
    const { api, wrapper, changeOwners } = await mountGate();
    expect(wrapper.find('.view').exists()).toBe(true);

    await changeOwners([{ resource: 'browser', agentId: 'agent-1', windowId: 2 }]);
    expect(wrapper.find('.view').exists()).toBe(false);
    expect(api.releaseNativeResource).not.toHaveBeenCalled();

    await changeOwners([]);
    expect(wrapper.find('.view').exists()).toBe(true);
    expect(api.claimNativeResource).toHaveBeenCalledTimes(2);
  });
});
