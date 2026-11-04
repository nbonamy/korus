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
  };
  const host: WindowStateHost = {
    api: () => api as unknown as AppApi,
    agentExists: () => true,
    showAgent: vi.fn(),
    teamExists: () => true,
    showTeam: vi.fn(),
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

  it('knows when it is a window for one agent', async () => {
    const { host, state } = setup({ windowId: 1, viewState: { agentId: 'agent-1', scope: 'agent' }, nativeOwners: [], composerDrafts: {} });
    await state.start(host);
    expect(state.scope.value).toBe('agent');
    expect(state.agentId.value).toBe('agent-1');
    expect(state.teamId.value).toBeNull();
  });

  it('selects the team of a team window and remembers it', async () => {
    const { host, state } = setup({ windowId: 1, viewState: { teamId: 'team-1', scope: 'team' }, nativeOwners: [], composerDrafts: {} });
    await state.start(host);
    expect(host.showTeam).toHaveBeenCalledWith('team-1');
    expect(state.teamId.value).toBe('team-1');
  });

  it('selects the team of a feature window and remembers its branch', async () => {
    const { host, state } = setup({ windowId: 1, viewState: { teamId: 'team-1', branch: 'feat1', scope: 'feature' }, nativeOwners: [], composerDrafts: {} });
    await state.start(host);
    expect(host.showTeam).toHaveBeenCalledWith('team-1');
    expect(state.teamId.value).toBe('team-1');
    expect(state.branch.value).toBe('feat1');
  });

  describe('panes a window starts with, or is handed', () => {
    const pane = { open: true, width: 420, activeTab: 'browser', tabs: ['browser'], browserUrl: 'https://example.com/' };

    it('gives the starting panes to the first listener once, whether it comes before or after the window starts', async () => {
      const early = setup({ windowId: 1, viewState: { setup: { 'agent-1': pane } }, nativeOwners: [], composerDrafts: {} });
      const first = vi.fn();
      early.state.onSetup(first);
      await early.state.start(early.host);
      expect(first).toHaveBeenCalledExactlyOnceWith({ 'agent-1': pane }, 'replace');
      await early.state.start(early.host);
      expect(first).toHaveBeenCalledOnce();
      const second = vi.fn();
      early.state.onSetup(second);
      expect(second).not.toHaveBeenCalled();

      const late = setup({ windowId: 1, viewState: { setup: { 'agent-1': pane } }, nativeOwners: [], composerDrafts: {} });
      await late.state.start(late.host);
      const listener = vi.fn();
      late.state.onSetup(listener);
      expect(listener).toHaveBeenCalledExactlyOnceWith({ 'agent-1': pane }, 'replace');
    });

    it('passes on panes handed over later as a patch, to every listener, until it stops listening', async () => {
      const { api, host, state } = setup({ windowId: 1, viewState: null, nativeOwners: [], composerDrafts: {} });
      let handOver: (setup: Record<string, typeof pane>) => void = () => undefined;
      Object.assign(api, { onWindowSetupApply: vi.fn((listener: typeof handOver) => { handOver = listener; return vi.fn(); }) });
      const listener = vi.fn();
      const stop = state.onSetup(listener);
      await state.start(host);
      expect(listener).not.toHaveBeenCalled();
      handOver({ 'agent-1': pane });
      expect(listener).toHaveBeenCalledExactlyOnceWith({ 'agent-1': pane }, 'patch');
      stop();
      handOver({ 'agent-1': pane });
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  it('is inert without a desktop host', async () => {
    const state = createWindowState();
    await state.start({ api: () => undefined, agentExists: () => true, showAgent: vi.fn(), teamExists: () => true, showTeam: vi.fn(), applyDraft: vi.fn() });
    expect(state.ownsNative('browser', 'agent-1')).toBe(true);
  });
});
