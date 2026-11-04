import { describe, expect, it, vi } from 'vitest';
import type { AppApi } from '@workspace/core/contracts';
import { createWindowState, type WindowStateHost } from '../window-state';

function setup(context: Awaited<ReturnType<NonNullable<AppApi['getWindowContext']>>>) {
  let owners: (entries: never[] | Array<{ resource: 'browser'; agentId: string; windowId: number }>) => void = () => undefined;
  const api = {
    getWindowContext: vi.fn().mockResolvedValue(context),
    onNativeOwnersChanged: vi.fn((listener: typeof owners) => { owners = listener; return vi.fn(); }),
    onComposerDraftChanged: vi.fn(() => vi.fn()),
    setWindowSelection: vi.fn().mockResolvedValue(undefined),
    setWindowScope: vi.fn().mockResolvedValue(undefined),
  };
  const host: WindowStateHost = {
    api: () => api as unknown as AppApi,
    agentExists: () => true,
    showAgent: vi.fn(),
    applyDraft: vi.fn(),
  };
  const state = createWindowState();
  return { api, host, state, changeOwners: (entries: Parameters<typeof owners>[0]) => owners(entries) };
}

describe('window state', () => {
  it('owns every native view while no other window holds one', async () => {
    const { host, state } = setup({ windowId: 1, viewState: null, nativeOwners: [], composerDrafts: {} });
    await state.start(host);
    expect(state.ownsNative('browser', 'agent-1')).toBe(true);
  });

  it('follows ownership changes announced by main', async () => {
    const { host, state, changeOwners } = setup({ windowId: 1, viewState: null, nativeOwners: [], composerDrafts: {} });
    await state.start(host);
    changeOwners([{ resource: 'browser', agentId: 'agent-1', windowId: 2 }]);
    expect(state.ownsNative('browser', 'agent-1')).toBe(false);
    expect(state.ownsNative('browser', 'agent-2')).toBe(true);
    changeOwners([{ resource: 'browser', agentId: 'agent-1', windowId: 1 }]);
    expect(state.ownsNative('browser', 'agent-1')).toBe(true);
  });

  it('reads the owners that exist when the window opens', async () => {
    const { host, state } = setup({ windowId: 2, viewState: null, nativeOwners: [{ resource: 'simulator', agentId: 'agent-1', windowId: 1 }], composerDrafts: {} });
    await state.start(host);
    expect(state.ownsNative('simulator', 'agent-1')).toBe(false);
    expect(state.ownsNative('browser', 'agent-1')).toBe(true);
  });

  it('does not report a selection before the initial view state was applied', async () => {
    const { api, host, state } = setup({ windowId: 1, viewState: { agentId: 'agent-2' }, nativeOwners: [], composerDrafts: {} });
    state.reportSelection(host.api(), 'agent-1');
    expect(api.setWindowSelection).not.toHaveBeenCalled();
    await state.start(host);
    expect(host.showAgent).toHaveBeenCalledWith('agent-2');
    state.reportSelection(host.api(), 'agent-2');
    expect(api.setWindowSelection).toHaveBeenCalledWith('agent-2');
  });

  it('reports a selection once, and again only when it changes', async () => {
    const { api, host, state } = setup({ windowId: 1, viewState: null, nativeOwners: [], composerDrafts: {} });
    await state.start(host);
    state.reportSelection(host.api(), 'agent-1');
    state.reportSelection(host.api(), 'agent-1');
    state.reportSelection(host.api(), null);
    expect(api.setWindowSelection.mock.calls).toEqual([['agent-1'], [null]]);
  });

  it('knows when it is a window for one agent, and widens to the workspace through main', async () => {
    const { api, host, state } = setup({ windowId: 1, viewState: { agentId: 'agent-1', scope: 'agent' }, nativeOwners: [], composerDrafts: {} });
    await state.start(host);
    expect(state.scope.value).toBe('agent');
    state.setScope(host.api(), 'workspace');
    expect(state.scope.value).toBe('workspace');
    expect(api.setWindowScope).toHaveBeenCalledWith('workspace');
  });

  it('is inert without a desktop host', async () => {
    const state = createWindowState();
    await state.start({ api: () => undefined, agentExists: () => true, showAgent: vi.fn(), applyDraft: vi.fn() });
    expect(state.ownsNative('browser', 'agent-1')).toBe(true);
  });
});
